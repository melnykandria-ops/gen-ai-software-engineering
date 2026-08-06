"""tests/test_compliance.py — agents/compliance_checker.py.

Covers the watchlist short-circuit (source AND destination), the CTR
threshold (> 10000, strictly, not >=), status pass-through for
flagged_for_review, forwarding to shared/output/settlement_processor, and
the CLI entry point.
"""
from __future__ import annotations

import runpy

from agents import compliance_checker as cc
from agents.compliance_checker import process_message

from conftest import FIXED_NOW_ISO, make_transaction, protocol_message, read_audit_lines


def _scored(**overrides) -> dict:
    """A transaction that has already passed through fraud_detector (carries
    risk_score/risk_factors/status), the shape compliance_checker expects.
    """
    data = make_transaction(status="cleared", risk_score=0, risk_factors=[])
    data.update(overrides)
    return data


# --------------------------------------------------------------------------- #
# watchlist — source account hit
# --------------------------------------------------------------------------- #
def test_watchlist_hit_on_source_account_rejects(ctx):
    message = protocol_message(_scored(transaction_id="TXN100", source_account="ACC-9999"))
    result = process_message(message, ctx)

    assert result["target_agent"] == "results"
    assert result["data"]["status"] == "rejected"
    assert result["data"]["reason"] == "watchlist_hit"


# --------------------------------------------------------------------------- #
# watchlist — destination account hit
# --------------------------------------------------------------------------- #
def test_watchlist_hit_on_destination_account_rejects(ctx):
    message = protocol_message(
        _scored(transaction_id="TXN003", destination_account="ACC-9999")
    )
    result = process_message(message, ctx)

    assert result["target_agent"] == "results"
    assert result["data"]["status"] == "rejected"
    assert result["data"]["reason"] == "watchlist_hit"


def test_watchlist_hit_short_circuits_regardless_of_risk_score(ctx):
    # Even a low-risk, cleared transaction is rejected if it touches the
    # watchlist — watchlist takes priority over the fraud-score status.
    message = protocol_message(
        _scored(transaction_id="TXN003", destination_account="ACC-9999", status="cleared", risk_score=0)
    )
    result = process_message(message, ctx)
    assert result["data"]["status"] == "rejected"


def test_watchlist_rejection_is_audited(ctx):
    process_message(
        protocol_message(_scored(transaction_id="TXN003", destination_account="ACC-9999")), ctx
    )
    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | compliance_checker | TXN003 | rejected:watchlist_hit"]


# --------------------------------------------------------------------------- #
# CTR threshold — strictly greater than 10000
# --------------------------------------------------------------------------- #
def test_amount_over_10000_files_ctr(ctx):
    data = _scored(transaction_id="TXN002", amount="25000.00")
    result = process_message(protocol_message(data), ctx)
    assert result["data"]["compliance"]["ctr_filed"] is True
    assert result["data"]["compliance"]["ctr_filed_at"] == FIXED_NOW_ISO


def test_amount_exactly_10000_does_not_file_ctr(ctx):
    data = _scored(transaction_id="TXN100", amount="10000.00")
    result = process_message(protocol_message(data), ctx)
    assert result["data"]["compliance"]["ctr_filed"] is False
    assert "ctr_filed_at" not in result["data"]["compliance"]


def test_amount_under_10000_does_not_file_ctr(ctx):
    data = _scored(transaction_id="TXN100", amount="500.00")
    result = process_message(protocol_message(data), ctx)
    assert result["data"]["compliance"]["ctr_filed"] is False


def test_ctr_status_is_audited_lowercase_true_false(ctx):
    process_message(protocol_message(_scored(transaction_id="TXN002", amount="25000.00")), ctx)
    process_message(protocol_message(_scored(transaction_id="TXN100", amount="500.00")), ctx)

    lines = read_audit_lines(ctx)
    assert any("TXN002" in line and "cleared:ctr_filed=true" in line for line in lines)
    assert any("TXN100" in line and "cleared:ctr_filed=false" in line for line in lines)


# --------------------------------------------------------------------------- #
# status pass-through — compliance never clears a flagged_for_review status
# --------------------------------------------------------------------------- #
def test_flagged_for_review_status_is_left_untouched(ctx):
    data = _scored(transaction_id="TXN002", status="flagged_for_review", risk_score=50, amount="25000.00")
    result = process_message(protocol_message(data), ctx)
    assert result["data"]["status"] == "flagged_for_review"
    assert result["message_type"] == "flagged_for_review"


def test_cleared_status_is_left_untouched(ctx):
    data = _scored(transaction_id="TXN100", status="cleared")
    result = process_message(protocol_message(data), ctx)
    assert result["data"]["status"] == "cleared"


# --------------------------------------------------------------------------- #
# forward path — writes to shared/output/settlement_processor
# --------------------------------------------------------------------------- #
def test_non_rejected_transaction_forwards_to_settlement_processor(ctx):
    ctx.write_message(
        ctx.output_dir("compliance_checker"),
        protocol_message(_scored(transaction_id="TXN100")),
    )

    processed = cc.run(ctx)

    assert processed == 1
    assert list(ctx.output_dir("compliance_checker").glob("*.json")) == []
    assert (ctx.output_dir("settlement_processor") / "TXN100.json").exists()


def test_run_drains_multiple_messages_watchlist_and_clean(ctx):
    ctx.write_message(
        ctx.output_dir("compliance_checker"),
        protocol_message(_scored(transaction_id="TXN003", destination_account="ACC-9999")),
    )
    ctx.write_message(
        ctx.output_dir("compliance_checker"),
        protocol_message(_scored(transaction_id="TXN100")),
    )

    processed = cc.run(ctx)

    assert processed == 2
    assert (ctx.results_dir / "TXN003.json").exists()
    assert (ctx.output_dir("settlement_processor") / "TXN100.json").exists()


# --------------------------------------------------------------------------- #
# does not mutate input message
# --------------------------------------------------------------------------- #
def test_process_message_does_not_mutate_the_input_message(ctx):
    data = _scored(transaction_id="TXN100")
    message = protocol_message(dict(data))
    process_message(message, ctx)
    assert "compliance" not in message["data"]


# --------------------------------------------------------------------------- #
# CLI entry point (__main__ block)
# --------------------------------------------------------------------------- #
def test_cli_main_runs_against_cwd_and_prints_processed_count(tmp_path, capsys, project_root, monkeypatch):
    from agents.base import PipelineContext

    monkeypatch.chdir(tmp_path)
    seed_ctx = PipelineContext(tmp_path)
    seed_ctx.write_message(
        seed_ctx.output_dir("compliance_checker"),
        protocol_message(_scored(transaction_id="TXN100")),
    )

    runpy.run_path(str(project_root / "agents" / "compliance_checker.py"), run_name="__main__")

    out = capsys.readouterr().out
    assert "processed 1 message(s)" in out
    assert (tmp_path / "shared" / "output" / "settlement_processor" / "TXN100.json").exists()
