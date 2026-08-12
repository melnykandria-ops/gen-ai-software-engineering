"""tests/test_reporting.py — agents/reporting_agent.py.

Covers writing one terminal result file per transaction, aggregating
shared/results/ into pipeline-summary.json (counts, by_status, total_fees as
strings), the masked stdout table, run(), and the CLI entry point.
"""
from __future__ import annotations

import json
import runpy
from decimal import Decimal

from agents import reporting_agent as ra
from agents.reporting_agent import build_summary, process_message, write_summary

from conftest import FIXED_NOW_ISO, make_transaction, protocol_message, read_audit_lines


# --------------------------------------------------------------------------- #
# process_message — one terminal result file per transaction
# --------------------------------------------------------------------------- #
def test_process_message_targets_results_with_original_status(ctx):
    data = make_transaction(transaction_id="TXN100", status="settled")
    result = process_message(protocol_message(data), ctx)

    assert result["target_agent"] == "results"
    assert result["data"]["status"] == "settled"


def test_process_message_is_audited_with_status(ctx):
    data = make_transaction(transaction_id="TXN002", status="held_for_review")
    process_message(protocol_message(data), ctx)

    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | reporting_agent | TXN002 | result_written:held_for_review"]


def test_run_writes_one_result_file_per_transaction(ctx):
    ctx.write_message(
        ctx.output_dir("reporting_agent"),
        protocol_message(make_transaction(transaction_id="TXN001", status="settled", settlement={"fee": "7.50"})),
    )
    ctx.write_message(
        ctx.output_dir("reporting_agent"),
        protocol_message(make_transaction(transaction_id="TXN002", status="held_for_review")),
    )

    ra.run(ctx)

    txn1 = json.loads((ctx.results_dir / "TXN001.json").read_text())
    txn2 = json.loads((ctx.results_dir / "TXN002.json").read_text())
    assert txn1["status"] == "settled"
    assert txn2["status"] == "held_for_review"


# --------------------------------------------------------------------------- #
# build_summary — counts, by_status, total_fees
# --------------------------------------------------------------------------- #
def _write_result(ctx, txn_id: str, payload: dict) -> None:
    (ctx.results_dir / f"{txn_id}.json").write_text(json.dumps(payload))


def test_build_summary_counts_by_status_and_total_fees_as_strings(ctx):
    _write_result(ctx, "TXN001", {"transaction_id": "TXN001", "status": "settled",
                                   "settlement": {"fee": "7.50"}})
    _write_result(ctx, "TXN004", {"transaction_id": "TXN004", "status": "settled",
                                   "settlement": {"fee": "2.50"}})
    _write_result(ctx, "TXN008", {"transaction_id": "TXN008", "status": "settled",
                                   "settlement": {"fee": "16.00"}})
    _write_result(ctx, "TXN002", {"transaction_id": "TXN002", "status": "held_for_review"})
    _write_result(ctx, "TXN005", {"transaction_id": "TXN005", "status": "held_for_review"})
    _write_result(ctx, "TXN003", {"transaction_id": "TXN003", "status": "rejected", "reason": "watchlist_hit"})
    _write_result(ctx, "TXN006", {"transaction_id": "TXN006", "status": "rejected", "reason": "invalid_currency"})
    _write_result(ctx, "TXN007", {"transaction_id": "TXN007", "status": "rejected", "reason": "non_positive_amount"})

    summary = build_summary(ctx)

    assert summary["total"] == 8
    assert summary["settled"] == 3
    assert summary["held_for_review"] == 2
    assert summary["rejected"] == 3
    assert summary["total_fees"] == "26.00"
    assert summary["by_status"] == {"settled": 3, "held_for_review": 2, "rejected": 3}
    assert summary["run_at"] == FIXED_NOW_ISO
    assert isinstance(summary["total_fees"], str)


def test_build_summary_creates_new_bucket_for_unexpected_status(ctx):
    _write_result(ctx, "TXN999", {"transaction_id": "TXN999", "status": "weird_status"})

    summary = build_summary(ctx)

    assert summary["by_status"]["weird_status"] == 1
    assert summary["total"] == 1


def test_build_summary_skips_malformed_result_files(ctx):
    (ctx.results_dir / "BROKEN.json").write_text("{not valid json")
    _write_result(ctx, "TXN001", {"transaction_id": "TXN001", "status": "settled"})

    summary = build_summary(ctx)
    assert summary["total"] == 1


def test_build_summary_excludes_its_own_summary_file(ctx):
    (ctx.results_dir / "pipeline-summary.json").write_text(json.dumps({"total": 999}))
    _write_result(ctx, "TXN001", {"transaction_id": "TXN001", "status": "settled"})

    summary = build_summary(ctx)
    assert summary["total"] == 1  # the stray old summary is not double-counted


def test_build_summary_with_no_results_is_all_zero(ctx):
    summary = build_summary(ctx)
    assert summary["total"] == 0
    assert summary["total_fees"] == "0.00"
    assert summary["by_status"] == {"settled": 0, "held_for_review": 0, "rejected": 0}


# --------------------------------------------------------------------------- #
# write_summary — writes the file, prints the table, audits the aggregate
# --------------------------------------------------------------------------- #
def test_write_summary_writes_pipeline_summary_json(ctx):
    _write_result(ctx, "TXN001", {"transaction_id": "TXN001", "status": "settled",
                                   "settlement": {"fee": "7.50"}})

    summary = write_summary(ctx)

    on_disk = json.loads((ctx.results_dir / "pipeline-summary.json").read_text())
    assert on_disk == summary


def test_write_summary_audits_the_aggregate(ctx):
    _write_result(ctx, "TXN001", {"transaction_id": "TXN001", "status": "settled",
                                   "settlement": {"fee": "7.50"}})

    write_summary(ctx)

    lines = read_audit_lines(ctx)
    assert any(
        line.endswith(
            "pipeline_summary:total=1:settled=1:rejected=0:held_for_review=0:total_fees=7.50"
        )
        for line in lines
    )


def test_write_summary_prints_masked_table(ctx, capsys):
    _write_result(
        ctx, "TXN003",
        {"transaction_id": "TXN003", "status": "rejected", "reason": "watchlist_hit ACC-9999"},
    )
    _write_result(
        ctx, "TXN001",
        {"transaction_id": "TXN001", "status": "settled", "settlement": {"fee": "7.50"}},
    )

    write_summary(ctx)

    out = capsys.readouterr().out
    assert "txn" in out and "status" in out and "fee" in out and "reason" in out
    assert "TXN001" in out and "7.50" in out
    assert "ACC-9999" not in out
    assert "ACC-***99" in out
    assert "TOTAL=2" in out and "settled=1" in out and "rejected=1" in out


def test_write_summary_table_handles_no_results(ctx, capsys):
    write_summary(ctx)
    out = capsys.readouterr().out
    assert "TOTAL=0" in out


# --------------------------------------------------------------------------- #
# run() — drains inbox, writes results, then writes the summary
# --------------------------------------------------------------------------- #
def test_run_writes_results_then_summary(ctx, capsys):
    ctx.write_message(
        ctx.output_dir("reporting_agent"),
        protocol_message(make_transaction(transaction_id="TXN001", status="settled", settlement={"fee": "7.50"})),
    )

    processed = ra.run(ctx)

    assert processed == 1
    assert (ctx.results_dir / "pipeline-summary.json").exists()
    out = capsys.readouterr().out
    assert "TOTAL=1" in out


# --------------------------------------------------------------------------- #
# CLI entry point (__main__ block)
# --------------------------------------------------------------------------- #
def test_cli_main_runs_against_cwd_and_prints_processed_count(tmp_path, capsys, project_root, monkeypatch):
    from agents.base import PipelineContext

    monkeypatch.chdir(tmp_path)
    seed_ctx = PipelineContext(tmp_path)
    seed_ctx.write_message(
        seed_ctx.output_dir("reporting_agent"),
        protocol_message(make_transaction(transaction_id="TXN100", status="settled")),
    )

    runpy.run_path(str(project_root / "agents" / "reporting_agent.py"), run_name="__main__")

    out = capsys.readouterr().out
    assert "processed 1 message(s)" in out
    assert (tmp_path / "shared" / "results" / "TXN100.json").exists()
