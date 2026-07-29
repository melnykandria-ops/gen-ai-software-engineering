# 🔌 Homework 5 — MCP Servers (GitHub · Filesystem · Notion · Custom FastMCP)

> **Student Name**: Andrii Melnyk (@melnykandria-ops)
> **Date**: 2026-07-29
> **AI Tools**: Claude Code + MCP (Model Context Protocol)

---

## 📋 Overview

Three external MCP servers configured (**GitHub**, **Filesystem**, **Notion**) plus one **custom FastMCP server**, all registered in [`.mcp.json`](.mcp.json) and each exercised with a real call. Screenshots of every result are in [`docs/screenshots/`](docs/screenshots/). Setup steps: [HOWTORUN.md](HOWTORUN.md).

| Task | Server | Call demonstrated | Screenshot |
|------|--------|-------------------|------------|
| 1 | **GitHub MCP** (`npx @modelcontextprotocol/server-github`) | `list_pull_requests` → the repo's 4 open PRs | [github-mcp-result.png](docs/screenshots/github-mcp-result.png) |
| 2 | **Filesystem MCP** (`npx @modelcontextprotocol/server-filesystem`) | `list_directory` on `homework-5/` | [filesystem-mcp-result.png](docs/screenshots/filesystem-mcp-result.png) |
| 3 | **Notion MCP** (`https://mcp.notion.com/mcp`) | search *"last 5 bugs on the project"* → 5 page IDs | [jira-or-notion-mcp-result.png](docs/screenshots/jira-or-notion-mcp-result.png) |
| 4 | **Custom FastMCP** (`custom-mcp-server/server.py`) | `read` tool + `lorem://words/{n}` resource | [custom-mcp-read-tool-result.png](docs/screenshots/custom-mcp-read-tool-result.png) |

## 🧠 Resources vs. Tools (Task 4 explanation)

- **Resources** are **URIs Claude can read from** (files, APIs, DB rows). They're passive data sources. This server exposes `lorem://words` (default 30 words) and the template `lorem://words/{word_count}`.
- **Tools** are **actions Claude can call** to perform operations (read a file, run a command, hit an API). This server exposes the `read` tool, which takes an optional `word_count` (default 30) and returns that many words from `lorem-ipsum.md`.

Same underlying data, two access patterns: the **resource** is addressed by URI; the **tool** is invoked like a function with arguments.

## 🛠️ Custom server details

[`custom-mcp-server/server.py`](custom-mcp-server/server.py) — built with **FastMCP 3.x** (`fastmcp` is pinned in [`requirements.txt`](custom-mcp-server/requirements.txt)):

- Resource `lorem://words` → first **30** words of [`lorem-ipsum.md`](custom-mcp-server/lorem-ipsum.md).
- Resource template `lorem://words/{word_count}` → first *N* words.
- Tool `read(word_count=30)` → returns exactly `word_count` words.

Verified: `read()` → 30 words, `read(5)` → 5 words, `lorem://words/8` → 8 words (see the screenshot).

## 📂 Configuration ([`.mcp.json`](.mcp.json))

All four servers registered. The GitHub token is referenced as `${GITHUB_PERSONAL_ACCESS_TOKEN}` — **no secret is committed**; export it from `gh auth token` (see HOWTORUN).

## 🔬 How the calls were verified

Each stdio server (GitHub, Filesystem, custom) was driven through a real MCP client (`fastmcp.Client`) that initializes the connection, lists tools/resources, and calls one tool — the screenshots show the genuine responses. The Notion call was made live through the hosted Notion MCP connector in a Claude Code session; only **masked** page IDs are shown, per the assignment's privacy note (the connected Notion workspace has no dedicated bug tracker, so the semantic search returned the 5 most relevant project pages; real identifiers are intentionally not published).

---

*Completed for the GenAI & Agentic AI for Software Engineering course.*
