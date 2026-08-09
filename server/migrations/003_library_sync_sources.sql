-- 003: library-sync sources (amazon, ebookjapan, kobo)
--
-- The typed DOM library-sync protocol (#43/#44/#46 foundation) upserts
-- observations for the three new sources. SQLite cannot alter a CHECK
-- constraint, so listing is rebuilt with the extended source list and its
-- data/indexes preserved. library_observation keeps every explicit
-- acquisition/access state (owned, unknown, non-owned) verbatim; the generic
-- layer never infers ownership, so it never writes listing rows itself.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE listing_new (
  id       INTEGER PRIMARY KEY,
  source   TEXT NOT NULL CHECK (source IN
             ('dlsite','fanza_doujin','fanza_books','fanza_video','fanza_dlsoft',
              'amazon','ebookjapan','kobo')),
  cid      TEXT NOT NULL,
  work_id  INTEGER NOT NULL REFERENCES work(id),
  work_id_locked INTEGER NOT NULL DEFAULT 0,

  title      TEXT NOT NULL,
  maker_name TEXT,
  series_id  TEXT,
  image_url  TEXT,

  purchased_at TEXT,
  purchased_at_precision TEXT NOT NULL DEFAULT 'unknown'
             CHECK (purchased_at_precision IN ('second','day','unknown')),

  raw_json    TEXT NOT NULL,
  imported_at TEXT NOT NULL,

  UNIQUE (source, cid)
);

INSERT INTO listing_new (
  id, source, cid, work_id, work_id_locked, title, maker_name, series_id,
  image_url, purchased_at, purchased_at_precision, raw_json, imported_at
)
SELECT id, source, cid, work_id, work_id_locked, title, maker_name, series_id,
       image_url, purchased_at, purchased_at_precision, raw_json, imported_at
FROM listing;

DROP TABLE listing;
ALTER TABLE listing_new RENAME TO listing;
CREATE INDEX listing_work ON listing(work_id);

-- Observation log for the DOM library-sync protocol. Rows are idempotent per
-- (source, cid); latest observation wins. `state` is reader-supplied DOM
-- evidence, never inferred from title or price.
CREATE TABLE library_observation (
  source     TEXT NOT NULL CHECK (source IN ('amazon','ebookjapan','kobo')),
  cid        TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN
               ('purchased','free','rental','sample','preview','subscription',
                'gift','reservation','unknown')),
  title      TEXT NOT NULL,
  maker_name TEXT,
  series_id  TEXT,
  image_url  TEXT,
  product_url TEXT,
  page_url   TEXT NOT NULL,
  raw_json   TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (source, cid)
);

COMMIT;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
