"""tests/conftest.py — shared fixtures/helpers for the transaction-pipeline
test suite (Agent 3 — unit-test meta-agent).

FIRST principles (skills/-style, agents.md "Tests" rule):
  * Fast          — everything runs against pytest's tmp_path, no network, no
                     sleeps, no real subprocess pipeline runs.
  * Independent   — every test gets its own tmp_path; nothing is shared
                     between tests beyond these pure helper functions.
  * Repeatable    — every PipelineContext built here uses a FIXED injected
                     `now`, never `datetime.now()`, so results never depend on
                     wall-clock time.
  * Self-validating — plain asserts, no manual inspection needed.
  * Timely        — tests exercise the real code paths in agents/*.py,
                     integrator.py and mcp/server.py; nothing is invented.

Tests must NEVER touch the real project's shared/ tree — every
PipelineContext below is rooted at pytest's tmp_path.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Make the project root (parent of tests/) importable as `agents`, `integrator`.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from agents.base import PipelineContext, make_message

# --------------------------------------------------------------------------- #
# Deterministic clock — every ctx below is built with this fixed instant.
# --------------------------------------------------------------------------- #
FIXED_NOW = datetime(2026, 3, 20, 12, 0, 0, tzinfo=timezone.utc)
FIXED_NOW_ISO = "2026-03-20T12:00:00Z"


def fixed_now() -> datetime:
    """A zero-arg 'clock' that always returns FIXED_NOW.

    This is the `now` callable every PipelineContext under test is built
    with, so timestamps/batch ids/audit lines are deterministic.
    """
    return FIXED_NOW


@pytest.fixture
def ctx(tmp_path: Path) -> PipelineContext:
    """A PipelineContext rooted at tmp_path with a fixed, injectable now().

    Never touches the real project's shared/ tree.
    """
    return PipelineContext(tmp_path, now=fixed_now)


@pytest.fixture
def sample_transactions_path() -> Path:
    """Path to the real (read-only) sample-transactions.json fixture data."""
    return PROJECT_ROOT / "sample-transactions.json"


@pytest.fixture
def project_root() -> Path:
    """Path to the homework-6 project root, for locating agent source files
    (e.g. for runpy-based __main__ coverage tests)."""
    return PROJECT_ROOT


# --------------------------------------------------------------------------- #
# Message-building helpers (not fixtures — plain functions tests import).
# --------------------------------------------------------------------------- #
def make_transaction(**overrides) -> dict:
    """Build a valid raw-transaction record (specification.md §4 shape) with
    sane defaults for every required + metadata field.

    Pass overrides to tweak/break individual fields for negative-path tests,
    e.g. make_transaction(currency="XYZ") or make_transaction(amount="-5").
    """
    txn = {
        "transaction_id": "TXN100",
        "timestamp": "2026-03-16T09:00:00Z",
        "source_account": "ACC-1001",
        "destination_account": "ACC-2001",
        "amount": "1500.00",
        "currency": "USD",
        "transaction_type": "transfer",
        "description": "test transaction",
        "metadata": {"channel": "online", "country": "US"},
    }
    txn.update(overrides)
    return txn


def protocol_message(
    data: dict,
    *,
    source_agent: str = "test_harness",
    target_agent: str = "test_target",
    message_type: str = "test_message",
    now: datetime = FIXED_NOW,
) -> dict:
    """Wrap a data payload in a protocol message via the real make_message()
    helper, so tests exercise the exact envelope shape production code uses:
    message_id, timestamp, source_agent, target_agent, message_type, data.
    """
    return make_message(source_agent, target_agent, message_type, data, now=now)


def read_audit_lines(ctx: PipelineContext) -> list[str]:
    """Read shared/logs/audit.log (if present) as a list of stripped lines."""
    log_path = ctx.logs_dir / "audit.log"
    if not log_path.exists():
        return []
    return log_path.read_text(encoding="utf-8").splitlines()
