import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { lookupItems as serverLookupItems } from "../../../../server/src/services/lookup.js";
import { openDatabase } from "../../../../server/src/db.js";
import { recomputeMatchKeys } from "../../../../server/src/services/lookup.js";
import type { DatabaseSync } from "node:sqlite";
import { handleLookup } from "../../background/messaging.js";
import { extractProductMeta } from "../meta.js";
import { runProductPageWithLookup } from "../product-runner.js";
import { parseFixtureDocument } from "./mock-document.js";
import { ADP_BANNER_ID } from "../banner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

/** Synthetic FANZA doujin cid (format-valid, not a measured product ID). */
const SYNTHETIC_FANZA_DOUJIN_CID = "d_900001";

function insertListing(
  db: DatabaseSync,
  opts: {
    source: string;
    cid: string;
    title: string;
    maker: string | null;
    purchasedAt?: string | null;
    seriesId?: string | null;
    rawJson?: string;
  },
): void {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?, 'day', ?, ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.title,
    opts.maker,
    opts.seriesId ?? null,
    opts.purchasedAt ?? null,
    opts.rawJson ?? "{}",
    new Date().toISOString(),
  );
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, id);
}

describe("cross-store lookup path", () => {
  let db: DatabaseSync;

  before(() => {
    db = openDatabase(":memory:").sqlite;
    insertListing(db, {
      source: "dlsite",
      cid: "RJ123456",
      title: "サンプル同人作品",
      maker: "サークル名",
      purchasedAt: "2023-12-30",
    });
  });

  after(() => {
    db.close();
  });

  it("reports DLsite ownership when FANZA doujin page matches exact title and maker", () => {
    const [result] = serverLookupItems(db, [
      {
        source: "fanza_doujin",
        cid: SYNTHETIC_FANZA_DOUJIN_CID,
        title: "サンプル同人作品",
        maker: "サークル名",
      },
    ]);
    assert.equal(result!.owned, false);
    assert.equal(result!.other.length, 1);
    assert.equal(result!.other[0]!.source, "dlsite");
    assert.equal(result!.other[0]!.cid, "RJ123456");
  });

  it("returns purchasedAt for same-store owned listings", () => {
    const [result] = serverLookupItems(db, [
      { source: "dlsite", cid: "RJ123456", title: "サンプル同人作品", maker: "サークル名" },
    ]);
    assert.equal(result!.owned, true);
    assert.equal(result!.purchasedAt, "2023-12-30");
  });

  it("does not report fuzzy candidate pairs as cross-store warnings", () => {
    const [result] = serverLookupItems(db, [
      {
        source: "fanza_doujin",
        cid: "d_999999",
        title: "別タイトル作品",
        maker: "サークル名",
      },
    ]);
    assert.equal(result!.other.length, 0);
  });

  it("renders a fuzzy same-circle candidate on a DLsite product page", async () => {
    const titleA = "類似タイトルA";
    const titleB = "類似タイトルB";
    const maker = "合成サークル";
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_410004",
      title: titleA,
      maker,
    });

    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8")
      .replaceAll("RJ123456", "RJ410004")
      .replaceAll("サンプル同人作品", titleB)
      .replaceAll("サークル名", maker);
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ410004.html",
    );
    const hit = await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async (items) => serverLookupItems(db, items),
    );

    assert.equal(hit?.other.length, 0);
    assert.equal(hit?.possible?.length, 1);
    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    assert.match(banner!.textContent ?? "", /同一作品の可能性あり/);
    assert.doesNotMatch(banner!.textContent ?? "", /他サイトで購入済み/);
  });

  it("exercises background handleLookup through the working lookup path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          results: serverLookupItems(db, [
            {
              source: "fanza_doujin",
              cid: SYNTHETIC_FANZA_DOUJIN_CID,
              title: "サンプル同人作品",
              maker: "サークル名",
            },
          ]),
        }),
      }) as Response;

    const reply = await handleLookup([
      {
        source: "fanza_doujin",
        cid: SYNTHETIC_FANZA_DOUJIN_CID,
        title: "サンプル同人作品",
        maker: "サークル名",
      },
    ]);
    globalThis.fetch = originalFetch;

    assert.equal(reply.ok, true);
    assert.equal(reply.results?.[0]?.other[0]?.source, "dlsite");
  });

  it("renders DLsite-backed cross-store banner on FANZA doujin fixture", async () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${SYNTHETIC_FANZA_DOUJIN_CID}/`,
    );
    const meta = extractProductMeta(
      "fanza_doujin",
      doc as unknown as Document,
    );
    assert.ok(meta);
    assert.equal(meta.cid, SYNTHETIC_FANZA_DOUJIN_CID);
    assert.equal(meta.title, "サンプル同人作品");
    assert.equal(meta.maker, "サークル名");

    const hit = await runProductPageWithLookup(
      "fanza_doujin",
      doc as unknown as Document,
      async (items) => serverLookupItems(db, items),
    );

    assert.equal(hit?.other[0]?.source, "dlsite");
    assert.ok(doc.getElementById(ADP_BANNER_ID));
  });

  it("renders same-store owned banner with purchase date from lookup contract", async () => {
    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async (items) => serverLookupItems(db, items),
    );
    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    assert.equal(banner!.textContent, "✓ 購入済み(2023-12-30)");
  });

  it("renders FANZA Video exact-match cross-store banner on DLsite fixture", async () => {
    const title = "動画クロスストア作品";
    const maker = "動画メーカー";
    insertListing(db, {
      source: "fanza_video",
      cid: "synthetic_av_900001",
      title,
      maker,
      rawJson: JSON.stringify({
        content: { id: "synthetic_av_900001", title: "動画AV", floor: "AV" },
      }),
    });

    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8")
      .replaceAll("RJ123456", "RJ900001")
      .replaceAll("サンプル同人作品", title)
      .replaceAll("サークル名", maker);
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ900001.html",
    );
    const hit = await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async (items) => serverLookupItems(db, items),
    );

    assert.equal(hit?.owned, false);
    assert.equal(hit?.other.length, 1);
    assert.equal(hit?.other[0]?.source, "fanza_video");
    assert.equal(hit?.other[0]?.url, "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001");

    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.equal(link!.href, "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001");
    assert.match(link!.textContent ?? "", /FANZA動画/);
    assert.match(link!.textContent ?? "", /動画クロスストア作品/);
  });

  it("renders FANZA PC-game exact-match cross-store banner on DLsite fixture", async () => {
    const title = "PCゲームクロスストア作品";
    const maker = "PCゲームメーカー";
    insertListing(db, {
      source: "fanza_dlsoft",
      cid: "synthetic_dlsoft_900001",
      title,
      maker,
    });

    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8")
      .replaceAll("RJ123456", "RJ900002")
      .replaceAll("サンプル同人作品", title)
      .replaceAll("サークル名", maker);
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ900002.html",
    );
    const hit = await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async (items) => serverLookupItems(db, items),
    );

    assert.equal(hit?.owned, false);
    assert.equal(hit?.other.length, 1);
    assert.equal(hit?.other[0]?.source, "fanza_dlsoft");
    assert.equal(hit?.other[0]?.url, "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/");

    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.equal(link!.href, "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/");
    assert.match(link!.textContent ?? "", /FANZA PCゲーム/);
    assert.match(link!.textContent ?? "", /PCゲームクロスストア作品/);
  });
});
