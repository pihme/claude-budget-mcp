import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVER_VERSION } from "../src/server.js";
import { VERSION, readPackageVersion } from "../src/version.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

test("VERSION and SERVER_VERSION come from package.json", () => {
  assert.equal(VERSION, pkg.version);
  assert.equal(SERVER_VERSION, pkg.version);
});

test("readPackageVersion walks up to the claude-budget-mcp package.json", () => {
  const root = mkdtempSync(join(tmpdir(), "cbm-version-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "claude-budget-mcp", version: "9.8.7" }));
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, "a", "package.json"), JSON.stringify({ name: "something-else", version: "1.0.0" }));
  assert.equal(readPackageVersion(nested), "9.8.7");
});

test("readPackageVersion falls back instead of throwing", () => {
  const empty = mkdtempSync(join(tmpdir(), "cbm-noversion-"));
  assert.match(readPackageVersion(join(empty, "x")), /^\d+\.\d+\.\d+/);
});
