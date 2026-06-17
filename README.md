# Doit

Doit is a small mobile-friendly web UI for Taskwarrior. It is designed for fast task capture and completion on a phone while keeping Taskwarrior as the source of truth through the local `task` CLI.

The app is intentionally single-user. It does not include account management or app-level authentication, so put it behind a trusted private network, SSH tunnel, or authenticated reverse proxy before exposing it beyond localhost.

## Features

- List pending non-waiting Taskwarrior tasks ordered by urgency
- Add new tasks due tomorrow, or extra `due:today +extra` tasks
- Declare a `+backlog` from overdue and due-today tasks, then work it separately
- Attach an optional `uri` user-defined attribute and Taskwarrior project when adding a task
- Complete tasks from the web UI
- Optionally run `task sync` before and after task changes
- Serve a static mobile web frontend from the same process

## Requirements

- Rust stable
- Taskwarrior 3.x available as `task`
- A Taskwarrior configuration and data directory

TaskChampion sync is handled by Taskwarrior itself. If your Taskwarrior profile is configured to sync, leave `TASK_SYNC` enabled. For isolated local development, set `TASK_SYNC=false`.

## Local Development

```sh
nix develop
just dev
```

The dev shell and `just dev` use local development paths:

```sh
TASKRC=.dev/taskrc
TASKDATA=.dev/task
TASK_SYNC=false
```

If `.dev/taskrc` does not exist, the development commands create it from `.dev/taskrc.example`.

Open `http://127.0.0.1:3000`.

Seed the local Taskwarrior profile with realistic software engineering tasks:

```sh
just seed
```

The seed command replaces the local `.dev/task` data with a fresh seeded profile. The seed data is tagged with `+doit_seed` and includes varied due dates, projects, tags, URIs, priorities, waiting tasks, overdue tasks, and annotations.

## Commands

```sh
just fmt
just lint
just test
just check
```

## Build

Build from source:

```sh
cargo build --release
```

Run the binary:

```sh
BIND_ADDR=127.0.0.1:3000 ./target/release/doit
```

Binary releases are expected to be published from tagged releases once release automation exists.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:3000` | HTTP bind address |
| `TASKRC` | Taskwarrior default | Path to the Taskwarrior config file |
| `TASKDATA` | Taskwarrior default | Path to the Taskwarrior data directory |
| `TASK_LOCK` | `$TASKDATA/task.lock` or `.dev/task/task.lock` | Lock file used to serialize `task` commands |
| `TASK_TIMEOUT_SECS` | `10` | Timeout for each `task` command |
| `TASK_SYNC` | `true` | Set to `false` or `0` to skip `task sync` |
| `DOIT_SESSION_FILE` | `$HOME/.local/share/doit/session.json` | JSON file used for app-owned FPV workflow state |
| `DOIT_SESSION_LOCK` | `DOIT_SESSION_FILE` with `.lock` extension | Lock file used to serialize workflow state writes |
| `DOIT_DEFAULT_USER_EMAIL` | `portalier.g@gmail.com` | Fallback workflow state user when Cloudflare Access does not provide an email header |

Doit also passes non-interactive Taskwarrior overrides for confirmation prompts and the `uri` UDA.

## API

- `GET /health` returns `OK`
- `GET /api/tasks` optionally runs `task sync`, exports pending non-waiting tasks, and returns JSON
- `POST /api/tasks` accepts `{ "description": "...", "uri": "https://example.com", "project": "Work.Client", "due": "today", "wait": "2026-06-18" }`, adds a task due tomorrow or extra today, optionally syncs, and returns the updated task list
- `POST /api/backlog/declare` accepts `{ "ids": [12, 13] }`, tags selected tasks with `+backlog`, optionally syncs, and returns the updated task list
- `POST /api/tasks/:id/release` removes `+backlog`, moves the task to tomorrow, optionally syncs, and returns the updated task list
- `POST /api/tasks/:id/complete` marks a task done, optionally syncs, and returns the updated task list

See [docs/api.md](docs/api.md) for response shapes and error handling.

## Self-Hosting

Run Doit as a local service and terminate TLS/authentication in infrastructure you control. A generic systemd example is available in [docs/self-hosting.md](docs/self-hosting.md).

Do not expose Doit directly to the public internet unless an authentication layer is in front of it.

## Limitations

- Single-user assumptions throughout the backend
- No built-in authentication or authorization
- Shells out to the local `task` binary for all task operations
- Adds new tasks to `project:Inbox` unless overridden, defaulting to `due:tomorrow`
- Uses a simple process-local lock file for serialized task operations

## Roadmap

- Optional configurable defaults for project, due date, and tags
- More tests around Taskwarrior command failures and frontend API errors
- Release workflow for tagged binaries
- Public screenshots or a demo using synthetic task data
- Optional deployment guide for authenticated reverse proxies

## License

Doit is licensed under the [MIT License](LICENSE).
