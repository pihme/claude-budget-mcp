import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { assertNotExpired, loadSession, parseExpiresAt, resolveCredentialsPath, selectSession } from "../src/auth.js";
import { BudgetError } from "../src/errors.js";
import { FIXED_NOW, authFixture } from "./helpers.js";

const NOW = FIXED_NOW().getTime();
const code = (c: string) => (e: unknown) => e instanceof BudgetError && e.code === c;

test("credentials path: CLAUDE_CONFIG_DIR wins, else ~/.claude", () => {
  assert.equal(resolveCredentialsPath({ CLAUDE_CONFIG_DIR: "/tmp/cc" }, "/home/u"), join("/tmp/cc", ".credentials.json"));
  assert.equal(resolveCredentialsPath({ CLAUDE_CONFIG_DIR: "  " }, "/home/u"), join("/home/u", ".claude", ".credentials.json"));
  assert.equal(resolveCredentialsPath({}, "/home/u"), join("/home/u", ".claude", ".credentials.json"));
});

test("parseExpiresAt accepts epoch ms, epoch s and ISO strings", () => {
  assert.equal(parseExpiresAt(1893456000000), 1893456000000);
  assert.equal(parseExpiresAt(1893456000), 1893456000000);
  assert.equal(parseExpiresAt("1893456000000"), 1893456000000);
  assert.equal(parseExpiresAt("2030-01-01T00:00:00Z"), Date.parse("2030-01-01T00:00:00Z"));
  assert.equal(parseExpiresAt(undefined), null);
  assert.equal(parseExpiresAt("soon"), null);
});

test("valid login: token, expiry and subscription type", async () => {
  const s = await loadSession(authFixture("valid.json"), NOW);
  assert.equal(s.accessToken, "FAKE-OAUTH-ACCESS-TOKEN-valid");
  assert.equal(s.expiresAtMs, 1893456000000);
  assert.equal(s.subscriptionType, "max");
});

test("expiry in seconds and missing expiry are accepted", async () => {
  assert.equal((await loadSession(authFixture("seconds-expiry.json"), NOW)).expiresAtMs, 1893456000000);
  const s = await loadSession(authFixture("no-expiry.json"), NOW);
  assert.equal(s.expiresAtMs, null);
  assert.equal(s.subscriptionType, null);
});

test("expired token: SESSION_EXPIRED, no refresh", async () => {
  await assert.rejects(loadSession(authFixture("expired.json"), NOW), code("SESSION_EXPIRED"));
  assert.throws(() => assertNotExpired({ accessToken: "x", expiresAtMs: NOW, subscriptionType: null }, NOW), code("SESSION_EXPIRED"));
});

test("missing file: NOT_LOGGED_IN without OS error text", async () => {
  await assert.rejects(loadSession("/nonexistent/secret-user/.credentials.json", NOW), (e: unknown) => {
    assert.ok(code("NOT_LOGGED_IN")(e));
    assert.doesNotMatch((e as Error).message, /secret-user|ENOENT/);
    return true;
  });
});

test("no claude.ai login or invalid JSON: AUTH_SHAPE_UNEXPECTED", async () => {
  await assert.rejects(loadSession(authFixture("no-oauth.json"), NOW), code("AUTH_SHAPE_UNEXPECTED"));
  await assert.rejects(loadSession(authFixture("invalid-json.txt"), NOW), code("AUTH_SHAPE_UNEXPECTED"));
  assert.throws(() => selectSession([]), code("AUTH_SHAPE_UNEXPECTED"));
  assert.throws(() => selectSession({ claudeAiOauth: { accessToken: "  " } }), code("AUTH_SHAPE_UNEXPECTED"));
});
