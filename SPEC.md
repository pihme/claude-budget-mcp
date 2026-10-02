# Claude Code budget MCP server — design spec

**Status:** design specification, implemented in this repository (see [README](README.md)).  
**Date:** 2026-10-02  
**Audience:** Claude Code agents that need to know how much of their plan's usage limits is left before starting expensive work.

This is the design spec for the small local MCP server in this repository. It is a personal helper, not an official Anthropic product. It is derived from its sister project [grok-budget-mcp](https://github.com/pihme/grok-budget-mcp) and keeps its decisions (read-only token, one request per call, never invent numbers) wherever they carry over.

## Goal

Give a Claude Code agent a **single MCP tool** that returns the same figures the interactive `/usage` command shows for a Claude subscription (Pro, Max, Team, Enterprise): how much of the 5-hour session window and of the weekly windows is used, how much remains, and when each window resets.

Today the agent has no first-class way to ask that question. `/usage` is interactive; the status line receives `rate_limits`, but only the status line script sees them, not the agent.

## Research (as of 2026-10-02)

### Official programmatic API for the subscription usage limits?

**No.** Findings:

| Surface | What it covers | Usable by the agent? |
| --- | --- | --- |
| `/usage` in Claude Code | 5-hour and weekly windows, per-model weekly limits | No: interactive only |
| Status line `rate_limits` (Claude Code 2.1.80+) | 5-hour and 7-day windows with used percentage and reset time | Only via a custom status line script that writes them somewhere; refreshed only while a session renders |
| Per-request rate-limit headers on the Messages API | API-key rate limits | No: a different ledger, not the subscription windows |
| Feature requests for an official endpoint | `anthropics/claude-code#44328`, `#32796` | Open |

Sources: [Claude Code authentication docs](https://code.claude.com/docs/en/authentication), [`anthropics/claude-code#30930`](https://github.com/anthropics/claude-code/issues/30930) (429s and the status line `rate_limits` field), community tools listed below.

### Undocumented endpoint the community (and Claude Code itself) uses

Claude Code's `/usage` and several community tools call:

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claudeAiOauth.accessToken from ~/.claude/.credentials.json>
anthropic-beta: oauth-2025-04-20
Accept: application/json
```

Useful response fields (names only; the shape is not a public contract and changes between releases):

- `five_hour` — `{ utilization, resets_at }`: the 5-hour session window
- `seven_day` — `{ utilization, resets_at }`: the weekly window across all models
- `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps`, … — further weekly buckets of the same shape, often `null`
- `limits[]` — newer per-model weekly limits: `{ kind: "weekly_scoped", percent, resets_at, scope.model.display_name }`

`utilization` is the **used** percent in `[0, 100]`; `resets_at` is an RFC 3339 timestamp (or `null`).

Community references (not endorsements):

- [andrewleech `cc-usage`](https://gist.github.com/andrewleech/e4642d9aa22c84f355d98c25abe9af1a) (read-only CLI, `limits[]` handling)
- [FullFran/claudeops-tui `docs/oauth-usage-endpoint.md`](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md)
- [`cship` `usage_limits.rs`](https://docs.rs/cship/latest/src/cship/usage_limits.rs.html)
- [genesiscz/GenesisTools `usage/api.ts`](https://github.com/genesiscz/GenesisTools/blob/8755729e/src/claude/lib/usage/api.ts)

**Only subscription logins.** The endpoint belongs to the claude.ai OAuth login. API keys (`ANTHROPIC_API_KEY`), Bedrock, Vertex and Foundry have no such windows.

## MCP tool

Server name in config: `claude-budget` (tools appear in Claude Code as `mcp__claude-budget__…`).

### `get_budget`

**Description:** Return the Claude subscription's usage windows (same figures as `/usage`): 5-hour session, weekly, and per-model weekly limits, each with used and remaining percent and reset time.

**Input:** none (empty object). No account selectors in v1.

**Output (JSON object, all fields always present or explicitly null):**

| Field | Type | Meaning |
| --- | --- | --- |
| `session_used_percent` | number \| null | `five_hour.utilization` |
| `session_remaining_percent` | number \| null | `100 - session_used_percent`, clamped to `[0, 100]` |
| `session_resets_at` | string \| null | `five_hour.resets_at` (ISO 8601) |
| `weekly_used_percent` | number \| null | `seven_day.utilization` |
| `weekly_remaining_percent` | number \| null | `100 - weekly_used_percent`, clamped |
| `weekly_resets_at` | string \| null | `seven_day.resets_at` |
| `windows` | array | Every window found, including the two above: `{ window, used_percent, remaining_percent, resets_at }`. `window` is the upstream key (`five_hour`, `seven_day`, `seven_day_opus`, …) or `weekly_scoped:<model>` for `limits[]` rows. Buckets that are `null` upstream are left out. |
| `subscription_type` | string \| null | `claudeAiOauth.subscriptionType` from the local credentials file (e.g. `max`), when present |
| `source` | string | always `"api.anthropic.com:/api/oauth/usage"` |
| `fetched_at` | string | ISO 8601, when this server fetched the data |
| `warning` | string \| null | human note if data is partial or the shape changed |

Do **not** return raw tokens, the credentials file, or the upstream body.

There is no second tool. The dollar figure in `/usage` is computed by the client from token counts and is not part of this endpoint; extra-usage spend fields are too unstable for v1.

## Data source

1. Resolve the credentials file: `$CLAUDE_CONFIG_DIR/.credentials.json` if `CLAUDE_CONFIG_DIR` is set, else `~/.claude/.credentials.json`. This is where Claude Code stores the login on **Linux** (file mode `0600`), and on Windows.
2. Read `claudeAiOauth.accessToken`, `claudeAiOauth.expiresAt` (epoch milliseconds; seconds are accepted too) and `claudeAiOauth.subscriptionType`. Do not refresh or modify anything.
3. Call `GET https://api.anthropic.com/api/oauth/usage` once with the headers above and `User-Agent: claude-budget-mcp/<version>`.
4. Map the fields as above. Missing windows are `null` with a `warning`; if no window can be parsed at all, fail with `SHAPE_CHANGED` — never invent a percent.

Base URL override for tests and proxies: `CLAUDE_BUDGET_MCP_BASE_URL` (default `https://api.anthropic.com`).

## Token handling (read-only)

**Decision for v1:** do not refresh the token and do not write `.credentials.json`. Claude Code owns that file and refreshes the token itself while it runs; a second writer could corrupt the session.

1. Read `accessToken` and `expiresAt`.
2. If `expiresAt` is in the past, return a clear error: the stored token expired; using Claude Code once refreshes it (or `/login`).
3. Otherwise make the request once.
4. On 401/403, return a clear error with the same hint.

The server never calls a token endpoint, writes the credentials file, or retries. Claude Code rotates the refresh token on every refresh, so a second, outside refresh can sign out every session ([`anthropics/claude-code#78020`](https://github.com/anthropics/claude-code/issues/78020)).

## Error cases

| Situation | Code | Tool result |
| --- | --- | --- |
| Credentials file missing / unreadable | `NOT_LOGGED_IN` | Not logged in; run `claude` and `/login` with a claude.ai subscription |
| No `claudeAiOauth.accessToken` (API key, Bedrock, Vertex, …) | `AUTH_SHAPE_UNEXPECTED` | Only claude.ai subscription logins have usage windows |
| `expiresAt` in the past | `SESSION_EXPIRED` | Token expired; run Claude Code once to refresh it, or `/login` |
| HTTP 401/403 | `UNAUTHORIZED` | Rejected; same hint |
| HTTP 429 | `RATE_LIMITED` | Retry later; do not call in a loop |
| HTTP 5xx / network / timeout | `REQUEST_FAILED` | Include the status if any |
| 200 but unparseable / no window | `SHAPE_CHANGED` | Response shape changed |

Timeout: 15 s. No retries.

## Risks

1. **Unofficial.** `/api/oauth/usage` is not a documented public API. Anthropic can change path, headers or JSON at any time. The server fails loudly instead of guessing.
2. **Token safety.** Never print, log or return the access token or the `Authorization` header. Never commit credentials files.
3. **Shared credentials.** Claude Code reads and writes the same file. Read-only handling avoids corrupting it.
4. **Rate limits.** The endpoint is known to answer 429 to clients that do not identify as Claude Code. This server identifies itself honestly (`claude-budget-mcp/<version>`) and makes one request per call; a 429 is reported, not worked around.
5. **Policy / ToS.** Calling a private product endpoint may conflict with the terms; keep this a personal local helper, not a hosted service.
6. **Wrong ledger.** API-key rate limits and Console spend are different questions.

## Wiring into Claude Code

Stdio MCP server: TypeScript on Node.js 22+, official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), minimal dependencies.

```bash
claude mcp add --scope user claude-budget -- node /path/to/claude-budget-mcp/dist/index.js
```

No secrets in `env`: the server reads the credentials file itself. `claude mcp list` and `/mcp` show whether it is connected.

## Out of scope (v1)

- **macOS.** There Claude Code keeps the login in the Keychain (`Claude Code-credentials`), not in a file, and reading it needs `security find-generic-password` plus a Keychain approval. v1 targets Linux; on macOS it only works when Claude Code fell back to the file.
- `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (made for model requests only).
- API-key, Bedrock, Vertex and Foundry logins.
- Extra-usage spend, the client-side dollar cost, caching, polling.

## Decisions (2026-10-02)

- **Q1 — Derived from grok-budget-mcp:** same structure, stack, error model and read-only rule; no separate spec review (decided by the maintainer).
- **Q2 — Platform:** Linux first; the credentials file is the only auth source. No Keychain in v1.
- **Q3 — Stack:** TypeScript on Node.js 22+, `@modelcontextprotocol/sdk`, stdio, no other runtime dependency.
- **Q4 — Refresh:** never refresh or write the credentials file; expired or rejected tokens produce a clear error, no retry.
- **Q5 — Windows:** top-level session and weekly fields for the common case, plus `windows[]` with every bucket so the agent can pick per-model limits.
- **Q6 — User-Agent:** honest `claude-budget-mcp/<version>`; no impersonation of Claude Code.
- **Q7 — License:** MIT, like grok-budget-mcp.
