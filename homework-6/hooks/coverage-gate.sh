#!/usr/bin/env bash
#
# Coverage gate (Task 3): blocks `git push` when unit-test coverage < 80%.
#
# Used two ways:
#   1. Claude Code PreToolUse hook (.claude/settings.json): receives the tool
#      call as JSON on stdin; if the Bash command is a `git push`, run the
#      coverage check and exit 2 (block) when below the threshold.
#   2. Plain git pre-push hook: `ln -s ../../hooks/coverage-gate.sh .git/hooks/pre-push`
#      (or `git config core.hooksPath homework-6/hooks-git`) — same check,
#      exit 1 blocks the push.
#
set -uo pipefail
HW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIN="${COVERAGE_MIN:-80}"

# --- Claude Code mode: stdin carries the tool-call JSON --------------------
if [ ! -t 0 ]; then
  STDIN_JSON="$(cat || true)"
  if [ -n "$STDIN_JSON" ]; then
    CMD=$(printf '%s' "$STDIN_JSON" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    print("")' 2>/dev/null)
    case "$CMD" in
      *"git push"*) ;;                       # a push → run the gate below
      "")           ;;                       # no JSON (direct git hook mode) → run the gate
      *)            exit 0 ;;                # any other tool call → allow
    esac
  fi
fi

echo "🛡  Coverage gate: running unit tests with coverage (min ${MIN}%)…" >&2
cd "$HW_DIR"
PYBIN="./.venv/bin/python"; [ -x "$PYBIN" ] || PYBIN="python3"

OUT=$("$PYBIN" -m pytest tests/ --cov=agents --cov=integrator --cov-report=term \
      --cov-fail-under="$MIN" -q 2>&1)
STATUS=$?
TOTAL=$(printf '%s\n' "$OUT" | awk '/^TOTAL/ {print $NF}' | tail -1)

if [ $STATUS -ne 0 ]; then
  echo "" >&2
  echo "⛔ PUSH BLOCKED — coverage ${TOTAL:-unknown} is below the ${MIN}% gate (or tests failed)." >&2
  printf '%s\n' "$OUT" | tail -12 >&2
  exit 2   # exit 2 = blocking error for Claude Code hooks; non-zero blocks git pre-push too
fi

echo "✅ Coverage gate passed: TOTAL ${TOTAL} (≥ ${MIN}%). Push allowed." >&2
exit 0
