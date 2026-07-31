ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS source_citations JSONB NOT NULL DEFAULT '{"showSources":true,"hideTypes":["key_facts"]}'::jsonb;

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS show_in_citations BOOLEAN NOT NULL DEFAULT true;
