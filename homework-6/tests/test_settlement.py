"""tests/test_settlement.py — agents/settlement_processor.py.

Covers the Decimal fee math (wire_transfer, transfer + cap, refund/deposit,
ROUND_HALF_UP rounding), the flagged_for_review -> held_for_review path (no
settlement block, no fee), forwarding to shared/output/reporting_agent, and
the CLI entry point.
"""
from __future__ import annotations

import runpy
from decimal import Decimal

from agents import settlement_processor as sp
from agents.settlement_processor import compute_fee, process_message

from conftest import FIXED_NOW_ISO, make_transaction, protocol_message, read_audit_lines


# --------------------------------------------------------------------------- #
# compute_fee — exact fee math
# --------------------------------------------------------------------------- #
def test_wire_transfer_fee_is_flat_25_plus_point_1_percent():
    # 25000 -> 25.00 flat + 0.1% of 25000 (25.00) = 50.00
    assert compute_fee("wire_transfer", Decimal("25000")) == Decimal("50.00")


def test_transfer_fee_is_half_percent_under_cap():
    # 1500 -> 0.5% = 7.50 (spec-seeded TXN001)
    assert compute_fee("transfer", Decimal("1500")) == Decimal("7.50")


def test_transfer_fee_is_capped_at_20():
    # 5000 -> 0.5% = 25.00, capped to 20.00
    assert compute_fee("transfer", Decimal("5000")) == Decimal("20.00")


def test_refund_fee_is_zero():
    assert compute_fee("refund", Decimal("100.00")) == Decimal("0.00")


def test_deposit_fee_is_zero():
    assert compute_fee("deposit", Decimal("100.00")) == Decimal("0.00")


def test_unknown_transaction_type_falls_back_to_zero_fee():
    assert compute_fee("unknown_type", Decimal("100.00")) == Decimal("0.00")


def test_transfer_fee_rounds_half_up():
    # 333.33 -> 0.5% = 1.66665 -> ROUND_HALF_UP -> 1.67
    assert compute_fee("transfer", Decimal("333.33")) == Decimal("1.67")


# --------------------------------------------------------------------------- #
# process_message — settlement math end-to-end (net_amount = amount - fee)
# --------------------------------------------------------------------------- #
def test_txn001_style_transfer_settles_with_seeded_fee_and_net(ctx):
    data = make_transaction(
        transaction_id="TXN001", amount="1500.00", transaction_type="transfer", status="cleared"
    )
    result = process_message(protocol_message(data), ctx)

    settlement = result["data"]["settlement"]
    assert result["data"]["status"] == "settled"
    assert settlement["fee"] == "7.50"
    assert settlement["net_amount"] == "1492.50"


def test_txn008_style_transfer_settles_with_seeded_fee_and_net(ctx):
    data = make_transaction(
        transaction_id="TXN008", amount="3200.00", transaction_type="transfer", status="cleared"
    )
    result = process_message(protocol_message(data), ctx)

    settlement = result["data"]["settlement"]
    assert settlement["fee"] == "16.00"
    assert settlement["net_amount"] == "3184.00"


def test_rounding_half_up_case_settlement_amounts(ctx):
    data = make_transaction(
        transaction_id="TXN200", amount="333.33", transaction_type="transfer", status="cleared"
    )
    result = process_message(protocol_message(data), ctx)

    settlement = result["data"]["settlement"]
    assert settlement["fee"] == "1.67"
    assert settlement["net_amount"] == "331.66"


def test_settlement_block_contains_batch_id_and_settled_at(ctx):
    data = make_transaction(transaction_id="TXN100", status="cleared")
    result = process_message(protocol_message(data), ctx)

    settlement = result["data"]["settlement"]
    assert settlement["settled_at"] == FIXED_NOW_ISO
    assert settlement["batch_id"] == "BATCH-20260320"  # matches FIXED_NOW's date


def test_settled_transaction_forwards_to_reporting_agent(ctx):
    data = make_transaction(transaction_id="TXN100", status="cleared")
    result = process_message(protocol_message(data), ctx)
    assert result["target_agent"] == "reporting_agent"
    assert result["message_type"] == "settled"


def test_settlement_is_audited_with_fee_net_and_batch(ctx):
    data = make_transaction(transaction_id="TXN001", amount="1500.00", status="cleared")
    process_message(protocol_message(data), ctx)

    lines = read_audit_lines(ctx)
    # NB: mask_text() runs over the whole outcome string, so a batch id that
    # happens to look like "<PREFIX>-<CODE>" gets masked too, same as an
    # account number would (BATCH-20260320 -> BATCH-***20).
    assert lines == [
        f"{FIXED_NOW_ISO} | settlement_processor | TXN001 | "
        "settled:fee=7.50:net=1492.50:batch=BATCH-***20"
    ]


def test_unparseable_amount_settles_with_zero_fee_and_net(ctx):
    data = make_transaction(transaction_id="TXN999", amount="not-a-number", status="cleared")
    result = process_message(protocol_message(data), ctx)

    settlement = result["data"]["settlement"]
    assert settlement["fee"] == "0.00"
    assert settlement["net_amount"] == "0.00"


# --------------------------------------------------------------------------- #
# flagged_for_review -> held_for_review (NOT settled, no fee, no settlement)
# --------------------------------------------------------------------------- #
def test_flagged_for_review_becomes_held_for_review_without_settlement(ctx):
    data = make_transaction(
        transaction_id="TXN002", amount="25000.00", status="flagged_for_review", risk_score=50
    )
    result = process_message(protocol_message(data), ctx)

    assert result["data"]["status"] == "held_for_review"
    assert "settlement" not in result["data"]
    assert result["target_agent"] == "reporting_agent"


def test_held_for_review_is_audited(ctx):
    data = make_transaction(transaction_id="TXN002", status="flagged_for_review")
    process_message(protocol_message(data), ctx)

    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | settlement_processor | TXN002 | held_for_review"]


def test_process_message_does_not_mutate_input_message(ctx):
    data = make_transaction(transaction_id="TXN100", status="cleared")
    message = protocol_message(dict(data))
    process_message(message, ctx)
    assert "settlement" not in message["data"]


# --------------------------------------------------------------------------- #
# run() — draining shared/output/settlement_processor/
# --------------------------------------------------------------------------- #
def test_run_drains_settlement_inbox_settled_and_held(ctx):
    ctx.write_message(
        ctx.output_dir("settlement_processor"),
        protocol_message(make_transaction(transaction_id="TXN001", status="cleared")),
    )
    ctx.write_message(
        ctx.output_dir("settlement_processor"),
        protocol_message(make_transaction(transaction_id="TXN002", status="flagged_for_review")),
    )

    processed = sp.run(ctx)

    assert processed == 2
    reporting_inbox = ctx.output_dir("reporting_agent")
    assert (reporting_inbox / "TXN001.json").exists()
    assert (reporting_inbox / "TXN002.json").exists()


# --------------------------------------------------------------------------- #
# CLI entry point (__main__ block)
# --------------------------------------------------------------------------- #
def test_cli_main_runs_against_cwd_and_prints_processed_count(tmp_path, capsys, project_root, monkeypatch):
    from agents.base import PipelineContext

    monkeypatch.chdir(tmp_path)
    seed_ctx = PipelineContext(tmp_path)
    seed_ctx.write_message(
        seed_ctx.output_dir("settlement_processor"),
        protocol_message(make_transaction(transaction_id="TXN100", status="cleared")),
    )

    runpy.run_path(str(project_root / "agents" / "settlement_processor.py"), run_name="__main__")

    out = capsys.readouterr().out
    assert "processed 1 message(s)" in out
    assert (tmp_path / "shared" / "output" / "reporting_agent" / "TXN100.json").exists()
