import { BudgetError, REFRESH_HINT } from "./errors.js";
import { VERSION } from "./version.js";

/**
 * Client + field mapping for the UNOFFICIAL `/api/oauth/usage` endpoint that
 * Claude Code's `/usage` uses. The response shape is not a public contract:
 * this module maps by field name, never invents numbers, and reports partial
 * data via `warning` (or fails loudly when nothing usable is present).
 */

export const DEFAULT_BASE_URL = "https://api.anthropic.com";
export const USAGE_PATH = "/api/oauth/usage";
export const OAUTH_BETA = "oauth-2025-04-20";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const SOURCE = "api.anthropic.com:/api/oauth/usage";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface UsageWindow {
  window: string;
  used_percent: number | null;
  remaining_percent: number | null;
  resets_at: string | null;
}

export interface BudgetResult {
  session_used_percent: number | null;
  session_remaining_percent: number | null;
  session_resets_at: string | null;
  weekly_used_percent: number | null;
  weekly_remaining_percent: number | null;
  weekly_resets_at: string | null;
  windows: UsageWindow[];
  subscription_type: string | null;
  source: string;
  fetched_at: string;
  warning: string | null;
}

/** `CLAUDE_BUDGET_MCP_BASE_URL`, e.g. http://127.0.0.1:8080 (tests, proxies). */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CLAUDE_BUDGET_MCP_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export interface RequestOptions {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Single GET against `<base>/api/oauth/usage`. No retries. Returns the parsed JSON body. */
export async function requestUsage(opts: RequestOptions): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () =>
    new BudgetError("REQUEST_FAILED", `Usage request failed: timed out after ${Math.round(timeoutMs / 1000)}s.`);

  let res: Response;
  try {
    res = await fetchImpl(`${opts.baseUrl}${USAGE_PATH}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
        Accept: "application/json",
        "User-Agent": `claude-budget-mcp/${VERSION}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw timedOut();
    const reason = err instanceof Error ? describeNetworkError(err) : "network error";
    throw new BudgetError("REQUEST_FAILED", `Usage request failed: ${reason}.`);
  }

  try {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new BudgetError(
        "UNAUTHORIZED",
        `Usage request unauthorized (HTTP ${status}): the stored token is expired or was rejected. ${REFRESH_HINT}`,
        status,
      );
    }
    if (status === 429) {
      throw new BudgetError(
        "RATE_LIMITED",
        "The usage endpoint rate limited this request (HTTP 429). Retry later; do not call in a loop.",
        status,
      );
    }
    if (status < 200 || status > 299) {
      throw new BudgetError("REQUEST_FAILED", `Usage request failed (HTTP ${status}).`, status);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      if (controller.signal.aborted) throw timedOut();
      throw new BudgetError("REQUEST_FAILED", "Usage request failed: could not read response body.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BudgetError("SHAPE_CHANGED", "Usage response shape changed: body is not valid JSON.");
    }
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(err: Error): string {
  // undici puts the useful part (ENOTFOUND, ECONNREFUSED...) in `cause`.
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const code = cause && typeof cause.code === "string" ? cause.code : null;
  return code ? `network error (${code})` : "network error";
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function isoString(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

function remaining(used: number | null): number | null {
  if (used === null) return null;
  const r = Math.min(100, Math.max(0, 100 - used));
  return Math.round(r * 1e6) / 1e6;
}

/** A bucket looks like `{ utilization, resets_at }`. */
function isBucket(v: unknown): v is Obj {
  return isObject(v) && "utilization" in v;
}

/**
 * Map an `/api/oauth/usage` body to the `get_budget` result.
 * Throws SHAPE_CHANGED when no usage window can be parsed.
 */
export function mapUsage(
  body: unknown,
  subscriptionType: string | null = null,
  fetchedAt: Date = new Date(),
): BudgetResult {
  if (!isObject(body)) {
    throw new BudgetError("SHAPE_CHANGED", "Usage response shape changed: the body is not a JSON object.");
  }
  const notes: string[] = [];
  const windows: UsageWindow[] = [];

  // Top-level buckets in response order (five_hour, seven_day, seven_day_opus, ...).
  for (const [key, value] of Object.entries(body)) {
    if (!isBucket(value)) continue;
    const used = num(value.utilization);
    if (used === null && value.utilization !== null) notes.push(`${key}.utilization is not a number`);
    if (value.resets_at !== undefined && value.resets_at !== null && isoString(value.resets_at) === null) {
      notes.push(`${key}.resets_at is not a timestamp`);
    }
    windows.push({
      window: key,
      used_percent: used,
      remaining_percent: remaining(used),
      resets_at: isoString(value.resets_at),
    });
  }

  // Newer per-model weekly limits.
  if (Array.isArray(body.limits)) {
    for (const lim of body.limits) {
      if (!isObject(lim) || lim.kind !== "weekly_scoped") continue;
      const scope = isObject(lim.scope) ? lim.scope : null;
      const model = scope && isObject(scope.model) ? scope.model : null;
      const name = model && typeof model.display_name === "string" && model.display_name.trim() !== ""
        ? model.display_name.trim()
        : "unknown";
      const used = num(lim.percent);
      if (used === null) notes.push(`limits[weekly_scoped:${name}].percent is not a number`);
      windows.push({
        window: `weekly_scoped:${name}`,
        used_percent: used,
        remaining_percent: remaining(used),
        resets_at: isoString(lim.resets_at),
      });
    }
  } else if (body.limits !== undefined && body.limits !== null) {
    notes.push("limits is not an array");
  }

  const session = windows.find((w) => w.window === "five_hour") ?? null;
  const weekly = windows.find((w) => w.window === "seven_day") ?? null;

  if (!windows.some((w) => w.used_percent !== null)) {
    throw new BudgetError(
      "SHAPE_CHANGED",
      "Usage response shape changed: no usage window (five_hour, seven_day, limits[]) with a utilization could be parsed.",
    );
  }

  const missing: string[] = [];
  if (session === null || session.used_percent === null) missing.push("five_hour");
  if (weekly === null || weekly.used_percent === null) missing.push("seven_day");
  if (missing.length > 0) notes.unshift(`missing window(s): ${missing.join(", ")}`);

  const warning =
    notes.length > 0 ? `Partial data from the unofficial usage endpoint: ${notes.join("; ")}.` : null;

  return {
    session_used_percent: session?.used_percent ?? null,
    session_remaining_percent: session?.remaining_percent ?? null,
    session_resets_at: session?.resets_at ?? null,
    weekly_used_percent: weekly?.used_percent ?? null,
    weekly_remaining_percent: weekly?.remaining_percent ?? null,
    weekly_resets_at: weekly?.resets_at ?? null,
    windows,
    subscription_type: subscriptionType,
    source: SOURCE,
    fetched_at: fetchedAt.toISOString(),
    warning,
  };
}
