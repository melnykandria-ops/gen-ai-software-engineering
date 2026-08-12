"""tests/test_base.py — agents/base.py: masking, Decimal helpers, message
protocol, PipelineContext I/O, and the audit trail.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from agents.base import (
    AgentRunResult,
    PipelineContext,
    iso_ts,
    make_message,
    mask_account,
    mask_text,
    parse_amount,
    quantize_money,
    required_fields_missing,
    route_message,
    run_agent,
)

from conftest import FIXED_NOW, FIXED_NOW_ISO, protocol_message, read_audit_lines


# --------------------------------------------------------------------------- #
# mask_account
# --------------------------------------------------------------------------- #
def test_mask_account_keeps_prefix_and_last_two_characters():
    assert mask_account("ACC-1001") == "ACC-***01"


def test_mask_account_short_code_keeps_whole_short_tail():
    # code shorter than 2 chars -> tail is the whole code, per implementation.
    assert mask_account("ACC-1") == "ACC-***1"


def test_mask_account_non_matching_shape_returns_unchanged():
    assert mask_account("no-dash-here has spaces") == "no-dash-here has spaces"
    assert mask_account("PLAINSTRING") == "PLAINSTRING"


@pytest.mark.parametrize("value", [None, 12345, 1500.0])
def test_mask_account_non_string_input_returns_unchanged(value):
    assert mask_account(value) is value


# --------------------------------------------------------------------------- #
# mask_text
# --------------------------------------------------------------------------- #
def test_mask_text_masks_every_account_occurrence_in_free_text():
    text = "transfer from ACC-1001 to ACC-2002 flagged"
    assert mask_text(text) == "transfer from ACC-***01 to ACC-***02 flagged"


@pytest.mark.parametrize("value", ["", None])
def test_mask_text_falsy_input_returns_unchanged(value):
    assert mask_text(value) == value


def test_mask_text_leaves_text_without_accounts_untouched():
    assert mask_text("watchlist_hit") == "watchlist_hit"


# --------------------------------------------------------------------------- #
# parse_amount
# --------------------------------------------------------------------------- #
def test_parse_amount_valid_string_returns_decimal():
    assert parse_amount("1500.00") == Decimal("1500.00")


def test_parse_amount_none_returns_none():
    assert parse_amount(None) is None


@pytest.mark.parametrize("garbage", ["abc", "12.34.56", "", "$100", object()])
def test_parse_amount_garbage_returns_none(garbage):
    assert parse_amount(garbage) is None


def test_parse_amount_negative_parses_to_negative_decimal():
    # parse_amount itself does not reject sign — only the validator's
    # positivity check does.
    assert parse_amount("-100.00") == Decimal("-100.00")


def test_parse_amount_nan_returns_none():
    assert parse_amount("NaN") is None


def test_parse_amount_infinity_returns_none():
    assert parse_amount("Infinity") is None
    assert parse_amount("-Infinity") is None


# --------------------------------------------------------------------------- #
# quantize_money — ROUND_HALF_UP edges
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "raw, expected",
    [
        (Decimal("1.005"), Decimal("1.01")),
        (Decimal("2.675"), Decimal("2.68")),
        (Decimal("0.125"), Decimal("0.13")),
        (Decimal("-1.005"), Decimal("-1.01")),
        (Decimal("10.004"), Decimal("10.00")),
        (Decimal("10.001"), Decimal("10.00")),
        (Decimal("333.33") * Decimal("0.005"), Decimal("1.67")),
    ],
)
def test_quantize_money_round_half_up(raw, expected):
    assert quantize_money(raw) == expected


# --------------------------------------------------------------------------- #
# iso_ts
# --------------------------------------------------------------------------- #
def test_iso_ts_naive_datetime_treated_as_utc_with_trailing_z():
    assert iso_ts(datetime(2026, 1, 1, 0, 0, 0)) == "2026-01-01T00:00:00Z"


def test_iso_ts_converts_non_utc_aware_datetime_to_utc():
    tz_plus5 = timezone(timedelta(hours=5))
    dt = datetime(2026, 1, 1, 5, 0, 0, tzinfo=tz_plus5)
    assert iso_ts(dt) == "2026-01-01T00:00:00Z"


# --------------------------------------------------------------------------- #
# make_message
# --------------------------------------------------------------------------- #
def test_make_message_has_exact_protocol_field_names():
    message = make_message(
        "transaction_validator", "fraud_detector", "validated",
        {"transaction_id": "TXN100"}, now=FIXED_NOW,
    )
    assert set(message.keys()) == {
        "message_id", "timestamp", "source_agent", "target_agent",
        "message_type", "data",
    }


def test_make_message_field_values_match_inputs():
    data = {"transaction_id": "TXN100", "amount": "1500.00"}
    message = make_message("agent_a", "agent_b", "some_type", data, now=FIXED_NOW)

    assert message["source_agent"] == "agent_a"
    assert message["target_agent"] == "agent_b"
    assert message["message_type"] == "some_type"
    assert message["data"] == data
    assert message["timestamp"] == FIXED_NOW_ISO
    # message_id must be a valid uuid4
    parsed = uuid.UUID(message["message_id"])
    assert parsed.version == 4


def test_make_message_defaults_now_to_real_utc_when_omitted():
    before = datetime.now(timezone.utc)
    message = make_message("agent_a", "agent_b", "type", {"transaction_id": "T1"})
    after = datetime.now(timezone.utc)

    ts = datetime.fromisoformat(message["timestamp"].replace("Z", "+00:00"))
    assert before - timedelta(seconds=1) <= ts <= after + timedelta(seconds=1)


# --------------------------------------------------------------------------- #
# required_fields_missing
# --------------------------------------------------------------------------- #
def test_required_fields_missing_detects_absent_and_blank_fields():
    data = {"a": "1", "b": "", "c": None}
    assert required_fields_missing(data, ("a", "b", "c", "d")) == ["b", "c", "d"]


def test_required_fields_missing_returns_empty_when_all_present():
    data = {"a": "1", "b": "2"}
    assert required_fields_missing(data, ("a", "b")) == []


# --------------------------------------------------------------------------- #
# audit line format + masking
# --------------------------------------------------------------------------- #
def test_audit_appends_iso_ts_pipe_agent_pipe_txn_pipe_outcome_line(ctx):
    ctx.audit("transaction_validator", "TXN100", "validated")

    lines = read_audit_lines(ctx)
    assert len(lines) == 1
    assert lines[0] == f"{FIXED_NOW_ISO} | transaction_validator | TXN100 | validated"


def test_audit_masks_account_numbers_in_outcome_text(ctx):
    ctx.audit("compliance_checker", "TXN200", "rejected:watchlist_hit ACC-9999")

    lines = read_audit_lines(ctx)
    assert "ACC-9999" not in lines[0]
    assert "ACC-***99" in lines[0]


def test_audit_appends_multiple_lines_across_calls(ctx):
    ctx.audit("agent_a", "TXN1", "outcome_1")
    ctx.audit("agent_b", "TXN2", "outcome_2")

    lines = read_audit_lines(ctx)
    assert len(lines) == 2
    assert "agent_a" in lines[0] and "TXN1" in lines[0]
    assert "agent_b" in lines[1] and "TXN2" in lines[1]


# --------------------------------------------------------------------------- #
# PipelineContext — directory layout
# --------------------------------------------------------------------------- #
def test_context_directories_are_created_lazily_on_access(ctx, tmp_path):
    assert not (tmp_path / "shared").exists()

    ctx.input_dir
    ctx.processing_dir
    ctx.output_dir("fraud_detector")
    ctx.results_dir
    ctx.logs_dir

    assert (tmp_path / "shared" / "input").is_dir()
    assert (tmp_path / "shared" / "processing").is_dir()
    assert (tmp_path / "shared" / "output" / "fraud_detector").is_dir()
    assert (tmp_path / "shared" / "results").is_dir()
    assert (tmp_path / "shared" / "logs").is_dir()


def test_context_now_uses_injected_clock(ctx):
    assert ctx.now() == FIXED_NOW


def test_context_now_defaults_to_real_utc_clock(tmp_path):
    default_ctx = PipelineContext(tmp_path)
    before = datetime.now(timezone.utc)
    observed = default_ctx.now()
    after = datetime.now(timezone.utc)
    assert before <= observed <= after


# --------------------------------------------------------------------------- #
# read_dir_messages
# --------------------------------------------------------------------------- #
def test_read_dir_messages_skips_malformed_json(ctx):
    inbox = ctx.input_dir
    (inbox / "TXN001.json").write_text(json.dumps({"data": {"transaction_id": "TXN001"}}))
    (inbox / "TXN002.json").write_text("{not valid json")

    messages = ctx.read_dir_messages(inbox)

    assert len(messages) == 1
    path, message = messages[0]
    assert path.name == "TXN001.json"
    assert message["data"]["transaction_id"] == "TXN001"


def test_read_dir_messages_returns_empty_list_for_empty_dir(ctx):
    assert ctx.read_dir_messages(ctx.input_dir) == []


def test_read_dir_messages_sorted_by_filename(ctx):
    inbox = ctx.input_dir
    for txn_id in ("TXN003", "TXN001", "TXN002"):
        ctx.write_message(inbox, protocol_message({"transaction_id": txn_id}))

    messages = ctx.read_dir_messages(inbox)
    names = [path.name for path, _ in messages]
    assert names == sorted(names)


# --------------------------------------------------------------------------- #
# move_to_processing / write_message / write_result / forward
# --------------------------------------------------------------------------- #
def test_move_to_processing_moves_file_out_of_source_dir(ctx):
    message = protocol_message({"transaction_id": "TXN100"})
    src = ctx.write_message(ctx.input_dir, message)

    dest = ctx.move_to_processing(src)

    assert not src.exists()
    assert dest == ctx.processing_dir / "TXN100.json"
    assert dest.exists()


def test_write_message_writes_full_envelope_named_by_transaction_id(ctx):
    message = protocol_message({"transaction_id": "TXN100", "amount": "1.00"})
    dest = ctx.write_message(ctx.output_dir("fraud_detector"), message)

    assert dest.name == "TXN100.json"
    on_disk = json.loads(dest.read_text(encoding="utf-8"))
    assert on_disk == message  # full envelope, not just data
    # indented (pretty-printed), not a single compact line
    assert "\n" in dest.read_text(encoding="utf-8")


def test_write_result_persists_only_the_data_payload(ctx):
    message = protocol_message({"transaction_id": "TXN100", "status": "rejected"})
    dest = ctx.write_result(message)

    assert dest == ctx.results_dir / "TXN100.json"
    on_disk = json.loads(dest.read_text(encoding="utf-8"))
    assert on_disk == message["data"]
    assert "message_id" not in on_disk


def test_forward_writes_into_target_agents_output_dir(ctx):
    message = protocol_message(
        {"transaction_id": "TXN100"}, target_agent="settlement_processor"
    )
    dest = ctx.forward(message)

    assert dest == ctx.output_dir("settlement_processor") / "TXN100.json"
    assert dest.exists()


# --------------------------------------------------------------------------- #
# route_message
# --------------------------------------------------------------------------- #
def test_route_message_to_results_writes_terminal_result(ctx):
    message = protocol_message({"transaction_id": "TXN100"}, target_agent="results")
    dest = route_message(ctx, message)

    assert dest == ctx.results_dir / "TXN100.json"


def test_route_message_to_agent_forwards_to_output_dir(ctx):
    message = protocol_message({"transaction_id": "TXN100"}, target_agent="reporting_agent")
    dest = route_message(ctx, message)

    assert dest == ctx.output_dir("reporting_agent") / "TXN100.json"


# --------------------------------------------------------------------------- #
# run_agent — the generic drain-inbox-and-route loop
# --------------------------------------------------------------------------- #
def test_run_agent_drains_inbox_and_routes_each_message(ctx):
    inbox = ctx.output_dir("test_agent")
    ctx.write_message(inbox, protocol_message({"transaction_id": "TXN001"}))
    ctx.write_message(inbox, protocol_message({"transaction_id": "TXN002"}))

    def process_fn(message: dict, ctx: PipelineContext) -> dict:
        data = dict(message["data"])
        # TXN001 forwards on, TXN002 terminates.
        target = "results" if data["transaction_id"] == "TXN002" else "next_agent"
        return make_message("test_agent", target, "processed", data, now=ctx.now())

    result = run_agent(ctx, "test_agent", inbox, process_fn)

    assert isinstance(result, AgentRunResult)
    assert result.agent == "test_agent"
    assert result.processed == 2
    assert sorted(result.inputs) == ["TXN001", "TXN002"]

    # inbox drained
    assert list(inbox.glob("*.json")) == []
    # both originals moved into processing/
    assert (ctx.processing_dir / "TXN001.json").exists()
    assert (ctx.processing_dir / "TXN002.json").exists()
    # routed correctly
    assert (ctx.output_dir("next_agent") / "TXN001.json").exists()
    assert (ctx.results_dir / "TXN002.json").exists()


def test_run_agent_on_empty_inbox_processes_nothing(ctx):
    result = run_agent(ctx, "test_agent", ctx.output_dir("test_agent"), lambda m, c: m)
    assert result.processed == 0
    assert result.inputs == []
