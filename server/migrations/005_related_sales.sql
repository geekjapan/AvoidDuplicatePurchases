-- 005: related products edges + market offers (issue #47)
--
-- related_edge stores evidenced relations from an owned anchor listing to a
-- candidate product. market_offer holds unowned product/price snapshots and
-- never creates or implies ownership (listing rows are separate).

CREATE TABLE related_edge (
  anchor_source TEXT NOT NULL,
  anchor_cid TEXT NOT NULL,
  product_source TEXT NOT NULL,
  product_cid TEXT NOT NULL,
  relation_kind TEXT NOT NULL
    CHECK (relation_kind IN ('maker', 'author', 'series', 'store_related')),
  evidence_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (
    anchor_source,
    anchor_cid,
    product_source,
    product_cid,
    relation_kind
  )
);

CREATE INDEX related_edge_anchor
  ON related_edge (anchor_source, anchor_cid);

CREATE TABLE market_offer (
  source TEXT NOT NULL,
  cid TEXT NOT NULL,
  title TEXT NOT NULL,
  maker_name TEXT,
  series_id TEXT,
  image_url TEXT,
  product_url TEXT,
  availability TEXT NOT NULL
    CHECK (availability IN ('available', 'unavailable', 'unknown')),
  current_amount_minor INTEGER,
  current_currency TEXT,
  current_tax_status TEXT
    CHECK (
      current_tax_status IS NULL
      OR current_tax_status IN ('included', 'excluded', 'unknown')
    ),
  regular_amount_minor INTEGER,
  regular_currency TEXT,
  regular_tax_status TEXT
    CHECK (
      regular_tax_status IS NULL
      OR regular_tax_status IN ('included', 'excluded', 'unknown')
    ),
  discount_percent REAL,
  sale_ends_at TEXT,
  price_observed_at TEXT,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source, cid),
  CHECK (
    (current_amount_minor IS NULL AND current_currency IS NULL AND current_tax_status IS NULL)
    OR (
      current_amount_minor IS NOT NULL
      AND current_currency IS NOT NULL
      AND current_tax_status IS NOT NULL
    )
  ),
  CHECK (
    (regular_amount_minor IS NULL AND regular_currency IS NULL AND regular_tax_status IS NULL)
    OR (
      regular_amount_minor IS NOT NULL
      AND regular_currency IS NOT NULL
      AND regular_tax_status IS NOT NULL
    )
  ),
  CHECK (current_amount_minor IS NULL OR current_amount_minor >= 0),
  CHECK (regular_amount_minor IS NULL OR regular_amount_minor >= 0)
);
