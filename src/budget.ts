import { loadSession, resolveCredentialsPath } from "./auth.js";
import { type BudgetResult, type FetchLike, mapUsage, requestUsage, resolveBaseUrl } from "./usage.js";

export interface Deps {
  /** Path to .credentials.json. Default: $CLAUDE_CONFIG_DIR/.credentials.json or ~/.claude/.credentials.json */
  credentialsPath?: string;
  /** Default: $CLAUDE_BUDGET_MCP_BASE_URL or https://api.anthropic.com */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

/** Usage windows (same figures as `/usage`). The credentials file is re-read on every call. */
export async function getBudget(deps: Deps = {}): Promise<BudgetResult> {
  const credentialsPath = deps.credentialsPath ?? resolveCredentialsPath();
  const baseUrl = deps.baseUrl ?? resolveBaseUrl();
  const now = deps.now ?? (() => new Date());
  const session = await loadSession(credentialsPath, now().getTime());
  const body = await requestUsage({
    baseUrl,
    accessToken: session.accessToken,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  return mapUsage(body, session.subscriptionType, now());
}
