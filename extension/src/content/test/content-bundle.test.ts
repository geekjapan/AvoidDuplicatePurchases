import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "../../..");
const contentDir = join(__dirname, "..");

const CONTENT_ENTRIES = [
  "dlsite.ts",
  "fanza-doujin.ts",
  "fanza-books.ts",
  "amazon-books.ts",
  "library.ts",
] as const;

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
    assert.equal(result.outputFiles.length, 5, "five content entry outputs");

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
    assert.equal(scripts.length, 5);
    for (const entry of scripts) {
      assert.equal(entry.type, undefined, "MV3 content_scripts must not set type: module");
      assert.ok(entry.js?.[0]?.startsWith("dist/content/"));
    }
  });

  it("models host_permissions as origin-level and keeps content_scripts path-limited", () => {
    const manifest = JSON.parse(
      readFileSync(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      host_permissions?: string[];
      content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
    };

    /** Chrome-like path match for https match patterns (path * wildcard only). */
    function chromeMatchPatternAccepts(pattern: string, href: string): boolean {
      const m = /^(\*|https|http|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
      if (!m) return false;
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return false;
      }
      const scheme = m[1]!;
      const host = m[2]!;
      const pathPat = m[3]!;
      if (scheme !== "*" && `${url.protocol.replace(":", "")}` !== scheme) return false;
      if (host === "*") {
        // any host
      } else if (host.startsWith("*.")) {
        const suffix = host.slice(1); // .example.com
        if (url.hostname !== host.slice(2) && !url.hostname.endsWith(suffix)) return false;
      } else if (url.hostname !== host) {
        return false;
      }
      // Path: * matches any characters; match is against pathname only.
      const escaped = pathPat
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(url.pathname);
    }

    /**
     * Chrome MV3 host_permissions are origin-level: the path component of a
     * host permission pattern is ignored (only scheme/host/port decide).
     * Claiming path-limited host permission protection would be false.
     */
    function hostPermissionAccepts(pattern: string, href: string): boolean {
      const m = /^(\*|https|http|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
      if (!m) return false;
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return false;
      }
      const scheme = m[1]!;
      const host = m[2]!;
      if (scheme !== "*" && `${url.protocol.replace(":", "")}` !== scheme) return false;
      if (host === "*") {
        return true;
      }
      if (host.startsWith("*.")) {
        const suffix = host.slice(1);
        return url.hostname === host.slice(2) || url.hostname.endsWith(suffix);
      }
      return url.hostname === host;
    }

    function anyPatternMatches(patterns: string[], href: string, accept: (p: string, h: string) => boolean): boolean {
      return patterns.some((p) => accept(p, href));
    }

    const hosts = manifest.host_permissions ?? [];
    const library = (manifest.content_scripts ?? []).find((entry) =>
      entry.js?.includes("dist/content/library.js"),
    );
    assert.ok(library, "library content script entry present");
    const matches = library.matches ?? [];

    // Origin-level host permissions: one pattern per provider origin, with an
    // explicit path wildcard. Path-limited patterns would be misleading
    // because Chrome ignores host-permission paths at runtime.
    const originPatterns = [
      "https://www.amazon.co.jp/*",
      "https://ebookjapan.yahoo.co.jp/*",
      "https://books.rakuten.co.jp/*",
    ];
    for (const pattern of originPatterns) {
      assert.ok(hosts.includes(pattern), `host_permissions must include ${pattern}`);
    }
    const pathLimited = [
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/*",
      "https://ebookjapan.yahoo.co.jp/bookshelf",
      "https://ebookjapan.yahoo.co.jp/bookshelf/",
      "https://books.rakuten.co.jp/e-book/kobo/library",
      "https://books.rakuten.co.jp/e-book/kobo/library/",
      "https://books.rakuten.co.jp/e-book/kobo/library/*",
    ];
    for (const pattern of pathLimited) {
      assert.ok(!hosts.includes(pattern), `host_permissions must not claim path-limited ${pattern}`);
    }

    // Content scripts keep the least-privilege path restriction: exact
    // library paths, with amazon/Kobo plus their descendants, never
    // origin-wide patterns. ebookjapan stays exact-path only: /bookshelf/*
    // subpaths are not claimed.
    for (const pattern of originPatterns) {
      assert.ok(!matches.includes(pattern), `library matches must not include ${pattern}`);
    }
    assert.deepEqual(
      matches.filter((m) => m.includes("ebookjapan") || m.includes("rakuten") || m.includes("amazon")),
      pathLimited,
    );

    // Exact path and (where observed) descendants only: unrelated prefix
    // paths must not inject.
    const accepted = [
      "https://ebookjapan.yahoo.co.jp/bookshelf",
      "https://ebookjapan.yahoo.co.jp/bookshelf/",
      "https://ebookjapan.yahoo.co.jp/bookshelf/?page=2",
      "https://books.rakuten.co.jp/e-book/kobo/library",
      "https://books.rakuten.co.jp/e-book/kobo/library/",
      "https://books.rakuten.co.jp/e-book/kobo/library/page/2",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/?pageNumber=2",
    ];
    const rejected = [
      "https://ebookjapan.yahoo.co.jp/bookshelf-extra",
      "https://ebookjapan.yahoo.co.jp/bookshelf-extra/all",
      // The canonical bookshelf is exact-path only: arbitrary subpaths are
      // not content-script match territory.
      "https://ebookjapan.yahoo.co.jp/bookshelf/all",
      "https://ebookjapan.yahoo.co.jp/bookshelf/all?page=2",
      "https://books.rakuten.co.jp/e-book/kobo/library-old",
      "https://books.rakuten.co.jp/e-book/kobo/library-old/page/1",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAllExtra",
      "https://ebookjapan.yahoo.co.jp/other",
    ];
    for (const href of accepted) {
      assert.ok(
        anyPatternMatches(matches, href, chromeMatchPatternAccepts),
        `library boundary must accept ${href}`,
      );
    }
    for (const href of rejected) {
      assert.ok(
        !anyPatternMatches(matches, href, chromeMatchPatternAccepts),
        `library boundary must reject unrelated path ${href}`,
      );
    }

    // Host permissions cover the whole origin (Chrome ignores the path), so
    // unrelated paths are covered by host_permissions but never by the
    // path-limited content script. This documents what Chrome actually
    // provides instead of claiming path-limited host permission protection.
    for (const href of [...accepted, ...rejected]) {
      if (!href.includes("127.0.0.1")) {
        assert.ok(
          anyPatternMatches(hosts, href, hostPermissionAccepts),
          `host boundary must cover origin path ${href}`,
        );
      }
    }
    for (const href of rejected) {
      assert.ok(
        !anyPatternMatches(matches, href, chromeMatchPatternAccepts),
        `content script must stay path-limited for ${href}`,
      );
    }
  });

  it("writes browser-loadable dist content entrypoints when build:content runs", async () => {
    await esbuild.build({
      ...contentBundleOptions,
      write: true,
    });
    for (const name of ["dlsite.js", "fanza-doujin.js", "fanza-books.js", "library.js"]) {
      const outfile = join(extensionRoot, "dist/content", name);
      assert.ok(existsSync(outfile), outfile);
      const code = readFileSync(outfile, "utf8");
      assert.equal(collectModuleSpecifiers(code).filter(isBareSpecifier).length, 0);
      assert.doesNotThrow(() => new Function(code));
    }
  });
});
