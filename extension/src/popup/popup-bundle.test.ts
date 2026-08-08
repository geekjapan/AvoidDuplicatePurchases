import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "../..");
const distRoot = join(extensionRoot, "dist");
const importPattern = /\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/g;

function collectModuleSpecifiers(code: string): string[] {
  const specs = new Set<string>();
  for (const match of code.matchAll(importPattern)) specs.add(match[1]!);
  for (const match of code.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    specs.add(match[1]!);
  }
  return [...specs];
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

describe("MV3 popup browser bundle", () => {
  it("builds a browser-loadable popup graph with both server states", () => {
    const build = spawnSync("npm", ["run", "build", "--silent"], {
      cwd: extensionRoot,
      encoding: "utf8",
    });
    assert.equal(
      build.status,
      0,
      `extension build failed\n${build.stdout}\n${build.stderr}`,
    );

    const entry = resolve(distRoot, "popup/popup.js");
    assert.ok(existsSync(entry), entry);
    const queue = [entry];
    const seen = new Set<string>();
    const unresolved: Array<{ from: string; spec: string }> = [];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = readFileSync(file, "utf8");
      for (const spec of collectModuleSpecifiers(code)) {
        if (!isRelativeSpecifier(spec)) {
          unresolved.push({ from: file, spec });
          continue;
        }
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) queue.push(target);
        else unresolved.push({ from: file, spec });
      }
    }

    assert.deepEqual(unresolved, [], "popup has unresolved module edges");
    const popup = readFileSync(entry, "utf8");
    assert.match(popup, /statusEl\.textContent = connected \?/);
    assert.match(popup, /"status connected"/);
    assert.match(popup, /"status disconnected"/);
  });
});
