import React from 'react';
import { DefaultAvatar } from '@kintzio/chat-widget';
import { useI18n } from '../lib/i18n.jsx';

function safeHex(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export default function ThemePreview({
  theme = {},
  botName = '',
  iconUrl,
  welcomeMessage = '',
}) {
  const { t } = useI18n();
  const panelBg = safeHex(theme.panelBg, '#faf9f5');
  const accent = safeHex(theme.accent, '#d97757');
  const launcherBg = safeHex(theme.launcherBg, '#ffffff');
  const textColor = safeHex(theme.textColor, '#141413');

  const displayName = botName?.trim() || t('editor.previewAssistant');
  const welcomeRaw = String(welcomeMessage || '').trim() || t('editor.previewWelcome');
  const welcome = welcomeRaw.length > 72 ? `${welcomeRaw.slice(0, 71)}…` : welcomeRaw;

  return (
    <div className="theme-preview" aria-hidden="true">
      <div className="theme-preview-caption">{t('editor.livePreview')}</div>
      <div className="theme-preview-stage">
        <div
          className="theme-preview-panel"
          style={{
            '--tp-panel': panelBg,
            '--tp-accent': accent,
            '--tp-text': textColor,
          }}
        >
          <div className="theme-preview-header">
            <div className="theme-preview-avatar">
              {iconUrl ? (
                <img src={iconUrl} alt="" />
              ) : (
                <DefaultAvatar size={22} accent={accent} />
              )}
            </div>
            <span className="theme-preview-name">{displayName}</span>
          </div>

          <div className="theme-preview-body">
            <p className="theme-preview-welcome">{welcome}</p>
            <div className="theme-preview-chips">
              <span className="theme-preview-chip">{t('editor.previewSampleQuestion')}</span>
            </div>
            <div className="theme-preview-user-bubble">{t('editor.previewUserBubble')}</div>
          </div>

          <div className="theme-preview-footer">
            <span className="theme-preview-input">{t('editor.previewInput')}</span>
            <span className="theme-preview-send">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </div>

        <div
          className="theme-preview-launcher"
          style={{
            '--tp-launcher': launcherBg,
            '--tp-accent': accent,
            '--tp-text': textColor,
          }}
        >
          <div className="theme-preview-launcher-avatar">
            {iconUrl ? (
              <img src={iconUrl} alt="" />
            ) : (
              <DefaultAvatar size={18} accent={accent} />
            )}
          </div>
          <span className="theme-preview-launcher-text">
            {t('editor.previewLauncherAsk', { name: displayName })}
          </span>
          <span className="theme-preview-launcher-send">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
