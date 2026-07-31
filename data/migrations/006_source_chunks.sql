ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;

-- Allow indexing status while a build is processing this source
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_status_check;
ALTER TABLE sources
  ADD CONSTRAINT sources_status_check
  CHECK (status IN ('pending', 'indexing', 'ready', 'error', 'skipped'));
