"""tests/test_integrator.py — integrator.py end-to-end.

Full-pipeline integration test against the real sample-transactions.json
(copied into tmp_path — never the real shared/ tree), the exact seeded
outcome numbers from the task brief, idempotency across repeated runs, a
missing-transactions-file error path, and unit tests for integrator's
smaller pure helpers (reset_shared_tree, ingest_transactions, _find_missing,
Summary.ok, main()).
"""
from __future__ import annotations

import json
import runpy
import shutil
from decimal import Decimal
from pathlib import Path

import pytest

import integrator
from integrator import (
    Summary,
    _find_missing,
    ingest_transactions,
    reset_shared_tree,
    run_pipeline,
)

from conftest import FIXED_NOW_ISO, read_audit_lines


# --------------------------------------------------------------------------- #
# full pipeline integration — exact seeded numbers from the task brief
# --------------------------------------------------------------------------- #
@pytest.fixture
def sample_copy(tmp_path, sample_transactions_path) -> Path:
    dest = tmp_path / "sample-transactions.json"
    shutil.copy(sample_transactions_path, dest)
    return dest


def test_full_pipeline_produces_seeded_summary_totals(tmp_path, sample_copy):
    summary = run_pipeline(tmp_path, sample_copy)

    assert summary.total == 8
    assert summary.settled == 3
    assert summary.held_for_review == 2
    assert summary.rejected == 3
    assert summary.total_fees == Decimal("26.00")
    assert summary.ok is True
    assert summary.missing == []


def test_full_pipeline_every_transaction_reaches_a_terminal_result(tmp_path, sample_copy):
    run_pipeline(tmp_path, sample_copy)

    results_dir = tmp_path / "shared" / "results"
    for txn_id in (f"TXN00{i}" for i in range(1, 9)):
        assert (results_dir / f"{txn_id}.json").exists(), f"{txn_id} missing a terminal result"


@pytest.mark.parametrize(
    "txn_id, expected",
    [
        ("TXN001", {"status": "settled", "fee": "7.50", "net_amount": "1492.50"}),
        ("TXN004", {"status": "settled", "fee": "2.50", "net_amount": "497.50", "risk_score": 40}),
        ("TXN008", {"status": "settled", "fee": "16.00", "net_amount": "3184.00"}),
        ("TXN002", {"status": "held_for_review", "risk_score": 50, "ctr_filed": True}),
        ("TXN005", {"status": "held_for_review", "risk_score": 50, "ctr_filed": True}),
        ("TXN003", {"status": "rejected", "reason": "watchlist_hit"}),
        ("TXN006", {"status": "rejected", "reason": "invalid_currency"}),
        ("TXN007", {"status": "rejected", "reason": "non_positive_amount"}),
    ],
)
def test_full_pipeline_spot_checks_each_transaction_outcome(tmp_path, sample_copy, txn_id, expected):
    run_pipeline(tmp_path, sample_copy)

    result = json.loads((tmp_path / "shared" / "results" / f"{txn_id}.json").read_text())
    assert result["status"] == expected["status"]

    if "fee" in expected:
        assert result["settlement"]["fee"] == expected["fee"]
        assert result["settlement"]["net_amount"] == expected["net_amount"]
    if "risk_score" in expected:
        assert result["risk_score"] == expected["risk_score"]
    if "ctr_filed" in expected:
        assert result["compliance"]["ctr_filed"] == expected["ctr_filed"]
    if "reason" in expected:
        assert result["reason"] == expected["reason"]


def test_full_pipeline_total_fees_matches_sum_of_settled_fees(tmp_path, sample_copy):
    summary = run_pipeline(tmp_path, sample_copy)
    # 7.50 (TXN001) + 2.50 (TXN004) + 16.00 (TXN008)
    assert summary.total_fees == Decimal("7.50") + Decimal("2.50") + Decimal("16.00")


# --------------------------------------------------------------------------- #
# idempotency — re-running produces the same result and preserves the log
# --------------------------------------------------------------------------- #
def test_pipeline_is_idempotent_across_repeated_runs(tmp_path, sample_copy):
    first = run_pipeline(tmp_path, sample_copy)
    audit_log = tmp_path / "shared" / "logs" / "audit.log"
    lines_after_first = audit_log.read_text().splitlines()

    second = run_pipeline(tmp_path, sample_copy)
    lines_after_second = audit_log.read_text().splitlines()

    assert second.total == first.total
    assert second.settled == first.settled
    assert second.held_for_review == first.held_for_review
    assert second.rejected == first.rejected
    assert second.total_fees == first.total_fees
    assert second.missing == []

    # logs/ is preserved and grows across runs (never wiped).
    assert len(lines_after_second) > len(lines_after_first)

    # results/ holds exactly the same 8 + summary files, not duplicates.
    result_files = list((tmp_path / "shared" / "results").glob("*.json"))
    assert len(result_files) == 9  # 8 transactions + pipeline-summary.json


def test_pipeline_rerun_clears_stale_stage_files(tmp_path, sample_copy):
    run_pipeline(tmp_path, sample_copy)
    stale = tmp_path / "shared" / "output" / "fraud_detector" / "STALE.json"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text("{}")

    run_pipeline(tmp_path, sample_copy)

    assert not stale.exists()


# --------------------------------------------------------------------------- #
# missing transactions file -> clean error (no partial/corrupt shared/ state)
# --------------------------------------------------------------------------- #
def test_missing_transactions_file_raises_file_not_found(tmp_path):
    missing_file = tmp_path / "does-not-exist.json"
    with pytest.raises(FileNotFoundError):
        run_pipeline(tmp_path, missing_file)


# --------------------------------------------------------------------------- #
# reset_shared_tree
# --------------------------------------------------------------------------- #
def test_reset_shared_tree_creates_all_stage_dirs(tmp_path):
    reset_shared_tree(tmp_path)
    shared = tmp_path / "shared"
    for stage in ("input", "processing", "output", "results", "logs"):
        assert (shared / stage).is_dir()


def test_reset_shared_tree_clears_stale_files_but_preserves_logs(tmp_path):
    shared = tmp_path / "shared"
    (shared / "input").mkdir(parents=True)
    (shared / "input" / "stale.json").write_text("{}")
    (shared / "logs").mkdir(parents=True)
    (shared / "logs" / "audit.log").write_text("old log line\n")

    reset_shared_tree(tmp_path)

    assert not (shared / "input" / "stale.json").exists()
    assert (shared / "logs" / "audit.log").read_text() == "old log line\n"


# --------------------------------------------------------------------------- #
# ingest_transactions
# --------------------------------------------------------------------------- #
def test_ingest_transactions_writes_one_message_per_record_in_order(ctx):
    records = [{"transaction_id": "TXN001"}, {"transaction_id": "TXN002"}]
    txn_ids = ingest_transactions(ctx, records)

    assert txn_ids == ["TXN001", "TXN002"]
    assert (ctx.input_dir / "TXN001.json").exists()
    assert (ctx.input_dir / "TXN002.json").exists()


def test_ingest_transactions_audits_each_as_ingested(ctx):
    ingest_transactions(ctx, [{"transaction_id": "TXN001"}])
    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | integrator | TXN001 | ingested"]


# --------------------------------------------------------------------------- #
# _find_missing
# --------------------------------------------------------------------------- #
def test_find_missing_returns_ids_with_no_result_file(ctx):
    (ctx.results_dir / "TXN001.json").write_text("{}")

    missing = _find_missing(ctx, ["TXN001", "TXN002"])
    assert missing == ["TXN002"]


def test_find_missing_returns_empty_when_all_present(ctx):
    (ctx.results_dir / "TXN001.json").write_text("{}")
    (ctx.results_dir / "TXN002.json").write_text("{}")

    assert _find_missing(ctx, ["TXN001", "TXN002"]) == []


def test_find_missing_ignores_the_summary_file_itself(ctx):
    (ctx.results_dir / "pipeline-summary.json").write_text("{}")
    (ctx.results_dir / "TXN001.json").write_text("{}")

    assert _find_missing(ctx, ["TXN001"]) == []


# --------------------------------------------------------------------------- #
# Summary.ok
# --------------------------------------------------------------------------- #
def test_summary_ok_true_when_nothing_missing():
    summary = Summary(total=1, settled=1, rejected=0, held_for_review=0, total_fees=Decimal("0.00"))
    assert summary.ok is True


def test_summary_ok_false_when_something_missing():
    summary = Summary(
        total=2, settled=1, rejected=0, held_for_review=0,
        total_fees=Decimal("0.00"), missing=["TXN999"],
    )
    assert summary.ok is False


# --------------------------------------------------------------------------- #
# main() — success and failure branches
# --------------------------------------------------------------------------- #
def test_main_success_path_runs_full_pipeline_and_returns_zero(tmp_path, sample_copy, capsys, monkeypatch):
    monkeypatch.setattr(integrator, "__file__", str(tmp_path / "integrator.py"))

    exit_code = integrator.main()

    out = capsys.readouterr().out
    assert exit_code == 0
    assert "OK: every input transaction reached a terminal result" in out
    assert (tmp_path / "shared" / "results" / "pipeline-summary.json").exists()


def test_main_failure_path_prints_error_and_returns_one(tmp_path, capsys, monkeypatch):
    fake_summary = Summary(
        total=2, settled=1, rejected=0, held_for_review=0,
        total_fees=Decimal("0.00"), missing=["TXN999"],
    )
    monkeypatch.setattr(integrator, "run_pipeline", lambda base_dir, txns_file: fake_summary)
    monkeypatch.setattr(integrator, "__file__", str(tmp_path / "integrator.py"))
    (tmp_path / "sample-transactions.json").write_text("[]")

    exit_code = integrator.main()

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "ERROR" in captured.err
    assert "TXN999" in captured.err


# --------------------------------------------------------------------------- #
# CLI entry point (`if __name__ == "__main__": sys.exit(main())`)
# --------------------------------------------------------------------------- #
def test_cli_entry_point_runs_full_pipeline_and_exits_zero(tmp_path, sample_copy, capsys, project_root):
    # Copy integrator.py's source into tmp_path so its own __file__ (and
    # therefore base_dir inside main()) resolves under tmp_path, never the
    # real project's shared/ tree.
    integrator_copy = tmp_path / "integrator_copy.py"
    integrator_copy.write_text((project_root / "integrator.py").read_text())

    with pytest.raises(SystemExit) as exc_info:
        runpy.run_path(str(integrator_copy), run_name="__main__")

    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "Pipeline run complete" in out
