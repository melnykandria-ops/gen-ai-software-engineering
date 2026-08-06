# research-notes.md — context7 queries (Agent 2, code generation)

All three queries below were made **live** through the context7 MCP server
(`npx @upstash/context7-mcp@latest`, server v3.2.5) while building the
pipeline. Screenshot: `docs/screenshots/mcp-interaction.png`.

## Query 1: decimal / monetary arithmetic

- **Search:** `resolve-library-id("python decimal")` → then
  `query-docs("decimal Decimal quantize ROUND_HALF_UP monetary rounding two decimal places")`
- **context7 library ID:** `/python/cpython` (36 847 snippets, High reputation)
- **Key result:** the `Doc/library/decimal.md` snippets on
  `Decimal.quantize()` — *"rounds a number to a fixed exponent … commonly used
  for monetary applications"*, with the `TWOPLACES = Decimal(10) ** -2` idiom.
- **Applied:** `agents/settlement_processor.py` computes every fee with
  `amount.quantize(TWOPLACES, rounding=ROUND_HALF_UP)` — money is parsed from
  JSON strings straight into `Decimal` and never passes through `float`.

## Query 2: FastMCP tools & resources

- **Search:** `resolve-library-id("fastmcp")` →
  `query-docs("define tool with decorator and resource uri, run server stdio")`
- **context7 library ID:** `/prefecthq/fastmcp` (4 041 snippets, benchmark 87.5;
  the older `/jlowin/fastmcp` ID now redirects — worth documenting as a gotcha)
- **Key result:** `docs/servers/resources.mdx` — the `@mcp.resource("scheme://uri")`
  decorator registers a **lazily executed** function per URI; tools use
  `@mcp.tool`; `mcp.run()` defaults to stdio transport.
- **Applied:** `mcp/server.py` exposes `pipeline://summary` as an
  `@mcp.resource` and `get_transaction_status` / `list_pipeline_results` as
  `@mcp.tool`, with `mcp.run()` (stdio) at the bottom.

## Query 3: coverage gate threshold

- **Search:** `resolve-library-id("pytest-cov")` →
  `query-docs("cov-fail-under option fail build when coverage below threshold")`
- **context7 library ID:** `/pytest-dev/pytest-cov` (260 snippets, High reputation)
- **Key result:** *"Causes pytest to exit with a non-zero status when total
  coverage falls below a specified minimum"* — `--cov-fail-under=MIN`, also
  readable from `.coveragerc`.
- **Applied:** `hooks/coverage-gate.sh` runs
  `pytest --cov=agents --cov=integrator --cov-fail-under=80`; the non-zero exit
  is what blocks `git push` (exit 2 in Claude Code hook mode).
