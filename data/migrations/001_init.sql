CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'building', 'ready', 'error')),
  theme JSONB NOT NULL DEFAULT '{
    "panelBg": "#faf9f5",
    "accent": "#d97757",
    "launcherBg": "#ffffff",
    "textColor": "#141413"
  }'::jsonb,
  icon_url TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'You are Kintzio, a human-centered digital navigation assistant.
Answer using ONLY the information in the provided CONTEXT.',
  welcome_message TEXT NOT NULL DEFAULT 'Ask me anything about the documents I was trained on.',
  suggested_questions JSONB NOT NULL DEFAULT '["What can you help me with?","Summarize the main points","How do I get started?"]'::jsonb,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  build_error TEXT,
  last_built_at TIMESTAMPTZ,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, slug),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'url', 'text', 'txt')),
  label TEXT NOT NULL,
  uri TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error', 'skipped')),
  byte_size INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, content_hash)
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_bot_id_idx ON chunks(bot_id);
CREATE INDEX IF NOT EXISTS chunks_source_id_idx ON chunks(source_id);

CREATE TABLE IF NOT EXISTS build_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('adaptive', 'full')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS build_jobs_bot_id_idx ON build_jobs(bot_id);
