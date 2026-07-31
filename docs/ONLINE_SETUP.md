# Going online with Kintzio

This guide splits work into **what is already wired in the repo** vs **what you must do** in Supabase, Render, and Netlify.

**Local dev is unchanged.** With no extra env vars, you still get username login + PGlite + local files.

---

## Architecture (production)

| Piece | Service | Purpose |
|-------|---------|---------|
| Dashboard | **Netlify** | React app (`apps/web`) |
| API | **Render** | Fastify + builds + embed (`apps/api`) |
| Auth | **Supabase Auth** | Email/password accounts |
| Database | **Supabase Postgres** | Bots, chunks, pgvector |
| Files | **Supabase Storage** | PDFs, icons |
| LLM | **Gemini** | Embeddings + chat (your API key) |

---

## What the repo already does

- `AUTH_MODE=dev` (default) — current username login, unchanged
- `AUTH_MODE=supabase` — JWT login via Supabase; dev login route hidden
- `STORAGE_MODE=local` (default) — `data/uploads`
- `STORAGE_MODE=supabase` — uploads go to Supabase Storage bucket
- Migration `009_auth.sql` — links `users` to Supabase `auth.users`
- `render.yaml` — Render deploy blueprint for API
- `netlify.toml` — Netlify build for web
- `Dockerfile` — API image with Chromium for site scraping
- `npm run check:online` — validates env before deploy

---

## Part 1 — You do: Supabase (~15 min)

### 1. Create project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Pick a region close to your users
3. Save the **database password** somewhere safe

### 2. Enable pgvector

In Supabase → **SQL Editor**, run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Run app migrations

From your machine (once Supabase DB URL is in `.env`):

```bash
cd kintzio
# Temporarily set DATABASE_URL to Supabase connection string in .env
npm run db:migrate
```

Use the **Transaction pooler** URI (port **6543**) from  
**Project Settings → Database → Connection string → URI**.

### 4. Enable Auth (email)

1. **Authentication → Providers → Email** — enable Email
2. For early testing you can disable “Confirm email” under **Authentication → Settings**
3. For production, keep confirm email on

### 5. Create Storage bucket

1. **Storage → New bucket**
2. Name: `kintzio` (must match `SUPABASE_STORAGE_BUCKET`)
3. **Public bucket** — ON (so bot icons and embed assets get public URLs)

Optional policy later: make PDF objects private + signed URLs.

### 6. Copy API keys

**Project Settings → API**

| Key | Where it goes |
|-----|----------------|
| Project URL | `SUPABASE_URL`, `VITE_SUPABASE_URL` |
| `anon` `public` | `VITE_SUPABASE_ANON_KEY` (Netlify only) |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` (Render only — never in web) |

---

## Part 2 — You do: Render (API) (~10 min)

### 1. Connect repo

1. [render.com](https://render.com) → **New → Blueprint**
2. Connect [github.com/giannismparous/Kintzio](https://github.com/giannismparous/Kintzio)
3. Branch: `local-version-alpha` (or `main` after merge)
4. Render reads `render.yaml` at repo root

### 2. Set environment variables

In the Render service → **Environment**, paste from [`.env.online.example`](.env.online.example):

| Variable | Example |
|----------|---------|
| `GEMINI_API_KEY` | your key |
| `DATABASE_URL` | Supabase pooler URI |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role secret |
| `CORS_ORIGIN` | `https://your-app.netlify.app` (set after Netlify) |
| `PUBLIC_API_URL` | `https://kintzio-api.onrender.com` |

Leave `AUTH_MODE=supabase` and `STORAGE_MODE=supabase` from `render.yaml`.

### 3. Deploy

First deploy takes a few minutes (Docker + Chromium).  
Check: `https://YOUR-API.onrender.com/health` → `{ "ok": true, "authMode": "supabase" }`

---

## Part 3 — You do: Netlify (dashboard) (~10 min)

### 1. Connect repo

1. [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Same repo + branch
3. Netlify picks up `netlify.toml` automatically

### 2. Environment variables

**Site settings → Environment variables** (build-time for Vite):

| Variable | Value |
|----------|-------|
| `VITE_AUTH_MODE` | `supabase` |
| `VITE_API_URL` | your Render API URL |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

### 3. Deploy & fix CORS

1. Note your Netlify URL, e.g. `https://kintzio.netlify.app`
2. Go back to **Render** → set `CORS_ORIGIN` to that URL (no trailing slash)
3. Redeploy API if needed

### 4. Test login

1. Open Netlify URL → **Sign up** with email
2. Create a bot → upload PDF → build
3. Confirm files appear in Supabase Storage and chunks in DB

---

## Part 4 — Optional: custom domains

| Service | Domain |
|---------|--------|
| Netlify | `app.kintzio.com` |
| Render | `api.kintzio.com` |

Update `CORS_ORIGIN`, `PUBLIC_API_URL`, and `VITE_API_URL` to match.

---

## Env reference

| File | When |
|------|------|
| [`.env`](.env) | Local dev — keep `AUTH_MODE` unset or `dev` |
| [`.env.online.example`](.env.online.example) | Cheat sheet for hosting dashboards |
| [`.env.example`](.env.example) | Local defaults |

### Local (unchanged)

```bash
npm install
npm run dev
# username login at http://localhost:5173
```

### Validate before deploy

```bash
# Copy .env.online.example values into .env temporarily, or export them
npm run check:online
```

---

## Checklist

### You (manual)

- [ ] Supabase project created
- [ ] `CREATE EXTENSION vector` run
- [ ] `npm run db:migrate` against Supabase `DATABASE_URL`
- [ ] Email auth enabled in Supabase
- [ ] Storage bucket `kintzio` created (public)
- [ ] Render API deployed + `/health` OK
- [ ] Netlify web deployed
- [ ] `CORS_ORIGIN` matches Netlify URL
- [ ] Sign up / sign in works online
- [ ] Build + embed tested

### Already in repo

- [x] Supabase JWT auth on API (`AUTH_MODE=supabase`)
- [x] Supabase login UI on web (`VITE_AUTH_MODE=supabase`)
- [x] Supabase Storage adapter (`STORAGE_MODE=supabase`)
- [x] Auth migration `009_auth.sql`
- [x] Render + Netlify + Docker configs

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401` on all API calls | `VITE_AUTH_MODE=supabase` on Netlify; user signed in? |
| CORS error in browser | `CORS_ORIGIN` on Render = exact Netlify origin |
| Build fails on Render | Check logs; Gemini key set; DB URL uses pooler port 6543 |
| Upload fails | Bucket name `kintzio`; service role key on API |
| Site scrape fails | Render Docker image includes Chromium; cold start may be slow |
| Local dev broken | Remove `VITE_AUTH_MODE` / `AUTH_MODE` from `.env` or set to `dev` |

---

## What comes later (not in this setup)

- Background build worker (Redis/BullMQ) — builds still run in API process
- Embed rate limits + domain allowlist
- Private PDF storage with signed URLs
- Google OAuth (Supabase provider — enable in dashboard when ready)

When you are ready for any of these, we can add them without changing local dev.
