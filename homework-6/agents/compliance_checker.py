"""agents/compliance_checker.py — third hop of the pipeline.

Consumes scored messages from shared/output/compliance_checker/. Rules
(specification.md §5):

  * source_account or destination_account in WATCHLIST {'ACC-9999'}
        -> terminal reject, reason 'watchlist_hit' (short-circuits to
           shared/results/, regardless of risk_score).
  * amount > 10000
        -> data.compliance.ctr_filed = True (a Currency Transaction Report
           is generated for the record).
  * risk_score >= 50 (set upstream by fraud_detector)
        -> the 'flagged_for_review' status is left untouched; compliance
           does not clear it, it just passes the flag on.

Everything that is not rejected is forwarded to
shared/output/settlement_processor/.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow direct script execution (`python agents/compliance_checker.py`) as well
# as `import agents.compliance_checker` — see transaction_validator.py.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from agents.base import PipelineContext, iso_ts, make_message, parse_amount, run_agent

AGENT_NAME = "compliance_checker"
NEXT_AGENT = "settlement_processor"

WATCHLIST = frozenset({"ACC-9999"})
CTR_THRESHOLD = parse_amount("10000")  # Decimal("10000") — amounts strictly above this get a CTR


def process_message(message: dict, ctx: PipelineContext) -> dict:
    """Apply watchlist + CTR rules to one scored transaction."""
    data = dict(message["data"])
    txn_id = data.get("transaction_id", "UNKNOWN")

    source_account = data.get("source_account")
    destination_account = data.get("destination_account")

    if source_account in WATCHLIST or destination_account in WATCHLIST:
        data["status"] = "rejected"
        data["reason"] = "watchlist_hit"
        ctx.audit(AGENT_NAME, txn_id, "rejected:watchlist_hit")
        return make_message(AGENT_NAME, "results", "rejected", data, now=ctx.now())

    amount = parse_amount(data.get("amount"))
    ctr_filed = amount is not None and amount > CTR_THRESHOLD
    data["compliance"] = {"ctr_filed": ctr_filed}
    if ctr_filed:
        data["compliance"]["ctr_filed_at"] = iso_ts(ctx.now())

    ctx.audit(AGENT_NAME, txn_id, f"cleared:ctr_filed={str(ctr_filed).lower()}")
    # data["status"] (validated upstream as 'flagged_for_review' or 'cleared')
    # is left exactly as fraud_detector set it — compliance does not clear it.
    return make_message(AGENT_NAME, NEXT_AGENT, data["status"], data, now=ctx.now())


def run(ctx: PipelineContext) -> int:
    """Drain shared/output/compliance_checker/, applying watchlist + CTR rules."""
    result = run_agent(ctx, AGENT_NAME, ctx.output_dir(AGENT_NAME), process_message)
    return result.processed


if __name__ == "__main__":
    context = PipelineContext(Path("."))
    processed_count = run(context)
    print(f"{AGENT_NAME}: processed {processed_count} message(s)")
