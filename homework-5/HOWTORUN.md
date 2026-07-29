# ▶️ How to Run — MCP Servers

## Prerequisites
- **Node.js ≥ 18** (`npx`) — for the GitHub & Filesystem MCP servers.
- **Python ≥ 3.10** — for the custom FastMCP server.
- **`gh` CLI** authenticated — a convenient source of a GitHub token.
- A client that reads `.mcp.json` (Claude Code, Cursor, …).

The four servers are registered in [`.mcp.json`](.mcp.json). Claude Code auto-loads a project `.mcp.json` from the working directory.

---

## Task 1 — GitHub MCP
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=$(gh auth token)   # never commit the token
# claude picks it up from .mcp.json → ${GITHUB_PERSONAL_ACCESS_TOKEN}
claude mcp add --transport stdio github -- npx -y @modelcontextprotocol/server-github
```
Then prompt, e.g.: *"List the open pull requests on melnykandria-ops/gen-ai-software-engineering."*
→ see [`docs/screenshots/github-mcp-result.png`](docs/screenshots/github-mcp-result.png).

## Task 2 — Filesystem MCP
```bash
claude mcp add --transport stdio filesystem -- \
  npx -y @modelcontextprotocol/server-filesystem "$(pwd)"
```
Then prompt: *"List the files in this directory."*
→ see [`docs/screenshots/filesystem-mcp-result.png`](docs/screenshots/filesystem-mcp-result.png).

## Task 3 — Notion MCP
Remote (hosted) server — connect with OAuth:
```bash
claude mcp add --transport http notion https://mcp.notion.com/mcp
# complete the OAuth flow in the browser when prompted
```
Then prompt: *"Give me the pages of the last 5 bugs on a project."*
→ see [`docs/screenshots/jira-or-notion-mcp-result.png`](docs/screenshots/jira-or-notion-mcp-result.png) (page IDs only, per the privacy note).

## Task 4 — Custom FastMCP server
```bash
cd custom-mcp-server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # installs fastmcp
python server.py                        # starts the server on stdio
```
Register it (from the homework-5 dir, where `.mcp.json` lives):
```bash
claude mcp add --transport stdio lorem -- python3 custom-mcp-server/server.py
```

**Test the `read` tool** without a full client — with the FastMCP client:
```bash
python - <<'PY'
import asyncio
from fastmcp import Client
async def main():
    async with Client("custom-mcp-server/server.py") as c:
        print(await c.list_tools())
        print((await c.call_tool("read", {})).data)                 # 30 words (default)
        print((await c.call_tool("read", {"word_count": 5})).data)  # 5 words
        print((await c.read_resource("lorem://words/8"))[0].text)   # 8 words
asyncio.run(main())
PY
```
→ see [`docs/screenshots/custom-mcp-read-tool-result.png`](docs/screenshots/custom-mcp-read-tool-result.png).

---

## Verify everything is registered
```bash
claude mcp list        # github, filesystem, notion, lorem
```
