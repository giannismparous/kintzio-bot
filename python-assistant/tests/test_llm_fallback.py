"""The fallback ladder, tested without a key or a network.

This is the least-tested part of the app — every other test runs keyless, so the
model chain is never exercised. Two production bugs lived here undetected:

  1. A retired model (404) was treated as a transient failure, so ONE question
     made six calls across two passes — attempt numbers 1,2,3 then 101,102,103 —
     wasting ~9s before returning an error string that was rendered to the user.
  2. Per-attempt timeouts were bounded but their SUM was not: 3 models x 2 passes
     x 60s = a six-minute worst case. A clean-venv run on a network that could not
     reach Google took 14 minutes of hung sockets.

The google SDK is stubbed rather than mocked at the method level, so the ladder's
real control flow runs.
"""
from __future__ import annotations

import asyncio
import sys
import time
import types

import pytest


def _install_fake_sdk(monkeypatch, behaviour):
    """Stub google.generativeai; `behaviour(model_name)` raises or returns text."""
    calls: list[str] = []

    pkg = types.ModuleType("google"); pkg.__path__ = []
    gg = types.ModuleType("google.generativeai")
    apic = types.ModuleType("google.api_core")
    exc = types.ModuleType("google.api_core.exceptions")
    for n in ("ResourceExhausted", "ServiceUnavailable", "DeadlineExceeded",
              "InternalServerError", "GoogleAPIError", "NotFound",
              "InvalidArgument", "PermissionDenied", "TooManyRequests"):
        setattr(exc, n, type(n, (Exception,), {}))
    apic.exceptions = exc

    class _Model:
        def __init__(self, name, **kw): self.name = name
        def generate_content(self, prompt):
            calls.append(self.name)
            return behaviour(self.name)

    gg.configure = lambda **kw: None
    gg.GenerativeModel = _Model
    gt = types.ModuleType("google.generativeai.types")
    gt.HarmCategory = type("HC", (), {f"HARM_CATEGORY_{k}": i for i, k in enumerate(
        ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"])})
    gt.HarmBlockThreshold = type("HB", (), {"BLOCK_ONLY_HIGH": "BLOCK_ONLY_HIGH",
                                            "BLOCK_NONE": "BLOCK_NONE"})
    gg.types = gt
    for k, v in {"google": pkg, "google.generativeai": gg,
                 "google.generativeai.types": gt, "google.api_core": apic,
                 "google.api_core.exceptions": exc}.items():
        monkeypatch.setitem(sys.modules, k, v)
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-test")
    return calls, gg


def _fresh_manager(monkeypatch, behaviour):
    """Patch the module's own `genai` reference, rather than sys.modules.

    `llm_manager` does `import google.generativeai as genai` at module scope, so it
    holds its own reference. Installing a stub into sys.modules afterwards does
    nothing — the module keeps the object it already bound, and three tests
    silently ran against whichever stub was installed first. Deleting and
    re-importing the module was also unreliable: pytest's other test modules hold
    live references to the same module object.

    So: build the stub, then monkeypatch `LM.genai` directly. That is the
    reference the code under test actually calls.
    """
    calls, gg = _install_fake_sdk(monkeypatch, behaviour)
    from app.services import llm_manager as LM

    monkeypatch.setattr(LM, "genai", gg, raising=True)
    mgr = LM.UniversalLLMManager()
    return mgr, calls, LM


def _retired(name):
    raise Exception(
        f"404 This model models/{name} is no longer available to new users.")


def test_retired_model_is_tried_once_not_twice(monkeypatch):
    """A 404 is permanent: each model gets ONE attempt, and no panic pass."""
    mgr, calls, _ = _fresh_manager(monkeypatch, _retired)
    n_models = len(mgr.gemini_models)

    t0 = time.time()
    out = asyncio.run(mgr.generate_with_multi_fallback("q"))
    elapsed = time.time() - t0

    assert len(calls) == n_models, f"expected {n_models} attempts, got {calls}"
    assert len(set(calls)) == len(calls), f"a model was retried: {calls}"
    assert elapsed < 5, f"404s must fail fast; took {elapsed:.1f}s"


def test_all_models_dead_returns_empty_not_an_error_string(monkeypatch):
    """The visitor must never see a raw exception message.

    The old code returned "Σφάλμα: Αποτυχία σύνδεσης…" with HTTP 200, so the chat
    UI rendered it as if it were Kintzios answering.
    """
    mgr, _, _ = _fresh_manager(monkeypatch, _retired)
    out = asyncio.run(mgr.generate_with_multi_fallback("q"))
    assert out == "", f"expected empty string, got {out!r}"
    assert "Σφάλμα" not in out and "Error" not in out


def test_dead_models_are_remembered_across_requests(monkeypatch):
    """The second question must not repeat the same doomed network calls."""
    mgr, calls, _ = _fresh_manager(monkeypatch, _retired)
    asyncio.run(mgr.generate_with_multi_fallback("first"))
    first = len(calls)
    calls.clear()
    asyncio.run(mgr.generate_with_multi_fallback("second"))
    assert first > 0
    assert calls == [], f"dead models re-tried on the next request: {calls}"


def test_first_working_model_wins_and_short_circuits(monkeypatch):
    """A healthy primary must be used, and the fallbacks left alone."""
    class _OK:
        text = "μια απάντηση"

    mgr, calls, _ = _fresh_manager(monkeypatch, lambda name: _OK())
    out = asyncio.run(mgr.generate_with_multi_fallback("q"))
    assert out == "μια απάντηση"
    assert len(calls) == 1, f"should stop at the first success, got {calls}"
    assert calls[0] == mgr.gemini_models[0]


def test_fallback_reaches_the_second_model(monkeypatch):
    """A transient failure on the primary must fall through, not give up."""
    class _OK:
        text = "fallback answer"

    def behaviour(name):
        if name == "PRIMARY":
            raise Exception("500 internal error")
        return _OK()

    mgr, calls, _ = _fresh_manager(monkeypatch, behaviour)
    mgr.gemini_models = ["PRIMARY", "SECONDARY"]
    mgr._initialize_instances()
    out = asyncio.run(mgr.generate_with_multi_fallback("q"))
    assert out == "fallback answer"
    assert calls[:2] == ["PRIMARY", "SECONDARY"]


def test_total_budget_is_bounded(monkeypatch):
    """There must be a ceiling on the whole ladder, not just per attempt."""
    _, _, LM = _fresh_manager(monkeypatch, _retired)
    assert LM.TOTAL_BUDGET_S <= 60, (
        f"total budget {LM.TOTAL_BUDGET_S}s is too long for a public widget; "
        "a visitor is gone after ~10s"
    )


def test_model_chain_is_env_overridable(monkeypatch):
    """A model retirement must be a .env fix, not a code change."""
    monkeypatch.setenv("GEMINI_MODELS", "model-a, model-b")
    mgr, _, _ = _fresh_manager(monkeypatch, _retired)
    assert mgr.gemini_models == ["model-a", "model-b"]
