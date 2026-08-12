"""agents/fraud_detector.py — second hop of the pipeline.

Consumes validated messages from shared/output/fraud_detector/ and scores
each transaction (specification.md §5):

  amount > 10000                    -> +50  (high_value)
  9000 <= amount <= 9999.99         -> +30  (structuring)
  UTC hour in [0, 6)                -> +15  (unusual_timing)
  metadata.country != 'US'          -> +20  (cross_border)
  metadata.channel == 'api'         -> +5   (api_channel)

risk_score >= 50 -> status 'flagged_for_review' (still forwarded, marked for
manual review); otherwise -> status 'cleared'. Everything is forwarded to
shared/output/compliance_checker/ with risk_score and risk_factors[].
"""
from __future__ import annotations

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

# Allow direct script execution (`python agents/fraud_detector.py`) as well as
# `import agents.fraud_detector` — see transaction_validator.py for rationale.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from agents.base import PipelineContext, make_message, parse_amount, run_agent

AGENT_NAME = "fraud_detector"
NEXT_AGENT = "compliance_checker"

FLAG_THRESHOLD = 50

HIGH_VALUE_THRESHOLD = Decimal("10000")
STRUCTURING_LOW = Decimal("9000")
STRUCTURING_HIGH = Decimal("9999.99")


def _parse_hour(timestamp: str) -> int | None:
    """Extract the UTC hour from an ISO-8601 timestamp string, or None."""
    try:
        ts = timestamp.replace("Z", "+00:00")
        return datetime.fromisoformat(ts).hour
    except (ValueError, AttributeError):
        return None


def score_transaction(data: dict) -> tuple[int, list[str]]:
    """Pure scoring logic: given a validated transaction's data, return
    (risk_score, risk_factors) per the fixed rule table above.
    """
    score = 0
    factors: list[str] = []

    amount = parse_amount(data.get("amount"))
    if amount is not None:
        if amount > HIGH_VALUE_THRESHOLD:
            score += 50
            factors.append("high_value")
        elif STRUCTURING_LOW <= amount <= STRUCTURING_HIGH:
            score += 30
            factors.append("structuring")

    hour = _parse_hour(data.get("timestamp", ""))
    if hour is not None and 0 <= hour < 6:
        score += 15
        factors.append("unusual_timing")

    metadata = data.get("metadata") or {}
    if metadata.get("country") != "US":
        score += 20
        factors.append("cross_border")
    if metadata.get("channel") == "api":
        score += 5
        factors.append("api_channel")

    return score, factors


def process_message(message: dict, ctx: PipelineContext) -> dict:
    """Score one validated transaction and forward it (flagged or cleared)."""
    data = dict(message["data"])
    txn_id = data.get("transaction_id", "UNKNOWN")

    risk_score, risk_factors = score_transaction(data)
    data["risk_score"] = risk_score
    data["risk_factors"] = risk_factors

    if risk_score >= FLAG_THRESHOLD:
        data["status"] = "flagged_for_review"
        outcome = f"flagged_for_review:score={risk_score}:factors={','.join(risk_factors) or 'none'}"
    else:
        data["status"] = "cleared"
        outcome = f"cleared:score={risk_score}:factors={','.join(risk_factors) or 'none'}"

    ctx.audit(AGENT_NAME, txn_id, outcome)
    return make_message(AGENT_NAME, NEXT_AGENT, data["status"], data, now=ctx.now())


def run(ctx: PipelineContext) -> int:
    """Drain shared/output/fraud_detector/, scoring everything found there."""
    result = run_agent(ctx, AGENT_NAME, ctx.output_dir(AGENT_NAME), process_message)
    return result.processed


if __name__ == "__main__":
    context = PipelineContext(Path("."))
    processed_count = run(context)
    print(f"{AGENT_NAME}: processed {processed_count} message(s)")
