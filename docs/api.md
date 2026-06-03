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
    "project": "Inbox",
    "due": "20260604T000000Z",
    "uri": "https://example.com",
    "urg": 9.5
  }
]
```

Tasks with empty descriptions are filtered out. Results are sorted by urgency descending.

## Add Task

```http
POST /api/tasks
Content-Type: application/json
```

Request:

```json
{
  "description": "Book train tickets",
  "uri": "https://example.com"
}
```

`uri` is optional. `description` is trimmed, required, and limited to 500 characters.

Doit adds tasks with these defaults:

```sh
task add project:Inbox due:tomorrow -- "Book train tickets"
```

If `uri` is provided, Doit also passes `uri:<value>` to Taskwarrior.

Response: the updated task list.

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
