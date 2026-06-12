use std::{
    collections::HashMap,
    env,
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    net::SocketAddr,
    path::PathBuf,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use axum::{
    extract::{Path, State},
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        HeaderMap, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tokio::{process::Command, time};
use tower_http::compression::CompressionLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const MAX_DESCRIPTION_LEN: usize = 500;
const INDEX_CACHE_CONTROL: &str = "no-cache";
const ASSET_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

#[derive(Clone)]
struct AppState {
    task: TaskConfig,
    workflow: WorkflowConfig,
}

/// Runtime configuration for Taskwarrior commands
#[derive(Clone)]
pub struct TaskConfig {
    taskrc: Option<PathBuf>,
    taskdata: Option<PathBuf>,
    home: Option<PathBuf>,
    lock_path: PathBuf,
    sync: bool,
    timeout: Duration,
}

#[derive(Clone)]
struct WorkflowConfig {
    path: PathBuf,
    lock_path: PathBuf,
    default_user: String,
}

#[derive(Deserialize)]
struct AddTaskRequest {
    description: String,
    uri: Option<String>,
    due: Option<String>,
}

#[derive(Deserialize)]
struct AddAnnotationRequest {
    annotation: String,
}

#[derive(Deserialize)]
struct SplitTaskRequest {
    descriptions: Vec<String>,
}

#[derive(Deserialize)]
struct DeleteTaskRequest {
    reason: String,
    confirmation: String,
}

#[derive(Deserialize)]
struct DeclareBacklogRequest {
    ids: Vec<u64>,
}

#[derive(Serialize)]
struct TaskItem {
    description: String,
    id: Option<u64>,
    uuid: Option<String>,
    project: Option<String>,
    due: Option<String>,
    uri: Option<String>,
    tags: Vec<String>,
    urg: Option<f64>,
    annotations: Vec<TaskAnnotation>,
}

#[derive(Deserialize)]
struct TaskExportItem {
    description: String,
    id: Option<u64>,
    uuid: Option<String>,
    project: Option<String>,
    due: Option<String>,
    uri: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    urgency: Option<f64>,
    #[serde(default)]
    annotations: Vec<TaskAnnotation>,
}

#[derive(Clone, Deserialize, Serialize)]
struct TaskAnnotation {
    entry: String,
    description: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Deserialize)]
struct WorkflowSessionRequest {
    session: serde_json::Value,
}

#[derive(Serialize)]
struct WorkflowSessionResponse {
    user: String,
    session: Option<serde_json::Value>,
    updated_at: Option<u64>,
}

#[derive(Default, Deserialize, Serialize)]
struct WorkflowStore {
    version: u8,
    users: HashMap<String, StoredWorkflowSession>,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredWorkflowSession {
    updated_at: u64,
    session: serde_json::Value,
}

#[derive(Debug)]
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
    let state = AppState {
        task,
        workflow: WorkflowConfig::from_env(),
    };

    Router::new()
        .route("/health", get(health))
        .route("/", get(index))
        .route("/index.html", get(index))
        .route("/app.js", get(asset_app_js))
        .route("/style.css", get(asset_style_css))
        .route("/favicon.ico", get(asset_favicon_ico))
        .route("/favicon.png", get(asset_favicon_png))
        .route("/favicon-32.png", get(asset_favicon_32_png))
        .route("/icon-192.png", get(asset_icon_192_png))
        .route("/api/tasks", get(tasks).post(add_task))
        .route("/api/tasks/:id", delete(delete_task))
        .route("/api/tasks/:id/complete", post(complete_task))
        .route("/api/tasks/:id/annotations", post(add_annotation))
        .route("/api/tasks/:id/release", post(release_task))
        .route("/api/tasks/:id/split", post(split_task))
        .route("/api/backlog/declare", post(declare_backlog))
        .route(
            "/api/workflow-session",
            get(workflow_session)
                .put(save_workflow_session)
                .delete(clear_workflow_session),
        )
        .layer(CompressionLayer::new())
        .with_state(state)
}

impl TaskConfig {
    /// Loads Taskwarrior paths and command timeout from environment variables
    pub fn from_env() -> Self {
        let taskrc = env::var_os("TASKRC").map(PathBuf::from);
        let taskdata = env::var_os("TASKDATA").map(PathBuf::from);
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| taskrc.as_deref().and_then(taskrc_home));
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
            home,
            lock_path,
            sync,
            timeout: Duration::from_secs(timeout_secs),
        }
    }
}

impl WorkflowConfig {
    fn from_env() -> Self {
        let path = env::var_os("DOIT_SESSION_FILE")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".local/share/doit/session.json"))
            })
            .unwrap_or_else(|| PathBuf::from("/root/.local/share/doit/session.json"));
        let lock_path = env::var_os("DOIT_SESSION_LOCK")
            .map(PathBuf::from)
            .unwrap_or_else(|| path.with_extension("lock"));
        let default_user = env::var("DOIT_DEFAULT_USER_EMAIL")
            .unwrap_or_else(|_| "portalier.g@gmail.com".to_string());

        Self {
            path,
            lock_path,
            default_user,
        }
    }
}

/// Returns a basic liveness response
async fn health() -> &'static str {
    "OK"
}

async fn index() -> Result<Response, AppError> {
    static_file(
        "index.html",
        "text/html; charset=utf-8",
        INDEX_CACHE_CONTROL,
    )
    .await
}

async fn asset_app_js() -> Result<Response, AppError> {
    static_file(
        "app.js",
        "text/javascript; charset=utf-8",
        ASSET_CACHE_CONTROL,
    )
    .await
}

async fn asset_style_css() -> Result<Response, AppError> {
    static_file("style.css", "text/css; charset=utf-8", ASSET_CACHE_CONTROL).await
}

async fn asset_favicon_ico() -> Result<Response, AppError> {
    static_file("favicon.ico", "image/x-icon", ASSET_CACHE_CONTROL).await
}

async fn asset_favicon_png() -> Result<Response, AppError> {
    static_file("favicon.png", "image/png", ASSET_CACHE_CONTROL).await
}

async fn asset_favicon_32_png() -> Result<Response, AppError> {
    static_file("favicon-32.png", "image/png", ASSET_CACHE_CONTROL).await
}

async fn asset_icon_192_png() -> Result<Response, AppError> {
    static_file("icon-192.png", "image/png", ASSET_CACHE_CONTROL).await
}

async fn static_file(
    filename: &str,
    content_type: &'static str,
    cache_control: &'static str,
) -> Result<Response, AppError> {
    let path = PathBuf::from("public").join(filename);
    let body = fs::read(&path).map_err(|error| {
        AppError::internal(format!("failed to read {}: {}", path.display(), error))
    })?;

    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    Ok(response)
}

/// Syncs Taskwarrior and returns pending tasks in priority order
async fn tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskItem>>, AppError> {
    with_task_lock(&state.task, || async {
        sync_tasks(&state.task).await?;
        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Adds an Inbox task, syncs Taskwarrior, and returns the updated list
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
    let uri = payload
        .uri
        .as_deref()
        .map(str::trim)
        .filter(|uri| !uri.is_empty());
    let due = match payload.due.as_deref().map(str::trim) {
        None | Some("") | Some("tomorrow") => "tomorrow",
        Some("today") => "today",
        Some(_) => return Err(AppError::bad_request("due must be today or tomorrow")),
    };

    with_task_lock(&state.task, || async {
        let mut args = vec![
            OsString::from("add"),
            OsString::from("project:Inbox"),
            OsString::from(format!("due:{due}")),
        ];
        if due == "today" {
            args.push(OsString::from("+extra"));
        }
        if let Some(uri) = uri {
            args.push(OsString::from(format!("uri:{uri}")));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(description));

        let output = run_task(&state.task, args).await?;
        ensure_success("task add", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Splits a pending task into smaller Inbox tasks, annotates them, and deletes the original
async fn split_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Json(payload): Json<SplitTaskRequest>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    let descriptions = payload
        .descriptions
        .iter()
        .map(|description| description.trim().to_string())
        .filter(|description| !description.is_empty())
        .collect::<Vec<_>>();
    if descriptions.is_empty() {
        return Err(AppError::bad_request("at least one split task is required"));
    }
    if descriptions
        .iter()
        .any(|description| description.chars().count() > MAX_DESCRIPTION_LEN)
    {
        return Err(AppError::bad_request("description is too long"));
    }

    with_task_lock(&state.task, || async {
        let mut tasks = list_tasks(&state.task).await?;
        let Some(original) = tasks.iter().find(|task| task.id == Some(id)) else {
            return Err(AppError::not_found("task not found"));
        };
        let original_description = format!("Split task from: {}", original.description);
        let mut known_ids = tasks.iter().filter_map(|task| task.id).collect::<Vec<_>>();

        for description in descriptions {
            let output = run_task(
                &state.task,
                [
                    "add".to_string(),
                    "project:Inbox".to_string(),
                    "due:tomorrow".to_string(),
                    "--".to_string(),
                    description.clone(),
                ],
            )
            .await?;
            ensure_success("task add", output.status, &output.stderr)?;

            tasks = list_tasks(&state.task).await?;
            let Some(new_id) = tasks
                .iter()
                .filter_map(|task| task.id.map(|task_id| (task_id, task)))
                .find(|(task_id, task)| {
                    !known_ids.contains(task_id) && task.description == description
                })
                .or_else(|| {
                    tasks
                        .iter()
                        .filter_map(|task| task.id.map(|task_id| (task_id, task)))
                        .find(|(task_id, _)| !known_ids.contains(task_id))
                })
                .map(|(task_id, _)| task_id)
            else {
                return Err(AppError::internal("failed to find split task"));
            };
            known_ids.push(new_id);

            let output = run_task(
                &state.task,
                [
                    new_id.to_string(),
                    "annotate".to_string(),
                    "--".to_string(),
                    original_description.clone(),
                ],
            )
            .await?;
            ensure_success("task annotate", output.status, &output.stderr)?;
        }

        let output = run_task(&state.task, [id.to_string(), "delete".to_string()]).await?;
        ensure_success("task delete", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Marks a pending task complete, syncs Taskwarrior, and returns the updated list
async fn complete_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    with_task_lock(&state.task, || async {
        let output = run_task(&state.task, [id.to_string(), "done".to_string()]).await?;
        ensure_success("task done", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Deletes a pending task after reason and typed confirmation checks
async fn delete_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Json(payload): Json<DeleteTaskRequest>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    let reason = payload.reason.trim();
    if reason.is_empty() {
        return Err(AppError::bad_request("reason cannot be empty"));
    }
    if reason.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(AppError::bad_request("reason is too long"));
    }
    if payload.confirmation != "delete" {
        return Err(AppError::bad_request("type delete to confirm"));
    }

    with_task_lock(&state.task, || async {
        let tasks = list_tasks(&state.task).await?;
        if !tasks.iter().any(|task| task.id == Some(id)) {
            return Err(AppError::not_found("task not found"));
        }

        let output = run_task(
            &state.task,
            [
                id.to_string(),
                "annotate".to_string(),
                "--".to_string(),
                format!("Delete reason: {reason}"),
            ],
        )
        .await?;
        ensure_success("task annotate", output.status, &output.stderr)?;

        let output = run_task(&state.task, [id.to_string(), "delete".to_string()]).await?;
        ensure_success("task delete", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Adds an annotation to a pending task, syncs Taskwarrior, and returns the updated list
async fn add_annotation(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Json(payload): Json<AddAnnotationRequest>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    let annotation = payload.annotation.trim();
    if annotation.is_empty() {
        return Err(AppError::bad_request("annotation cannot be empty"));
    }
    with_task_lock(&state.task, || async {
        let output = run_task(
            &state.task,
            [
                id.to_string(),
                "annotate".to_string(),
                "--".to_string(),
                annotation.to_string(),
            ],
        )
        .await?;
        ensure_success("task annotate", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Adds selected pending tasks to the backlog, syncs Taskwarrior, and returns the updated list
async fn declare_backlog(
    State(state): State<AppState>,
    Json(payload): Json<DeclareBacklogRequest>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    let ids = payload
        .ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err(AppError::bad_request("at least one task is required"));
    }

    with_task_lock(&state.task, || async {
        let tasks = list_tasks(&state.task).await?;
        let task_ids = tasks
            .iter()
            .filter(|task| task.id.is_some() && !task.tags.iter().any(|tag| tag == "backlog"))
            .filter_map(|task| task.id)
            .collect::<Vec<_>>();

        for id in ids {
            if !task_ids.contains(&id) {
                continue;
            }
            let output = run_task(
                &state.task,
                [id.to_string(), "modify".to_string(), "+backlog".to_string()],
            )
            .await?;
            ensure_success("task modify", output.status, &output.stderr)?;

            let output = run_task(
                &state.task,
                [
                    id.to_string(),
                    "annotate".to_string(),
                    "--".to_string(),
                    format!("Declared backlog: {}", local_day()),
                ],
            )
            .await?;
            ensure_success("task annotate", output.status, &output.stderr)?;
        }

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

/// Releases a backlog task back to tomorrow, syncs Taskwarrior, and returns the updated list
async fn release_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Vec<TaskItem>>, AppError> {
    with_task_lock(&state.task, || async {
        let tasks = list_tasks(&state.task).await?;
        if !tasks.iter().any(|task| task.id == Some(id)) {
            return Err(AppError::not_found("task not found"));
        }

        let output = run_task(
            &state.task,
            [
                id.to_string(),
                "modify".to_string(),
                "-backlog".to_string(),
                "-extra".to_string(),
                "due:tomorrow".to_string(),
            ],
        )
        .await?;
        ensure_success("task modify", output.status, &output.stderr)?;

        sync_tasks(&state.task).await?;

        Ok(Json(list_tasks(&state.task).await?))
    })
    .await
}

async fn workflow_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WorkflowSessionResponse>, AppError> {
    let user = workflow_user(&headers, &state.workflow);
    with_workflow_lock(&state.workflow, || {
        let store = read_workflow_store(&state.workflow)?;
        let session = store.users.get(&user).cloned();
        Ok(Json(WorkflowSessionResponse {
            user,
            session: session.as_ref().map(|stored| stored.session.clone()),
            updated_at: session.map(|stored| stored.updated_at),
        }))
    })
}

async fn save_workflow_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WorkflowSessionRequest>,
) -> Result<Json<WorkflowSessionResponse>, AppError> {
    let user = workflow_user(&headers, &state.workflow);
    with_workflow_lock(&state.workflow, || {
        let mut store = read_workflow_store(&state.workflow)?;
        let updated_at = unix_timestamp();
        store.users.insert(
            user.clone(),
            StoredWorkflowSession {
                updated_at,
                session: payload.session,
            },
        );
        write_workflow_store(&state.workflow, &store)?;
        let session = store.users.get(&user).map(|stored| stored.session.clone());
        Ok(Json(WorkflowSessionResponse {
            user,
            session,
            updated_at: Some(updated_at),
        }))
    })
}

async fn clear_workflow_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WorkflowSessionResponse>, AppError> {
    let user = workflow_user(&headers, &state.workflow);
    with_workflow_lock(&state.workflow, || {
        let mut store = read_workflow_store(&state.workflow)?;
        store.users.remove(&user);
        write_workflow_store(&state.workflow, &store)?;
        Ok(Json(WorkflowSessionResponse {
            user,
            session: None,
            updated_at: None,
        }))
    })
}

async fn sync_tasks(config: &TaskConfig) -> Result<(), AppError> {
    if !config.sync {
        return Ok(());
    }

    let output = run_task(config, ["sync"]).await?;
    ensure_success("task sync", output.status, &output.stderr)
}

async fn list_tasks(config: &TaskConfig) -> Result<Vec<TaskItem>, AppError> {
    let output = run_task(config, ["status:pending", "-WAITING", "export"]).await?;
    ensure_success("task export", output.status, &output.stderr)?;
    task_items_from_export(&output.stdout)
}

fn task_items_from_export(stdout: &str) -> Result<Vec<TaskItem>, AppError> {
    let mut items: Vec<TaskItem> = serde_json::from_str::<Vec<TaskExportItem>>(stdout)
        .map_err(|err| AppError::internal(format!("failed to parse task export output: {err}")))?
        .into_iter()
        .filter(|task| !task.description.trim().is_empty())
        .map(|task| {
            let (description, uri) = task_description_and_uri(task.description, task.uri);
            let mut annotations = task.annotations;
            annotations.sort_by(|a, b| a.entry.cmp(&b.entry));
            TaskItem {
                description,
                id: task.id,
                uuid: task.uuid,
                project: task.project,
                due: task.due,
                uri,
                tags: task.tags,
                urg: task.urgency,
                annotations,
            }
        })
        .collect();
    items.sort_by(|a, b| {
        b.urg
            .partial_cmp(&a.urg)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

fn task_description_and_uri(description: String, uri: Option<String>) -> (String, Option<String>) {
    if uri.is_some() {
        return (description, uri);
    }

    if !description.starts_with("uri:") {
        return (description, None);
    }

    let mut parts = description.splitn(2, char::is_whitespace);
    let Some(uri_part) = parts.next() else {
        return (description, None);
    };
    let uri = uri_part.trim_start_matches("uri:");
    if uri.is_empty() {
        return (description, None);
    }

    let description = parts.next().unwrap_or("").trim_start().to_string();
    (description, Some(uri.to_string()))
}

fn workflow_user(headers: &HeaderMap, config: &WorkflowConfig) -> String {
    for header in [
        "cf-access-authenticated-user-email",
        "x-authenticated-user-email",
        "x-forwarded-email",
    ] {
        let Some(value) = headers.get(header).and_then(|value| value.to_str().ok()) else {
            continue;
        };
        let email = value.trim();
        if !email.is_empty() {
            return email.to_ascii_lowercase();
        }
    }

    config.default_user.trim().to_ascii_lowercase()
}

fn empty_workflow_store() -> WorkflowStore {
    WorkflowStore {
        version: 1,
        users: HashMap::new(),
    }
}

fn read_workflow_store(config: &WorkflowConfig) -> Result<WorkflowStore, AppError> {
    let Ok(contents) = fs::read_to_string(&config.path) else {
        return Ok(empty_workflow_store());
    };
    if contents.trim().is_empty() {
        return Ok(empty_workflow_store());
    }

    let mut store = match serde_json::from_str::<WorkflowStore>(&contents) {
        Ok(store) => store,
        Err(_) => {
            let store = empty_workflow_store();
            write_workflow_store(config, &store)?;
            return Ok(store);
        }
    };
    if store.version != 1 {
        store = empty_workflow_store();
        write_workflow_store(config, &store)?;
    }
    Ok(store)
}

fn write_workflow_store(config: &WorkflowConfig, store: &WorkflowStore) -> Result<(), AppError> {
    if let Some(parent) = config.path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::internal(format!("failed to create workflow state directory: {err}"))
        })?;
    }

    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|err| AppError::internal(format!("failed to serialize workflow state: {err}")))?;
    let temp_path = config.path.with_extension("tmp");
    fs::write(&temp_path, bytes)
        .map_err(|err| AppError::internal(format!("failed to write workflow state: {err}")))?;
    fs::rename(&temp_path, &config.path)
        .map_err(|err| AppError::internal(format!("failed to save workflow state: {err}")))
}

fn with_workflow_lock<F, T>(config: &WorkflowConfig, work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    if let Some(parent) = config.lock_path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::internal(format!("failed to create workflow lock directory: {err}"))
        })?;
    }

    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&config.lock_path)
        .map_err(|err| AppError::internal(format!("failed to open workflow lock: {err}")))?;
    file.lock_exclusive()
        .map_err(|err| AppError::internal(format!("failed to lock workflow state: {err}")))?;

    let result = work();
    let unlock_result = file.unlock();
    if let Err(err) = unlock_result {
        return Err(AppError::internal(format!(
            "failed to unlock workflow state: {err}"
        )));
    }

    result
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn local_day() -> String {
    let days = unix_timestamp() / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

async fn with_task_lock<F, Fut, T>(config: &TaskConfig, work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    let lock_path = config.lock_path.clone();
    let file = tokio::task::spawn_blocking(move || {
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppError::internal(format!("failed to create lock directory: {err}"))
            })?;
        }

        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&lock_path)
            .map_err(|err| AppError::internal(format!("failed to open task lock: {err}")))?;
        file.lock_exclusive()
            .map_err(|err| AppError::internal(format!("failed to lock task data: {err}")))?;
        Ok(file)
    })
    .await
    .map_err(|err| AppError::internal(format!("failed to join task lock worker: {err}")))??;

    let result = work().await;
    let unlock_result = tokio::task::spawn_blocking(move || file.unlock())
        .await
        .map_err(|err| AppError::internal(format!("failed to join task unlock worker: {err}")))?;
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
    S: AsRef<OsStr>,
{
    let mut command = Command::new("task");
    command.args(task_args(args));
    command.kill_on_drop(true);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    if let Some(taskrc) = &config.taskrc {
        command.env("TASKRC", taskrc);
    }
    if let Some(taskdata) = &config.taskdata {
        command.env("TASKDATA", taskdata);
    }
    if let Some(home) = &config.home {
        command.env("HOME", home);
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

fn task_args<I, S>(args: I) -> Vec<OsString>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command_args = vec![
        OsString::from("rc.confirmation:no"),
        OsString::from("rc.recurrence.confirmation:no"),
        OsString::from("rc.uda.uri.type:string"),
        OsString::from("rc.uda.uri.label:URI"),
    ];
    command_args.extend(args.into_iter().map(|arg| arg.as_ref().to_os_string()));
    command_args
}

fn taskrc_home(taskrc: &std::path::Path) -> Option<PathBuf> {
    taskrc
        .is_absolute()
        .then(|| taskrc.parent().map(PathBuf::from))
        .flatten()
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

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
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

    #[test]
    fn task_args_force_noninteractive_mode() {
        let args = task_args(["add", "project:Inbox", "due:tomorrow", "--", "project:Work"]);

        assert_eq!(
            args,
            vec![
                OsString::from("rc.confirmation:no"),
                OsString::from("rc.recurrence.confirmation:no"),
                OsString::from("rc.uda.uri.type:string"),
                OsString::from("rc.uda.uri.label:URI"),
                OsString::from("add"),
                OsString::from("project:Inbox"),
                OsString::from("due:tomorrow"),
                OsString::from("--"),
                OsString::from("project:Work"),
            ]
        );
    }

    #[test]
    fn taskrc_home_uses_absolute_taskrc_parent() {
        assert_eq!(
            taskrc_home(std::path::Path::new("/home/alice/.taskrc")),
            Some(PathBuf::from("/home/alice"))
        );
        assert_eq!(taskrc_home(std::path::Path::new(".dev/taskrc")), None);
    }

    #[test]
    fn workflow_user_uses_access_header_or_default_user() {
        let directory = tempfile::tempdir().expect("temp dir");
        let config = WorkflowConfig {
            path: directory.path().join("session.json"),
            lock_path: directory.path().join("session.lock"),
            default_user: "Portalier.G@Gmail.Com".to_string(),
        };
        let mut headers = HeaderMap::new();

        assert_eq!(workflow_user(&headers, &config), "portalier.g@gmail.com");

        headers.insert(
            "cf-access-authenticated-user-email",
            "Someone@Example.COM".parse().expect("header value"),
        );

        assert_eq!(workflow_user(&headers, &config), "someone@example.com");
    }

    #[test]
    fn workflow_store_resets_invalid_json() {
        let directory = tempfile::tempdir().expect("temp dir");
        let config = WorkflowConfig {
            path: directory.path().join("session.json"),
            lock_path: directory.path().join("session.lock"),
            default_user: "portalier.g@gmail.com".to_string(),
        };
        fs::write(&config.path, "not json").expect("write invalid state");

        let store = with_workflow_lock(&config, || read_workflow_store(&config))
            .expect("read resets state");

        assert_eq!(store.version, 1);
        assert!(store.users.is_empty());
        let contents = fs::read_to_string(&config.path).expect("state exists");
        assert!(contents.contains("\"users\": {}"));
    }

    #[test]
    fn workflow_store_round_trips_session_json() {
        let directory = tempfile::tempdir().expect("temp dir");
        let config = WorkflowConfig {
            path: directory.path().join("session.json"),
            lock_path: directory.path().join("session.lock"),
            default_user: "portalier.g@gmail.com".to_string(),
        };
        let mut store = empty_workflow_store();
        store.users.insert(
            "portalier.g@gmail.com".to_string(),
            StoredWorkflowSession {
                updated_at: 10,
                session: serde_json::json!({ "mode": "scanning" }),
            },
        );

        with_workflow_lock(&config, || write_workflow_store(&config, &store)).expect("write state");
        let stored =
            with_workflow_lock(&config, || read_workflow_store(&config)).expect("read state");

        assert_eq!(
            stored.users["portalier.g@gmail.com"].session["mode"],
            "scanning"
        );
    }

    #[test]
    fn task_items_from_export_sorts_by_urgency_and_uses_description() {
        let stdout = r#"[
{"id":1,"description":"Alpha task","project":"Inbox","due":"20260531T000000Z","uri":"https://example.com/alpha","tags":["extra"],"urgency":9.5},
{"id":2,"description":"Beta task","project":"Work","due":"20260530T000000Z","urgency":10.1}
]"#;

        let items = task_items_from_export(stdout).expect("valid export");

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].description, "Beta task");
        assert_eq!(items[0].id, Some(2));
        assert_eq!(items[0].project.as_deref(), Some("Work"));
        assert_eq!(items[1].description, "Alpha task");
        assert_eq!(items[1].uri.as_deref(), Some("https://example.com/alpha"));
        assert_eq!(items[1].tags, vec!["extra".to_string()]);
    }

    #[test]
    fn task_items_from_export_recovers_legacy_uri_description_prefix() {
        let stdout = r#"[
{"id":1,"description":"uri:https://example.com/alpha Alpha task","project":"Inbox","due":"20260531T000000Z","urgency":9.5}
]"#;

        let items = task_items_from_export(stdout).expect("valid export");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].description, "Alpha task");
        assert_eq!(items[0].uri.as_deref(), Some("https://example.com/alpha"));
    }
}
