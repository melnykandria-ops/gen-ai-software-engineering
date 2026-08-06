"""tests/test_mcp_server.py — mcp/server.py (FastMCP tools/resource).

Loaded via importlib.util with an explicit spec, under a module name that
never collides with the real `mcp` PyPI package already installed in the
venv (a plain `import mcp.server` would be ambiguous: there is no
mcp/__init__.py in this project, but `mcp` IS a top-level installed package).

Each test monkeypatches the module's RESULTS_DIR / SUMMARY_PATH constants to
point at a tmp_path results directory — never the real project's
shared/results/.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


def _load_server_module():
    """Load mcp/server.py under a private module name (avoids colliding with
    the installed `mcp` SDK package)."""
    project_root = Path(__file__).resolve().parent.parent
    server_path = project_root / "mcp" / "server.py"
    spec = importlib.util.spec_from_file_location("pipeline_mcp_server_under_test", server_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def mcp_server(tmp_path, monkeypatch):
    """The mcp/server.py module, pointed at an isolated tmp results dir."""
    module = _load_server_module()
    results_dir = tmp_path / "shared" / "results"
    results_dir.mkdir(parents=True)
    monkeypatch.setattr(module, "RESULTS_DIR", results_dir)
    monkeypatch.setattr(module, "SUMMARY_PATH", results_dir / module.SUMMARY_FILENAME)
    return module


def _write_result(mcp_server, txn_id: str, payload: dict) -> None:
    (mcp_server.RESULTS_DIR / f"{txn_id}.json").write_text(json.dumps(payload))


# --------------------------------------------------------------------------- #
# sanity — @mcp.tool / @mcp.resource expose plain callables (no MCP runtime
# context required to invoke them directly, per research-notes.md §2).
# --------------------------------------------------------------------------- #
def test_tool_and_resource_functions_are_directly_callable(mcp_server):
    assert callable(mcp_server.get_transaction_status)
    assert callable(mcp_server.list_pipeline_results)
    assert callable(mcp_server.pipeline_summary)


# --------------------------------------------------------------------------- #
# get_transaction_status
# --------------------------------------------------------------------------- #
def test_get_transaction_status_known_id_settled(mcp_server):
    _write_result(mcp_server, "TXN001", {
        "transaction_id": "TXN001", "status": "settled", "settlement": {"fee": "7.50"},
    })

    result = mcp_server.get_transaction_status("TXN001")

    assert result == {"transaction_id": "TXN001", "status": "settled"}


def test_get_transaction_status_known_rejected_id_includes_reason(mcp_server):
    _write_result(mcp_server, "TXN003", {
        "transaction_id": "TXN003", "status": "rejected", "reason": "watchlist_hit",
    })

    result = mcp_server.get_transaction_status("TXN003")

    assert result == {"transaction_id": "TXN003", "status": "rejected", "reason": "watchlist_hit"}


def test_get_transaction_status_unknown_id_returns_friendly_error(mcp_server):
    result = mcp_server.get_transaction_status("TXN_NOPE")
    assert result == {"error": "no result found for transaction_id 'TXN_NOPE'"}


def test_get_transaction_status_rejects_the_reserved_summary_name(mcp_server):
    result = mcp_server.get_transaction_status("pipeline-summary")
    assert result == {"error": "'pipeline-summary' is not a transaction id"}


def test_get_transaction_status_malformed_result_file_treated_as_unknown(mcp_server):
    (mcp_server.RESULTS_DIR / "TXN666.json").write_text("{not valid json")
    result = mcp_server.get_transaction_status("TXN666")
    assert result == {"error": "no result found for transaction_id 'TXN666'"}


# --------------------------------------------------------------------------- #
# list_pipeline_results
# --------------------------------------------------------------------------- #
def test_list_pipeline_results_returns_all_transactions_with_fee_when_present(mcp_server):
    _write_result(mcp_server, "TXN001", {
        "transaction_id": "TXN001", "status": "settled", "settlement": {"fee": "7.50"},
    })
    _write_result(mcp_server, "TXN002", {"transaction_id": "TXN002", "status": "held_for_review"})

    results = mcp_server.list_pipeline_results()

    assert {"transaction_id": "TXN001", "status": "settled", "fee": "7.50"} in results
    assert {"transaction_id": "TXN002", "status": "held_for_review"} in results
    assert len(results) == 2


def test_list_pipeline_results_skips_the_summary_file(mcp_server):
    _write_result(mcp_server, "TXN001", {"transaction_id": "TXN001", "status": "settled"})
    mcp_server.SUMMARY_PATH.write_text(json.dumps({"total": 1}))

    results = mcp_server.list_pipeline_results()
    assert len(results) == 1


def test_list_pipeline_results_skips_malformed_files(mcp_server):
    (mcp_server.RESULTS_DIR / "BROKEN.json").write_text("{not valid json")
    _write_result(mcp_server, "TXN001", {"transaction_id": "TXN001", "status": "settled"})

    results = mcp_server.list_pipeline_results()
    assert len(results) == 1


def test_list_pipeline_results_empty_when_results_dir_missing(mcp_server):
    import shutil
    shutil.rmtree(mcp_server.RESULTS_DIR)
    assert mcp_server.list_pipeline_results() == []


# --------------------------------------------------------------------------- #
# pipeline://summary resource
# --------------------------------------------------------------------------- #
def test_pipeline_summary_resource_renders_json_text(mcp_server):
    summary = {"total": 8, "settled": 3, "rejected": 3, "held_for_review": 2, "total_fees": "26.00"}
    mcp_server.SUMMARY_PATH.write_text(json.dumps(summary))

    rendered = mcp_server.pipeline_summary()

    assert json.loads(rendered) == summary


def test_pipeline_summary_resource_missing_file_returns_friendly_message(mcp_server):
    rendered = mcp_server.pipeline_summary()
    assert "not found" in rendered
    assert "python integrator.py" in rendered
