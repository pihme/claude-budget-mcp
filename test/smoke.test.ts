/**
 * End-to-end smoke test: spawn the real stdio server (compiled src/index.ts) as
 * a child process, list tools, and call get_budget against a local HTTP mock of
 * the usage endpoint (via CLAUDE_BUDGET_MCP_BASE_URL) with a fixture CLAUDE_CONFIG_DIR.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tempConfigDir, usageFixture } from "./helpers.js";

const ENTRY = fileURLToPath(new URL("../src/index.js", import.meta.url));
const PKG_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
}

test("stdio server: list tools and call get_budget end-to-end", async () => {
  const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
  const http = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(usageFixture("full.json")));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;

  const env = baseEnv();
  env.CLAUDE_CONFIG_DIR = tempConfigDir("valid.json");
  env.CLAUDE_BUDGET_MCP_BASE_URL = `http://127.0.0.1:${port}`;

  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "claude-budget");
    assert.equal(client.getServerVersion()?.version, PKG_VERSION);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["get_budget"]);

    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.notEqual(r.isError, true);
    const body = r.structuredContent as Record<string, unknown>;
    assert.equal(body.session_used_percent, 24);
    assert.equal(body.weekly_remaining_percent, 38.5);
    assert.equal((body.windows as unknown[]).length, 4);

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "/api/oauth/usage");
    assert.equal(seen[0]!.headers.authorization, "Bearer FAKE-OAUTH-ACCESS-TOKEN-valid");
    assert.equal(seen[0]!.headers["anthropic-beta"], "oauth-2025-04-20");
    assert.equal(seen[0]!.headers.accept, "application/json");
  } finally {
    await client.close();
    http.close();
  }
});

test("stdio server: expired session is a tool error, no HTTP call", async () => {
  const env = baseEnv();
  env.CLAUDE_CONFIG_DIR = tempConfigDir("expired.json");
  env.CLAUDE_BUDGET_MCP_BASE_URL = "http://127.0.0.1:9"; // discard port; must not be contacted

  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.equal(r.isError, true);
    const t = (r.content as Array<{ text: string }>)[0]!.text;
    assert.match(t, /Session expired/);
  } finally {
    await client.close();
  }
});
