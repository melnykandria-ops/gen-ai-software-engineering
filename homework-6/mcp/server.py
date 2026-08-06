"""mcp/server.py — FastMCP server exposing pipeline results.

Per specification.md §4 ending state / §5 "MCP server" task:

  * tool get_transaction_status(transaction_id) -> status/reason, read only
    from shared/results/ (never the in-flight stage directories).
  * tool list_pipeline_results() -> a per-transaction summary list.
  * resource pipeline://summary -> pipeline-summary.json rendered as text.

Uses the FastMCP decorator API confirmed in research-notes.md §2:
@mcp.tool / @mcp.resource("scheme://uri"), mcp.run() at the bottom (stdio).
"""
from __future__ import annotations

import json
from pathlib import Path

from fastmcp import FastMCP

# shared/results/ lives one directory up from mcp/server.py, at <repo>/shared/results
BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "shared" / "results"
SUMMARY_FILENAME = "pipeline-summary.json"
SUMMARY_PATH = RESULTS_DIR / SUMMARY_FILENAME

mcp = FastMCP("pipeline-status")


def _load_result(transaction_id: str) -> dict | None:
    """Read shared/results/<transaction_id>.json, or None if absent/invalid."""
    path = RESULTS_DIR / f"{transaction_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


@mcp.tool
def get_transaction_status(transaction_id: str) -> dict:
    """Look up one transaction's terminal status from shared/results/.

    Returns {"transaction_id", "status", "reason"?}. Unknown IDs (or the
    reserved 'pipeline-summary' name) get a friendly error dict instead of
    raising. Reads ONLY shared/results/ — never input/processing/output.
    """
    if transaction_id == "pipeline-summary":
        return {"error": f"'{transaction_id}' is not a transaction id"}

    data = _load_result(transaction_id)
    if data is None:
        return {"error": f"no result found for transaction_id '{transaction_id}'"}

    response = {
        "transaction_id": data.get("transaction_id", transaction_id),
        "status": data.get("status", "unknown"),
    }
    if "reason" in data:
        response["reason"] = data["reason"]
    return response


@mcp.tool
def list_pipeline_results() -> list[dict]:
    """List every terminal result in shared/results/ as {transaction_id, status, fee?}."""
    results: list[dict] = []
    if not RESULTS_DIR.exists():
        return results

    for path in sorted(RESULTS_DIR.glob("*.json")):
        if path.name == SUMMARY_FILENAME:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        entry = {
            "transaction_id": data.get("transaction_id", path.stem),
            "status": data.get("status", "unknown"),
        }
        settlement = data.get("settlement")
        if settlement and "fee" in settlement:
            entry["fee"] = settlement["fee"]
        results.append(entry)

    return results


@mcp.resource("pipeline://summary")
def pipeline_summary() -> str:
    """Render shared/results/pipeline-summary.json as text.

    Lazily executed on each read (per research-notes.md §2), so it always
    reflects the most recent `python integrator.py` run.
    """
    if not SUMMARY_PATH.exists():
        return "pipeline-summary.json not found — run `python integrator.py` first."
    data = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    return json.dumps(data, indent=2)


if __name__ == "__main__":
    mcp.run()
