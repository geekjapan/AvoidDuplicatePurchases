import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "../../../..");
const contentDir = join(__dirname, "../..");

/** Existing three browser-loadable content IIFEs (same as package.json build:content). */
const CONTENT_ENTRIES = ["dlsite.ts", "fanza-doujin.ts", "fanza-books.ts"] as const;
const CONTENT_OUTPUTS = ["dlsite.js", "fanza-doujin.js", "fanza-books.js"] as const;

/**
 * Store-local cart boot markers retained by esbuild (no minify).
 * Proves each of the three IIFEs wired its own cart parser/boot, not a separate dist/cart contract.
 */
const CART_BOOT_MARKERS: Record<(typeof CONTENT_OUTPUTS)[number], string> = {
  "dlsite.js": "parseDlsiteCartRows",
  "fanza-doujin.js": "fetchDoujinCartRows",
  "fanza-books.js": "fetchBooksCartRows",
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

const contentBundleOptions: esbuild.BuildOptions = {
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

describe("MV3 cart behavior inside existing content IIFEs", () => {
  it("bundles three content entrypoints with guarded cart logic and no bare imports", async () => {
    const result = await esbuild.build({
      ...contentBundleOptions,
      write: false,
      metafile: true,
    });

    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.ok(result.outputFiles);
    assert.equal(result.outputFiles.length, 3, "three content entry outputs only");

    for (const file of result.outputFiles) {
      const base = file.path.split(/[/\\]/).pop() ?? file.path;
      const code = file.text;
      assert.ok(code.length > 0, file.path);
      assert.doesNotMatch(code, /\bimport\s*\(\s*["'`]/);
      const bare = collectModuleSpecifiers(code).filter(isBareSpecifier);
      assert.deepEqual(bare, [], `bare imports remain in ${file.path}: ${bare.join(", ")}`);
      assert.doesNotThrow(() => new Function(code));

      const marker = CART_BOOT_MARKERS[base as (typeof CONTENT_OUTPUTS)[number]];
      assert.ok(marker, `unexpected content output ${base}`);
      assert.ok(
        code.includes(marker),
        `${base} must embed store-local cart boot marker ${marker}`,
      );
      // Guarded cart path is live (not DCE'd): page guard + runner + warning UI.
      assert.ok(code.includes("isCartInterventionPage"), `${base} missing cart page guard`);
      assert.ok(code.includes("runCartPage"), `${base} missing runCartPage`);
      assert.ok(code.includes("adp-cart"), `${base} missing cart UI markers`);
    }
  });

  it("manifest keeps the library-sync content script alongside the store readers", () => {
    const manifest = JSON.parse(
      readFileSync(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      content_scripts?: Array<{ matches?: string[]; js?: string[]; type?: string }>;
    };
    const scripts = manifest.content_scripts ?? [];
    assert.equal(scripts.length, 5, "manifest must include the library-sync reader");
    for (const entry of scripts) {
      assert.equal(entry.type, undefined, "MV3 content_scripts must not set type: module");
      assert.ok(entry.js?.[0]?.startsWith("dist/content/"));
      assert.ok(!entry.js?.[0]?.includes("/cart/"), "no separate cart dist js in manifest");
      assert.ok(entry.matches?.[0]);
    }
    const jsPaths = scripts.map((e) => e.js?.[0]);
    assert.deepEqual(jsPaths, [
      "dist/content/dlsite.js",
      "dist/content/fanza-doujin.js",
      "dist/content/fanza-books.js",
      "dist/content/amazon-books.js",
      "dist/content/library.js",
    ]);
  });

  it("normal build:content IIFEs include cart boot; no separate dist/cart contract required", async () => {
    await esbuild.build({
      ...contentBundleOptions,
      write: true,
    });
    for (const name of CONTENT_OUTPUTS) {
      const outfile = join(extensionRoot, "dist/content", name);
      assert.ok(existsSync(outfile), outfile);
      const code = readFileSync(outfile, "utf8");
      assert.equal(collectModuleSpecifiers(code).filter(isBareSpecifier).length, 0);
      assert.ok(code.includes(CART_BOOT_MARKERS[name]), `${name} missing cart boot marker`);
      assert.doesNotThrow(() => new Function(code));
    }
  });
});
