ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS scrape_mode TEXT NOT NULL DEFAULT 'page';

CREATE TABLE IF NOT EXISTS bot_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, page_url)
);

CREATE INDEX IF NOT EXISTS bot_pages_source_id_idx ON bot_pages(source_id);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_url TEXT;
