import os
import time
import asyncio
import logging
import random
import json
from typing import List, Dict, Any, Optional

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from google.api_core import exceptions

logger = logging.getLogger(__name__)
# Bumped from 30s — long retrieval-augmented prompts on gemini-2.5-pro
# routinely take 40-50s. The router-level eval client has 120s tolerance,
# so leaving 60s of slack is safe.
DEFAULT_TIMEOUT = 60
# Ceiling on the ENTIRE fallback ladder (all models, both passes). See the note in
# generate_with_multi_fallback: per-attempt timeouts alone allow a ~6 minute wait.
TOTAL_BUDGET_S = float(os.environ.get("LLM_TOTAL_BUDGET_S", "45"))

# ---------------------------------------------------------------------------
# SAFETY SETTINGS — DELIBERATELY DIFFERENT FROM THE BPAN APP.
#
# The BPAN version of this file sets all four harm categories to BLOCK_NONE.
# That is defensible there and it is documented in its own comment: a
# patient-support app discussing cancer, disability and suicide risk keeps
# tripping Gemini's filters on PROHIBITED_CONTENT, and BPAN wraps the model in
# its own reviewed safety layer (crisis filtering, 1018 injection, a clinically
# reviewed decision tree).
#
# None of that transfers to a commercial thought-leadership assistant:
#   * The corpus is business content. Legitimate answers do not need the filters
#     off, so disabling them buys nothing.
#   * The audience is unscreened website traffic, not people who arrived at a
#     patient-support service.
#   * The reputational asymmetry is total: one screenshot of this bot saying
#     something abusive under his name is worse than every good answer it gives.
#
# So Kintzios uses Gemini's DEFAULTS and lets the platform filters run. Our own
# guardrails (services/guardrails.py) sit in front as an additional layer, not
# as a replacement for the model's.
#
# BLOCK_ONLY_HIGH is set explicitly rather than passing None so that the choice
# is visible in code review and cannot be mistaken for an oversight.
# ---------------------------------------------------------------------------
SAFETY_DEFAULT = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
}

# Name kept as an alias so the three call sites below read identically to the
# BPAN original — but it now points at the safe table. If you are diffing
# against BPAN and see SAFETY_OFF, that is this constant, and it is not "off".
SAFETY_OFF = SAFETY_DEFAULT

# temperature 0.2: this is a grounded-retrieval app, and a distinctive personal
# register is better served by faithful reproduction of his phrasing than by
# sampling variety.
GEN_CFG = {"temperature": 0.2, "top_p": 0.9}

class UniversalLLMManager:
    """Manages Google Gemini models with automatic key rotation and model fallback."""

    def __init__(self):
        self.gemini_keys = []
        
        # Priority list — cheap/fast first, fall back to bigger models.
        _env_models = os.environ.get("GEMINI_MODELS", "").strip()
        self.gemini_models = [m.strip() for m in _env_models.split(",") if m.strip()] or [
            # Priority order: cheapest capable model first, stronger one as
            # fallback. Overridable with GEMINI_MODELS (comma-separated) so a
            # model retirement is a config change, not a code change — the 2.5
            # family was shut down to new keys and this list 404'd on every
            # request until it was edited.
            #
            # Verified GA names as of Aug 2026. NOTE: there is no
            # "gemini-3.6-flash-lite" — the GA pair is 3.6-flash and
            # 3.5-flash-lite. Run `python manage.py models` to list what your own
            # key can actually see rather than trusting this comment.
            "gemini-3.5-flash-lite",   # fast + cheap: the default for Q&A here
            "gemini-3.6-flash",        # stronger fallback
            "gemini-3.1-flash-lite",   # older lite, still GA
        ]
        
        self.gemini_instances = {}
        self.failed_combos = {} # (key_idx, model) -> last_fail_time
        self._dead_models: set = set()   # models this key cannot use at all (404)
        self.cooldown_period = 60 # seconds
        
        self._load_keys()
        self._initialize_instances()
        
        if not self.gemini_keys:
            logger.error("CRITICAL: No Gemini API keys found!")
        else:
            logger.info(f"LLM Manager initialized with {len(self.gemini_keys)} keys and {len(self.gemini_models)} models.")

    def _load_keys(self):
        # Load keys from environment
        for i in range(1, 11):
            key_name = "GEMINI_API_KEY" if i == 1 else f"GEMINI_API_KEY_{i}"
            key = os.environ.get(key_name)
            if key and key.strip():
                val = key.strip()
                if val not in self.gemini_keys:
                    self.gemini_keys.append(val)
        
        # Fallback to .api_key file if env is empty
        if not self.gemini_keys and os.path.exists('.api_key'):
            try:
                with open('.api_key', 'r') as f:
                    key = f.read().strip()
                    if key: self.gemini_keys.append(key)
            except Exception:
                pass

    def _initialize_instances(self):
        """Pre-initialize models for each key to save time on calls."""
        for key_idx, key in enumerate(self.gemini_keys):
            for model_name in self.gemini_models:
                try:
                    # We don't call genai.configure() here globally, 
                    # we'll do it per call to ensure the right key is used.
                    self.gemini_instances[(key_idx, model_name)] = model_name
                except Exception as e:
                    logger.warning(f"Could not prepare combo {model_name} for key {key_idx}: {e}")

    def _get_ordered_combos(self) -> List[tuple]:
        """Returns all combos in strict priority order: Model 1 (all keys), then Model 2 (all keys)..."""
        now = time.time()
        ordered = []
        for model_name in self.gemini_models:
            for key_idx in range(len(self.gemini_keys)):
                combo = (key_idx, model_name)
                last_fail = self.failed_combos.get(combo, 0)
                if now - last_fail > self.cooldown_period:
                    ordered.append(combo)
        
        if not ordered:
            # Reset cooldowns if everything is blocked
            self.failed_combos.clear()
            for model_name in self.gemini_models:
                for key_idx in range(len(self.gemini_keys)):
                    ordered.append((key_idx, model_name))
        return ordered

    async def generate_with_multi_fallback(self, prompt: str, timeout: int = DEFAULT_TIMEOUT, max_retries: int = 12):
        """Tries different Gemini keys and models in strict priority order.

        Resilience strategy (after 5/84 eval failures on previous run):
          1. Walk through up to `max_retries` (key, model) combos in priority
             order, honouring per-combo cooldowns.
          2. If we run out of fresh combos AND nothing succeeded, do a final
             "panic" pass: clear all cooldowns and try every combo once more
             with a 2s sleep before each attempt. This handles the case
             where bursts of requests (e.g. an 84-question eval) saturate
             every combo simultaneously.

        A 404 ("no longer available") is PERMANENT and is exempt from all of the
        above: the model does not exist for this key and will not exist two
        seconds from now. BPAN's ladder treats every failure as transient, so when
        the 2.5 family was retired one question walked all three models, cleared
        the cooldowns, and walked them AGAIN with a 2s sleep before each — 6 dead
        calls and ~9 wasted seconds, ending in an error string shown to the
        visitor. Dead models are now remembered process-wide and skipped.
        """
        last_error = None
        combos = self._get_ordered_combos()

        # TOTAL deadline across all attempts, not per-attempt.
        #
        # BPAN's ladder bounds each call at `timeout` but never bounds the sum, so
        # the worst case is 3 models x 2 passes x 60s = SIX MINUTES before the
        # caller hears anything. That is not hypothetical: a clean-venv test run
        # from a network that couldn't reach Google took 14 minutes of hung
        # sockets. BPAN is an internal support tool where a slow answer beats no
        # answer; this is a public widget on his website, where a visitor is gone
        # after about ten seconds and a hung request looks like a broken site.
        #
        # 45s total, and each individual attempt gets whatever is left.
        deadline = time.time() + TOTAL_BUDGET_S

        def _remaining() -> float:
            return deadline - time.time()

        # Scoped to this MANAGER, not the class. The app builds one manager at
        # startup, so a dead model is still skipped for the life of the process —
        # but a class-level cache would mean one transient 404 during a Google
        # incident permanently disables a model until someone restarts the app,
        # and it silently leaks state between tests.
        dead: set = self._dead_models

        def _is_permanent(err) -> bool:
            msg = str(err)
            return "no longer available" in msg or ("404" in msg and "model" in msg.lower())

        combos = [(k, m) for (k, m) in combos if m not in dead]
        if not combos:
            logger.error(
                "Every configured Gemini model is unavailable to this key (%s). "
                "Set GEMINI_MODELS in .env to a current model id.", sorted(dead))
            return ""

        async def _try_combo(combo_idx: int, key_idx: int, model_name: str):
            api_key = self.gemini_keys[key_idx]
            logger.info(f"Gemini Call (Attempt {combo_idx+1}): model={model_name}, key_idx={key_idx}")

            def _sync_call():
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel(
                    model_name,
                    generation_config=GEN_CFG,
                    safety_settings=SAFETY_OFF,
                )
                return model.generate_content(prompt)

            loop = asyncio.get_event_loop()
            response = await asyncio.wait_for(
                loop.run_in_executor(None, _sync_call),
                timeout=max(1.0, min(timeout, _remaining())),
            )
            if response and response.text:
                return response.text
            raise ValueError("Empty response")

        # Pass 1: normal priority walk
        for attempt, (key_idx, model_name) in enumerate(combos[:max_retries]):
            if _remaining() <= 1:
                logger.error("LLM budget of %.0fs exhausted after %d attempt(s).",
                             TOTAL_BUDGET_S, attempt)
                return ""
            try:
                return await _try_combo(attempt, key_idx, model_name)
            except Exception as e:
                last_error = e
                if _is_permanent(e):
                    dead.add(model_name)
                    logger.error(
                        "Model %s is GONE for this key (permanent, not retried): %s",
                        model_name, str(e)[:120])
                    continue
                self.failed_combos[(key_idx, model_name)] = time.time()
                logger.warning(f"Gemini combo {model_name}/{key_idx} failed: {e}")
                # 429 means rate-limited — back off a bit before next combo
                if "429" in str(e) or "ResourceExhausted" in str(e):
                    await asyncio.sleep(2)

        # Pass 2 (panic): clear cooldowns and try every combo once more
        # The panic pass exists for rate-limit saturation, so it is pointless when
        # every failure was a 404. Skipping it here is what turns a ~9s dead-end
        # into a <1s one.
        live = [(k, m) for (k, m) in self._get_ordered_combos() if m not in dead]
        if not live:
            logger.error(
                "All configured models are unavailable to this key (%s). "
                "Set GEMINI_MODELS in .env — run `python manage.py models` to see "
                "what your key can actually use.", sorted(dead))
            return ""

        logger.warning("All initial combos failed — doing final cooldown-reset pass.")
        self.failed_combos.clear()
        for attempt, (key_idx, model_name) in enumerate(live):
            if _remaining() <= 3:   # 2s sleep + at least 1s of call
                logger.error("LLM budget exhausted during fallback pass.")
                return ""
            try:
                await asyncio.sleep(2)  # let upstream rate-limits cool down
                return await _try_combo(100 + attempt, key_idx, model_name)
            except Exception as e:
                last_error = e
                if _is_permanent(e):
                    dead.add(model_name)
                    continue
                self.failed_combos[(key_idx, model_name)] = time.time()
                logger.warning(f"Panic-pass combo {model_name}/{key_idx} also failed: {e}")

        logger.error(f"GIVING UP — last error: {last_error}")
        return f"Σφάλμα: Αποτυχία σύνδεσης με την υπηρεσία Gemini AI. ({type(last_error).__name__ if last_error else 'unknown'})"

    async def generate_json(self, prompt: str, schema: dict, timeout: int = DEFAULT_TIMEOUT, max_retries: int = 5) -> dict:
        """Native JSON generation using strict priority fallback."""
        last_error = None
        combos = self._get_ordered_combos()
        
        for attempt, (key_idx, model_name) in enumerate(combos[:max_retries]):
            api_key = self.gemini_keys[key_idx]
            try:
                def _sync_json_call():
                    genai.configure(api_key=api_key)
                    model = genai.GenerativeModel(
                        model_name,
                        generation_config={
                            "response_mime_type": "application/json",
                            "response_schema": schema,
                            "temperature": 0.2,
                        },
                        safety_settings=SAFETY_OFF,
                    )
                    return model.generate_content(prompt)

                loop = asyncio.get_event_loop()
                response = await asyncio.wait_for(
                    loop.run_in_executor(None, _sync_json_call),
                    timeout=timeout
                )
                
                if response and response.text:
                    return json.loads(response.text)
                raise ValueError("Empty JSON response")
                    
            except Exception as e:
                last_error = e
                self.failed_combos[(key_idx, model_name)] = time.time()
                logger.warning(f"JSON failed ({model_name}/{key_idx}): {e}")

        raise ValueError(f"generate_json failed: {last_error}")

    async def stream_with_multi_fallback(self, prompt: str, timeout: int = DEFAULT_TIMEOUT, max_retries: int = 5):
        """Streaming with strict priority fallback."""
        last_error = None
        combos = self._get_ordered_combos()
        
        for attempt, (key_idx, model_name) in enumerate(combos[:max_retries]):
            api_key = self.gemini_keys[key_idx]
            logger.info(f"Streaming Attempt {attempt+1}: model={model_name}, key_idx={key_idx}")
            
            loop = asyncio.get_event_loop()
            chunk_queue = asyncio.Queue()
            _DONE = object(); _FAILED = object()
            streaming_error = None

            def _gemini_stream():
                nonlocal streaming_error
                try:
                    genai.configure(api_key=api_key)
                    model = genai.GenerativeModel(
                        model_name,
                        generation_config=GEN_CFG,
                        safety_settings=SAFETY_OFF,
                    )
                    for chunk in model.generate_content(prompt, stream=True):
                        if chunk.text:
                            loop.call_soon_threadsafe(chunk_queue.put_nowait, chunk.text)
                    loop.call_soon_threadsafe(chunk_queue.put_nowait, _DONE)
                except Exception as exc:
                    # Log immediately so the actual reason shows up in stdout
                    # (otherwise it gets buried in the SSE error message).
                    logger.warning(
                        "Streaming combo %s/key#%d FAILED: %s: %s",
                        model_name, key_idx, type(exc).__name__, exc,
                    )
                    # FORENSICS: if this was a safety block, persist the full
                    # prompt that triggered it so the user can inspect WHICH
                    # chunk(s) caused the issue.
                    is_block = (
                        "PROHIBITED_CONTENT" in str(exc)
                        or "BlockedPromptException" in type(exc).__name__
                        or "block_reason" in str(exc)
                    )
                    if is_block:
                        try:
                            import os, time as _t
                            outdir = os.path.join(
                                os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "..", "embeddings", "_blocked_prompts",
                            )
                            os.makedirs(outdir, exist_ok=True)
                            fname = f"blocked_{int(_t.time())}_{model_name.replace('/', '_')}.txt"
                            fpath = os.path.join(outdir, fname)
                            with open(fpath, "w", encoding="utf-8") as f:
                                f.write(f"# BLOCKED by Gemini safety filter\n")
                                f.write(f"# Model: {model_name}\n")
                                f.write(f"# Exception: {exc}\n")
                                f.write(f"# Prompt length: {len(prompt)} chars\n")
                                f.write(f"# {'=' * 60}\n\n")
                                f.write(prompt)
                            logger.warning("📁 Blocked prompt saved to: %s", fpath)
                        except Exception as save_exc:
                            logger.warning("Could not persist blocked prompt: %s", save_exc)
                    streaming_error = exc
                    loop.call_soon_threadsafe(chunk_queue.put_nowait, _FAILED)

            loop.run_in_executor(None, _gemini_stream)

            success_so_far = False
            while True:
                try:
                    item = await asyncio.wait_for(chunk_queue.get(), timeout=timeout)
                    if item is _DONE: return
                    if item is _FAILED:
                        last_error = streaming_error
                        self.failed_combos[(key_idx, model_name)] = time.time()
                        break
                    yield item
                    success_so_far = True
                except asyncio.TimeoutError:
                    self.failed_combos[(key_idx, model_name)] = time.time()
                    break

            if success_so_far: return

        # If we get here, every attempt failed. Detect WHY.
        err_str = str(last_error) if last_error else ""
        is_blocked = (
            "PROHIBITED_CONTENT" in err_str
            or "BlockedPromptException" in type(last_error).__name__
            or "block_reason" in err_str
        )

        if is_blocked:
            # Re-skinned from BPAN, which routed blocked prompts to the Κάπα3
            # cancer-guidance phone lines and the 1018 crisis line. Those are the
            # wrong destinations here; and crisis handling is not this module's
            # job in the first place — services/guardrails.py intercepts distress
            # BEFORE any model call, so a block reaching this point is a filter
            # false positive on business content, not a person in crisis.
            logger.warning(
                "ALL %d attempts blocked by Gemini safety filters — returning the "
                "contact fallback.", attempt + 1,
            )
            from app.config import ORG_EMAIL
            yield (
                "Δεν μπορώ να απαντήσω αυτόματα σε αυτή τη συγκεκριμένη ερώτηση. "
                f'Στείλε το απευθείας στο <a href="mailto:{ORG_EMAIL}">{ORG_EMAIL}</a> '
                "και θα το δει άνθρωπος."
            )
            return

        yield (
            "Η υπηρεσία δεν απάντησε αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο."
        )
        logger.error("LLM generation failed after all fallbacks: %s", last_error)

    # ----------------------------------------------------------------------
    # Agentic loop
    # ----------------------------------------------------------------------
    async def generate_with_tools(
        self,
        prompt: str,
        tool_schemas: list,
        dispatch,
        *,
        max_steps: int = 4,
        timeout: int = DEFAULT_TIMEOUT,
        lang_directive: str = "",
    ):
        """Multi-step generation where the MODEL chooses which tools to call.

        Returns (text, trace) where `trace` is the list of
        {tool, args, result_summary} steps actually taken — the router threads
        it to the UI so a visitor can see the reasoning rather than a spinner.

        Resilience: this walks the SAME (key, model) ladder as
        generate_with_multi_fallback via _first_live_combo(), so a retired model
        is skipped here too. It does NOT re-run the panic pass — a tool loop
        that has already made two calls should fail fast rather than restart.

        Budget: `max_steps` caps tool calls, and the total-deadline logic still
        applies per underlying call. A model that loops calling search_corpus
        forever is a real failure mode, so the cap is hard, not advisory.
        """
        if genai is None or not self.gemini_keys:
            return "", []

        combo = self._first_live_combo()
        if combo is None:
            return "", []
        key_idx, model_name = combo
        genai.configure(api_key=self.gemini_keys[key_idx])

        tools = [{"function_declarations": tool_schemas}]
        model = genai.GenerativeModel(
            model_name,
            generation_config=GEN_CFG,
            safety_settings=SAFETY_DEFAULT,
            tools=tools,
        )
        chat = model.start_chat()
        trace: list[dict] = []
        loop = asyncio.get_event_loop()
        message = prompt

        for step in range(max_steps):
            try:
                resp = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda m=message: chat.send_message(m)),
                    timeout=timeout,
                )
            except Exception as e:
                logger.warning("Tool loop step %d failed: %s", step, e)
                if _is_permanent(e):
                    self._dead_models.add(model_name)
                return "", trace

            calls = []
            for cand in (resp.candidates or []):
                for part in (cand.content.parts or []):
                    fc = getattr(part, "function_call", None)
                    if fc and fc.name:
                        calls.append(fc)

            if not calls:
                text = ""
                try:
                    text = (resp.text or "").strip()
                except Exception:
                    pass
                return text, trace

            # Run every tool the model asked for this turn, then hand all the
            # results back at once. Sequential single-tool turns would cost an
            # extra round trip per tool for no benefit.
            replies = []
            for fc in calls:
                args = {k: v for k, v in (fc.args or {}).items()}
                payload, docs = dispatch(fc.name, args)
                trace.append({
                    "tool": fc.name,
                    "args": args,
                    "n_results": len(payload.get("passages", payload.get("pillars", []) or [])),
                })
                logger.info("Tool call: %s(%s)", fc.name, args)
                replies.append({"function_response": {"name": fc.name, "response": payload}})

            # Re-assert the response language AFTER the tool results.
            #
            # BPAN brackets the directive on both sides of the prompt because a
            # long retrieved-context block dilutes a single instruction at the
            # top. The tool loop breaks that: tool results are the LAST thing
            # the model sees before it writes, and they arrive as raw corpus
            # text. Measured on this index, a Greek question about Gen Z
            # retrieves 4 English chunks out of 6 — so without this the model
            # drifts into the corpus's language and a Greek visitor gets an
            # English answer. The directive has to be the final token, every
            # turn, not just at the start of the conversation.
            if lang_directive:
                replies.append({"text": lang_directive})
            message = replies

        logger.info("Tool loop hit max_steps=%d", max_steps)
        return "", trace

    def _first_live_combo(self):
        """First (key, model) pair not known to be dead. None if all are."""
        for key_idx, model_name in self._get_ordered_combos():
            if model_name not in self._dead_models:
                return key_idx, model_name
        return None
