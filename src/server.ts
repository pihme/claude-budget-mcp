import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Deps, getBudget } from "./budget.js";
import { BudgetError } from "./errors.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "claude-budget";
export const SERVER_VERSION = VERSION;

const GET_BUDGET_DESCRIPTION =
  "Return the Claude subscription's usage limits (same figures as `/usage`): the 5-hour session window " +
  "(session_*) and the weekly window across all models (weekly_*), each with used and remaining percent and " +
  "reset time. `windows` lists every window found, including per-model weekly limits, so you can pick the " +
  "relevant one. Data comes from an UNOFFICIAL, undocumented endpoint; null fields plus `warning` mean partial " +
  "data. Call it once before expensive work; do not poll in a loop.";

function ok(data: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function toolError(err: unknown): CallToolResult {
  const message =
    err instanceof BudgetError
      ? err.message
      : "Unexpected internal error in claude-budget-mcp."; // never echo unknown errors (could contain secrets)
  const code = err instanceof BudgetError ? err.code : "INTERNAL";
  return {
    isError: true,
    content: [{ type: "text", text: `Error [${code}]: ${message}` }],
  };
}

export function createServer(deps: Deps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "get_budget",
    {
      title: "Claude usage limits",
      description: GET_BUDGET_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        return ok(await getBudget(deps));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}
