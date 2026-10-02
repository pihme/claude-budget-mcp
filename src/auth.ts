import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BudgetError, LOGIN_HINT, REFRESH_HINT } from "./errors.js";

/**
 * READ-ONLY access to the Claude Code login in .credentials.json.
 *
 * This module never refreshes tokens, never writes the file and never logs or
 * returns the token anywhere except to the usage request's Authorization header.
 *
 * Shape written by Claude Code on Linux (and Windows) after `/login` with a
 * claude.ai subscription:
 *
 * {
 *   "claudeAiOauth": {
 *     "accessToken": "<used as Bearer>",
 *     "refreshToken": "...",
 *     "expiresAt": 1759700000000,          // epoch ms
 *     "scopes": ["user:inference", ...],
 *     "subscriptionType": "max"
 *   }
 * }
 */

export interface ClaudeSession {
  /** Bearer token. Never log or return this. */
  readonly accessToken: string;
  /** Expiry in epoch ms, or null if absent/unparseable. */
  readonly expiresAtMs: number | null;
  /** e.g. "pro", "max"; null if absent. Not secret. */
  readonly subscriptionType: string | null;
}

export function resolveCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) return join(configDir, ".credentials.json");
  return join(home, ".claude", ".credentials.json");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseExpiresAt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Claude Code writes epoch milliseconds; accept seconds as well.
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Pick the claude.ai OAuth login from a parsed credentials document. */
export function selectSession(doc: unknown): ClaudeSession {
  if (!isObject(doc)) {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      `Credentials shape unexpected: .credentials.json is not a JSON object. ${LOGIN_HINT}`,
    );
  }
  const oauth = doc.claudeAiOauth;
  if (!isObject(oauth) || typeof oauth.accessToken !== "string" || oauth.accessToken.trim() === "") {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      "No claude.ai subscription login found in .credentials.json (no `claudeAiOauth.accessToken`). " +
        `Usage windows exist only for claude.ai subscriptions, not for API keys, Bedrock or Vertex. ${LOGIN_HINT}`,
    );
  }
  const sub = typeof oauth.subscriptionType === "string" && oauth.subscriptionType.trim() !== ""
    ? oauth.subscriptionType.trim()
    : null;
  return {
    accessToken: oauth.accessToken.trim(),
    expiresAtMs: parseExpiresAt(oauth.expiresAt),
    subscriptionType: sub,
  };
}

/** Throws SESSION_EXPIRED if the session's expiresAt is in the past. */
export function assertNotExpired(session: ClaudeSession, now: number = Date.now()): void {
  if (session.expiresAtMs !== null && session.expiresAtMs <= now) {
    const when = new Date(session.expiresAtMs).toISOString();
    throw new BudgetError(
      "SESSION_EXPIRED",
      `Session expired: the stored Claude Code token expired at ${when}. ${REFRESH_HINT}`,
    );
  }
}

/** Read .credentials.json (read-only) and return a non-expired session. */
export async function loadSession(
  path: string = resolveCredentialsPath(),
  now: number = Date.now(),
): Promise<ClaudeSession> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // Do not echo the OS error: it may contain local usernames / paths.
    throw new BudgetError(
      "NOT_LOGGED_IN",
      `Not logged in: could not read the Claude Code credentials file ($CLAUDE_CONFIG_DIR/.credentials.json or ~/.claude/.credentials.json). ${LOGIN_HINT}`,
    );
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      `Credentials shape unexpected: .credentials.json is not valid JSON. ${LOGIN_HINT}`,
    );
  }
  const session = selectSession(doc);
  assertNotExpired(session, now);
  return session;
}
