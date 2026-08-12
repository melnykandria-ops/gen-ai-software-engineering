"""tests/test_fraud.py — agents/fraud_detector.py.

Exercises the exact scoring table from specification.md §5, the
flagged_for_review / cleared threshold at risk_score 50, process_message
forwarding, run(), and the CLI entry point.
"""
from __future__ import annotations

import runpy
import sys

import pytest

from agents import fraud_detector as fd
from agents.fraud_detector import _parse_hour, process_message, score_transaction

from conftest import FIXED_NOW_ISO, make_transaction, protocol_message, read_audit_lines


def _clean(**overrides) -> dict:
    """A transaction with every risk factor OFF, so individual factors can be
    isolated: US country, non-api channel, daytime UTC hour, modest amount.
    """
    base = make_transaction(
        amount="100.00",
        timestamp="2026-03-16T12:00:00Z",  # hour 12 -> no unusual_timing
        metadata={"channel": "online", "country": "US"},
    )
    base.update(overrides)
    return base


# --------------------------------------------------------------------------- #
# scoring table — amount thresholds
# --------------------------------------------------------------------------- #
def test_score_amount_over_10000_scores_50_high_value():
    score, factors = score_transaction(_clean(amount="10000.01"))
    assert score == 50
    assert factors == ["high_value"]


def test_score_amount_9999_99_scores_30_structuring():
    score, factors = score_transaction(_clean(amount="9999.99"))
    assert score == 30
    assert factors == ["structuring"]


def test_score_amount_9000_boundary_scores_30_structuring():
    score, factors = score_transaction(_clean(amount="9000.00"))
    assert score == 30
    assert factors == ["structuring"]


def test_score_amount_8999_99_scores_zero():
    score, factors = score_transaction(_clean(amount="8999.99"))
    assert score == 0
    assert factors == []


def test_score_amount_exactly_10000_is_neither_high_value_nor_structuring():
    score, factors = score_transaction(_clean(amount="10000.00"))
    assert score == 0
    assert factors == []


# --------------------------------------------------------------------------- #
# scoring table — unusual timing (UTC hour 0..5 inclusive, 6 excluded)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("hour", [0, 1, 2, 3, 4, 5])
def test_score_unusual_timing_hours_0_to_5_score_15(hour):
    score, factors = score_transaction(_clean(timestamp=f"2026-03-16T{hour:02d}:00:00Z"))
    assert score == 15
    assert factors == ["unusual_timing"]


def test_score_hour_6_is_not_unusual_timing():
    score, factors = score_transaction(_clean(timestamp="2026-03-16T06:00:00Z"))
    assert score == 0
    assert factors == []


# --------------------------------------------------------------------------- #
# scoring table — cross-border + api channel
# --------------------------------------------------------------------------- #
def test_score_country_de_scores_20_cross_border():
    score, factors = score_transaction(_clean(metadata={"channel": "online", "country": "DE"}))
    assert score == 20
    assert factors == ["cross_border"]


def test_score_channel_api_scores_5_api_channel():
    score, factors = score_transaction(_clean(metadata={"channel": "api", "country": "US"}))
    assert score == 5
    assert factors == ["api_channel"]


def test_score_missing_metadata_still_counts_as_cross_border():
    data = _clean()
    del data["metadata"]
    score, factors = score_transaction(data)
    # metadata.get("country") != "US" is True when metadata itself is absent.
    assert score == 20
    assert factors == ["cross_border"]


# --------------------------------------------------------------------------- #
# combined scoring — TXN004-style (timing + cross_border + api == 40)
# --------------------------------------------------------------------------- #
def test_score_txn004_style_combined_factors_scores_40():
    data = make_transaction(
        transaction_id="TXN004",
        amount="500.00",
        currency="EUR",
        timestamp="2026-03-16T02:47:00Z",  # hour 2 -> unusual_timing
        metadata={"channel": "api", "country": "DE"},
    )
    score, factors = score_transaction(data)
    assert score == 40
    assert set(factors) == {"unusual_timing", "cross_border", "api_channel"}


def test_score_structuring_plus_cross_border_reaches_flag_threshold_via_addition():
    data = _clean(amount="9500.00", metadata={"channel": "online", "country": "DE"})
    score, factors = score_transaction(data)
    assert score == 50
    assert set(factors) == {"structuring", "cross_border"}


# --------------------------------------------------------------------------- #
# _parse_hour helper
# --------------------------------------------------------------------------- #
def test_parse_hour_extracts_utc_hour_from_iso_timestamp():
    assert _parse_hour("2026-03-16T02:47:00Z") == 2


def test_parse_hour_returns_none_for_malformed_timestamp():
    assert _parse_hour("not-a-timestamp") is None


def test_parse_hour_returns_none_for_missing_timestamp():
    assert _parse_hour("") is None
    assert _parse_hour(None) is None


# --------------------------------------------------------------------------- #
# risk_score threshold -> status
# --------------------------------------------------------------------------- #
def test_score_at_or_above_50_flags_for_review(ctx):
    message = protocol_message(_clean(amount="10000.01", transaction_id="TXN002"))
    result = process_message(message, ctx)
    assert result["data"]["status"] == "flagged_for_review"
    assert result["data"]["risk_score"] == 50


def test_score_below_50_is_cleared(ctx):
    message = protocol_message(_clean(amount="9999.99", transaction_id="TXN003"))
    result = process_message(message, ctx)
    assert result["data"]["status"] == "cleared"
    assert result["data"]["risk_score"] == 30


# --------------------------------------------------------------------------- #
# process_message — forwarding + audit
# --------------------------------------------------------------------------- #
def test_process_message_forwards_to_compliance_checker_with_risk_fields(ctx):
    message = protocol_message(_clean(transaction_id="TXN100"))
    result = process_message(message, ctx)

    assert result["target_agent"] == "compliance_checker"
    assert result["data"]["risk_score"] == 0
    assert result["data"]["risk_factors"] == []
    assert result["timestamp"] == FIXED_NOW_ISO


def test_process_message_audits_flagged_and_cleared_outcomes(ctx):
    process_message(protocol_message(_clean(amount="10000.01", transaction_id="TXN002")), ctx)
    process_message(protocol_message(_clean(transaction_id="TXN100")), ctx)

    lines = read_audit_lines(ctx)
    assert any("TXN002" in line and "flagged_for_review:score=50:factors=high_value" in line for line in lines)
    assert any("TXN100" in line and "cleared:score=0:factors=none" in line for line in lines)


def test_process_message_does_not_mutate_the_input_message(ctx):
    data = _clean(transaction_id="TXN100")
    message = protocol_message(dict(data))
    process_message(message, ctx)
    assert "risk_score" not in message["data"]


# --------------------------------------------------------------------------- #
# run() — draining shared/output/fraud_detector/
# --------------------------------------------------------------------------- #
def test_run_drains_fraud_detector_inbox_and_forwards(ctx):
    ctx.write_message(
        ctx.output_dir("fraud_detector"), protocol_message(_clean(transaction_id="TXN100"))
    )

    processed = fd.run(ctx)

    assert processed == 1
    assert list(ctx.output_dir("fraud_detector").glob("*.json")) == []
    assert (ctx.output_dir("compliance_checker") / "TXN100.json").exists()


# --------------------------------------------------------------------------- #
# CLI entry point (__main__ block)
# --------------------------------------------------------------------------- #
def test_cli_main_runs_against_cwd_and_prints_processed_count(tmp_path, capsys, project_root, monkeypatch):
    from agents.base import PipelineContext

    monkeypatch.chdir(tmp_path)
    seed_ctx = PipelineContext(tmp_path)
    seed_ctx.write_message(
        seed_ctx.output_dir("fraud_detector"), protocol_message(_clean(transaction_id="TXN100"))
    )

    runpy.run_path(str(project_root / "agents" / "fraud_detector.py"), run_name="__main__")

    out = capsys.readouterr().out
    assert "processed 1 message(s)" in out
    assert (tmp_path / "shared" / "output" / "compliance_checker" / "TXN100.json").exists()
