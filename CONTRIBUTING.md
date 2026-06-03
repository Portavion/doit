# Contributing

## Local Setup

Install Rust stable and Taskwarrior 3.x, then run:

```sh
nix develop
just dev
```

Without Nix, install `just` and Taskwarrior locally, then run:

```sh
mkdir -p .dev/task
test -f .dev/taskrc || cp .dev/taskrc.example .dev/taskrc
TASKRC=.dev/taskrc TASKDATA=.dev/task TASK_SYNC=false cargo run
```

## Validation

Run the smallest relevant check while working. Before opening a pull request, run:

```sh
just check
```

That runs formatting, clippy with warnings denied, and tests.

## Issues

Good issues include:

- The Taskwarrior version
- The exact command or UI action that failed
- Relevant environment variables with secrets removed
- The expected behavior and observed behavior

Do not include private task data, sync secrets, tokens, personal domains, or local network details in public issues.

## Maintainer Boundaries

Doit is a small single-user tool. Contributions that preserve the simple Taskwarrior-backed model are easier to review than broad platform changes. Larger changes should start with an issue describing the user problem and intended behavior.
