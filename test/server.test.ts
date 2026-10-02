import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Deps } from "../src/budget.js";
import { createServer } from "../src/server.js";
import { FIXED_NOW, authFixture, json, mockFetch, usageFixture } from "./helpers.js";

async function connect(deps: Deps) {
  const server = createServer(deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, close: () => client.close() };
}

const text = (r: unknown) => ((r as { content: unknown }).content as Array<{ type: string; text: string }>)[0]!.text;

test("lists exactly get_budget, read-only", async () => {
  const { client, close } = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["get_budget"]);
  assert.equal(tools[0]!.annotations?.readOnlyHint, true);
  assert.match(tools[0]!.description ?? "", /UNOFFICIAL/);
  await close();
});

test("get_budget returns JSON text + structuredContent", async () => {
  const m = mockFetch(() => json(usageFixture("full.json")));
  const { client, close } = await connect({
    credentialsPath: authFixture("valid.json"),
    baseUrl: "https://x.example",
    fetchImpl: m.fetch,
    now: FIXED_NOW,
  });
  const r = await client.callTool({ name: "get_budget", arguments: {} });
  assert.notEqual(r.isError, true);
  const parsed = JSON.parse(text(r));
  assert.equal(parsed.session_used_percent, 24);
  assert.deepEqual(r.structuredContent, parsed);
  assert.doesNotMatch(text(r), /FAKE/);
  await close();
});

test("errors surface as MCP tool errors (isError) with clear messages", async () => {
  const cases: Array<[Deps, RegExp]> = [
    [{ credentialsPath: authFixture("expired.json") }, /SESSION_EXPIRED.*expired.*never refreshes/],
    [{ credentialsPath: "/nope/.credentials.json" }, /NOT_LOGGED_IN.*\/login/],
    [{ credentialsPath: authFixture("no-oauth.json") }, /AUTH_SHAPE_UNEXPECTED.*subscription/],
    [
      { credentialsPath: authFixture("valid.json"), fetchImpl: mockFetch(() => new Response("", { status: 401 })).fetch },
      /UNAUTHORIZED.*HTTP 401/,
    ],
    [
      { credentialsPath: authFixture("valid.json"), fetchImpl: mockFetch(() => new Response("", { status: 429 })).fetch },
      /RATE_LIMITED.*do not call in a loop/,
    ],
    [
      { credentialsPath: authFixture("valid.json"), fetchImpl: mockFetch(() => json(usageFixture("shape-changed.json"))).fetch },
      /SHAPE_CHANGED.*shape changed/,
    ],
  ];
  for (const [deps, re] of cases) {
    const { client, close } = await connect({ baseUrl: "https://x.example", now: FIXED_NOW, ...deps });
    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(text(r), re);
    assert.doesNotMatch(text(r), /FAKE/);
    await close();
  }
});

test("unexpected internal errors are not echoed", async () => {
  const { client, close } = await connect({
    credentialsPath: authFixture("valid.json"),
    baseUrl: "https://x.example",
    now: FIXED_NOW,
    fetchImpl: async () => ({ status: 200, text: async () => { throw new TypeError("secret FAKE-OAUTH"); } }) as unknown as Response,
  });
  const r = await client.callTool({ name: "get_budget", arguments: {} });
  assert.equal(r.isError, true);
  assert.doesNotMatch(text(r), /FAKE|secret/);
  await close();
});
