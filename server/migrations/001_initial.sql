CREATE TABLE work (
  id INTEGER PRIMARY KEY
);

CREATE TABLE listing (
  id       INTEGER PRIMARY KEY,
  source   TEXT NOT NULL CHECK (source IN
             ('dlsite','fanza_doujin','fanza_books','fanza_video','fanza_dlsoft')),
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
CREATE INDEX listing_work ON listing(work_id);

CREATE TABLE match_key (
  listing_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  PRIMARY KEY (listing_id, kind, key)
);
CREATE INDEX match_key_lookup ON match_key(kind, key);

CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,
  cursor TEXT,
  last_synced_at TEXT NOT NULL
);

CREATE TABLE candidate (
  id INTEGER PRIMARY KEY,
  listing_a_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  listing_b_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  dice REAL NOT NULL,
  UNIQUE (listing_a_id, listing_b_id)
);
