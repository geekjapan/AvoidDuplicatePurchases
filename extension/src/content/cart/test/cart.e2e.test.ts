import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../../../../server/src/db.js";
import { lookupItems as serverLookupItems, recomputeMatchKeys } from "../../../../../server/src/services/lookup.js";
import { buildCartFixtureDocument } from "./build-cart-fixture.js";
import { ADP_CART_WARNING_CLASS } from "../warning.js";
import { parseDoujinCartRowsFromPayload } from "../parse-doujin.js";
import { runCartPage } from "../runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

/** Synthetic FANZA doujin cid used only in fixtures (not a measured product ID). */
const SYNTHETIC_FANZA_DOUJIN_CID = "d_900001";

function insertListing(
  db: DatabaseSync,
  opts: {
    source: string;
    cid: string;
    title: string;
    maker: string | null;
    purchasedAt?: string | null;
    rawJson?: string;
  },
): void {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, ?, 'day', ?, ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.title,
    opts.maker,
    opts.purchasedAt ?? null,
    opts.rawJson ?? "{}",
    new Date().toISOString(),
  );
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, id);
}

describe("e2e cart surfaces", () => {
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

  it("rechecks integrated FANZA doujin listing in cart context with redacted evidence", async () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const meta = doc.head.querySelector('meta[name="csrf-token"]');
    assert.equal(meta?.getAttribute("content"), "SYNTHETIC_CSRF_TOKEN");

    const rows = parseDoujinCartRowsFromPayload(doc as unknown as Document, {
      data: [
        {
          content_id: SYNTHETIC_FANZA_DOUJIN_CID,
          title: "サンプル同人作品",
          maker_name: "サークル名",
        },
      ],
    });
    assert.equal(rows.length, 1);

    const [lookup] = serverLookupItems(db, [
      {
        source: "fanza_doujin",
        cid: SYNTHETIC_FANZA_DOUJIN_CID,
        title: "サンプル同人作品",
        maker: "サークル名",
      },
    ]);
    assert.equal(lookup!.owned, false);
    assert.equal(lookup!.other[0]!.source, "dlsite");
    assert.equal(lookup!.other[0]!.cid, "RJ123456");

    const warned = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => rows,
      async (items) => serverLookupItems(db, items),
    );
    assert.equal(warned, 1);
    const warning = doc.body.querySelector(`.${ADP_CART_WARNING_CLASS}`);
    assert.ok(warning);
    assert.match(warning!.textContent ?? "", /他サイトで購入済み/);
    assert.ok(warning!.querySelector(".adp-cart-warning__delete"));
  });

  it("shows same-store owned warning on DLsite cart fixture", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      async () => {
        const { parseDlsiteCartRows } = await import("../parse-dlsite.js");
        return parseDlsiteCartRows(doc as unknown as Document);
      },
      async (items) => serverLookupItems(db, items),
    );
    assert.equal(warned, 1);
    const warning = doc.body.querySelector(`.${ADP_CART_WARNING_CLASS}`);
    assert.ok(warning);
    assert.match(warning!.textContent ?? "", /購入済み/);
  });
});
