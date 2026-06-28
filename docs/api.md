# API

The API is JSON over HTTP except for `GET /health`, which returns plain text.

All task-changing endpoints serialize access to the local Taskwarrior data directory with a lock file.

## Health

```http
GET /health
```

Returns:

```text
OK
```

## List Tasks

```http
GET /api/tasks
```

When `TASK_SYNC` is enabled, Doit runs `task sync` first. It then runs:

```sh
task status:pending -WAITING export
```

Response:

```json
[
  {
    "description": "Book train tickets",
    "id": 12,
    "uuid": "b470e4fb-bca3-4416-8076-67998818ea05",
    "project": "Inbox",
    "due": "20260604T000000Z",
    "wait": null,
    "uri": "https://example.com",
    "tags": ["extra", "backlog"],
    "urg": 9.5
  }
]
```

`wait` is included when Taskwarrior exports a wait date. Tasks with empty descriptions are filtered out. Results are sorted by urgency descending.
`uuid` is read from Taskwarrior export and is stable across devices; Doit uses it for workflow state when available.

## List Waiting Tasks

```http
GET /api/waiting
```

When `TASK_SYNC` is enabled, Doit runs `task sync` first. It then runs:

```sh
task +WAITING export
```

Response: the same task item shape as `GET /api/tasks`, including `wait`.

Taskwarrior hides waiting tasks from most reports until their wait date passes, so Doit keeps them out of the main task list and exposes them separately for the Future view.

## Add Task

```http
POST /api/tasks
Content-Type: application/json
```

Request:

```json
{
  "description": "Book train tickets",
  "uri": "https://example.com",
  "project": "Personal.Travel",
  "due": "today",
  "wait": "2026-06-18"
}
```

`uri`, `project`, and `wait` are optional. `project` defaults to `Inbox` and accepts dotted Taskwarrior project names such as `Work.Client`. `due` is optional and accepts `today` or `tomorrow`. `wait` is trimmed, limited to 500 characters, and cannot contain whitespace. When `wait` is provided, Doit sets the task due date to the same value. `description` is trimmed, required, and limited to 500 characters.

Doit adds tasks with these defaults:

```sh
task add project:Inbox due:tomorrow -- "Book train tickets"
```

If `project` is provided, Doit passes `project:<value>` instead of `project:Inbox`. If `due` is `today` and `wait` is not provided, Doit adds `due:today +extra`. If `uri` is provided, Doit also passes `uri:<value>` to Taskwarrior. If `wait` is provided, Doit passes `wait:<value>` and `due:<value>` when creating the task.

Response: the updated task list.

## Clear Task Wait

```http
DELETE /api/tasks/:id/wait
```

Clears the wait date with:

```sh
task <id> modify wait:
```

Response: the updated non-waiting task list.

## Declare Backlog

```http
POST /api/backlog/declare
Content-Type: application/json
```

Request:

```json
{
  "ids": [12, 13]
}
```

Doit adds `+backlog` to each selected pending task that is not already in the backlog and annotates it with the declaration date.

Response: the updated task list.

## Release Backlog Task

```http
POST /api/tasks/:id/release
```

Removes `+backlog` and `+extra`, then moves the task to tomorrow with:

```sh
task <id> modify -backlog -extra due:tomorrow
```

Response: the updated task list.

## Split Task

```http
POST /api/tasks/:id/split
Content-Type: application/json
```

Request:

```json
{
  "descriptions": ["Draft outline", "Send first question"]
}
```

Each description is trimmed and limited to 500 characters. Empty descriptions are ignored, but at least one split task is required.

Doit adds each split as an Inbox task due tomorrow, annotates each split task with `Split task from: <task name>`, then deletes the original task.

Response: the updated task list.

## Workflow Session

```http
GET /api/workflow-session
```

Returns the current app-owned FPV workflow session for the authenticated user:

```json
{
  "user": "portalier.g@gmail.com",
  "session": null,
  "updated_at": null
}
```

Doit uses the `Cf-Access-Authenticated-User-Email` header when Cloudflare Access is present. Without that header, it falls back to `DOIT_DEFAULT_USER_EMAIL`.

```http
PUT /api/workflow-session
Content-Type: application/json
```

Request:

```json
{
  "session": {
    "version": 2,
    "activeMode": "today",
    "sessions": {
      "today": {
        "date": "2026-06-03",
        "mode": "today",
        "entries": []
      },
      "backlog": {
        "date": "2026-06-03",
        "mode": "backlog",
        "entries": []
      }
    }
  }
}
```

The session is stored in Doit's own JSON file, not in Taskwarrior. The default path is `$HOME/.local/share/doit/session.json`; override it with `DOIT_SESSION_FILE`.

```http
DELETE /api/workflow-session
```

Clears the stored FPV workflow session for the current user.

## Complete Task

```http
POST /api/tasks/:id/complete
```

Marks the pending task complete with:

```sh
task <id> done
```

Response: the updated task list.

## Errors

Errors return JSON:

```json
{
  "error": "description cannot be empty"
}
```

Expected client errors use `400 Bad Request`. Taskwarrior command failures and unexpected parse errors use `500 Internal Server Error`.
