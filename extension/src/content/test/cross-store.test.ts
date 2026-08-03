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
  },
): void {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, ?, 'day', '{}', ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.title,
    opts.maker,
    opts.purchasedAt ?? null,
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
});
