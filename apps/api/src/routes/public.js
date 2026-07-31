import { pool, env } from '../config.js';
import { mapBot } from '../services/auth.js';
import { answerBotChat } from '../services/chatService.js';

const CHAT_WINDOW_MS = 60_000;
const CHAT_REQUEST_LIMIT = 20;
const chatRequests = new Map();

function consumeChatRequest(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const recent = (chatRequests.get(key) || []).filter(
    (timestamp) => now - timestamp < CHAT_WINDOW_MS
  );
  if (recent.length >= CHAT_REQUEST_LIMIT) {
    chatRequests.set(key, recent);
    return false;
  }
  recent.push(now);
  chatRequests.set(key, recent);
  return true;
}

export default async function publicRoutes(fastify) {
  fastify.get('/public/bots/:botId/config', async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [
      request.params.botId,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    const bot = mapBot(rows[0]);
    return {
      id: bot.id,
      name: bot.name,
      theme: bot.theme,
      iconUrl: bot.iconUrl,
      welcomeMessage: bot.welcomeMessage,
      suggestedQuestions: bot.suggestedQuestions,
      status: bot.status,
    };
  });

  fastify.post('/public/bots/:botId/chat', async (request, reply) => {
    if (!consumeChatRequest(request.ip)) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: 'rate_limited' });
    }
    if (
      !request.body ||
      typeof request.body !== 'object' ||
      typeof request.body.message !== 'string'
    ) {
      return reply.code(400).send({ error: 'invalid_message' });
    }
    try {
      const result = await answerBotChat(request.params.botId, request.body?.message, {
        history: request.body?.history || [],
        language: request.body?.language,
      });
      return result;
    } catch (err) {
      request.log.error({ err }, 'Public chat failed');
      return reply.code(err.statusCode || 500).send({
        error: 'chat_failed',
        message:
          err.statusCode === 404
            ? 'Bot not found'
            : 'The assistant could not answer right now',
      });
    }
  });

  fastify.get('/embed/:botId.js', async (request, reply) => {
    const botId = request.params.botId;
    const api = env.publicApiUrl;
    const script = `
(function(){
  var BOT_ID = ${JSON.stringify(botId)};
  var API = ${JSON.stringify(api)};
  if (window.__DF_EMBED_LOADED__ && window.__DF_EMBED_LOADED__[BOT_ID]) return;
  window.__DF_EMBED_LOADED__ = window.__DF_EMBED_LOADED__ || {};
  window.__DF_EMBED_LOADED__[BOT_ID] = true;

  var SEND_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function injectStyles() {
    if (document.getElementById('df-embed-styles')) return;
    var style = document.createElement('style');
    style.id = 'df-embed-styles';
    style.textContent = [
      '.df-launcher,.df-panel,.df-panel *{box-sizing:border-box}',
      '.df-launcher{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:10px;width:min(520px,calc(100vw - 2.5rem));min-height:44px;padding:5px 7px 5px 8px;margin:0;background:var(--df-launcher-bg,#fff);color:var(--df-text,#141413);border:1px solid rgba(20,20,19,.1);border-radius:999px;box-shadow:0 2px 12px rgba(20,20,19,.07),0 12px 36px rgba(20,20,19,.12);cursor:pointer;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.4;text-align:left;-webkit-appearance:none;appearance:none;transition:opacity .52s cubic-bezier(.16,1,.3,1),transform .58s cubic-bezier(.16,1,.3,1),box-shadow .35s ease}',
      '.df-launcher.df-launcher-hidden{opacity:0;transform:translateX(-50%) translateY(10px) scale(.985);pointer-events:none}',
      '.df-launcher.df-launcher-returning{animation:dfLauncherReturn .22s cubic-bezier(.22,1,.36,1) both}',
      '.df-launcher-avatar{flex-shrink:0;width:34px;height:34px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;line-height:0}',
      '.df-launcher-avatar img,.df-launcher-avatar svg{display:block;width:34px;height:34px}',
      '.df-launcher-avatar img{object-fit:cover;object-position:center 22%}',
      '.df-launcher-field{flex:1;min-width:0;padding:3px 0;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}',
      '.df-launcher-send{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:rgba(20,20,19,.07);color:rgba(20,20,19,.4);display:flex;align-items:center;justify-content:center;pointer-events:none}',
      '.df-launcher-send svg{display:block;width:16px;height:16px}',
      '.df-panel{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100000;width:min(520px,calc(100vw - 2.5rem));height:min(680px,calc(100svh - 4rem));background:var(--df-panel-bg,#faf9f5);color:var(--df-text,#141413);border-radius:22px;border:1px solid rgba(20,20,19,.06);box-shadow:0 4px 20px rgba(20,20,19,.08),0 24px 64px rgba(20,20,19,.16);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;flex-direction:column}',
      '.df-panel.df-panel-opening{animation:dfPanelOpen .9s cubic-bezier(.16,1,.3,1) both}',
      '.df-panel.df-panel-closing{animation:dfPanelClose .48s cubic-bezier(.22,1,.36,1) forwards;pointer-events:none}',
      '.df-header{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;min-height:48px}',
      '.df-header-title{display:flex;align-items:center;gap:10px;min-width:0}',
      '.df-header-title img,.df-header-title svg{width:32px;height:32px;border-radius:8px;display:block;flex-shrink:0}',
      '.df-header-title img{object-fit:cover;object-position:center 22%}',
      '.df-header-title strong{font-size:14px;font-weight:600;letter-spacing:-.02em;line-height:1}',
      '.df-close-btn{background:rgba(20,20,19,.06);border:0;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;color:rgba(20,20,19,.55);padding:0;margin:0;line-height:0}',
      '.df-close-btn svg{width:16px;height:16px;display:block}',
      '.df-log{flex:1;min-height:0;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}',
      '.df-idle{display:flex;flex-direction:column;gap:10px;animation:dfIdleIn .38s cubic-bezier(.16,1,.3,1) both}',
      '.df-welcome-row{display:flex;align-items:flex-start;gap:8px;animation:dfWelcomeIn .34s cubic-bezier(.16,1,.3,1) both}',
      '.df-welcome-avatar{flex-shrink:0;line-height:0}',
      '.df-welcome-avatar img,.df-welcome-avatar svg{width:26px;height:26px;border-radius:8px;display:block}',
      '.df-welcome-avatar img{object-fit:cover;object-position:center 22%}',
      '.df-bubble{max-width:85%;padding:10px 14px;border-radius:16px;white-space:pre-wrap;line-height:1.45;font-size:14px}',
      '.df-bubble-user{align-self:flex-end;border-radius:16px 16px 4px 16px;background:var(--df-accent,#d97757);color:#fff}',
      '.df-bubble-bot{align-self:flex-start;border-radius:16px 16px 16px 4px;background:#fff;color:var(--df-text,#141413);box-shadow:0 1px 4px rgba(20,20,19,.06)}',
      '.df-bubble-bot p{margin:0 0 8px;white-space:pre-wrap}',
      '.df-bubble-bot p:last-child{margin-bottom:0}',
      '.df-bubble-bot ul{margin:5px 0 8px;padding-left:19px;white-space:normal}',
      '.df-bubble-bot ul:last-child{margin-bottom:0}',
      '.df-bubble-bot li{margin:0 0 7px;padding-left:1px}',
      '.df-bubble-bot li:last-child{margin-bottom:0}',
      '.df-bubble-bot strong{font-weight:650;color:var(--df-text,#141413)}',
      '.df-bubble.df-typing::after{content:"";display:inline-block;width:2px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--df-accent,#d97757);animation:dfCursorBlink .9s steps(1) infinite}',
      '.df-loading{display:flex;align-items:center;gap:4px;width:max-content;padding:10px 13px;background:rgba(20,20,19,.06);box-shadow:none}',
      '.df-loading span{width:6px;height:6px;border-radius:50%;background:rgba(20,20,19,.35);animation:dfTypingBounce 1.2s ease-in-out infinite}',
      '.df-loading span:nth-child(2){animation-delay:.15s}',
      '.df-loading span:nth-child(3){animation-delay:.3s}',
      '.df-footer{padding:6px 16px 14px;flex-shrink:0}',
      '.df-input-bar{display:flex;align-items:center;gap:6px;min-height:44px;background:#fff;border:1px solid rgba(20,20,19,.1);border-radius:999px;padding:5px 6px 5px 15px;box-shadow:0 2px 14px rgba(20,20,19,.06)}',
      '.df-input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:14px;color:#141413;padding:4px 0;margin:0;line-height:1.4;outline:none}',
      '.df-input::placeholder{color:rgba(20,20,19,.38)}',
      '.df-send-btn{width:34px;height:34px;border:0;border-radius:50%;background:var(--df-accent,#d97757);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;margin:0;line-height:0;transition:filter .2s ease,transform .2s ease,opacity .2s ease}',
      '.df-send-btn.is-active{background:var(--df-accent,#d97757);color:#fff}',
      '.df-send-btn:hover:not(:disabled){filter:brightness(.82);transform:translateY(-1px)}',
      '.df-send-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.df-send-btn svg{display:block;width:16px;height:16px}',
      '.df-chips{display:flex;flex-direction:column;align-items:flex-start;gap:5px}',
      '.df-chips-below{padding-left:34px;animation:dfChipsIn .32s cubic-bezier(.16,1,.3,1) .12s both}',
      '.df-chip{border:0;border-radius:999px;padding:6px 13px;background:#141413;color:#faf9f5;font:inherit;font-size:12px;font-weight:500;line-height:1.25;cursor:pointer;text-align:left;max-width:100%;animation:dfChipIn .3s cubic-bezier(.16,1,.3,1) both}',
      '.df-booking{align-self:flex-start;width:min(88%,390px);margin:0 0 2px;padding:12px;background:#fff;border:1px solid rgba(20,20,19,.09);border-radius:16px;color:var(--df-text,#141413);animation:dfChipsIn .4s cubic-bezier(.16,1,.3,1) both}',
      '.df-booking-cta{width:100%;border:0;border-radius:12px;padding:10px 12px;background:var(--df-accent,#d97757);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:transform .18s ease,filter .18s ease}',
      '.df-booking-cta:hover{transform:translateY(-1px);filter:brightness(.96)}',
      '.df-booking-cta:focus-visible,.df-slot:focus-visible{outline:2px solid var(--df-text,#141413);outline-offset:2px}',
      '.df-booking-slots{display:none;grid-template-columns:1fr;gap:6px;margin-top:9px}',
      '.df-booking.is-open .df-booking-slots{display:grid;animation:dfChipsIn .28s cubic-bezier(.16,1,.3,1) both}',
      '.df-slot{display:flex;justify-content:space-between;gap:10px;width:100%;border:1px solid rgba(20,20,19,.1);border-radius:10px;padding:9px 10px;background:#faf9f5;color:var(--df-text,#141413);font:inherit;font-size:12px;cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,transform .18s ease}',
      '.df-slot:hover{border-color:var(--df-accent,#d97757);transform:translateY(-1px)}',
      '.df-slot.is-selected{border-color:var(--df-accent,#d97757);background:rgba(217,119,87,.1)}',
      '@keyframes dfIdleIn{from{opacity:0}to{opacity:1}}',
      '@keyframes dfWelcomeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfChipsIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfChipIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfTypingBounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}',
      '@keyframes dfCursorBlink{0%,45%{opacity:1}50%,100%{opacity:0}}',
      '@keyframes dfPanelOpen{from{opacity:0;transform:translateX(-50%) translateY(20px) scale(.97)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
      '@keyframes dfPanelClose{from{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}to{opacity:0;transform:translateX(-50%) translateY(16px) scale(.97)}}',
      '@keyframes dfLauncherReturn{from{opacity:.78;transform:translateX(-50%) translateY(8px) scale(.98)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
      '@media(max-width:640px){.df-launcher{bottom:12px;width:calc(100vw - 20px)}.df-panel{bottom:12px;width:calc(100vw - 20px);height:min(600px,80svh);border-radius:18px}.df-log{padding:9px 12px;gap:8px}.df-header{padding:10px 12px}.df-footer{padding:5px 12px 10px}.df-bubble{max-width:90%;font-size:13.5px}.df-booking{width:min(92%,390px)}}',
      '@media(max-width:380px){.df-panel{width:calc(100vw - 14px);height:min(560px,78svh)}.df-launcher{width:calc(100vw - 14px)}.df-bubble{max-width:94%;padding:9px 11px}}',
      '@media(max-height:700px) and (max-width:640px){.df-panel{height:min(520px,76svh)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function defaultAvatar(accent, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size || 34));
    svg.setAttribute('height', String(size || 34));
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('fill', 'none');
    svg.innerHTML = '<rect width="32" height="32" rx="8" fill="' + accent + '"/><circle cx="16" cy="14" r="7.5" fill="#fff5f0"/><circle cx="13" cy="13" r="1.35" fill="#141413"/><circle cx="19" cy="13" r="1.35" fill="#141413"/><path d="M12.5 16.5C14 18.2 18 18.2 19.5 16.5" stroke="#141413" stroke-width="1.2" stroke-linecap="round"/>';
    return svg;
  }

  function createAvatar(iconUrl, accent, size) {
    if (iconUrl) {
      var img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.width = size;
      img.height = size;
      return img;
    }
    return defaultAvatar(accent, size);
  }

  injectStyles();

  fetch(API + '/public/bots/' + BOT_ID + '/config')
    .then(function(r){ return r.json(); })
    .then(function(cfg){
      var theme = cfg.theme || {};
      var accent = theme.accent || '#d97757';
      var open = false;
      var isClosing = false;
      var pending = false;
      var messages = [];
      var hasUserSent = false;

      var launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.className = 'df-launcher';
      launcher.style.setProperty('--df-launcher-bg', theme.launcherBg || '#fff');
      launcher.style.setProperty('--df-text', theme.textColor || '#141413');
      launcher.style.setProperty('--df-accent', accent);

      var launcherAvatar = document.createElement('span');
      launcherAvatar.className = 'df-launcher-avatar';
      launcherAvatar.appendChild(createAvatar(cfg.iconUrl, accent, 34));

      var launcherField = document.createElement('span');
      launcherField.className = 'df-launcher-field';
      launcherField.textContent = 'Ask ' + (cfg.name || 'the bot') + '…';

      var launcherSend = document.createElement('span');
      launcherSend.className = 'df-launcher-send';
      launcherSend.innerHTML = SEND_ICON;

      launcher.appendChild(launcherAvatar);
      launcher.appendChild(launcherField);
      launcher.appendChild(launcherSend);

      var panel = document.createElement('div');
      panel.className = 'df-panel';
      panel.style.setProperty('--df-panel-bg', theme.panelBg || '#faf9f5');
      panel.style.setProperty('--df-text', theme.textColor || '#141413');
      panel.style.setProperty('--df-accent', accent);

      var header = document.createElement('div');
      header.className = 'df-header';
      var headerTitle = document.createElement('div');
      headerTitle.className = 'df-header-title';
      headerTitle.appendChild(createAvatar(cfg.iconUrl, accent, 32));
      var title = document.createElement('strong');
      title.textContent = cfg.name || 'Assistant';
      headerTitle.appendChild(title);
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'df-close-btn';
      closeBtn.setAttribute('aria-label', 'Minimize chat');
      closeBtn.innerHTML = CLOSE_ICON;
      header.appendChild(headerTitle);
      header.appendChild(closeBtn);

      var chips = document.createElement('div');
      chips.className = 'df-chips df-chips-below';
      var chipIndex = 0;
      (cfg.suggestedQuestions || [])
        .map(function(q) { return String(q || '').trim(); })
        .filter(Boolean)
        .slice(0, 4)
        .forEach(function(q) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'df-chip';
        chip.textContent = q;
        chip.style.animationDelay = (0.18 + chipIndex * 0.06) + 's';
        chipIndex += 1;
        chip.addEventListener('click', function() {
          input.value = q;
          input.focus();
        });
        chips.appendChild(chip);
      });

      var log = document.createElement('div');
      log.className = 'df-log';

      var idle = document.createElement('div');
      idle.className = 'df-idle';
      var welcomeText = String(cfg.welcomeMessage || '').trim();
      if (welcomeText) {
        var welcomeRow = document.createElement('div');
        welcomeRow.className = 'df-welcome-row';
        var welcomeAvatar = document.createElement('span');
        welcomeAvatar.className = 'df-welcome-avatar';
        welcomeAvatar.appendChild(createAvatar(cfg.iconUrl, accent, 26));
        var welcomeBubble = document.createElement('div');
        welcomeBubble.className = 'df-bubble df-bubble-bot';
        welcomeBubble.textContent = welcomeText;
        welcomeRow.appendChild(welcomeAvatar);
        welcomeRow.appendChild(welcomeBubble);
        idle.appendChild(welcomeRow);
      }
      if (chips.childNodes.length) idle.appendChild(chips);
      if (idle.childNodes.length) log.appendChild(idle);

      function setIdleVisible(show) {
        idle.style.display = show && idle.childNodes.length ? 'flex' : 'none';
      }
      setIdleVisible(false);

      var footer = document.createElement('div');
      footer.className = 'df-footer';
      var inputBar = document.createElement('div');
      inputBar.className = 'df-input-bar';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'df-input';
      input.placeholder = 'Ask anything...';
      var sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'df-send-btn';
      sendBtn.setAttribute('aria-label', 'Send');
      sendBtn.innerHTML = SEND_ICON;
      inputBar.appendChild(input);
      inputBar.appendChild(sendBtn);
      footer.appendChild(inputBar);

      panel.appendChild(header);
      panel.appendChild(log);
      panel.appendChild(footer);

      function syncSendBtn() {
        sendBtn.classList.toggle('is-active', !!(input.value || '').trim());
      }

      function openPanel() {
        if (open || isClosing) return;
        open = true;
        launcher.classList.add('df-launcher-hidden');
        panel.classList.remove('df-panel-closing');
        panel.style.display = 'flex';
        panel.classList.add('df-panel-opening');
        setTimeout(function() {
          panel.classList.remove('df-panel-opening');
        }, 900);
        setIdleVisible(!hasUserSent);
      }

      function closePanel() {
        if (!open || isClosing) return;
        isClosing = true;
        panel.classList.add('df-panel-closing');
        setTimeout(function() {
          panel.classList.remove('df-panel-closing');
          panel.style.display = 'none';
          open = false;
          isClosing = false;
          launcher.classList.remove('df-launcher-hidden');
          launcher.classList.add('df-launcher-returning');
          setTimeout(function() {
            launcher.classList.remove('df-launcher-returning');
          }, 240);
        }, 480);
      }

      function addMsg(role, text) {
        messages.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
        var bubble = document.createElement('div');
        bubble.className = 'df-bubble ' + (role === 'user' ? 'df-bubble-user' : 'df-bubble-bot');
        if (role === 'user') bubble.textContent = text;
        else renderFormattedText(bubble, text);
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
        if (role === 'user') {
          hasUserSent = true;
          setIdleVisible(false);
        }
      }

      function appendInlineFormatting(parent, text) {
        String(text || '').split(/(\\*\\*[^*]+\\*\\*)/g).filter(Boolean).forEach(function(part) {
          if (part.startsWith('**') && part.endsWith('**')) {
            var strong = document.createElement('strong');
            strong.textContent = part.slice(2, -2);
            parent.appendChild(strong);
          } else {
            parent.appendChild(document.createTextNode(part));
          }
        });
      }

      function renderFormattedText(container, text) {
        container.textContent = '';
        var lines = String(text || '').split(/\\r?\\n/);
        var list = null;
        lines.forEach(function(rawLine) {
          var line = rawLine.trim();
          if (!line) {
            list = null;
            return;
          }
          var bullet = line.match(/^(?:-|\\*)\\s+(.+)$/);
          if (bullet) {
            if (!list) {
              list = document.createElement('ul');
              container.appendChild(list);
            }
            var item = document.createElement('li');
            appendInlineFormatting(item, bullet[1]);
            list.appendChild(item);
            return;
          }
          list = null;
          var paragraph = document.createElement('p');
          appendInlineFormatting(paragraph, line.replace(/^#{1,4}\\s+/, ''));
          container.appendChild(paragraph);
        });
      }

      function addLoadingBubble() {
        var bubble = document.createElement('div');
        bubble.className = 'df-bubble df-bubble-bot df-loading';
        bubble.setAttribute('aria-label', 'Typing');
        bubble.innerHTML = '<span></span><span></span><span></span>';
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
        return bubble;
      }

      function addAnimatedBotMessage(text, onDone) {
        messages.push({ role: 'assistant', content: text });
        var bubble = document.createElement('div');
        bubble.className = 'df-bubble df-bubble-bot df-typing';
        log.appendChild(bubble);
        var plainText = String(text || '')
          .replace(/\\*\\*/g, '')
          .replace(/^\\s*(?:-|\\*)\\s+/gm, '• ');
        var shown = 0;
        function tick() {
          shown = Math.min(plainText.length, shown + 4);
          bubble.textContent = plainText.slice(0, shown);
          log.scrollTop = log.scrollHeight;
          if (shown < plainText.length) {
            setTimeout(tick, 6);
            return;
          }
          bubble.classList.remove('df-typing');
          renderFormattedText(bubble, text);
          log.scrollTop = log.scrollHeight;
          if (onDone) onDone();
        }
        setTimeout(tick, 80);
      }

      function usesGreek(text) {
        return /[\\u0370-\\u03ff]/.test(text) ||
          /(ti|poios|poia|poio|eisai|iesai|exeis|ipires|ypires|prosfer|voith|synergas|synant|rantev)/i.test(text);
      }

      function nextBusinessDates(count) {
        var dates = [];
        var cursor = new Date();
        cursor.setDate(cursor.getDate() + 1);
        while (dates.length < count) {
          var day = cursor.getDay();
          if (day !== 0 && day !== 6) dates.push(new Date(cursor));
          cursor.setDate(cursor.getDate() + 1);
        }
        return dates;
      }

      function addBookingCard(userText) {
        var greek = usesGreek(userText);
        var card = document.createElement('div');
        card.className = 'df-booking';

        var cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'df-booking-cta';
        cta.textContent = greek
          ? 'Ας προγραμματίσουμε μια συνάντηση'
          : 'Let’s schedule a meeting';

        var slots = document.createElement('div');
        slots.className = 'df-booking-slots';
        var dates = nextBusinessDates(3);
        var times = ['10:00', '13:30', '17:00'];
        var formatter = new Intl.DateTimeFormat(greek ? 'el-GR' : 'en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });

        dates.forEach(function(date, index) {
          var slot = document.createElement('button');
          slot.type = 'button';
          slot.className = 'df-slot';
          var dateText = document.createElement('span');
          dateText.textContent = formatter.format(date);
          var timeText = document.createElement('strong');
          timeText.textContent = times[index];
          slot.appendChild(dateText);
          slot.appendChild(timeText);
          slot.addEventListener('click', function() {
            slots.querySelectorAll('.df-slot').forEach(function(item) {
              item.classList.remove('is-selected');
            });
            slot.classList.add('is-selected');
          });
          slots.appendChild(slot);
        });

        cta.addEventListener('click', function() {
          card.classList.toggle('is-open');
          cta.setAttribute('aria-expanded', card.classList.contains('is-open') ? 'true' : 'false');
          log.scrollTop = log.scrollHeight;
        });
        cta.setAttribute('aria-expanded', 'false');
        card.appendChild(cta);
        card.appendChild(slots);
        log.appendChild(card);
        log.scrollTop = log.scrollHeight;
      }

      function send() {
        var text = (input.value || '').trim();
        if (!text || pending) return;
        pending = true;
        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;
        syncSendBtn();
        addMsg('user', text);
        var history = messages.slice(0, -1);
        var loadingBubble = addLoadingBubble();
        fetch(API + '/public/bots/' + BOT_ID + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history })
        }).then(function(r){
          if (!r.ok) throw new Error('Chat request failed');
          return r.json();
        }).then(function(data){
          loadingBubble.remove();
          var answer = data.answer || data.message || 'No answer';
          addAnimatedBotMessage(answer, function() {
            if (data.answer && data.offerMeeting === true) addBookingCard(text);
          });
        }).catch(function(){
          loadingBubble.remove();
          addMsg('bot', 'Something went wrong. Please try again.');
        }).finally(function(){
          pending = false;
          input.disabled = false;
          sendBtn.disabled = false;
          input.focus();
          syncSendBtn();
        });
      }

      launcher.addEventListener('click', openPanel);
      closeBtn.addEventListener('click', closePanel);
      sendBtn.addEventListener('click', send);
      input.addEventListener('input', syncSendBtn);
      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter') send();
      });

      document.body.appendChild(launcher);
      document.body.appendChild(panel);
      syncSendBtn();
      setTimeout(openPanel, 1000);
    });
})();
`;
    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  });
}
