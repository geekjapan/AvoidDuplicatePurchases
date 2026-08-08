import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "../../..");
const contentDir = join(__dirname, "..");

const CONTENT_ENTRIES = ["dlsite.ts", "fanza-doujin.ts", "fanza-books.ts"] as const;

/** Shared esbuild options for MV3 classic content-script artifacts (must match package.json build:content). */
export const contentBundleOptions: esbuild.BuildOptions = {
  entryPoints: CONTENT_ENTRIES.map((name) => join(contentDir, name)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome109"],
  legalComments: "none",
  logLevel: "silent",
  absWorkingDir: extensionRoot,
  outdir: join(extensionRoot, "dist/content"),
};

function collectModuleSpecifiers(code: string): string[] {
  const specs = new Set<string>();
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/g)) {
    specs.add(m[1]!);
  }
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

describe("MV3 content script browser bundles", () => {
  it("bundles all three entrypoints as classic/IIFE without bare imports", async () => {
    const result = await esbuild.build({
      ...contentBundleOptions,
      write: false,
      metafile: true,
    });

    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.ok(result.outputFiles);
    assert.equal(result.outputFiles.length, 3, "three content entry outputs");

    for (const file of result.outputFiles) {
      const code = file.text;
      assert.ok(code.length > 0, file.path);
      assert.doesNotMatch(code, /\bimport\s*\(\s*["'`]/);
      const bare = collectModuleSpecifiers(code).filter(isBareSpecifier);
      assert.deepEqual(bare, [], `bare imports remain in ${file.path}: ${bare.join(", ")}`);
      // Classic script smoke: syntax-check without executing page boot side effects.
      // IIFE wrapping still must parse as a Program.
      assert.doesNotThrow(() => new Function(code));
    }
  });

  it("manifest content_scripts omit type:module and point at bundled js", () => {
    const manifest = JSON.parse(
      readFileSync(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      content_scripts?: Array<{ js?: string[]; type?: string }>;
    };
    const scripts = manifest.content_scripts ?? [];
    assert.equal(scripts.length, 4);
    for (const entry of scripts) {
      assert.equal(entry.type, undefined, "MV3 content_scripts must not set type: module");
      assert.ok(entry.js?.[0]?.startsWith("dist/content/"));
    }
  });

  it("writes browser-loadable dist content entrypoints when build:content runs", async () => {
    await esbuild.build({
      ...contentBundleOptions,
      write: true,
    });
    for (const name of ["dlsite.js", "fanza-doujin.js", "fanza-books.js"]) {
      const outfile = join(extensionRoot, "dist/content", name);
      assert.ok(existsSync(outfile), outfile);
      const code = readFileSync(outfile, "utf8");
      assert.equal(collectModuleSpecifiers(code).filter(isBareSpecifier).length, 0);
      assert.doesNotThrow(() => new Function(code));
    }
  });
});
