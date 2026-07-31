import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DefaultAvatar from './DefaultAvatar.jsx';
import './ChatWindow.css';

const msgEase = [0.16, 1, 0.3, 1];
const TYPE_MS = 6;
const CHARS_PER_TICK = 3;

function BotIcon({ iconUrl, accent, size }) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8 }}
      />
    );
  }
  return <DefaultAvatar size={size} accent={accent} />;
}

function MeetingScheduler({ language = 'el' }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const greek = language !== 'en';
  const slots = useMemo(() => {
    const dates = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() + 1);
    while (dates.length < 3) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const times = ['10:00', '13:30', '17:00'];
    const formatter = new Intl.DateTimeFormat(greek ? 'el-GR' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return dates.map((date, index) => ({
      id: `${date.toISOString()}-${times[index]}`,
      date: formatter.format(date),
      time: times[index],
    }));
  }, [greek]);

  return (
    <div className={`message-meeting${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="message-meeting-cta"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {greek ? 'Ας προγραμματίσουμε μια συνάντηση' : 'Let’s schedule a meeting'}
      </button>
      {open && (
        <div className="message-meeting-slots">
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className={`message-meeting-slot${selected === slot.id ? ' is-selected' : ''}`}
              onClick={() => setSelected(slot.id)}
            >
              <span>{slot.date}</span>
              <strong>{slot.time}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.botName
 * @param {object} props.theme
 * @param {string} [props.iconUrl]
 * @param {string} [props.welcomeMessage]
 * @param {string[]} [props.suggestedQuestions]
 * @param {(payload: { message: string, history: Array<{role:string,content:string}> }) => Promise<{ answer: string, sources?: any[] }>} props.onSend
 * @param {boolean} [props.inline]
 * @param {() => void} [props.onClose]
 * @param {boolean} [props.isClosing]
 * @param {Array} [props.messages]
 * @param {Function} [props.setMessages]
 * @param {string} [props.inputPlaceholder]
 */
export default function ChatWindow({
  botName = 'Assistant',
  theme = {},
  iconUrl,
  welcomeMessage = '',
  suggestedQuestions = [],
  onSend,
  inline = false,
  onClose,
  isClosing = false,
  messages: controlledMessages,
  setMessages: setControlledMessages,
  inputPlaceholder = 'Ask anything...',
  sourcesLabel = 'Sources',
  showSources = true,
}) {
  const [internalMessages, setInternalMessages] = useState([]);
  const messages = controlledMessages ?? internalMessages;
  const setMessages = setControlledMessages ?? setInternalMessages;

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef(null);
  const typewriterRef = useRef(null);

  const accent = theme.accent || '#d97757';
  const chips = useMemo(
    () =>
      (suggestedQuestions || [])
        .map((item) => (typeof item === 'string' ? item : item?.text))
        .map((text) => String(text || '').trim())
        .filter(Boolean)
        .map((text, i) => ({ id: i + 1, text })),
    [suggestedQuestions]
  );

  const hasConversation = messages.length > 0;
  const showSuggestionChips = showOptions && !isLoading && chips.length > 0 && !hasConversation;
  const isIdle = !hasConversation;
  const welcomeText = String(welcomeMessage || '').trim();

  const themeStyle = {
    '--df-panel-bg': theme.panelBg || '#faf9f5',
    '--df-accent': accent,
    '--df-launcher-bg': theme.launcherBg || '#ffffff',
    '--df-text': theme.textColor || '#141413',
    '--df-user-bubble': theme.textColor || '#141413',
  };

  useEffect(() => {
    return () => {
      if (typewriterRef.current?.timer) clearTimeout(typewriterRef.current.timer);
    };
  }, []);

  const stopTypewriter = () => {
    if (typewriterRef.current?.timer) {
      clearTimeout(typewriterRef.current.timer);
      typewriterRef.current.timer = null;
    }
  };

  const startTypewriter = (botId, initialTarget = '') => {
    stopTypewriter();
    const state = {
      botId,
      target: initialTarget,
      shown: 0,
      sources: [],
      done: false,
      timer: null,
    };
    typewriterRef.current = state;

    const patchBot = (patch) => {
      setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, ...patch } : m)));
    };

    const tick = () => {
      const tw = typewriterRef.current;
      if (!tw || tw.botId !== botId) return;
      if (tw.shown < tw.target.length) {
        tw.shown = Math.min(tw.target.length, tw.shown + CHARS_PER_TICK);
        patchBot({ text: tw.target.slice(0, tw.shown), isTyping: true, sources: [] });
        tw.timer = setTimeout(tick, TYPE_MS);
        return;
      }
      if (!tw.done) {
        tw.timer = setTimeout(tick, 28);
        return;
      }
      patchBot({
        text: tw.target,
        sources: tw.sources || [],
        isTyping: false,
      });
      tw.timer = null;
    };

    state.timer = setTimeout(tick, TYPE_MS);
  };

  const updateTypewriterTarget = (botId, target, { done = false, sources = [] } = {}) => {
    const tw = typewriterRef.current;
    if (!tw || tw.botId !== botId) return;
    tw.target = String(target || '');
    if (done) {
      tw.done = true;
      tw.sources = sources || [];
    }
  };

  const sendUserMessage = async (userText) => {
    if (!userText.trim() || isLoading) return;
    setShowOptions(false);
    const historyBeforeSend = messages.map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    const botId = Date.now() + 1;
    setMessages((prev) => [...prev, { id: Date.now(), text: userText.trim(), sender: 'user' }]);
    setIsLoading(true);

    try {
      const response = await onSend({
        message: userText.trim(),
        history: historyBeforeSend,
      });
      const finalAnswer = response?.answer || 'No answer returned.';
      setMessages((prev) => [
        ...prev,
        {
          id: botId,
          text: '',
          sender: 'bot',
          sources: [],
          isTyping: true,
          offerMeeting: Boolean(response?.offerMeeting),
          replyLanguage: response?.replyLanguage || 'el',
        },
      ]);
      startTypewriter(botId, finalAnswer);
      updateTypewriterTarget(botId, finalAnswer, {
        done: true,
        sources: response?.sources || [],
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: botId,
          text: 'Sorry, something went wrong. Please try again.',
          sender: 'bot',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userText = inputValue.trim();
    setInputValue('');
    await sendUserMessage(userText);
  };

  return (
    <div
      className={`df-widget-root${inline ? ' df-inline' : ''}`}
      style={themeStyle}
    >
      <div
        className={`chat-window${isIdle ? ' chat-window-idle' : ''}${isClosing ? ' chat-closing' : ''}`}
      >
        <header className="chat-header">
          <div className="chat-header-content">
            <div className="bot-avatar">
              <BotIcon iconUrl={iconUrl} accent={accent} size={32} />
            </div>
            <div className="bot-info">
              <h3>
                <em className="brand-kintzio">{botName}</em>
              </h3>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              className="close-chat-btn"
              onClick={onClose}
              aria-label="Minimize chat"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </header>

        <div className="chat-body" aria-live="polite">
          {isIdle && (welcomeText || showSuggestionChips) && (
            <motion.div
              className="chat-idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: msgEase }}
            >
              {welcomeText && (
                <motion.div
                  className="chat-row chat-row-bot"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.34, ease: msgEase }}
                >
                  <div className="chat-row-avatar" aria-hidden="true">
                    <BotIcon iconUrl={iconUrl} accent={accent} size={26} />
                  </div>
                  <div className="message-bubble bot-message">
                    <p className="message-text">{welcomeText}</p>
                  </div>
                </motion.div>
              )}

              <AnimatePresence>
                {showSuggestionChips && (
                  <motion.div
                    className="chat-suggestions chat-suggestions-below"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: 0.32,
                      delay: welcomeText ? 0.12 : 0,
                      ease: msgEase,
                    }}
                  >
                    {chips.map((question, i) => (
                      <motion.button
                        key={question.id}
                        type="button"
                        className="suggestion-chip"
                        onClick={() => {
                          setInputValue(question.text);
                          inputRef.current?.focus();
                        }}
                        disabled={isLoading}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: (welcomeText ? 0.18 : 0.08) + 0.06 * i,
                          ease: msgEase,
                        }}
                      >
                        {question.text}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {hasConversation && (
            <>
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    className={`chat-row chat-row-${message.sender}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.32, ease: msgEase }}
                  >
                    {message.sender === 'bot' && (
                      <div className="chat-row-avatar" aria-hidden="true">
                        <BotIcon iconUrl={iconUrl} accent={accent} size={26} />
                      </div>
                    )}
                    <div className={`message-bubble ${message.sender}-message`}>
                      <p className={`message-text${message.isTyping ? ' is-typing' : ''}`}>
                        {message.text}
                        {message.isTyping && (
                          <span className="typing-cursor" aria-hidden="true" />
                        )}
                      </p>
                      {showSources && !message.isTyping && (message.sources || []).length > 0 && (
                        <div className="message-sources">
                          <p className="sources-label">{sourcesLabel}</p>
                          <ul>
                            {message.sources.map((source, idx) => (
                              <li key={`${source.title}-${idx}`}>
                                {source.url ? (
                                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                                    {source.title}
                                  </a>
                                ) : (
                                  <span>{source.title}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!message.isTyping && message.offerMeeting && (
                        <MeetingScheduler language={message.replyLanguage} />
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && messages[messages.length - 1]?.sender !== 'bot' && (
                <div className="chat-row chat-row-bot">
                  <div className="chat-row-avatar" aria-hidden="true">
                    <BotIcon iconUrl={iconUrl} accent={accent} size={26} />
                  </div>
                  <div className="message-bubble bot-message loading">
                    <div className="typing-indicator" aria-label="Typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="chat-footer">
          <div
            className={`chat-input-bar${inputFocused ? ' is-focused' : ''}`}
            onClick={() => setShowOptions(true)}
            role="presentation"
          >
            <div className="chat-input-wrap">
              <input
                ref={inputRef}
                type="text"
                placeholder={inputPlaceholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => {
                  setInputFocused(true);
                  setShowOptions(true);
                }}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isLoading}
                className="chat-input"
                aria-label="Ask anything"
              />
            </div>
            <button
              type="button"
              className={`chat-send-btn${inputValue.trim() ? ' is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSendMessage();
              }}
              disabled={isLoading || !inputValue.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
