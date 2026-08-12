"""agents/base.py — shared plumbing for the transaction-processing pipeline.

Everything the five runtime agents (transaction_validator, fraud_detector,
compliance_checker, settlement_processor, reporting_agent) have in common
lives here:

  * ``PipelineContext``    — base directory, injectable ``now``, audit log,
                              and the shared/ directory helpers (read/write/move).
  * ``make_message``       — builds a protocol message
                              (message_id, timestamp, source_agent,
                              target_agent, message_type, data).
  * ``route_message``      — writes a message to shared/results/ (terminal)
                              or shared/output/<target_agent>/ (forwarded).
  * Decimal helpers        — ``parse_amount`` and ``quantize_money`` so that
                              money NEVER touches ``float``.
  * ``ISO_4217``           — the currency whitelist.
  * ``mask_account`` / ``mask_text`` — PII masking for logs and reports.

See specification.md §3 for the message protocol and directory layout, and
agents.md for the shared rules (Decimal-only money, PII masking, field names).
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Callable, Iterable

# --------------------------------------------------------------------------- #
# Currency whitelist (specification.md §3)
# --------------------------------------------------------------------------- #
ISO_4217 = frozenset(
    {"USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "UAH", "PLN", "SEK", "NOK", "DKK"}
)

# --------------------------------------------------------------------------- #
# Decimal helpers — money is ALWAYS decimal.Decimal, never float.
# --------------------------------------------------------------------------- #
TWOPLACES = Decimal(10) ** -2  # Decimal("0.01") — the quantize target for money


def parse_amount(raw: object) -> Decimal | None:
    """Parse a raw JSON value (normally a string) into a Decimal.

    Returns None if the value cannot be parsed into a finite Decimal (missing,
    malformed, NaN, or +/-Infinity) — callers treat None as "invalid amount".
    Never routes the value through float.
    """
    if raw is None:
        return None
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite():
        return None
    return value


def quantize_money(value: Decimal) -> Decimal:
    """Round a Decimal to 2 places using ROUND_HALF_UP (research-notes.md §1)."""
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- #
# PII masking — account numbers are masked to their last 2 characters.
# ACC-1001 -> ACC-***01. Applied to every audit-log line and printed report.
# --------------------------------------------------------------------------- #
_ACCOUNT_PATTERN = re.compile(r"\b([A-Za-z]+-)(\w+)\b")


def mask_account(account: str) -> str:
    """Mask a single account identifier, keeping only its last 2 characters.

    'ACC-1001' -> 'ACC-***01'. Falls back to returning the input unchanged if
    it does not match the '<PREFIX>-<CODE>' shape.
    """
    if not isinstance(account, str):
        return account
    match = _ACCOUNT_PATTERN.fullmatch(account)
    if not match:
        return account
    prefix, code = match.groups()
    tail = code[-2:] if len(code) >= 2 else code
    return f"{prefix}***{tail}"


def mask_text(text: str) -> str:
    """Mask every account-like token ('<PREFIX>-<CODE>') found inside free text.

    Used before writing anything to shared/logs/audit.log or stdout so that no
    unmasked account number ever leaves the message payloads on disk.
    """
    if not text:
        return text
    return _ACCOUNT_PATTERN.sub(lambda m: mask_account(m.group(0)), text)


# --------------------------------------------------------------------------- #
# ISO-8601 timestamp helper
# --------------------------------------------------------------------------- #
def iso_ts(dt: datetime) -> str:
    """Render a datetime as ISO-8601 UTC with a trailing 'Z' (no +00:00)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# Message protocol
# --------------------------------------------------------------------------- #
def make_message(
    source_agent: str,
    target_agent: str,
    message_type: str,
    data: dict,
    *,
    now: datetime | None = None,
) -> dict:
    """Build a protocol message: message_id, timestamp, source_agent,
    target_agent, message_type, data. ``data`` must carry ``transaction_id``.

    ``now`` is injectable for deterministic tests; defaults to real UTC time.
    """
    ts = now if now is not None else datetime.now(timezone.utc)
    return {
        "message_id": str(uuid.uuid4()),
        "timestamp": iso_ts(ts),
        "source_agent": source_agent,
        "target_agent": target_agent,
        "message_type": message_type,
        "data": data,
    }


# --------------------------------------------------------------------------- #
# PipelineContext — base_dir, injectable now(), audit log, shared/ I/O helpers
# --------------------------------------------------------------------------- #
class PipelineContext:
    """Shared runtime context passed into every agent's process_message/run.

    Holds the pipeline's base directory and an injectable "now" provider so
    tests can run deterministically against tmp_path instead of the real
    shared/ tree (agents.md: "Tests: isolate ... via tmp_path").
    """

    def __init__(self, base_dir: Path | str, now: Callable[[], datetime] | None = None):
        self.base_dir = Path(base_dir)
        self._now = now or (lambda: datetime.now(timezone.utc))

    def now(self) -> datetime:
        return self._now()

    # ---- directory layout (specification.md §3) --------------------------
    @property
    def shared_dir(self) -> Path:
        return self.base_dir / "shared"

    @property
    def input_dir(self) -> Path:
        return self._ensure(self.shared_dir / "input")

    @property
    def processing_dir(self) -> Path:
        return self._ensure(self.shared_dir / "processing")

    def output_dir(self, agent: str) -> Path:
        return self._ensure(self.shared_dir / "output" / agent)

    @property
    def results_dir(self) -> Path:
        return self._ensure(self.shared_dir / "results")

    @property
    def logs_dir(self) -> Path:
        return self._ensure(self.shared_dir / "logs")

    @staticmethod
    def _ensure(path: Path) -> Path:
        path.mkdir(parents=True, exist_ok=True)
        return path

    # ---- message I/O -------------------------------------------------------
    def read_dir_messages(self, dir_path: Path) -> list[tuple[Path, dict]]:
        """Read every *.json message in dir_path, sorted by filename.

        Malformed JSON files are skipped rather than crashing the run.
        """
        messages: list[tuple[Path, dict]] = []
        for file_path in sorted(dir_path.glob("*.json")):
            try:
                messages.append((file_path, json.loads(file_path.read_text(encoding="utf-8"))))
            except json.JSONDecodeError:
                continue
        return messages

    def move_to_processing(self, path: Path) -> Path:
        """Move a message file into shared/processing/ while an agent works on it."""
        dest = self.processing_dir / path.name
        shutil.move(str(path), str(dest))
        return dest

    def write_message(self, dir_path: Path, message: dict) -> Path:
        """Write a protocol message to dir_path/<transaction_id>.json."""
        txn_id = message["data"]["transaction_id"]
        dest = dir_path / f"{txn_id}.json"
        dest.write_text(json.dumps(message, indent=2), encoding="utf-8")
        return dest

    def forward(self, message: dict) -> Path:
        """Write a message into shared/output/<target_agent>/ for the next hop."""
        return self.write_message(self.output_dir(message["target_agent"]), message)

    def write_result(self, message: dict) -> Path:
        """Write a terminal outcome to shared/results/<transaction_id>.json.

        Only message['data'] is persisted (the envelope has done its job).
        """
        txn_id = message["data"]["transaction_id"]
        dest = self.results_dir / f"{txn_id}.json"
        dest.write_text(json.dumps(message["data"], indent=2), encoding="utf-8")
        return dest

    # ---- audit trail --------------------------------------------------------
    def audit(self, agent: str, txn_id: str, outcome: str) -> None:
        """Append '<ISO ts> | <agent> | <txn id> | <outcome>' to audit.log.

        The outcome text is PII-masked before it ever touches disk.
        """
        line = f"{iso_ts(self.now())} | {agent} | {txn_id} | {mask_text(outcome)}\n"
        log_path = self.logs_dir / "audit.log"
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(line)


def route_message(ctx: PipelineContext, message: dict) -> Path:
    """Route a processed message to its next home.

    target_agent == 'results' -> terminal outcome (shared/results/<TXN>.json).
    Anything else             -> forwarded to shared/output/<target_agent>/.
    """
    if message["target_agent"] == "results":
        return ctx.write_result(message)
    return ctx.forward(message)


@dataclass
class AgentRunResult:
    """Small summary of one agent's run() pass, used by integrator/tests."""

    agent: str
    processed: int
    inputs: list[str]


def run_agent(
    ctx: PipelineContext,
    agent_name: str,
    inbox_dir: Path,
    process_fn: Callable[[dict, "PipelineContext"], dict],
) -> AgentRunResult:
    """Generic run() loop shared by every agent module.

    Drains inbox_dir: for each message, move it to shared/processing/, run
    process_fn(message, ctx) to get the next message, then route it either to
    shared/results/ (terminal) or the next agent's shared/output/ inbox.
    """
    processed_ids: list[str] = []
    for path, message in ctx.read_dir_messages(inbox_dir):
        ctx.move_to_processing(path)
        result_message = process_fn(message, ctx)
        route_message(ctx, result_message)
        processed_ids.append(result_message["data"].get("transaction_id", "?"))
    return AgentRunResult(agent=agent_name, processed=len(processed_ids), inputs=processed_ids)


def required_fields_missing(data: dict, required: Iterable[str]) -> list[str]:
    """Return the subset of `required` keys that are missing or blank in data."""
    missing = []
    for field in required:
        if field not in data or data[field] in (None, ""):
            missing.append(field)
    return missing
