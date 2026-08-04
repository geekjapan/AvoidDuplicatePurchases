import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "../../../..");
const cartDir = join(__dirname, "..");

const CART_ENTRIES = ["dlsite-cart.ts", "doujin-cart.ts", "books-cart.ts"] as const;

describe("MV3 cart content script bundles", () => {
  it("bundles all three cart entrypoints as classic/IIFE without bare imports", async () => {
    const result = await esbuild.build({
      entryPoints: CART_ENTRIES.map((name) => join(cartDir, name)),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome109"],
      legalComments: "none",
      logLevel: "silent",
      absWorkingDir: extensionRoot,
      outdir: join(extensionRoot, "dist/content/cart"),
      write: false,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.outputFiles?.length, 3);
    for (const file of result.outputFiles ?? []) {
      assert.doesNotThrow(() => new Function(file.text));
    }
  });

  it("manifest cart content_scripts point at bundled js without type module", () => {
    const manifest = JSON.parse(
      readFileSync(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      content_scripts?: Array<{ matches?: string[]; js?: string[]; type?: string }>;
    };
    const cartScripts = (manifest.content_scripts ?? []).filter((entry) =>
      entry.js?.[0]?.includes("/cart/"),
    );
    assert.equal(cartScripts.length, 3);
    for (const entry of cartScripts) {
      assert.equal(entry.type, undefined);
      assert.ok(entry.js?.[0]?.startsWith("dist/content/cart/"));
      assert.ok(entry.matches?.[0]);
    }
  });

  it("writes browser-loadable dist cart entrypoints when build:content runs", () => {
    for (const name of ["dlsite-cart.js", "doujin-cart.js", "books-cart.js"]) {
      const outfile = join(extensionRoot, "dist/content/cart", name);
      assert.ok(existsSync(outfile), outfile);
      const code = readFileSync(outfile, "utf8");
      assert.doesNotThrow(() => new Function(code));
    }
  });
});
