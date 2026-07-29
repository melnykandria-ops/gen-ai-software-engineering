#!/usr/bin/env bash
#
# Homework 4 — single-command 4-agent pipeline runner.
#
#   bash run-pipeline.sh            # run the full pipeline (needs an authenticated `claude` CLI)
#   bash run-pipeline.sh --plan     # print the ordered stages + per-agent model/skill, run nothing
#
# The pipeline runs each agent in the correct order via `claude -p`, selecting
# the model declared in the agent's frontmatter and auto-loading its skill (if
# any) as an appended system prompt. No manual per-agent invocation is needed.
set -euo pipefail
cd "$(dirname "$0")"

BUG="context/bugs/001"
AGENTS=(
  "agents/bug-researcher.agent.md"       # 1 → research/codebase-research.md
  "agents/research-verifier.agent.md"    # 2 → research/verified-research.md   (Task 1, uses research-quality skill)
  "agents/bug-planner.agent.md"          # 3 → implementation-plan.md
  "agents/bug-fixer.agent.md"            # 4 → fix-summary.md  (applies edits, runs tests)  (Task 2)
  "agents/security-verifier.agent.md"    # 5 → security-report.md                            (Task 3)
  "agents/unit-test-generator.agent.md"  # 6 → test-report.md + tests/*.test.js  (Task 4, uses FIRST skill)
)

fm() { # $1=file $2=key  → value of a frontmatter key
  sed -n '2,/^---$/p' "$1" | grep -m1 "^$2:" | sed "s/^$2:[[:space:]]*//" || true
}

banner() { printf '\n\033[1;33m━━━ %s ━━━\033[0m\n' "$*"; }

if [[ "${1:-}" == "--plan" ]]; then
  echo "4-Agent Pipeline — execution plan (bug id: 001)"
  echo "================================================="
  i=0
  for a in "${AGENTS[@]}"; do
    i=$((i+1))
    name=$(fm "$a" name); model=$(fm "$a" model); skill=$(fm "$a" skill)
    printf "  %d. %-24s model=%-18s %s\n" "$i" "$name" "$model" "${skill:+skill=$skill}"
  done
  echo "-------------------------------------------------"
  echo "Run order: researcher → research-verifier → planner → fixer → security-verifier → unit-test-generator"
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: the 'claude' CLI is required to run the pipeline. Install it, then re-run." >&2
  exit 1
fi

banner "BEFORE — running tests on the seeded-bug code (expected: failures)"
node --test tests/ || true

i=0
for a in "${AGENTS[@]}"; do
  i=$((i+1))
  name=$(fm "$a" name); model=$(fm "$a" model); skill=$(fm "$a" skill)
  banner "STAGE $i/${#AGENTS[@]} — $name  (model: $model)"

  prompt="You are the agent defined below. Execute your stage NOW against this repository (current working directory). Bug id: 001. Read your declared inputs, do your work, and write your output file(s) exactly as specified. Do not ask questions; act.

$(cat "$a")"

  args=(-p "$prompt" --model "$model" --permission-mode acceptEdits
        --allowedTools "Read,Write,Edit,Bash,Grep,Glob")
  [[ -n "$skill" && -f "$skill" ]] && args+=(--append-system-prompt "$(cat "$skill")")

  claude "${args[@]}"
done

banner "AFTER — running tests on the fixed code (expected: pass)"
node --test tests/

banner "PIPELINE COMPLETE — artifacts in $BUG/"
ls -1 "$BUG"
