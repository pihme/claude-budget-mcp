#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  // stdout is the MCP channel; keep diagnostics on stderr and free of secrets.
  process.stderr.write("claude-budget-mcp: failed to start\n");
  process.exit(1);
});
