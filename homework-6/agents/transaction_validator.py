"""agents/transaction_validator.py — first hop of the pipeline.

Reads raw-transaction messages from shared/input/, moves each to
shared/processing/ while working, and checks:
  * all required fields are present,
  * amount parses as a positive Decimal,
  * currency is in the ISO-4217 whitelist.

Valid transactions are forwarded to shared/output/fraud_detector/ with
status 'validated'. Invalid transactions become terminal reject messages in
shared/results/ with a machine-readable 'reason' (specification.md §5).

Supports `--dry-run`, which validates sample-transactions.json and prints a
table WITHOUT touching shared/ at all.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python agents/transaction_validator.py` (direct script execution) as
# well as `import agents.transaction_validator` — direct execution puts only
# agents/ itself on sys.path, so the package root needs adding explicitly.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from agents.base import (
    ISO_4217,
    PipelineContext,
    make_message,
    parse_amount,
    required_fields_missing,
    run_agent,
)

AGENT_NAME = "transaction_validator"
NEXT_AGENT = "fraud_detector"

REQUIRED_FIELDS = (
    "transaction_id",
    "amount",
    "currency",
    "source_account",
    "destination_account",
    "transaction_type",
    "timestamp",
)


def validate_record(data: dict) -> tuple[bool, str | None]:
    """Pure validation logic: no I/O, no ctx — usable by both the pipeline
    and --dry-run.

    Returns (True, None) if valid, otherwise (False, reason).
    """
    missing = required_fields_missing(data, REQUIRED_FIELDS)
    if missing:
        return False, f"missing_fields:{','.join(missing)}"

    amount = parse_amount(data["amount"])
    if amount is None:
        return False, "unparseable_amount"
    if amount <= 0:
        return False, "non_positive_amount"

    if data["currency"] not in ISO_4217:
        return False, "invalid_currency"

    return True, None


def process_message(message: dict, ctx: PipelineContext) -> dict:
    """Validate one protocol message and return the next message to route.

    Valid -> forwarded message (target_agent=fraud_detector, status=validated).
    Invalid -> terminal message (target_agent=results, status=rejected, reason=...).
    """
    data = dict(message["data"])  # shallow copy — don't mutate the input message
    txn_id = data.get("transaction_id", "UNKNOWN")

    is_valid, reason = validate_record(data)

    if is_valid:
        data["status"] = "validated"
        ctx.audit(AGENT_NAME, txn_id, "validated")
        return make_message(AGENT_NAME, NEXT_AGENT, "validated", data, now=ctx.now())

    data["status"] = "rejected"
    data["reason"] = reason
    ctx.audit(AGENT_NAME, txn_id, f"rejected:{reason}")
    return make_message(AGENT_NAME, "results", "rejected", data, now=ctx.now())


def run(ctx: PipelineContext) -> int:
    """Drain shared/input/, validating everything found there."""
    result = run_agent(ctx, AGENT_NAME, ctx.input_dir, process_message)
    return result.processed


# --------------------------------------------------------------------------- #
# --dry-run mode: validate a transactions file and print a table, no writes.
# --------------------------------------------------------------------------- #
def dry_run(transactions_file: Path) -> None:
    """Validate every record in `transactions_file` and print a table.

    Never touches shared/ — purely diagnostic.
    """
    records = json.loads(transactions_file.read_text(encoding="utf-8"))

    rows = []
    valid_count = 0
    for record in records:
        is_valid, reason = validate_record(record)
        verdict = "VALID" if is_valid else "INVALID"
        if is_valid:
            valid_count += 1
        rows.append(
            (
                str(record.get("transaction_id", "?")),
                str(record.get("amount", "?")),
                str(record.get("currency", "?")),
                verdict,
                reason or "-",
            )
        )

    headers = ("txn", "amount", "currency", "verdict", "reason")
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
    print(f"\n{valid_count}/{len(rows)} valid, {len(rows) - valid_count}/{len(rows)} invalid")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transaction Validator agent")
    parser.add_argument("--dry-run", action="store_true", help="validate only, no writes to shared/")
    parser.add_argument("--base-dir", default=".", help="pipeline base directory (contains shared/)")
    parser.add_argument(
        "--transactions-file",
        default="sample-transactions.json",
        help="input file for --dry-run",
    )
    args = parser.parse_args()

    if args.dry_run:
        dry_run(Path(args.transactions_file))
        sys.exit(0)

    context = PipelineContext(Path(args.base_dir))
    processed_count = run(context)
    print(f"{AGENT_NAME}: processed {processed_count} message(s)")
