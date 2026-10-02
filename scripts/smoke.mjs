#!/usr/bin/env node
// Manual MCP smoke test: start dist/index.js over stdio, list tools, call get_budget once.
// Uses your real $CLAUDE_CONFIG_DIR / ~/.claude/.credentials.json unless you override CLAUDE_CONFIG_DIR.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
const client = new Client({ name: "claude-budget-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env }));
console.log("server:", client.getServerVersion());
const { tools } = await client.listTools();
for (const t of tools) console.log(`tool: ${t.name} - ${t.description?.slice(0, 80)}...`);
const res = await client.callTool({ name: "get_budget", arguments: {} });
console.log(res.isError ? "get_budget ERROR:" : "get_budget:", res.content?.[0]?.text);
await client.close();
