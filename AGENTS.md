# AGENTS.md

This file is for the coding agent working in this repo. Read it at the start of a session.

## What this repo is

**claude-budget-mcp** is a small local MCP server (stdio) that gives a Claude Code agent the 5-hour and weekly usage figures `/usage` shows for a Claude subscription. Sister project of grok-budget-mcp; keep the two consistent where the services allow. Spec and decisions: `SPEC.md`. User docs: `README.md`.

License: **MIT** (`LICENSE`). Copyright line: "claude-budget-mcp contributors"; keep it that way.

## How to work here

- TypeScript on Node.js 22+ (ESM), official MCP SDK (`@modelcontextprotocol/sdk`) as the only runtime dependency. Ask before adding a dependency. CI runs Node 22 and 24; `@types/node` stays on ^22.
- Layout: `src/index.ts` (stdio entry), `src/server.ts` (tool registration, error mapping), `src/budget.ts` (one call = read credentials, one request, map), `src/auth.ts` (read-only `.credentials.json`), `src/usage.ts` (HTTP client and field mapping), `src/errors.ts` (error codes), `src/version.ts` (version read from `package.json` at runtime), `test/` (`node:test`, mocked fetch, synthetic fixtures in `test/fixtures/`), `scripts/smoke.mjs` (manual check with a real login).
- **Token handling is read-only** (SPEC Q4, do not reopen): read `claudeAiOauth.accessToken`, `expiresAt` and `subscriptionType` only; never refresh, never write the credentials file, never call an auth endpoint. Never log, print or return the token, the `Authorization` header, the raw upstream body, or OS error text. stdout is the MCP channel; diagnostics go to stderr.
- One HTTPS request per tool call. No retries, no caching, no polling. Honest `User-Agent` (SPEC Q6).
- **Never invent numbers.** Missing fields are `null` plus `warning`; nothing usable is `SHAPE_CHANGED`.
- Error codes in `src/errors.ts` match the error tables in `README.md` and `SPEC.md`; change them together.
- The endpoint is unofficial. Keep the README warning and say "unofficial" wherever the endpoint is described.
- Do not run `npm run smoke` or call the real endpoint as the agent: it uses the maintainer's real Claude login.

- Tests: `npm test` must pass before anything lands on `main`. Tests stay offline: no real accounts, tokens or live services.
- Release paths (only commits touching them can cut a release) are listed in `.github/release.json`.

## Shared rules

### Commits and changes

- [Conventional Commits](https://www.conventionalcommits.org/) for every commit: `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, `build:`, optional scope, `!` for breaking changes.
- **Trivial changes go straight to `main`:** typos, small docs fixes, obvious small bugs, housekeeping. Keep commits small and focused; pull before you commit, CI pushes release commits to `main`.
- **Non-trivial findings become GitHub issues** (with the matching issue form): bugs you do not fix right away, design questions, anything that needs a decision. Do not hide them in a commit.
- **Never force-push**, never rewrite pushed history, never delete branches or tags.
- **No comments, reviews, label changes, closes or merges on other people's issues and PRs** unless the maintainer asked for it in the session. Exception: Dependabot PRs (see below). Opening issues for your own findings and closing them with your own commits (`Closes #n`) is fine.
- **Never write the skip-CI token** (the word `skip` and `ci` in square brackets, or any of its variants) in a commit message, not even quoted or explained: GitHub then skips CI for that push and no release is cut. Only `release.py` puts it in its own release commits.

### Versions and releases

- SemVer, one tag per artifact: `claude-budget-mcp/vX.Y.Z`.
- `feat:` bumps minor, `fix:`/`perf:` patch, `feat!:`/`fix!:` or a `BREAKING CHANGE:` footer major. **Before 1.0.0 a breaking change bumps the minor version** (0.3.x to 0.4.0, never to 1.0.0). Reaching 1.0.0 is a deliberate decision by the maintainer, not a side effect.
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, `build:` never bump. A commit only counts when it touches a release path.
- **Release 1.0** (or any chosen version): an empty commit with the footer `Release-As: 1.0.0`, e.g. `git commit --allow-empty -m "chore: release 1.0" -m "Release-As: 1.0.0"`. With several artifacts in `.github/release.json`, name one per footer line: `Release-As: <name>@1.0.0` (the bare form is then ignored). It releases by itself, regardless of type or paths; upwards only (at or below the current version it is ignored with a warning); several footers: the highest wins. Only use it when the maintainer decided the version.
- After CI passes on a push to `main`, `.github/scripts/release.py` computes the version, updates the version file if there is one (commit `chore(release): …` by github-actions), creates the GitHub Release with notes and attaches the build. **Never tag, bump versions or create releases by hand.**

### Dependabot

- Commit prefixes (set in `.github/dependabot.yml`): runtime dependencies and shipped Docker base images `fix(deps):` (patch release), dev dependencies `chore(deps-dev):`, GitHub Actions `ci(deps):`, images that are not shipped (examples, tests) `chore(deps):`.
- **Never turn a dependency update into `feat!:`** or reword its title. A major dependency update is still `fix(deps)` / `chore(deps-dev)`. If it forces a breaking change on users (for example a new minimum runtime), that is a separate, deliberate commit after the maintainer decides.
- **Merge Dependabot PRs when CI is green** (squash, keep the Dependabot title). If one conflicts, comment `@dependabot rebase`. If CI is red and the fix is not obvious, leave the PR open and open an issue.

### Secrets

- Never commit, print, log or paste tokens, API keys, credentials, `.env` files, session files or real service responses: not in code, tests, fixtures, issues, PRs or commit messages. Use synthetic fixtures.
- Security problems are reported privately (`SECURITY.md`). Do not discuss an unfixed vulnerability in a public issue.

### Contributions

- Outside pull requests are welcome under MIT (see `CONTRIBUTING.md` and `.github/pull_request_template.md`). The maintainer reviews and merges them (squash, Conventional Commit title).
- `CONTRIBUTING.md` holds **only content for outside people**: license, how to report, how to build and test. Internal working rules (this file) never go there.

### Website

- No website yet. If one is added, follow the shared website rules from presets.

## Do not invent

- Token refresh, writing `.credentials.json`, or another auth path (Keychain, `CLAUDE_CODE_OAUTH_TOKEN`, API keys) without a new SPEC decision
- Impersonating Claude Code (for example a `claude-code/…` User-Agent) to dodge rate limits
- Caching, polling or background refresh
- Dollar cost or extra-usage spend (out of scope in SPEC)
- Claims that the endpoint is an official or stable Anthropic API

## Agent skills

### Issue tracker

GitHub issues in `pihme/claude-budget-mcp`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, plus `bug` / `enhancement`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: decisions in `SPEC.md`, optional root `GLOSSARY.md`. See `docs/agents/domain.md`.
