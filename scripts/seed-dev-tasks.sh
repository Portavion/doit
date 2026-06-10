#!/usr/bin/env bash
set -euo pipefail

TASKRC="${TASKRC:-.dev/taskrc}"
TASKDATA="${TASKDATA:-.dev/task}"
SEED_TAG="${DOIT_SEED_TAG:-doit_seed}"
export TASKRC TASKDATA

mkdir -p "$TASKDATA"
if [[ ! -f "$TASKRC" && -f ".dev/taskrc.example" ]]; then
  cp ".dev/taskrc.example" "$TASKRC"
fi

rm -rf "$TASKDATA"
mkdir -p "$TASKDATA"

task_cmd=(
  task
  rc.confirmation:no
  rc.recurrence.confirmation:no
  rc.verbose:nothing
  rc.uda.uri.type:string
  rc.uda.uri.label:URI
)

add_task() {
  local description="$1"
  shift

  local annotations=()
  while [[ $# -gt 0 && "$1" == note:* ]]; do
    annotations+=("${1#note:}")
    shift
  done

  "${task_cmd[@]}" add "+$SEED_TAG" "$@" -- "$description"
  local uuid
  uuid="$("${task_cmd[@]}" +LATEST uuids | head -n 1)"

  for annotation in "${annotations[@]}"; do
    "${task_cmd[@]}" "$uuid" annotate "$annotation"
  done
}

add_task "Fix flaky deploy health check" \
  note:"Reproduced after a cold boot of the local container" \
  note:"Likely timeout regression in readiness probe" \
  project:Platform priority:H due:today +bug +ops \
  uri:https://gitlab.example.com/acme/app/-/issues/182

add_task "Review task detail drawer accessibility" \
  note:"Check keyboard focus order, screen reader labels, and mobile tap targets" \
  note:"Compare against the last merged drawer implementation" \
  project:Frontend priority:M due:tomorrow +review \
  uri:https://gitlab.example.com/acme/app/-/merge_requests/44

add_task "Ship pagination fix for audit log endpoint" \
  note:"Cursor repeats when the last row shares created_at with the next page" \
  note:"Add regression coverage around duplicate timestamps" \
  project:Backend priority:H due:+2d +api +bug \
  uri:https://gitlab.example.com/acme/app/-/issues/193

add_task "Write migration notes for user preference schema" \
  note:"Mention rollback command and expected lock duration" \
  project:Backend due:+3d +docs \
  uri:https://gitlab.example.com/acme/app/-/merge_requests/47

add_task "Triage production error spike from payment webhooks" \
  note:"Sentry issue has three stack traces from the retry worker" \
  note:"Confirm whether duplicate events are being acknowledged" \
  project:Payments priority:H due:today +incident +triage \
  uri:https://sentry.example.com/issues/7712

add_task "Review on-call escalation handoff" \
  note:"Confirm the current owner and next concrete action before lunch" \
  project:Support priority:H due:today +extra \
  uri:https://gitlab.example.com/acme/app/-/issues/207

add_task "Pair with support on enterprise import failure" \
  note:"Customer CSV has blank owner rows and duplicate external IDs" \
  project:Support priority:M due:tomorrow +customer \
  uri:https://gitlab.example.com/acme/app/-/issues/201

add_task "Rotate staging service token" \
  note:"Update CI variable and restart staging workers after rotation" \
  project:Infra priority:M due:+1wk +maintenance

add_task "Refactor retry backoff around idempotent jobs" \
  note:"Keep behavior compatible with current delayed job metrics" \
  note:"Avoid touching non-idempotent queue handlers in this pass" \
  project:Platform due:+5d +refactor

add_task "Update onboarding checklist for new engineers" \
  note:"Include local Taskwarrior profile setup and seed command" \
  project:Team due:+2wk +docs

add_task "Investigate slow first render on mobile dashboard" \
  note:"Lighthouse regression started after adding grouped counters" \
  note:"Capture before and after traces on a throttled profile" \
  project:Frontend due:+4d +perf \
  uri:https://gitlab.example.com/acme/app/-/issues/188

add_task "Add contract test for webhook signature failures" \
  note:"Assert 401 body uses the shared error contract" \
  project:Payments due:+6d +test

add_task "Backfill missing uri UDA on imported tasks" \
  note:"Run only against local sample data before proposing production script" \
  project:Taskwarrior due:+1wk +script

add_task "Prepare sprint demo notes" \
  note:"Show the mobile add flow, completion hold, and color scheme menu" \
  project:Team due:friday +demo

add_task "Follow up on database index proposal" \
  note:"DBA asked for cardinality numbers by project and status" \
  project:Data wait:+2d due:+10d +waiting \
  uri:https://gitlab.example.com/acme/app/-/issues/176

add_task "Clean up stale feature flag for import preview" \
  note:"Flag has been enabled for all users since last release" \
  project:Backend due:+9d +cleanup

add_task "Document local self-hosting tunnel options" \
  note:"Keep authentication guidance explicit; Doit has no app-level auth" \
  project:Docs due:+8d +security

add_task "Check overdue backup restore drill" \
  note:"Last restore proof is missing from the runbook thread" \
  project:Infra priority:H due:-2d +ops +overdue

add_task "Fix mobile safe-area padding on settings menu" \
  note:"Only reproduces on iOS Safari with the bottom toolbar visible" \
  project:Frontend due:-1d +mobile +bug

echo "Seeded Taskwarrior dev data with +$SEED_TAG"
