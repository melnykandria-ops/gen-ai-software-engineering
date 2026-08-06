"""agents/settlement_processor.py — fourth hop of the pipeline.

Consumes messages from shared/output/settlement_processor/. Fees are always
Decimal, always rounded with ROUND_HALF_UP to 2 places (research-notes.md §1):

  wire_transfer -> 25.00 + 0.1% of amount
  transfer      -> 0.5% of amount, capped at 20.00
  refund/deposit -> 0.00

net_amount = amount - fee.

Transactions flagged upstream ('flagged_for_review') are NOT settled: they
are forwarded as status 'held_for_review' with no settlement block. Everyone
else is forwarded 'settled' with a settlement block:
{fee, net_amount, batch_id, settled_at}. Everything lands in
shared/output/reporting_agent/.
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

# Allow direct script execution (`python agents/settlement_processor.py`) as
# well as `import agents.settlement_processor` — see transaction_validator.py.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from agents.base import PipelineContext, iso_ts, make_message, parse_amount, quantize_money, run_agent

AGENT_NAME = "settlement_processor"
NEXT_AGENT = "reporting_agent"

WIRE_FLAT_FEE = Decimal("25.00")
WIRE_PERCENT = Decimal("0.001")  # 0.1%
TRANSFER_PERCENT = Decimal("0.005")  # 0.5%
TRANSFER_CAP = Decimal("20.00")
ZERO_FEE = Decimal("0.00")


def compute_fee(transaction_type: str, amount: Decimal) -> Decimal:
    """Compute the settlement fee for a transaction type/amount, per spec.

    Falls back to a zero fee for any transaction_type not covered by the
    spec (defensive default — the sample data never hits this branch).
    """
    if transaction_type == "wire_transfer":
        raw_fee = WIRE_FLAT_FEE + (amount * WIRE_PERCENT)
        return quantize_money(raw_fee)
    if transaction_type == "transfer":
        raw_fee = min(amount * TRANSFER_PERCENT, TRANSFER_CAP)
        return quantize_money(raw_fee)
    if transaction_type in ("refund", "deposit"):
        return ZERO_FEE
    return ZERO_FEE


def process_message(message: dict, ctx: PipelineContext) -> dict:
    """Settle one transaction, or hold it for review if it was flagged."""
    data = dict(message["data"])
    txn_id = data.get("transaction_id", "UNKNOWN")

    if data.get("status") == "flagged_for_review":
        data["status"] = "held_for_review"
        ctx.audit(AGENT_NAME, txn_id, "held_for_review")
        return make_message(AGENT_NAME, NEXT_AGENT, "held_for_review", data, now=ctx.now())

    amount = parse_amount(data.get("amount"))
    fee = compute_fee(data.get("transaction_type", ""), amount) if amount is not None else ZERO_FEE
    net_amount = quantize_money(amount - fee) if amount is not None else ZERO_FEE

    batch_id = f"BATCH-{ctx.now():%Y%m%d}"
    data["status"] = "settled"
    data["settlement"] = {
        "fee": str(fee),
        "net_amount": str(net_amount),
        "batch_id": batch_id,
        "settled_at": iso_ts(ctx.now()),
    }

    ctx.audit(AGENT_NAME, txn_id, f"settled:fee={fee}:net={net_amount}:batch={batch_id}")
    return make_message(AGENT_NAME, NEXT_AGENT, "settled", data, now=ctx.now())


def run(ctx: PipelineContext) -> int:
    """Drain shared/output/settlement_processor/, settling or holding each."""
    result = run_agent(ctx, AGENT_NAME, ctx.output_dir(AGENT_NAME), process_message)
    return result.processed


if __name__ == "__main__":
    context = PipelineContext(Path("."))
    processed_count = run(context)
    print(f"{AGENT_NAME}: processed {processed_count} message(s)")
