-- 004: visible-DOM three-tier price observations (issue #45)
--
-- Linked 1:1 to an owned listing. Normal product/library imports never touch
-- this table, so a later re-import preserves the last observation. Tiers are
-- independent optional Money values; all-null tiers are allowed. purchasePrice
-- is intentionally not stored here (observations are display prices, not paid).

CREATE TABLE price_observation (
  listing_id INTEGER PRIMARY KEY REFERENCES listing(id) ON DELETE CASCADE,

  regular_amount_minor INTEGER,
  regular_currency TEXT,
  regular_tax_status TEXT
    CHECK (regular_tax_status IS NULL OR regular_tax_status IN ('included','excluded','unknown')),

  sale_amount_minor INTEGER,
  sale_currency TEXT,
  sale_tax_status TEXT
    CHECK (sale_tax_status IS NULL OR sale_tax_status IN ('included','excluded','unknown')),

  coupon_amount_minor INTEGER,
  coupon_currency TEXT,
  coupon_tax_status TEXT
    CHECK (coupon_tax_status IS NULL OR coupon_tax_status IN ('included','excluded','unknown')),

  observed_at TEXT NOT NULL,
  page_url TEXT NOT NULL,

  CHECK (
    (regular_amount_minor IS NULL AND regular_currency IS NULL AND regular_tax_status IS NULL)
    OR (regular_amount_minor IS NOT NULL AND regular_currency IS NOT NULL AND regular_tax_status IS NOT NULL)
  ),
  CHECK (
    (sale_amount_minor IS NULL AND sale_currency IS NULL AND sale_tax_status IS NULL)
    OR (sale_amount_minor IS NOT NULL AND sale_currency IS NOT NULL AND sale_tax_status IS NOT NULL)
  ),
  CHECK (
    (coupon_amount_minor IS NULL AND coupon_currency IS NULL AND coupon_tax_status IS NULL)
    OR (coupon_amount_minor IS NOT NULL AND coupon_currency IS NOT NULL AND coupon_tax_status IS NOT NULL)
  ),
  CHECK (regular_amount_minor IS NULL OR regular_amount_minor >= 0),
  CHECK (sale_amount_minor IS NULL OR sale_amount_minor >= 0),
  CHECK (coupon_amount_minor IS NULL OR coupon_amount_minor >= 0)
);
