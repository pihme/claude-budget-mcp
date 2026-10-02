import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetError } from "../src/errors.js";
import { SOURCE, mapUsage, requestUsage, resolveBaseUrl } from "../src/usage.js";
import { FIXED_NOW, json, mockFetch, usageFixture } from "./helpers.js";

const code = (c: string) => (e: unknown) => e instanceof BudgetError && e.code === c;
const BASE = "https://api.anthropic.com";

test("full response: session, weekly and every non-null bucket", () => {
  const r = mapUsage(usageFixture("full.json"), "max", FIXED_NOW());
  assert.equal(r.session_used_percent, 24);
  assert.equal(r.session_remaining_percent, 76);
  assert.equal(r.session_resets_at, "2026-10-02T22:00:00.000000+00:00");
  assert.equal(r.weekly_used_percent, 61.5);
  assert.equal(r.weekly_remaining_percent, 38.5);
  assert.deepEqual(r.windows.map((w) => w.window), ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"]);
  const sonnet = r.windows.find((w) => w.window === "seven_day_sonnet")!;
  assert.equal(sonnet.used_percent, 0);
  assert.equal(sonnet.resets_at, null);
  assert.equal(r.subscription_type, "max");
  assert.equal(r.source, SOURCE);
  assert.equal(r.fetched_at, "2026-10-02T19:00:00.000Z");
  assert.equal(r.warning, null);
});

test("limits[]: weekly_scoped rows become windows, others are ignored, remaining is clamped", () => {
  const r = mapUsage(usageFixture("limits.json"), null, FIXED_NOW());
  assert.equal(r.weekly_used_percent, 102);
  assert.equal(r.weekly_remaining_percent, 0);
  const opus = r.windows.find((w) => w.window === "weekly_scoped:Opus")!;
  assert.equal(opus.used_percent, 40);
  assert.equal(opus.remaining_percent, 60);
  const unknown = r.windows.find((w) => w.window === "weekly_scoped:unknown")!;
  assert.equal(unknown.used_percent, null);
  assert.ok(!r.windows.some((w) => w.window.includes("something_new")));
  assert.match(r.warning ?? "", /percent is not a number/);
});

test("missing session window: nulls plus warning, weekly still reported", () => {
  const r = mapUsage(usageFixture("weekly-only.json"), null, FIXED_NOW());
  assert.equal(r.session_used_percent, null);
  assert.equal(r.session_remaining_percent, null);
  assert.equal(r.weekly_used_percent, 33.3);
  assert.match(r.warning ?? "", /missing window\(s\): five_hour/);
});

test("nothing usable: SHAPE_CHANGED, never invented numbers", () => {
  assert.throws(() => mapUsage(usageFixture("shape-changed.json")), code("SHAPE_CHANGED"));
  assert.throws(() => mapUsage(usageFixture("null-buckets.json")), code("SHAPE_CHANGED"));
  assert.throws(() => mapUsage([]), code("SHAPE_CHANGED"));
  assert.throws(() => mapUsage("nope"), code("SHAPE_CHANGED"));
});

test("base URL override", () => {
  assert.equal(resolveBaseUrl({}), BASE);
  assert.equal(resolveBaseUrl({ CLAUDE_BUDGET_MCP_BASE_URL: "http://127.0.0.1:9/" }), "http://127.0.0.1:9");
});

test("HTTP errors map to error codes", async () => {
  const cases: Array<[number, string]> = [
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [429, "RATE_LIMITED"],
    [500, "REQUEST_FAILED"],
    [404, "REQUEST_FAILED"],
  ];
  for (const [status, c] of cases) {
    const m = mockFetch(() => new Response("{}", { status }));
    await assert.rejects(requestUsage({ baseUrl: BASE, accessToken: "t", fetchImpl: m.fetch }), code(c));
    assert.equal(m.calls.length, 1, "no retry");
  }
});

test("invalid JSON body: SHAPE_CHANGED", async () => {
  const m = mockFetch(() => new Response("<html>", { status: 200 }));
  await assert.rejects(requestUsage({ baseUrl: BASE, accessToken: "t", fetchImpl: m.fetch }), code("SHAPE_CHANGED"));
});

test("network error and timeout: REQUEST_FAILED without details", async () => {
  const boom = mockFetch(() => {
    throw Object.assign(new Error("fetch failed FAKE"), { cause: { code: "ENOTFOUND" } });
  });
  await assert.rejects(requestUsage({ baseUrl: BASE, accessToken: "t", fetchImpl: boom.fetch }), (e: unknown) => {
    assert.ok(code("REQUEST_FAILED")(e));
    assert.match((e as Error).message, /ENOTFOUND/);
    assert.doesNotMatch((e as Error).message, /FAKE/);
    return true;
  });
  const hang = mockFetch(
    (_u, init) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
  );
  await assert.rejects(
    requestUsage({ baseUrl: BASE, accessToken: "t", fetchImpl: hang.fetch, timeoutMs: 20 }),
    (e: unknown) => code("REQUEST_FAILED")(e) && /timed out/.test((e as Error).message),
  );
});

test("200 is passed through as parsed JSON", async () => {
  const m = mockFetch(() => json({ five_hour: { utilization: 1, resets_at: null } }));
  assert.deepEqual(await requestUsage({ baseUrl: BASE, accessToken: "t", fetchImpl: m.fetch }), {
    five_hour: { utilization: 1, resets_at: null },
  });
});
