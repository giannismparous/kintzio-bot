import React, { useEffect, useState } from 'react';
import ChatWindow from './ChatWindow.jsx';
import DefaultAvatar from './DefaultAvatar.jsx';
import TypewriterPlaceholder from './TypewriterPlaceholder.jsx';
import './ChatWindow.css';

export default function ChatbotBubble({
  botName = 'Assistant',
  theme = {},
  iconUrl,
  welcomeMessage = '',
  suggestedQuestions = [],
  onSend,
  launcherPhrases,
  autoOpenDelayMs = 0,
  resetSignal = 0,
  contentKey = 'default',
  inputPlaceholder,
  sourcesLabel = 'Sources',
  showSources = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!resetSignal) return;
    setMessages([]);
  }, [resetSignal]);

  useEffect(() => {
    if (!autoOpenDelayMs || autoOpenDelayMs <= 0) return undefined;
    const timer = setTimeout(() => setIsOpen(true), autoOpenDelayMs);
    return () => clearTimeout(timer);
  }, [autoOpenDelayMs]);

  const accent = theme.accent || '#d97757';
  const phrases =
    launcherPhrases?.length > 0
      ? launcherPhrases
      : suggestedQuestions?.length
        ? suggestedQuestions
        : [`Ask ${botName}…`];

  const themeStyle = {
    '--df-panel-bg': theme.panelBg || '#faf9f5',
    '--df-accent': accent,
    '--df-launcher-bg': theme.launcherBg || '#ffffff',
    '--df-text': theme.textColor || '#141413',
  };

  const closeChat = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 480);
  };

  return (
    <div className="df-widget-root" style={themeStyle}>
      {isOpen && (
        <ChatWindow
          key={contentKey}
          botName={botName}
          theme={theme}
          iconUrl={iconUrl}
          welcomeMessage={welcomeMessage}
          suggestedQuestions={suggestedQuestions}
          onSend={onSend}
          onClose={closeChat}
          isClosing={isClosing}
          messages={messages}
          setMessages={setMessages}
          inputPlaceholder={inputPlaceholder}
          sourcesLabel={sourcesLabel}
          showSources={showSources}
        />
      )}

      <button
        type="button"
        className={`chat-launcher-pill${isOpen && !isClosing ? ' launcher-hidden' : ''}${
          isClosing ? ' launcher-returning' : ''
        }`}
        onClick={() => setIsOpen(true)}
        aria-label={`Open ${botName}`}
        aria-hidden={isOpen && !isClosing}
        tabIndex={isOpen && !isClosing ? -1 : 0}
      >
        <span className="launcher-avatar">
          {iconUrl ? (
            <img src={iconUrl} alt="" width={34} height={34} />
          ) : (
            <DefaultAvatar size={34} accent={accent} />
          )}
        </span>
        <span className="launcher-field">
          <TypewriterPlaceholder phrases={phrases} />
        </span>
        <span className="launcher-send" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}
