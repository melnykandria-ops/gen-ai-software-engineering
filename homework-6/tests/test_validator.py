"""tests/test_validator.py — agents/transaction_validator.py.

Covers the pure validate_record() rules, process_message() routing
(valid -> shared/output/fraud_detector, invalid -> shared/results with a
reason), --dry-run (no writes), run(), and the CLI entry point.
"""
from __future__ import annotations

import json
import runpy
import sys
from decimal import Decimal
from pathlib import Path

import pytest

from agents import transaction_validator as tv
from agents.transaction_validator import REQUIRED_FIELDS, dry_run, process_message, validate_record

from conftest import FIXED_NOW_ISO, fixed_now, make_transaction, protocol_message, read_audit_lines


# --------------------------------------------------------------------------- #
# validate_record — happy path
# --------------------------------------------------------------------------- #
def test_validate_record_happy_path_is_valid():
    is_valid, reason = validate_record(make_transaction())
    assert is_valid is True
    assert reason is None


# --------------------------------------------------------------------------- #
# validate_record — each missing required field
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_validate_record_rejects_each_missing_required_field(field):
    data = make_transaction()
    del data[field]

    is_valid, reason = validate_record(data)

    assert is_valid is False
    assert reason == f"missing_fields:{field}"


def test_validate_record_reports_all_missing_fields_in_required_order():
    data = make_transaction()
    del data["currency"]
    del data["timestamp"]

    is_valid, reason = validate_record(data)

    assert is_valid is False
    # required_fields_missing walks REQUIRED_FIELDS in its declared order.
    assert reason == "missing_fields:currency,timestamp"


def test_validate_record_treats_blank_string_as_missing():
    data = make_transaction(transaction_id="")
    is_valid, reason = validate_record(data)
    assert is_valid is False
    assert reason == "missing_fields:transaction_id"


# --------------------------------------------------------------------------- #
# validate_record — non-positive amounts
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("amount", ["0", "0.00", "-100.00"])
def test_validate_record_rejects_non_positive_amounts(amount):
    data = make_transaction(amount=amount)
    is_valid, reason = validate_record(data)
    assert is_valid is False
    assert reason == "non_positive_amount"


# --------------------------------------------------------------------------- #
# validate_record — invalid currency
# --------------------------------------------------------------------------- #
def test_validate_record_rejects_invalid_currency():
    data = make_transaction(currency="XYZ")
    is_valid, reason = validate_record(data)
    assert is_valid is False
    assert reason == "invalid_currency"


# --------------------------------------------------------------------------- #
# validate_record — Decimal parse garbage
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("amount", ["not-a-number", "12.34.56", "$$$"])
def test_validate_record_rejects_unparseable_amount(amount):
    data = make_transaction(amount=amount)
    is_valid, reason = validate_record(data)
    assert is_valid is False
    assert reason == "unparseable_amount"


# --------------------------------------------------------------------------- #
# process_message — routing
# --------------------------------------------------------------------------- #
def test_process_message_valid_routes_to_fraud_detector(ctx):
    message = protocol_message(make_transaction(transaction_id="TXN010"))

    result = process_message(message, ctx)

    assert result["target_agent"] == "fraud_detector"
    assert result["message_type"] == "validated"
    assert result["data"]["status"] == "validated"
    assert result["data"]["transaction_id"] == "TXN010"
    assert result["timestamp"] == FIXED_NOW_ISO

    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | transaction_validator | TXN010 | validated"]


def test_process_message_invalid_routes_to_results_with_reason(ctx):
    message = protocol_message(make_transaction(transaction_id="TXN006", currency="XYZ"))

    result = process_message(message, ctx)

    assert result["target_agent"] == "results"
    assert result["data"]["status"] == "rejected"
    assert result["data"]["reason"] == "invalid_currency"

    lines = read_audit_lines(ctx)
    assert lines == [f"{FIXED_NOW_ISO} | transaction_validator | TXN006 | rejected:invalid_currency"]


def test_process_message_uses_unknown_when_transaction_id_missing(ctx):
    message = protocol_message({"currency": "XYZ"})  # deliberately malformed
    result = process_message(message, ctx)
    assert result["data"].get("transaction_id") is None
    lines = read_audit_lines(ctx)
    assert "UNKNOWN" in lines[0]


def test_process_message_does_not_mutate_the_input_message(ctx):
    original_data = make_transaction(transaction_id="TXN010")
    message = protocol_message(dict(original_data))

    process_message(message, ctx)

    assert message["data"] == original_data  # untouched (shallow copy inside)


# --------------------------------------------------------------------------- #
# run() — draining shared/input/
# --------------------------------------------------------------------------- #
def test_run_drains_input_dir_and_forwards_valid_transaction(ctx):
    ctx.write_message(ctx.input_dir, protocol_message(make_transaction(transaction_id="TXN010")))

    processed = tv.run(ctx)

    assert processed == 1
    assert list(ctx.input_dir.glob("*.json")) == []
    assert (ctx.processing_dir / "TXN010.json").exists()
    assert (ctx.output_dir("fraud_detector") / "TXN010.json").exists()


def test_run_drains_input_dir_and_rejects_invalid_transaction(ctx):
    ctx.write_message(
        ctx.input_dir, protocol_message(make_transaction(transaction_id="TXN007", amount="-100.00"))
    )

    processed = tv.run(ctx)

    assert processed == 1
    result = json.loads((ctx.results_dir / "TXN007.json").read_text())
    assert result["status"] == "rejected"
    assert result["reason"] == "non_positive_amount"


# --------------------------------------------------------------------------- #
# --dry-run: validate a file and print a table, WITHOUT writing to shared/
# --------------------------------------------------------------------------- #
def test_dry_run_prints_table_and_touches_no_shared_tree(tmp_path, capsys):
    records = [
        make_transaction(transaction_id="TXN_OK"),
        make_transaction(transaction_id="TXN_BAD", currency="XYZ"),
    ]
    txns_file = tmp_path / "txns.json"
    txns_file.write_text(json.dumps(records))

    dry_run(txns_file)

    out = capsys.readouterr().out
    assert "txn" in out and "verdict" in out and "reason" in out
    assert "TXN_OK" in out and "VALID" in out
    assert "TXN_BAD" in out and "INVALID" in out and "invalid_currency" in out
    assert "1/2 valid, 1/2 invalid" in out

    # dry_run never builds a PipelineContext -> no shared/ tree anywhere.
    assert not (tmp_path / "shared").exists()


def test_dry_run_handles_empty_transactions_list(tmp_path, capsys):
    txns_file = tmp_path / "empty.json"
    txns_file.write_text(json.dumps([]))

    dry_run(txns_file)

    out = capsys.readouterr().out
    assert "0/0 valid, 0/0 invalid" in out


# --------------------------------------------------------------------------- #
# CLI entry point (__main__ block)
# --------------------------------------------------------------------------- #
def test_cli_dry_run_flag_exits_zero_and_prints_table(tmp_path, capsys, project_root, monkeypatch):
    txns_file = tmp_path / "txns.json"
    txns_file.write_text(json.dumps([make_transaction(transaction_id="TXN010")]))

    monkeypatch.setattr(
        sys, "argv", ["transaction_validator.py", "--dry-run", "--transactions-file", str(txns_file)]
    )

    with pytest.raises(SystemExit) as exc_info:
        runpy.run_path(str(project_root / "agents" / "transaction_validator.py"), run_name="__main__")

    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "TXN010" in out
    assert not (tmp_path / "shared").exists()


def test_cli_default_mode_runs_pipeline_against_base_dir(tmp_path, capsys, project_root, monkeypatch):
    from agents.base import PipelineContext

    seed_ctx = PipelineContext(tmp_path, now=fixed_now)
    seed_ctx.write_message(seed_ctx.input_dir, protocol_message(make_transaction(transaction_id="TXN010")))

    monkeypatch.setattr(sys, "argv", ["transaction_validator.py", "--base-dir", str(tmp_path)])

    runpy.run_path(str(project_root / "agents" / "transaction_validator.py"), run_name="__main__")

    out = capsys.readouterr().out
    assert "processed 1 message(s)" in out
    assert (tmp_path / "shared" / "output" / "fraud_detector" / "TXN010.json").exists()
