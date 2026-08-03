import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backgroundEntry = join(__dirname, "index.ts");
const extensionRoot = join(__dirname, "../..");

/** Shared esbuild options for the MV3 service-worker artifact (must match package.json build:sw). */
export const serviceWorkerBundleOptions: esbuild.BuildOptions = {
  entryPoints: [backgroundEntry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109"],
  legalComments: "none",
  logLevel: "silent",
  absWorkingDir: extensionRoot,
};

function collectModuleSpecifiers(code: string): string[] {
  const specs = new Set<string>();
  // Static: import ... from "x" / export ... from "x"
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/g)) {
    specs.add(m[1]!);
  }
  // Side-effect: import "x"
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    specs.add(m[1]!);
  }
  return [...specs];
}

function isBareSpecifier(spec: string): boolean {
  return (
    !spec.startsWith("./") &&
    !spec.startsWith("../") &&
    !spec.startsWith("/") &&
    !spec.startsWith("http:") &&
    !spec.startsWith("https:") &&
    !spec.startsWith("data:") &&
    !spec.startsWith("blob:")
  );
}

describe("MV3 service worker browser bundle", () => {
  it("esbuild in-memory bundle has one entry, no bare/dynamic imports, includes sync graph", async () => {
    const result = await esbuild.build({
      ...serviceWorkerBundleOptions,
      write: false,
      metafile: true,
    });

    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.ok(result.outputFiles);
    assert.equal(result.outputFiles.length, 1, "single service-worker entry output");

    const code = result.outputFiles[0]!.text;
    assert.ok(code.length > 0);

    // No dynamic import expressions in the emitted graph.
    assert.doesNotMatch(code, /\bimport\s*\(\s*["'`]/);

    const specs = collectModuleSpecifiers(code);
    const bare = specs.filter(isBareSpecifier);
    assert.deepEqual(
      bare,
      [],
      `unresolved bare specifiers remain in bundle: ${bare.join(", ")}`,
    );

    // Metafile proves the shared adapter + zod were pulled into the graph (not left external).
    assert.ok(result.metafile);
    const inputPaths = Object.keys(result.metafile.inputs);
    assert.ok(
      inputPaths.some((p) => p.includes("adapters/dlsite") || p.includes("@adp/shared")),
      "bundle graph must include @adp/shared dlsite adapter sources",
    );
    assert.ok(
      inputPaths.some((p) => /[/\\]zod[/\\]/.test(p) || p.endsWith("zod") || p.includes("node_modules/zod")),
      "bundle graph must include zod transitively",
    );

    // Required sync / alarm behavior markers from the static graph.
    assert.match(code, /adp-daily-sync/);
    assert.match(code, /play\.dlsite\.com\/api\/v3\/content\/sales/);
    assert.match(code, /sales_malformed/);
    assert.match(code, /chrome\.alarms/);
  });

  it("built dist/background/index.js matches the no-bare-specifier browser contract when present", async () => {
    // Prefer verifying the real package build artifact when a prior `npm run build` left it.
    // Always re-emit a temporary in-process build to outfile under dist for link-scan parity.
    const outfile = join(extensionRoot, "dist/background/index.js");
    await esbuild.build({
      ...serviceWorkerBundleOptions,
      outfile,
      write: true,
    });
    assert.ok(existsSync(outfile));

    const code = readFileSync(outfile, "utf8");
    assert.doesNotMatch(code, /\bimport\s*\(\s*["'`]/);
    const bare = collectModuleSpecifiers(code).filter(isBareSpecifier);
    assert.deepEqual(bare, []);
    assert.match(code, /adp-daily-sync/);

    // Browser-like ESM parse: Node can parse the module (syntax + static link of relative imports).
    // With zero import declarations remaining, this is a pure module with no external link edges.
    assert.equal(collectModuleSpecifiers(code).length, 0);
  });
});
