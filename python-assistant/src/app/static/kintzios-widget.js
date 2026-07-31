/*!
 * DialogosAI — Kintzios embeddable chat widget
 *
 * Re-skinned from chios-forum-app/src/app/static/chios-widget.js. Kept from that
 * file: the single-IIFE no-build structure, the `window.*_CONFIG` override
 * object, apiBase inference from the script tag's own src (so one file works on
 * any host), the `kzw-` CSS prefix guarding against the host page's styles,
 * bubble vs inline modes, the localStorage language memory, and the
 * relative-link fixup that rewrites `/foo` hrefs onto apiBase.
 *
 * Dropped from the Chios version: speech recognition (~90 lines) and the image
 * lightbox — no voice input in this product and the corpus has no images. Also
 * dropped its streaming reader; this backend returns one JSON payload, because
 * the answer must be quote-verified in full before any of it is shown (a
 * streamed fabricated quote cannot be retracted from the user's screen).
 *
 * Embed on kkintzios.com (bubble, bottom-right):
 *   <script src="https://YOUR-DEPLOY-URL/static/kintzios-widget.js" defer></script>
 *
 * Inline in a page section:
 *   <div id="kintzios-assistant"></div>
 *   <script>window.KINTZIOS_WIDGET_CONFIG = { mode: "inline", mount: "#kintzios-assistant" };</script>
 *   <script src="https://YOUR-DEPLOY-URL/static/kintzios-widget.js" defer></script>
 *
 * Config (window.KINTZIOS_WIDGET_CONFIG, all optional):
 *   apiBase  — backend origin; inferred from this script's src when omitted
 *   mode     — "bubble" (default) | "inline"
 *   mount    — CSS selector for inline mode
 *   lang     — "el" | "en"; otherwise remembered, else from navigator.language
 *   accent   — override the accent colour
 */
(function () {
  "use strict";
  if (window.__KINTZIOS_WIDGET_LOADED__) return;
  window.__KINTZIOS_WIDGET_LOADED__ = true;

  // ---------- config ----------
  function inferBase() {
    try {
      var s = document.currentScript ||
              document.querySelector('script[src*="kintzios-widget"]');
      if (s && s.src) return new URL(s.src).origin;
    } catch (e) {}
    return "";
  }
  var userCfg = window.KINTZIOS_WIDGET_CONFIG || {};
  var CFG = {
    apiBase: (userCfg.apiBase || inferBase()).replace(/\/$/, ""),
    mode: userCfg.mode === "inline" ? "inline" : "bubble",
    mount: userCfg.mount || null,
    accent: userCfg.accent || "#ff7d00",
  };

  var LANG_KEY = "kz_widget_lang";
  var SESSION_KEY = "kz_widget_session";

  var SESSION;
  try {
    SESSION = localStorage.getItem(SESSION_KEY);
    if (!SESSION) {
      SESSION = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID() : "s" + Date.now() + Math.random().toString(36).slice(2);
      localStorage.setItem(SESSION_KEY, SESSION);
    }
  } catch (e) { SESSION = "s" + Date.now(); }

  // ---------- i18n ----------
  var I18N = {
    el: {
      title: "Κίτσι",
      sub: "Ψηφιακός βοηθός του Κ. Κιντζιού",
      // AI Act Art. 50 — shown before the first exchange, not after it.
      disclose: "Μιλάς με το Κίτσι, ψηφιακό βοηθό (AI), όχι με τον Κωνσταντίνο.",
      welcome:
        "<p>Απαντώ <b>μόνο</b> από αυτά που έχει πει και γράψει ο Κωνσταντίνος — " +
        "και σου δείχνω πού.</p>" +
        "<p>Ηγεσία, ομάδες, εργασιακή κουλτούρα, Gen Z, καριέρα. Ή πες μου τι " +
        "πρόβλημα έχεις.</p>",
      chips: [
        "Πώς διοικώ μια ομάδα με Gen Z;",
        "Οι νέοι μας φεύγουν στον πρώτο χρόνο",
        "Θέλω keynote για το συνέδριό μας",
      ],
      placeholder: "Γράψε την ερώτησή σου…",
      send: "Στείλε",
      openLabel: "Άνοιγμα βοηθού",
      closeLabel: "Κλείσιμο",
      slow: "Το ψάχνω στο υλικό του…",
      err: "Κάτι πήγε λάθος. Δοκίμασε ξανά.",
      foot: "Δεν αντικαθιστά ιατρική, νομική ή οικονομική συμβουλή.",
    },
    en: {
      title: "Kitsi",
      sub: "Konstantinos Kintzios's assistant",
      disclose: "You're talking to Kitsi, a digital assistant (AI), not Konstantinos.",
      welcome:
        "<p>I answer <b>only</b> from what Konstantinos has said and written — " +
        "and I show you where.</p>" +
        "<p>Leadership, teams, workplace culture, Gen Z, careers. Or just tell me " +
        "your problem.</p>",
      chips: [
        "How do I manage a Gen Z team?",
        "Our graduates leave within a year",
        "I want a keynote for our conference",
      ],
      placeholder: "Type your question…",
      send: "Send",
      openLabel: "Open assistant",
      closeLabel: "Close",
      slow: "Looking through his material…",
      err: "Something went wrong. Please try again.",
      foot: "Does not replace medical, legal or financial advice.",
    },
  };

  var LANG = userCfg.lang;
  if (!I18N[LANG]) { try { LANG = localStorage.getItem(LANG_KEY); } catch (e) {} }
  if (!I18N[LANG]) {
    LANG = (navigator.language || "el").toLowerCase().indexOf("en") === 0 ? "en" : "el";
  }
  function T() { return I18N[LANG]; }

  // ---------- styles ----------
  var CSS = [
    ".kzw-root{--kz-accent:", CFG.accent, ";--kz-ink:#070f45;--kz-mute:#5b6470;",
    "--kz-line:#e4e7eb;--kz-card:#fff;--kz-bg:#fbfbfc;",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    "font-size:15px;line-height:1.55;color:var(--kz-ink);box-sizing:border-box;}",
    ".kzw-root *,.kzw-root *::before,.kzw-root *::after{box-sizing:inherit;}",

    // Launcher wears his orange, not the navy: it is a call to action sitting on
    // his own pages, and the orange is what his site already uses for those.
    ".kzw-launcher{position:fixed;right:1.5rem;bottom:1.5rem;z-index:2147483000;",
    "height:56px;padding:0 20px 0 8px;border-radius:999px;border:0;cursor:pointer;",
    "background:var(--kz-accent);color:#fff;font:600 15px/56px inherit;",
    "display:flex;align-items:center;gap:9px;",
    "box-shadow:0 6px 22px rgba(7,15,69,.28);}",
    ".kzw-launcher:hover{filter:brightness(.93);}",
    ".kzw-launcher img{width:40px;height:40px;border-radius:50%;display:block;}",
    ".kzw-avatar{width:34px;height:34px;border-radius:50%;display:block;flex:0 0 auto;}",
    ".kzw-launcher[hidden]{display:none;}",

    ".kzw-panel{position:fixed;right:1.5rem;bottom:1.5rem;z-index:2147483001;",
    "width:min(400px,calc(100vw - 2rem));height:min(620px,calc(100vh - 3rem));",
    "background:var(--kz-bg);border:1px solid var(--kz-line);border-radius:16px;",
    "box-shadow:0 18px 50px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden;}",
    ".kzw-inline .kzw-panel{position:static;width:100%;height:560px;right:auto;bottom:auto;",
    "box-shadow:none;}",
    ".kzw-panel[hidden]{display:none;}",

    ".kzw-head{background:var(--kz-card);border-bottom:1px solid var(--kz-line);",
    "gap:10px;",
    "padding:12px 14px;display:flex;align-items:center;gap:10px;flex:0 0 auto;}",
    ".kzw-title{font-weight:700;font-size:14.5px;letter-spacing:-.2px;}",
    ".kzw-sub{font-size:11.5px;color:var(--kz-mute);}",
    ".kzw-langs{margin-left:auto;display:flex;gap:4px;}",
    ".kzw-lang{border:1px solid var(--kz-line);background:#fff;border-radius:999px;",
    "padding:3px 9px;font:600 11px inherit;color:var(--kz-mute);cursor:pointer;}",
    ".kzw-lang.kzw-on{border-color:var(--kz-accent);color:var(--kz-accent);}",
    ".kzw-x{border:0;background:none;font-size:20px;line-height:1;color:var(--kz-mute);",
    "cursor:pointer;padding:0 2px;}",

    ".kzw-disclose{background:#fff8ec;border-bottom:1px solid #e8d5a8;color:#6b5628;",
    "font-size:11.5px;padding:7px 14px;text-align:center;flex:0 0 auto;}",

    ".kzw-msgs{flex:1 1 auto;overflow-y:auto;padding:14px;}",
    ".kzw-msg{margin:0 0 12px;padding:11px 13px;border-radius:13px;max-width:92%;",
    "font-size:14.5px;word-wrap:break-word;overflow-wrap:break-word;}",
    ".kzw-bot{background:var(--kz-card);border:1px solid var(--kz-line);}",
    ".kzw-user{background:var(--kz-ink);color:#fff;margin-left:auto;}",
    ".kzw-msg p{margin:.4em 0;}",
    ".kzw-msg ul,.kzw-msg ol{margin:.45em 0;padding-left:1.15em;}",
    ".kzw-msg ol{font-size:12.5px;color:var(--kz-mute);}",
    ".kzw-msg a{color:var(--kz-accent);}",
    ".kzw-msg sup a{text-decoration:none;font-weight:600;}",
    ".kzw-err{background:#fdeaea;border-color:#f0c9c9;}",

    ".kzw-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 12px;}",
    ".kzw-chip{border:1px solid var(--kz-line);background:#fff;border-radius:999px;",
    "padding:6px 12px;font:inherit;font-size:12.5px;color:var(--kz-mute);cursor:pointer;",
    "text-align:left;}",
    ".kzw-chip:hover{border-color:var(--kz-accent);color:var(--kz-accent);}",

    ".kzw-typing{display:flex;gap:4px;padding:11px 13px;}",
    ".kzw-typing span{width:6px;height:6px;border-radius:50%;background:var(--kz-mute);",
    "animation:kzw-b 1.2s infinite;}",
    ".kzw-typing span:nth-child(2){animation-delay:.15s;}",
    ".kzw-typing span:nth-child(3){animation-delay:.3s;}",
    "@keyframes kzw-b{0%,60%,100%{opacity:.25}30%{opacity:1}}",
    ".kzw-slow{font-size:12px;color:var(--kz-mute);padding:0 13px 8px;}",

    ".kzw-foot{flex:0 0 auto;border-top:1px solid var(--kz-line);background:var(--kz-card);",
    "padding:10px;}",
    ".kzw-row{display:flex;gap:7px;}",
    ".kzw-in{flex:1;padding:10px 12px;border:1px solid var(--kz-line);border-radius:9px;",
    "font:inherit;font-size:14px;outline:none;min-width:0;}",
    ".kzw-in:focus{border-color:var(--kz-accent);}",
    ".kzw-send{border:0;border-radius:9px;background:var(--kz-ink);color:#fff;",
    "padding:0 15px;font:600 13.5px inherit;cursor:pointer;}",
    ".kzw-send:disabled{opacity:.45;cursor:default;}",
    ".kzw-note{margin:7px 2px 0;font-size:10.5px;color:var(--kz-mute);text-align:center;}",
  ].join("");

  // ---------- dom helpers ----------
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  var root = el("div", "kzw-root" + (CFG.mode === "inline" ? " kzw-inline" : ""));

  var launcher = el("button", "kzw-launcher");
  launcher.type = "button";
  // Avatar is served from the app host, resolved off the same base as the API, so
  // it works when the widget is embedded on his WordPress site.
  var launcherImg = document.createElement("img");
  launcherImg.src = CFG.apiBase.replace(/\/$/, "") + "/static/kitsi-avatar.svg";
  launcherImg.alt = "";
  var launcherTxt = el("span");
  launcher.appendChild(launcherImg);
  launcher.appendChild(launcherTxt);

  var panel = el("div", "kzw-panel");
  var head = el("div", "kzw-head");
  var headAvatar = document.createElement("img");
  headAvatar.className = "kzw-avatar";
  headAvatar.src = CFG.apiBase.replace(/\/$/, "") + "/static/kitsi-avatar.svg";
  headAvatar.alt = "";
  var titleWrap = el("div");
  var titleEl = el("div", "kzw-title");
  var subEl = el("div", "kzw-sub");
  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(subEl);
  var langs = el("div", "kzw-langs");
  var btnEl = el("button", "kzw-lang", "ΕΛ");
  var btnEn = el("button", "kzw-lang", "EN");
  btnEl.type = btnEn.type = "button";
  langs.appendChild(btnEl);
  langs.appendChild(btnEn);
  var closeBtn = el("button", "kzw-x", "&times;");
  closeBtn.type = "button";
  head.appendChild(headAvatar);
  head.appendChild(titleWrap);
  head.appendChild(langs);
  if (CFG.mode !== "inline") head.appendChild(closeBtn);

  var discloseEl = el("div", "kzw-disclose");
  var msgs = el("div", "kzw-msgs");
  var foot = el("div", "kzw-foot");
  var row = el("div", "kzw-row");
  var input = el("input", "kzw-in");
  input.type = "text";
  input.autocomplete = "off";
  var sendBtn = el("button", "kzw-send");
  sendBtn.type = "button";
  row.appendChild(input);
  row.appendChild(sendBtn);
  var note = el("div", "kzw-note");
  foot.appendChild(row);
  foot.appendChild(note);

  panel.appendChild(head);
  panel.appendChild(discloseEl);
  panel.appendChild(msgs);
  panel.appendChild(foot);
  root.appendChild(panel);
  if (CFG.mode !== "inline") root.appendChild(launcher);

  function mount() {
    var host = null;
    if (CFG.mode === "inline" && CFG.mount) host = document.querySelector(CFG.mount);
    (host || document.body).appendChild(root);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else { mount(); }

  // ---------- rendering ----------
  function fixupLinks(node) {
    var as = node.querySelectorAll("a[href]");
    for (var i = 0; i < as.length; i++) {
      var h = as[i].getAttribute("href");
      // Backend-rendered citations use root-relative or #src-N anchors; only the
      // former needs rebasing onto the API origin when embedded cross-origin.
      if (h && h.charAt(0) === "/") as[i].href = CFG.apiBase + h;
      if (h && h.charAt(0) !== "#") {
        as[i].target = "_blank";
        as[i].rel = "noopener noreferrer";
      }
    }
  }
  function addUser(text) {
    msgs.appendChild(el("div", "kzw-msg kzw-user", esc(text)));
    msgs.scrollTop = msgs.scrollHeight;
  }
  function addBot(html, isErr) {
    var m = el("div", "kzw-msg kzw-bot" + (isErr ? " kzw-err" : ""), html);
    fixupLinks(m);
    msgs.appendChild(m);
    msgs.scrollTop = Math.max(0, m.offsetTop - 8);
    return m;
  }
  function addChips(list) {
    var w = el("div", "kzw-chips");
    list.forEach(function (c) {
      var b = el("button", "kzw-chip", esc(c));
      b.type = "button";
      b.onclick = function () { input.value = c; send(); };
      w.appendChild(b);
    });
    msgs.appendChild(w);
  }

  var typingEl = null, slowEl = null, slowTimer = null;
  function showTyping() {
    typingEl = el("div", "kzw-typing", "<span></span><span></span><span></span>");
    msgs.appendChild(typingEl);
    msgs.scrollTop = msgs.scrollHeight;
    slowTimer = setTimeout(function () {
      slowEl = el("div", "kzw-slow", esc(T().slow));
      msgs.appendChild(slowEl);
      msgs.scrollTop = msgs.scrollHeight;
    }, 6000);
  }
  function hideTyping() {
    clearTimeout(slowTimer);
    if (typingEl) typingEl.remove();
    if (slowEl) slowEl.remove();
    typingEl = slowEl = null;
  }

  // ---------- language ----------
  function applyLang() {
    var t = T();
    titleEl.textContent = t.title;
    subEl.textContent = t.sub;
    discloseEl.textContent = t.disclose;
    input.placeholder = t.placeholder;
    sendBtn.textContent = t.send;
    note.textContent = t.foot;
    launcherTxt.textContent = t.openLabel;
    launcher.setAttribute("aria-label", t.openLabel);
    closeBtn.setAttribute("aria-label", t.closeLabel);
    btnEl.className = "kzw-lang" + (LANG === "el" ? " kzw-on" : "");
    btnEn.className = "kzw-lang" + (LANG === "en" ? " kzw-on" : "");
    msgs.innerHTML = "";
    addBot(t.welcome);
    addChips(t.chips);
  }
  function setLang(l) {
    if (!I18N[l] || l === LANG) return;
    LANG = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    applyLang();
  }
  btnEl.onclick = function () { setLang("el"); };
  btnEn.onclick = function () { setLang("en"); };

  // ---------- send ----------
  var busy = false;
  function send() {
    var q = input.value.trim();
    if (!q || busy) return;
    input.value = "";
    var chips = msgs.querySelectorAll(".kzw-chips");
    for (var i = 0; i < chips.length; i++) chips[i].remove();
    addUser(q);
    busy = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(CFG.apiBase + "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, session_id: SESSION, lang: LANG }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        addBot(d && d.answer ? d.answer : esc(T().err), !(d && d.answer));
      })
      .catch(function () {
        hideTyping();
        addBot(esc(T().err), true);
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }
  sendBtn.onclick = send;
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

  // ---------- open / close ----------
  function open() {
    panel.hidden = false;
    launcher.hidden = true;
    setTimeout(function () { input.focus(); }, 40);
  }
  function close() {
    panel.hidden = true;
    launcher.hidden = false;
  }
  launcher.onclick = open;
  closeBtn.onclick = close;
  if (CFG.mode === "inline") { panel.hidden = false; }
  else { panel.hidden = true; launcher.hidden = false; }

  applyLang();

  // Small public surface, so his web team can wire a "Ask the assistant" button.
  window.KintziosWidget = { open: open, close: close, setLang: setLang };
})();
