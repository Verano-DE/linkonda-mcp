# Linkonda MCP server

[![linkonda-mcp MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/Verano-DE/linkonda-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Verano-DE/linkonda-mcp)

Create and manage [Linkonda](https://linkonda.com) short links from Claude, Claude Code, Cursor, or any other MCP client.

When a short link is followed, Linkonda counts the click (a total per link, and per variant on an A/B split link) and records nothing about the visitor: no IP address, location, device data or referrer. That matters more than usual for an agent, which can generate links in bulk without building a visitor dataset you then have to secure, retain, and answer requests about.

## Works without an API key

Most shortener MCP servers refuse to start without credentials. This one shortens URLs immediately on install: anonymous links are capped per network and expire after 30 days. Add a key when you want links that persist and can be managed.

| | No key | With `LINKONDA_API_KEY` |
| --- | --- | --- |
| `shorten_link` | ✅ 10 links, expire after 30 days | ✅ permanent, saved to your account |
| `get_link_stats` | ✅ | ✅ |
| `check_quota` | ✅ anonymous allowance | ✅ your plan |
| `list_links`, `update_link`, `delete_link` | ✗ | ✅ |
| `shorten_links_bulk` | ✗ | ✅ Pro and Business |

API keys come with the Starter, Pro and Business plans; see [pricing](https://linkonda.com/pricing). Create a key in the dashboard under **API keys**; it is shown once.

## Install

Add to your MCP client config (Claude Desktop: `claude_desktop_config.json`; Claude Code: `.mcp.json`):

```json
{
  "mcpServers": {
    "linkonda": {
      "command": "npx",
      "args": ["-y", "@veranoapp/linkonda-mcp"]
    }
  }
}
```

To use an API key, add it to the same entry:

```json
{
  "mcpServers": {
    "linkonda": {
      "command": "npx",
      "args": ["-y", "@veranoapp/linkonda-mcp"],
      "env": { "LINKONDA_API_KEY": "lk_your_key_here" }
    }
  }
}
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKONDA_API_KEY` | *(unset)* | Bearer key. Omit to run anonymously. |
| `LINKONDA_API_BASE_URL` | `https://api.linkonda.com` | Point at another instance. |

## Tools

| Tool | What it does | Key required |
| --- | --- | --- |
| `shorten_link` | Shorten one URL | No |
| `shorten_links_bulk` | Shorten up to 100 URLs in one request | Yes, from a Pro or Business account |
| `list_links` | List your 100 most recent links with destinations and click counts | Yes |
| `update_link` | Change a destination, or pause/resume a link | Yes |
| `delete_link` | Delete a link (can't be undone; its short URL is never reused) | Yes |
| `get_link_stats` | Total redirect count for a link | No |
| `check_quota` | Links live vs. plan allowance | No |

`shorten_links_bulk` is partial-success: some entries can fail (quota, invalid URL) while others are created, and the tool reports both lists rather than only the successes.

## What you cannot get

There is no per-visitor data to return, so there are no tools for geographic, device, or referrer breakdowns — that data is never collected. If your workflow needs click attribution, a tracking shortener is the right tool; see the [comparisons](https://linkonda.com/alternatives/bitly).

## Development

```bash
npm install
npm run build
LINKONDA_API_KEY=lk_... npm start   # speaks MCP over stdio
```

`npm run typecheck` runs the compiler without emitting.
