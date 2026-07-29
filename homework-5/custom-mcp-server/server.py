"""Custom MCP server (Homework 5, Task 4) built with FastMCP.

Exposes the first N words of `lorem-ipsum.md` both as a **Resource** (a URI
Claude can read from) and as a **Tool** named `read` (an action Claude can
call). Both default to 30 words.
"""
from pathlib import Path
from fastmcp import FastMCP

mcp = FastMCP("lorem-server")

LOREM_FILE = Path(__file__).parent / "lorem-ipsum.md"
DEFAULT_WORDS = 30


def _first_words(word_count: int) -> str:
    """Return exactly `word_count` whitespace-delimited words from the file."""
    n = max(0, int(word_count))
    words = LOREM_FILE.read_text(encoding="utf-8").split()
    return " ".join(words[:n])


# --- Resource: a URI Claude can read from -----------------------------------
# Fixed URI → default 30 words.
@mcp.resource("lorem://words")
def lorem_default() -> str:
    """First 30 words of lorem-ipsum.md (the default resource)."""
    return _first_words(DEFAULT_WORDS)


# Parameterised URI template → caller chooses how many words.
@mcp.resource("lorem://words/{word_count}")
def lorem_words(word_count: int = DEFAULT_WORDS) -> str:
    """First `word_count` words of lorem-ipsum.md (default 30)."""
    return _first_words(word_count)


# --- Tool: an action Claude can call ----------------------------------------
@mcp.tool
def read(word_count: int = DEFAULT_WORDS) -> str:
    """Read `word_count` words (default 30) from the lorem-ipsum resource."""
    return _first_words(word_count)


if __name__ == "__main__":
    # Default transport is stdio — the transport MCP clients (Claude Code) use.
    mcp.run()
