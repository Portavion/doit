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
    "uri": "https://example.com",
    "tags": ["extra"],
    "urg": 9.5
  }
]
```

Tasks with empty descriptions are filtered out. Results are sorted by urgency descending.
`uuid` is read from Taskwarrior export and is stable across devices; Doit uses it for workflow state when available.

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
  "due": "today"
}
```

`uri` is optional. `due` is optional and accepts `today` or `tomorrow`. `description` is trimmed, required, and limited to 500 characters.

Doit adds tasks with these defaults:

```sh
task add project:Inbox due:tomorrow -- "Book train tickets"
```

If `due` is `today`, Doit adds `due:today +extra`. If `uri` is provided, Doit also passes `uri:<value>` to Taskwarrior.

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
    "date": "2026-06-03",
    "entries": [],
    "progressKeys": [],
    "scanMarkedKeys": [],
    "scanCursorKey": "",
    "runKeys": []
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
