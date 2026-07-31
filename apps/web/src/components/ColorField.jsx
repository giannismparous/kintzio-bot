import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import CheckIcon from './CheckIcon.jsx';

export const COLOR_PALETTE = [
  '#fffdf8',
  '#faf9f5',
  '#f5efe4',
  '#ece5d8',
  '#ffd9a8',
  '#f7e7c5',
  '#ffffff',
  '#141413',
  '#1a1814',
  '#6b6458',
  '#d97757',
  '#c45f2f',
  '#a85226',
  '#e8a088',
  '#1f5a48',
  '#d9ebe4',
  '#8a2e22',
  '#f3d6d1',
  '#8a5a10',
  '#eee7da',
  '#2d4a6f',
  '#c9daf8',
  '#4a3728',
  '#b8956a',
];

function normalizeHex(value, fallback = '#d97757') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

export default function ColorField({ label, value, onChange }) {
  const { t } = useI18n();
  const safe = normalizeHex(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(safe);

  useEffect(() => {
    if (!open) setDraft(safe);
  }, [safe, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const apply = (next) => {
    const hex = normalizeHex(next, draft);
    setDraft(hex);
    onChange(hex);
  };

  const openPicker = () => {
    setDraft(safe);
    setOpen(true);
  };

  return (
    <>
      <div className="field">
        <label>{label}</label>
        <div className="color-picker-row">
          <button
            type="button"
            className="color-swatch"
            style={{ background: safe }}
            onClick={openPicker}
            aria-label={`Pick ${label.toLowerCase()}`}
          />
          <input
            className="color-hex"
            value={value}
            onChange={(e) => onChange(normalizeHex(e.target.value, safe))}
            placeholder="#d97757"
            spellCheck={false}
          />
        </div>
      </div>

      {open && (
        <div
          className="color-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${label} color palette`}
          onClick={() => setOpen(false)}
        >
          <div className="color-picker-popover" onClick={(e) => e.stopPropagation()}>
            <div className="color-picker-popover-head">
              <div>
            <h3 className="color-picker-title">{label}</h3>
            <p className="color-picker-sub">{t('editor.pickColor')}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            {t('common.close')}
          </button>
            </div>

            <div className="color-picker-current-row">
              <div className="color-picker-current-swatch" style={{ background: draft }} />
              <input
                className="color-hex color-picker-hex-input"
                value={draft}
                onChange={(e) => apply(e.target.value)}
                spellCheck={false}
                aria-label={`${label} hex value`}
              />
            </div>

            <div className="color-picker-palette" role="listbox" aria-label="Color palette">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="option"
                  aria-selected={draft === color}
                  className={`color-palette-swatch${draft === color ? ' is-active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => apply(color)}
                />
              ))}
            </div>

            <label className="color-picker-native">
              <span>{t('editor.fineTune')}</span>
              <input
                type="color"
                value={draft}
                onChange={(e) => apply(e.target.value)}
                aria-label={`${label} fine tune color`}
              />
            </label>

            <div className="color-picker-actions">
              <button type="button" className="btn btn-accent" onClick={() => setOpen(false)}>
                {t('common.done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
