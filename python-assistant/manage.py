#!/usr/bin/env python
"""Single entrypoint for the dev tasks, so nothing depends on PYTHONPATH.

    python manage.py ingest [--stats]   rebuild / report the index
    python manage.py serve [--port N]   run the app
    python manage.py crawl              refresh corpus/site from kkintzios.com
    python manage.py models             list Gemini models THIS key can use

`python -m ingest` works too, but only when the app root is on sys.path —
which is not true under PYTHONSAFEPATH or when launched from elsewhere. This
wrapper puts src/ and the root on the path first and then dispatches.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
for p in (str(ROOT), str(ROOT / "src")):
    if p not in sys.path:
        sys.path.insert(0, p)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    rest = sys.argv[2:]

    if cmd == "ingest":
        from ingest.__main__ import build
        import json
        st = build(stats_only="--stats" in rest)
        print(json.dumps(st, ensure_ascii=False, indent=2))
        return 0 if st.get("chunks") else 1

    if cmd == "crawl":
        from ingest.crawl import main as crawl_main
        # `rest`, not sys.argv — crawl_main parses its own flags and would
        # otherwise see the subcommand name as an unrecognised argument.
        return crawl_main(rest)

    if cmd == "models":
        # Model ids are not stable — the 2.5 family was retired to new keys and
        # every request 404'd. Ask the API what this key can see instead of
        # trusting a hardcoded list or a blog post.
        import google.generativeai as genai
        from app.config import GEMINI_API_KEY
        if not GEMINI_API_KEY:
            print("No GEMINI_API_KEY set — nothing to list.")
            return 1
        genai.configure(api_key=GEMINI_API_KEY)
        rows = []
        for m in genai.list_models():
            if "generateContent" in getattr(m, "supported_generation_methods", []):
                rows.append(m.name.replace("models/", ""))
        for n in sorted(rows):
            print(n)
        print(f"\n{len(rows)} usable model(s). Put your choice in .env:")
        print("  GEMINI_MODELS=<first-choice>,<fallback>")
        return 0

    if cmd == "serve":
        import uvicorn
        from app.config import APP_PORT
        port = APP_PORT
        if "--port" in rest:
            port = int(rest[rest.index("--port") + 1])
        uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload="--reload" in rest)
        return 0

    print(__doc__)
    return 0 if cmd == "help" else 2


if __name__ == "__main__":
    raise SystemExit(main())
