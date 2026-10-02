import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package version, read once from package.json at runtime so that the MCP
 * serverInfo and the User-Agent always match the released version.
 * Walks up from this file (dist/ in a build, .test-build/src/ in tests) to the
 * package.json named "claude-budget-mcp".
 */
export const PACKAGE_NAME = "claude-budget-mcp";

export function readPackageVersion(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string" && pkg.version !== "") return pkg.version;
    } catch {
      // no (readable) package.json here; keep walking up
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "0.0.0-unknown";
}

export const VERSION: string = readPackageVersion();
