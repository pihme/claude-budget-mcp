# claude-budget-mcp

[![CI](https://github.com/pihme/claude-budget-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/pihme/claude-budget-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Release](https://img.shields.io/github/v/release/pihme/claude-budget-mcp?filter=claude-budget-mcp%2F*&label=release)](https://github.com/pihme/claude-budget-mcp/releases)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

A small, local **MCP server** (stdio) that lets a [Claude Code](https://code.claude.com/docs) agent ask
*"how much of my 5-hour and weekly usage limits is left, and when do they reset?"* —
the same figures the interactive `/usage` command shows for a Claude subscription (Pro, Max, Team, Enterprise).

Today an agent has no first-class way to get these numbers: `/usage` is interactive, and the status line's
`rate_limits` only reach the status line script. This server reads your existing Claude Code login and returns
the figures as JSON. It is the sister project of [grok-budget-mcp](https://github.com/pihme/grok-budget-mcp).

> [!WARNING]
> **Unofficial, undocumented endpoint.** This server calls `https://api.anthropic.com/api/oauth/usage`, the
> private route Claude Code itself uses for `/usage`. It is **not** a public Anthropic API, has no stability
> guarantee, and Anthropic can change or remove it at any time. When the shape changes, this server fails loudly
> (error or `warning` + `null` fields) instead of guessing numbers.
>
> **Terms of service / risk.** Calling private product endpoints may conflict with Anthropic's terms. Use it only
> as a **personal, local helper** with your own account — not as a hosted or shared service. You are responsible
> for how you use it. This project is not affiliated with or endorsed by Anthropic.

> [!NOTE]
> **Linux first.** The server reads the login from `~/.claude/.credentials.json`, where Claude Code keeps it on
> Linux (and Windows). On macOS Claude Code stores it in the Keychain instead, which this version does not read.

## What it does

One tool, `get_budget`, with no input. Each call re-reads the credentials file and makes **exactly one** HTTPS
request (15 s timeout, no retries, no caching).

### `get_budget` output

All fields are always present; anything the endpoint did not return is `null` and explained in `warning`.

| Field | Meaning |
| --- | --- |
| `session_used_percent` / `session_remaining_percent` | The 5-hour session window (`five_hour.utilization`), remaining clamped to `[0, 100]` |
| `session_resets_at` | When the 5-hour window resets |
| `weekly_used_percent` / `weekly_remaining_percent` | The weekly window across all models (`seven_day.utilization`) |
| `weekly_resets_at` | When the weekly window resets |
| `windows` | **Every** window found as `{ window, used_percent, remaining_percent, resets_at }`: `five_hour`, `seven_day`, per-model buckets like `seven_day_opus`, and `weekly_scoped:<model>` rows from `limits[]`. Buckets that are `null` upstream are left out. |
| `subscription_type` | Your plan as stored by Claude Code (e.g. `max`), or `null` |
| `source` | always `"api.anthropic.com:/api/oauth/usage"` |
| `fetched_at` | ISO 8601 time of the fetch |
| `warning` | Human note when data is partial or the shape looks different; `null` when everything was present |

Example (illustrative values):

```json
{
  "session_used_percent": 24,
  "session_remaining_percent": 76,
  "session_resets_at": "2026-10-02T22:00:00.000000+00:00",
  "weekly_used_percent": 61.5,
  "weekly_remaining_percent": 38.5,
  "weekly_resets_at": "2026-10-06T08:00:00.000000+00:00",
  "windows": [
    { "window": "five_hour", "used_percent": 24, "remaining_percent": 76, "resets_at": "2026-10-02T22:00:00.000000+00:00" },
    { "window": "seven_day", "used_percent": 61.5, "remaining_percent": 38.5, "resets_at": "2026-10-06T08:00:00.000000+00:00" },
    { "window": "seven_day_opus", "used_percent": 12, "remaining_percent": 88, "resets_at": "2026-10-06T08:00:00.000000+00:00" }
  ],
  "subscription_type": "max",
  "source": "api.anthropic.com:/api/oauth/usage",
  "fetched_at": "2026-10-02T19:00:00.000Z",
  "warning": null
}
```

Mapping rules: numbers are never invented. A missing 5-hour or weekly window gives `null` fields and a warning.
If no window with a utilization can be parsed at all, the tool returns an error.

### Errors

Errors are returned as MCP tool errors (`isError: true`) with a code and a readable message:

| Situation | Message |
| --- | --- |
| Credentials file missing / unreadable | `NOT_LOGGED_IN` — run `claude` and sign in with `/login` |
| No `claudeAiOauth.accessToken` (API key, Bedrock, Vertex, …) | `AUTH_SHAPE_UNEXPECTED` — only claude.ai subscription logins have usage windows |
| `expiresAt` is in the past | `SESSION_EXPIRED` — use Claude Code once (it refreshes its own token) or `/login` (no request is made) |
| HTTP 401 / 403 | `UNAUTHORIZED` — same hint |
| HTTP 429 | `RATE_LIMITED` — retry later; do not call in a loop |
| HTTP 5xx / other / network / timeout | `REQUEST_FAILED` — includes the HTTP status if any |
| 200 but unparseable / no usage window | `SHAPE_CHANGED` — usage response shape changed |
| Anything else (unexpected internal error) | `INTERNAL` — generic message; details are never echoed |

## Token handling (read-only)

- Reads `$CLAUDE_CONFIG_DIR/.credentials.json` if `CLAUDE_CONFIG_DIR` is set, else `~/.claude/.credentials.json`,
  the file Claude Code writes on `/login`.
- Uses `claudeAiOauth.accessToken` as the Bearer token; `expiresAt` is checked locally.
- **Never refreshes** the token, **never writes** the file, never calls an auth endpoint. Claude Code rotates the
  refresh token on every refresh, so an outside refresh could sign out your sessions.
- Never logs, prints or returns the token, the Authorization header, or the raw upstream body.
- No secrets go into MCP config `env`.

Request sent (once per tool call):

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken from .credentials.json>
anthropic-beta: oauth-2025-04-20
Accept: application/json
User-Agent: claude-budget-mcp/<version>
```

The base URL can be overridden with `CLAUDE_BUDGET_MCP_BASE_URL` (for tests or a proxy). The server identifies
itself honestly; the endpoint is known to rate-limit clients that are not Claude Code more strictly, so call it
once before expensive work rather than often.

## Install / build

Requires Node.js 22+.

```bash
git clone https://github.com/pihme/claude-budget-mcp.git
cd claude-budget-mcp
npm install        # also builds dist/ via the prepare script
npm run build      # tsc -> dist/
npm test           # unit + stdio smoke tests (mocked fetch, fixture credentials)
npm run smoke      # optional: start the server over stdio, list tools, call get_budget once with YOUR login
```

Prebuilt alternative: each [release](https://github.com/pihme/claude-budget-mcp/releases) has a
`claude-budget-mcp-X.Y.Z.tgz` (built `dist/`, no build step); `npm install -g ./claude-budget-mcp-X.Y.Z.tgz`
puts `claude-budget-mcp` on your PATH. Versions follow SemVer; nothing is published to npm.

## Wiring into Claude Code

```bash
claude mcp add --scope user claude-budget -- node /path/to/claude-budget-mcp/dist/index.js
# or, with the binary on your PATH:
claude mcp add --scope user claude-budget -- claude-budget-mcp
```

Check it with `claude mcp list` or `/mcp`. The tool appears as `mcp__claude-budget__get_budget`. No `env` is
needed. See the official [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).

A good agent instruction (for example in `CLAUDE.md`): *"Before starting long or expensive work, call
`mcp__claude-budget__get_budget` once; if `session_remaining_percent` or `weekly_remaining_percent` is low,
tell me and ask before continuing."*

## Not covered

- macOS Keychain logins, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, API keys, Bedrock, Vertex, Foundry.
- Not API-key rate limits or Console spend — different ledgers.
- No dollar cost (Claude Code computes that on the client), no extra-usage spend, no caching or polling.

## Background

Design notes and the research behind this server: [SPEC.md](SPEC.md). Community prior art that documents the
endpoint (not endorsements):
[andrewleech `cc-usage`](https://gist.github.com/andrewleech/e4642d9aa22c84f355d98c25abe9af1a),
[FullFran/claudeops-tui](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md),
[`cship`](https://docs.rs/cship/latest/src/cship/usage_limits.rs.html).

## Contributing

Issues, ideas and pull requests are welcome: see [Contributing](CONTRIBUTING.md).

## License

[MIT](LICENSE)
