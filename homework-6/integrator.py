"""integrator.py — orchestrates the full transaction-processing pipeline.

Builds the shared/ tree, wraps every record from sample-transactions.json
(or any transactions file) into a protocol message dropped into
shared/input/, then runs the five agents in spec order:

    transaction_validator -> fraud_detector -> compliance_checker
        -> settlement_processor -> reporting_agent

Idempotent: each run clears shared/input, shared/processing, shared/output,
and shared/results, but preserves shared/logs/audit.log across runs.
Exits 1 if any input transaction fails to reach a terminal result.
"""
from __future__ import annotations

import json
import shutil
import sys
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from agents import compliance_checker, fraud_detector, reporting_agent, settlement_processor, transaction_validator
from agents.base import PipelineContext, make_message

AGENT_RUN_ORDER = (
    transaction_validator,
    fraud_detector,
    compliance_checker,
    settlement_processor,
    reporting_agent,
)


@dataclass
class Summary:
    """Outcome of one run_pipeline() call."""

    total: int
    settled: int
    rejected: int
    held_for_review: int
    total_fees: Decimal
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """True iff every input transaction reached a terminal result."""
        return not self.missing


def _clear_dir(path: Path) -> None:
    """Remove a directory tree (if present) and recreate it empty."""
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def reset_shared_tree(base_dir: Path) -> None:
    """Clear the pipeline stage directories, but preserve shared/logs/.

    Makes `python integrator.py` idempotent: re-running never leaves stale
    messages or result files behind, while the audit trail keeps growing.
    """
    shared_dir = base_dir / "shared"
    shared_dir.mkdir(parents=True, exist_ok=True)
    for stage in ("input", "processing", "output", "results"):
        _clear_dir(shared_dir / stage)
    (shared_dir / "logs").mkdir(parents=True, exist_ok=True)  # never cleared


def ingest_transactions(ctx: PipelineContext, records: list[dict]) -> list[str]:
    """Wrap each raw record in a protocol message into shared/input/.

    Returns the list of transaction_ids ingested, in file order.
    """
    txn_ids: list[str] = []
    for record in records:
        txn_id = record.get("transaction_id", "UNKNOWN")
        message = make_message(
            "integrator", "transaction_validator", "raw_transaction", dict(record), now=ctx.now()
        )
        ctx.write_message(ctx.input_dir, message)
        ctx.audit("integrator", txn_id, "ingested")
        txn_ids.append(txn_id)
    return txn_ids


def _find_missing(ctx: PipelineContext, txn_ids: list[str]) -> list[str]:
    """Return the subset of txn_ids that have NO file in shared/results/."""
    present = {
        path.stem for path in ctx.results_dir.glob("*.json") if path.stem != "pipeline-summary"
    }
    return [txn_id for txn_id in txn_ids if txn_id not in present]


def run_pipeline(base_dir: Path, transactions_file: Path) -> Summary:
    """Run the entire pipeline end to end and return a Summary.

    1. Reset the shared/ tree (idempotent, preserves logs).
    2. Load and ingest every record from transactions_file into shared/input/.
    3. Run the five agents in spec order, each draining its own inbox.
    4. Verify every ingested transaction has a terminal result.
    """
    base_dir = Path(base_dir)
    transactions_file = Path(transactions_file)

    reset_shared_tree(base_dir)
    ctx = PipelineContext(base_dir)

    records = json.loads(transactions_file.read_text(encoding="utf-8"))
    txn_ids = ingest_transactions(ctx, records)

    for agent_module in AGENT_RUN_ORDER:
        agent_module.run(ctx)

    missing = _find_missing(ctx, txn_ids)

    summary_path = ctx.results_dir / "pipeline-summary.json"
    summary_data = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}

    return Summary(
        total=summary_data.get("total", len(txn_ids)),
        settled=summary_data.get("settled", 0),
        rejected=summary_data.get("rejected", 0),
        held_for_review=summary_data.get("held_for_review", 0),
        total_fees=Decimal(str(summary_data.get("total_fees", "0.00"))),
        missing=missing,
    )


def main() -> int:
    """CLI entry point: run the pipeline against sample-transactions.json."""
    base_dir = Path(__file__).resolve().parent
    transactions_file = base_dir / "sample-transactions.json"

    summary = run_pipeline(base_dir, transactions_file)

    print("\n=== Pipeline run complete ===")
    print(
        f"total={summary.total}  settled={summary.settled}  "
        f"held_for_review={summary.held_for_review}  rejected={summary.rejected}  "
        f"total_fees={summary.total_fees}"
    )

    if not summary.ok:
        print(f"ERROR: {len(summary.missing)} transaction(s) never reached a terminal result: "
              f"{', '.join(summary.missing)}", file=sys.stderr)
        return 1

    print("OK: every input transaction reached a terminal result in shared/results/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
