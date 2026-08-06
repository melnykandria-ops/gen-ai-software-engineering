"""agents/reporting_agent.py — fifth and final hop of the pipeline.

Consumes messages from shared/output/reporting_agent/ (settled or
held_for_review) and writes one terminal result JSON per transaction to
shared/results/<TXN>.json.

After draining its inbox, it aggregates EVERY file already sitting in
shared/results/ (settled, held_for_review, and the rejections written
directly there by earlier agents) into shared/results/pipeline-summary.json:
{run_at, total, settled, rejected, held_for_review, total_fees, by_status{}}
and prints a masked summary table to stdout.
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

# Allow direct script execution (`python agents/reporting_agent.py`) as well as
# `import agents.reporting_agent` — see transaction_validator.py for rationale.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from agents.base import PipelineContext, iso_ts, make_message, mask_text, quantize_money, run_agent

AGENT_NAME = "reporting_agent"

SUMMARY_FILENAME = "pipeline-summary.json"
TERMINAL_STATUSES = ("settled", "held_for_review", "rejected")


def process_message(message: dict, ctx: PipelineContext) -> dict:
    """Turn a settled/held_for_review message into a terminal result write.

    Reporting is the last hop, so the returned message simply targets
    'results' — route_message() (via run_agent) will write message['data']
    to shared/results/<TXN>.json.
    """
    data = dict(message["data"])
    txn_id = data.get("transaction_id", "UNKNOWN")
    status = data.get("status", "unknown")

    ctx.audit(AGENT_NAME, txn_id, f"result_written:{status}")
    return make_message(AGENT_NAME, "results", status, data, now=ctx.now())


def _load_results(ctx: PipelineContext) -> list[dict]:
    """Read every result JSON in shared/results/, skipping the summary file
    itself (so re-running summary generation never double-counts)."""
    records = []
    for path in sorted(ctx.results_dir.glob("*.json")):
        if path.name == SUMMARY_FILENAME:
            continue
        try:
            records.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return records


def build_summary(ctx: PipelineContext) -> dict:
    """Aggregate shared/results/ into the pipeline-summary shape."""
    records = _load_results(ctx)

    by_status: dict[str, int] = {status: 0 for status in TERMINAL_STATUSES}
    total_fees = Decimal("0.00")

    for record in records:
        status = record.get("status", "unknown")
        by_status[status] = by_status.get(status, 0) + 1
        settlement = record.get("settlement")
        if settlement and "fee" in settlement:
            total_fees += Decimal(str(settlement["fee"]))

    summary = {
        "run_at": iso_ts(ctx.now()),
        "total": len(records),
        "settled": by_status.get("settled", 0),
        "rejected": by_status.get("rejected", 0),
        "held_for_review": by_status.get("held_for_review", 0),
        "total_fees": str(quantize_money(total_fees)),
        "by_status": by_status,
    }
    return summary


def write_summary(ctx: PipelineContext) -> dict:
    """Compute the summary, write it to shared/results/pipeline-summary.json,
    print a masked table to stdout, and audit-log the aggregate."""
    summary = build_summary(ctx)
    dest = ctx.results_dir / SUMMARY_FILENAME
    dest.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    _print_summary_table(ctx, summary)

    ctx.audit(
        AGENT_NAME,
        "SUMMARY",
        f"pipeline_summary:total={summary['total']}:settled={summary['settled']}:"
        f"rejected={summary['rejected']}:held_for_review={summary['held_for_review']}:"
        f"total_fees={summary['total_fees']}",
    )
    return summary


def _print_summary_table(ctx: PipelineContext, summary: dict) -> None:
    """Print a masked per-transaction table followed by the aggregate counts.

    No account numbers are ever included, but reasons/outcomes are still run
    through mask_text defensively in case free text ever carries one.
    """
    records = _load_results(ctx)
    headers = ("txn", "status", "fee", "reason")
    rows = []
    for record in records:
        settlement = record.get("settlement") or {}
        rows.append(
            (
                str(record.get("transaction_id", "?")),
                str(record.get("status", "?")),
                str(settlement.get("fee", "-")),
                mask_text(str(record.get("reason", "-"))),
            )
        )

    widths = [
        max(len(headers[i]), *(len(row[i]) for row in rows)) if rows else len(headers[i])
        for i in range(len(headers))
    ]

    def fmt_row(row: tuple[str, ...]) -> str:
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(row))

    print(fmt_row(headers))
    print("-+-".join("-" * w for w in widths))
    for row in rows:
        print(fmt_row(row))
    print(
        f"\nTOTAL={summary['total']}  settled={summary['settled']}  "
        f"held_for_review={summary['held_for_review']}  rejected={summary['rejected']}  "
        f"total_fees={summary['total_fees']}"
    )


def run(ctx: PipelineContext) -> int:
    """Drain shared/output/reporting_agent/, write results, then summarize."""
    result = run_agent(ctx, AGENT_NAME, ctx.output_dir(AGENT_NAME), process_message)
    write_summary(ctx)
    return result.processed


if __name__ == "__main__":
    context = PipelineContext(Path("."))
    processed_count = run(context)
    print(f"{AGENT_NAME}: processed {processed_count} message(s)")
