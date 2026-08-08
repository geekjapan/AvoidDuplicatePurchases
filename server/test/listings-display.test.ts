import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { seedDlsiteFromSales } from "../src/services/import.js";
import { importListingBatch } from "../src/import/fanza/common.js";
import { parseDoujinMylibrariesPayload } from "@adp/shared/adapters/fanza_doujin";
import { parseBooksImportPayload } from "@adp/shared/adapters/fanza_books";
import { parseVideoGraphqlPayload } from "@adp/shared/adapters/fanza_video";
import { parseDlsoftLibraryPayload } from "@adp/shared/adapters/fanza_dlsoft";
import type { DatabaseSync } from "node:sqlite";
import { sanitizeProductUrl } from "../src/services/listing-display.js";
import "../src/routes/listings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_FIXTURES = join(__dirname, "../../shared/test/fixtures");
const SERVER_FIXTURES = join(__dirname, "fixtures");

type ApiListing = {
  source: string;
  cid: string;
  workId: number;
  imageUrl: string | null;
  imageProvenance: string | null;
  productUrl: string | null;
  productUrlProvenance: string | null;
  purchasedAt: string | null;
  purchasedAtPrecision: "second" | "day" | "unknown";
  purchasePrice: null;
  currentPrice: null;
};

function request(port: number, path: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    import("node:http").then(({ request: httpRequest }) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers: { Origin: `http://127.0.0.1:${port}` },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

function startServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let port = 0;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, { db, port });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

describe("library listing display metadata", () => {
  let db: DatabaseSync;
  let server: Server;
  let port: number;

  before(async () => {
    db = openDatabase(":memory:").sqlite;

    const sales = JSON.parse(readFileSync(join(SERVER_FIXTURES, "dlsite-sales.json"), "utf8"));
    const product = JSON.parse(
      readFileSync(join(SERVER_FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    );
    seedDlsiteFromSales(db, sales, { RJ000001: product });

    const doujin = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-doujin-page.json"), "utf8"),
    );
    importListingBatch(db, "fanza_doujin", parseDoujinMylibrariesPayload(doujin));

    const books = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-books-import.json"), "utf8"),
    );
    importListingBatch(db, "fanza_books", parseBooksImportPayload(books));

    const video = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-video-page.json"), "utf8"),
    );
    importListingBatch(db, "fanza_video", parseVideoGraphqlPayload(video));

    const dlsoft = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-dlsoft-page.json"), "utf8"),
    );
    importListingBatch(db, "fanza_dlsoft", parseDlsoftLibraryPayload(dlsoft));

    ({ server, port } = await startServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("accepts only HTTPS product URLs", () => {
    assert.equal(sanitizeProductUrl("https://store.example/item"), "https://store.example/item");
    assert.equal(sanitizeProductUrl("http://store.example/item"), null);
    assert.equal(sanitizeProductUrl("https://user:password@store.example/item"), null);
  });

  it("returns flat rows with source-safe nullable display metadata", async () => {
    const response = await request(port, "/api/listings?limit=500&offset=0");
    assert.equal(response.status, 200);
    const body = response.json as { listings: ApiListing[]; total: number };
    assert.equal(body.total, 7);
    assert.equal(body.listings.length, 7);

    const byCid = new Map(body.listings.map((listing) => [listing.cid, listing]));
    assert.deepEqual(
      {
        imageUrl: byCid.get("RJ000001")?.imageUrl,
        imageProvenance: byCid.get("RJ000001")?.imageProvenance,
        productUrl: byCid.get("RJ000001")?.productUrl,
        productUrlProvenance: byCid.get("RJ000001")?.productUrlProvenance,
        purchasedAt: byCid.get("RJ000001")?.purchasedAt,
        purchasedAtPrecision: byCid.get("RJ000001")?.purchasedAtPrecision,
        purchasePrice: byCid.get("RJ000001")?.purchasePrice,
        currentPrice: byCid.get("RJ000001")?.currentPrice,
      },
      {
        imageUrl: "https://img.dlsite.com/modpub/images2/work/doujin/example.jpg",
        imageProvenance: "store_product_metadata",
        productUrl:
          "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        productUrlProvenance: "verified_derived",
        purchasedAt: "2022-06-11T14:20:07.000000Z",
        purchasedAtPrecision: "second",
        purchasePrice: null,
        currentPrice: null,
      },
    );
    assert.equal(byCid.get("d_100001")?.imageProvenance, "store_library_metadata");
    assert.equal(byCid.get("d_100001")?.purchasedAt, "2026-07-24");
    assert.equal(byCid.get("d_100001")?.purchasedAtPrecision, "day");
    assert.equal(byCid.get("d_100001")?.productUrlProvenance, "verified_derived");
    assert.equal(
      byCid.get("b100xxxxx01001")?.productUrl,
      "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    );
    assert.equal(byCid.get("b100xxxxx01001")?.imageUrl, null);
    assert.equal(byCid.get("b100xxxxx01001")?.imageProvenance, null);
    assert.equal(byCid.get("b100xxxxx01001")?.purchasedAtPrecision, "second");
    assert.equal(
      byCid.get("abcd00123")?.productUrl,
      "https://video.dmm.co.jp/av/content/?id=abcd00123",
    );
    assert.equal(byCid.get("abcd00123")?.purchasedAt, null);
    assert.equal(byCid.get("abcd00123")?.purchasedAtPrecision, "unknown");
    assert.equal(byCid.get("brand_0001")?.imageProvenance, "store_library_metadata");
    assert.equal(byCid.get("brand_0001")?.imageUrl, "https://example.invalid/pkg.jpg");
    assert.equal(byCid.get("brand_0001")?.purchasedAt, null);
    assert.equal(byCid.get("brand_0001")?.productUrl, "https://dlsoft.dmm.co.jp/detail/brand_0001/");
    for (const listing of body.listings) {
      assert.ok("imageUrl" in listing);
      assert.ok("imageProvenance" in listing);
      assert.ok("productUrl" in listing);
      assert.ok("productUrlProvenance" in listing);
      assert.ok("purchasedAt" in listing);
      assert.ok("purchasedAtPrecision" in listing);
      assert.ok("purchasePrice" in listing);
      assert.ok("currentPrice" in listing);
      assert.equal(listing.purchasePrice, null);
      assert.equal(listing.currentPrice, null);
    }
  });

  it("does not guess a product URL when source evidence is incomplete", async () => {
    importListingBatch(db, "fanza_video", [
      {
        cid: "video_no_floor",
        title: "Video without floor",
        maker: null,
        seriesId: null,
        imageUrl: "javascript:alert(1)",
        purchasedAt: null,
        purchasedAtPrecision: "unknown",
        rawJson: JSON.stringify({ sale: { content: { id: "video_no_floor" } } }),
      },
    ]);

    const response = await request(port, "/api/listings?q=video_no_floor");
    assert.equal(response.status, 200);
    const body = response.json as { listings: ApiListing[]; total: number };
    assert.equal(body.total, 1);
    assert.equal(body.listings.length, 1);
    assert.equal(body.listings[0]!.imageUrl, null);
    assert.equal(body.listings[0]!.imageProvenance, null);
    assert.equal(body.listings[0]!.productUrl, null);
    assert.equal(body.listings[0]!.productUrlProvenance, null);
  });
});
