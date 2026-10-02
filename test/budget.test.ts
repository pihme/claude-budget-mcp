import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { getBudget } from "../src/budget.js";
import { BudgetError } from "../src/errors.js";
import { VERSION } from "../src/version.js";
import { FIXED_NOW, authFixture, header, json, mockFetch, usageFixture } from "./helpers.js";

const VALID = authFixture("valid.json");
const BASE = "https://api.anthropic.com";
const TOKEN = "FAKE-OAUTH-ACCESS-TOKEN-valid";

test("get_budget: single GET with the exact URL and headers", async () => {
  const m = mockFetch(() => json(usageFixture("full.json")));
  const r = await getBudget({ credentialsPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW });
  assert.equal(m.calls.length, 1, "exactly one request, no refresh, no retry");
  const [call] = m.calls;
  assert.equal(call!.url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(call!.init?.method, "GET");
  assert.equal(header(call!.init, "authorization"), `Bearer ${TOKEN}`);
  assert.equal(header(call!.init, "anthropic-beta"), "oauth-2025-04-20");
  assert.equal(header(call!.init, "accept"), "application/json");
  assert.equal(header(call!.init, "user-agent"), `claude-budget-mcp/${VERSION}`);
  assert.ok(call!.init?.signal, "request has an abort signal (timeout)");
  assert.equal(r.weekly_used_percent, 61.5);
  assert.equal(r.subscription_type, "max");
});

test("token never appears in the result", async () => {
  const m = mockFetch(() => json(usageFixture("full.json")));
  const r = await getBudget({ credentialsPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW });
  assert.doesNotMatch(JSON.stringify(r), /FAKE/);
});

test("expired token: no HTTP request at all", async () => {
  const m = mockFetch(() => json(usageFixture("full.json")));
  await assert.rejects(
    getBudget({ credentialsPath: authFixture("expired.json"), baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
    (e: unknown) => e instanceof BudgetError && e.code === "SESSION_EXPIRED",
  );
  assert.equal(m.calls.length, 0);
});

test("credentials file is never modified (read-only)", async () => {
  const before = readFileSync(VALID, "utf8");
  const mtime = statSync(VALID).mtimeMs;
  for (const status of [200, 401]) {
    const m = mockFetch(() => (status === 200 ? json(usageFixture("full.json")) : new Response("no", { status })));
    await getBudget({ credentialsPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }).catch(() => undefined);
  }
  assert.equal(readFileSync(VALID, "utf8"), before);
  assert.equal(statSync(VALID).mtimeMs, mtime);
});
