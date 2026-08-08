CREATE TABLE amazon_observation (
  asin TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  acquired_label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('acquired_or_unknown', 'rental')),
  is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
  page_url TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
