use std::{
    env,
    fs::{self, OpenOptions},
    net::SocketAddr,
    path::PathBuf,
    process::Stdio,
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tokio::{process::Command, time};
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const MAX_DESCRIPTION_LEN: usize = 500;

#[derive(Clone)]
struct AppState {
    task: TaskConfig,
}

/// Runtime configuration for Taskwarrior commands
#[derive(Clone)]
pub struct TaskConfig {
    taskrc: Option<PathBuf>,
    taskdata: Option<PathBuf>,
    lock_path: PathBuf,
    sync: bool,
    timeout: Duration,
}

#[derive(Deserialize)]
struct AddTaskRequest {
    description: String,
}

#[derive(Serialize)]
struct TaskItem {
    line: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

struct AppError {
    status: StatusCode,
    message: String,
}

struct CommandResult {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
}

/// Starts the HTTP server and serves the API plus static frontend
#[tokio::main]
pub async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();

    let task = TaskConfig::from_env();
    let app = app(task);
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".to_string())
        .parse()
        .context("invalid BIND_ADDR")?;

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Builds the axum router
pub fn app(task: TaskConfig) -> Router {
    let state = AppState { task };

    Router::new()
        .route("/health", get(health))
        .route("/api/tasks", get(tasks).post(add_task))
        .nest_service(
            "/",
            ServeDir::new("public").append_index_html_on_directories(true),
        )
        .with_state(state)
}

impl TaskConfig {
    /// Loads Taskwarrior paths and command timeout from environment variables
    pub fn from_env() -> Self {
        let taskrc = env::var_os("TASKRC").map(PathBuf::from);
        let taskdata = env::var_os("TASKDATA").map(PathBuf::from);
        let lock_path = env::var_os("TASK_LOCK")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                taskdata
                    .clone()
                    .unwrap_or_else(|| PathBuf::from(".dev/task"))
                    .join("task.lock")
            });
        let timeout_secs = env::var("TASK_TIMEOUT_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(10);
        let sync = env::var("TASK_SYNC")
            .map(|value| value != "false" && value != "0")
            .unwrap_or(true);

        Self {
            taskrc,
            taskdata,
            lock_path,
            sync,
            timeout: Duration::from_secs(timeout_secs),
        }
    }
}

/// Returns a basic liveness response
async fn health() -> &'static str {
    "OK"
}

/// Returns tasks from `task next` in Taskwarrior priority order
async fn tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskItem>>, AppError> {
    let output = run_task(&state.task, ["next"]).await?;
    ensure_next_success(output.status, &output.stdout, &output.stderr)?;

    Ok(Json(task_lines(output.stdout)))
}

/// Adds an Inbox task due tomorrow, syncs Taskwarrior, and returns the updated list
async fn add_task(
    State(state): State<AppState>,
    Json(payload): Json<AddTaskRequest>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    let description = payload.description.trim();
    if description.is_empty() {
        return Err(AppError::bad_request("description cannot be empty"));
    }
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(AppError::bad_request("description is too long"));
    }

    with_task_lock(&state.task, || async {
        let output = run_task(
            &state.task,
            ["add", "project:Inbox", "due:tomorrow", description],
        )
        .await?;
        ensure_success("task add", output.status, &output.stderr)?;

        if state.task.sync {
            let output = run_task(&state.task, ["sync"]).await?;
            ensure_success("task sync", output.status, &output.stderr)?;
        }

        let output = run_task(&state.task, ["next"]).await?;
        ensure_next_success(output.status, &output.stdout, &output.stderr)?;
        Ok(Json(task_lines(output.stdout)))
    })
    .await
}

fn task_lines(stdout: String) -> Vec<TaskItem> {
    stdout
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(|line| TaskItem {
            line: line.to_string(),
        })
        .collect()
}

async fn with_task_lock<F, Fut, T>(config: &TaskConfig, work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    let lock_path = config.lock_path.clone();
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| AppError::internal(format!("failed to create lock directory: {err}")))?;
    }

    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(|err| AppError::internal(format!("failed to open task lock: {err}")))?;
    file.lock_exclusive()
        .map_err(|err| AppError::internal(format!("failed to lock task data: {err}")))?;

    let result = work().await;
    let unlock_result = file.unlock();
    if let Err(err) = unlock_result {
        return Err(AppError::internal(format!(
            "failed to unlock task data: {err}"
        )));
    }

    result
}

async fn run_task<I, S>(config: &TaskConfig, args: I) -> Result<CommandResult, AppError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = Command::new("task");
    command.args(args);
    command.kill_on_drop(true);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    if let Some(taskrc) = &config.taskrc {
        command.env("TASKRC", taskrc);
    }
    if let Some(taskdata) = &config.taskdata {
        command.env("TASKDATA", taskdata);
    }

    let child = command
        .spawn()
        .map_err(|err| AppError::internal(format!("failed to start task: {err}")))?;
    let output = time::timeout(config.timeout, child.wait_with_output())
        .await
        .map_err(|_| AppError::gateway_timeout("task command timed out"))?
        .map_err(|err| AppError::internal(format!("task command failed: {err}")))?;

    Ok(CommandResult {
        status: output.status,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn ensure_success(
    command: &str,
    status: std::process::ExitStatus,
    stderr: &str,
) -> Result<(), AppError> {
    if status.success() {
        return Ok(());
    }

    let stderr = stderr.trim();
    if stderr.is_empty() {
        return Err(AppError::internal(format!(
            "{command} failed with status {status}"
        )));
    }

    Err(AppError::internal(format!(
        "{command} failed with status {status}: {stderr}"
    )))
}

fn ensure_next_success(
    status: std::process::ExitStatus,
    stdout: &str,
    stderr: &str,
) -> Result<(), AppError> {
    if status.success() || stdout.is_empty() && stderr.is_empty() {
        return Ok(());
    }

    ensure_success("task next", status, stderr)
}

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn gateway_timeout(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::GATEWAY_TIMEOUT,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_config_defaults_to_dev_lock() {
        env::remove_var("TASKRC");
        env::remove_var("TASKDATA");
        env::remove_var("TASK_LOCK");
        let config = TaskConfig::from_env();
        assert_eq!(config.lock_path, PathBuf::from(".dev/task/task.lock"));
    }
}
