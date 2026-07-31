-- Widen source types (drop old check if present)
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('pdf', 'url', 'text', 'txt'));

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS persona_gender TEXT NOT NULL DEFAULT 'neutral';
