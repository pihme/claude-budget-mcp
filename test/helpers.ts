import { readFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/usage.js";

// Compiled tests live in .test-build/test/, fixtures stay in test/fixtures/.
export const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));

export const authFixture = (name: string) => join(FIXTURES, "auth", name);
export const usageFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, "usage", name), "utf8"));

/** Copy an auth fixture into a fresh temp CLAUDE_CONFIG_DIR as .credentials.json. */
export function tempConfigDir(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-budget-test-"));
  copyFileSync(authFixture(fixture), join(dir, ".credentials.json"));
  return dir;
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

export type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(responder: Responder): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

export const FIXED_NOW = () => new Date("2026-10-02T19:00:00.000Z");
