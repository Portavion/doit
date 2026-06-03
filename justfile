set dotenv-load := true

export TASKRC := ".dev/taskrc"
export TASKDATA := ".dev/task"
export TASK_SYNC := "false"

dev:
    mkdir -p .dev/task
    test -f .dev/taskrc || cp .dev/taskrc.example .dev/taskrc
    cargo run

fmt:
    cargo fmt --all

lint:
    cargo clippy --all-targets --all-features -- -D warnings

test:
    cargo test

check: fmt lint test
