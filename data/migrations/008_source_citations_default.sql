ALTER TABLE bots
  ALTER COLUMN source_citations SET DEFAULT '{"showSources":true,"hideTypes":["key_facts"]}'::jsonb;

UPDATE bots
SET source_citations = '{"showSources":true,"hideTypes":["key_facts"]}'::jsonb
WHERE source_citations = '{"showSources":true,"hideTypes":[]}'::jsonb;
