import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../../../../server/src/db.js";
import { importFanzaDoujinPayload } from "../../../../../server/src/import/fanza/doujin.js";
import {
  lookupItems as serverLookupItems,
  recomputeMatchKeys,
} from "../../../../../server/src/services/lookup.js";
import {
  CART_GATE_REFERENCE,
  FANZA_CART_RECHECK_CHECKPOINT,
} from "../../../cart-deleter/gate-reference.js";
import { buildCartFixtureDocument } from "./build-cart-fixture.js";
import { ADP_CART_WARNING_CLASS } from "../warning.js";
import { parseDoujinCartRowsFromPayload } from "../parse-doujin.js";
import { runCartPage } from "../runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

/** Synthetic FANZA doujin cid used only in fixtures (not a measured product ID). */
const SYNTHETIC_FANZA_DOUJIN_CID = FANZA_CART_RECHECK_CHECKPOINT.syntheticCid;

/**
 * Clearly synthetic/redacted FANZA mylibraries payload for the real import pipeline.
 * Shapes match shared Doujin schema; IDs are fixture-only.
 */
const SYNTHETIC_FANZA_DOUJIN_IMPORT_PAYLOAD = {
  error_code: 0 as const,
  data: {
    total: 1,
    hasNext: false,
    items: {
      "2024年01月15日": [
        {
          contentId: SYNTHETIC_FANZA_DOUJIN_CID,
          productId: SYNTHETIC_FANZA_DOUJIN_CID,
          title: "サンプル同人作品",
          makerName: "サークル名",
          genre: "CG",
          imageSrc: "https://example.invalid/redacted.jpg",
        },
      ],
    },
  },
};

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

  it("exposes referenceable redacted local checkpoint linked to T-FANZA and T-CART-HUMAN", () => {
    assert.equal(
      FANZA_CART_RECHECK_CHECKPOINT.fanzaCommit,
      "a31b7e3d97dc0f394d53aa608742e822931fb92a",
    );
    assert.equal(
      FANZA_CART_RECHECK_CHECKPOINT.cartHumanCommit,
      "24c4bbe166f02c1ab5679789d58ea2627809f965",
    );
    assert.equal(
      FANZA_CART_RECHECK_CHECKPOINT.cartHumanCommit,
      CART_GATE_REFERENCE.humanGateCommit,
    );
    assert.equal(FANZA_CART_RECHECK_CHECKPOINT.mode, "synthetic-local-import-pipeline");
    assert.equal(FANZA_CART_RECHECK_CHECKPOINT.syntheticCid, "d_900001");
  });

  it("rechecks FANZA listing via real import pipeline then cart warning mount (synthetic)", async () => {
    // Actual existing FANZA import pipeline (not a direct listing INSERT).
    const importResult = importFanzaDoujinPayload(db, SYNTHETIC_FANZA_DOUJIN_IMPORT_PAYLOAD);
    assert.ok(importResult.inserted + importResult.updated >= 1);
    assert.equal(importResult.itemCount, 1);

    const stored = db
      .prepare(
        "SELECT source, cid, title, maker_name FROM listing WHERE source = ? AND cid = ?",
      )
      .get("fanza_doujin", SYNTHETIC_FANZA_DOUJIN_CID) as
      | { source: string; cid: string; title: string; maker_name: string | null }
      | undefined;
    assert.ok(stored, "import pipeline must persist synthetic FANZA listing");
    assert.equal(stored!.cid, SYNTHETIC_FANZA_DOUJIN_CID);
    assert.equal(stored!.title, "サンプル同人作品");

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
    assert.notEqual(rows[0]!.host, doc.body);

    // Lookup the listing stored by the import pipeline from a FANZA cart row.
    const [lookup] = serverLookupItems(db, [
      {
        source: "fanza_doujin",
        cid: SYNTHETIC_FANZA_DOUJIN_CID,
        title: "サンプル同人作品",
        maker: "サークル名",
      },
    ]);
    assert.equal(lookup!.owned, true, "imported FANZA listing must be owned same-store");

    const warned = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => rows,
      async (items) => serverLookupItems(db, items),
    );
    assert.equal(warned, 1);
    const warning = rows[0]!.host.querySelector(`.${ADP_CART_WARNING_CLASS}`);
    assert.ok(warning, "warning must attach to exact product row host");
    assert.match(warning!.textContent ?? "", /購入済み/);
    assert.ok(warning!.querySelector(".adp-cart-warning__delete"));
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 1);
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
