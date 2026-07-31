import React, { useRef } from 'react';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Editable ordered list — compact single-line rows.
 * Enter = new item, paste newlines = many items, ↑↓ reorder, + add.
 */
export default function OrderedListEditor({
  items,
  onChange,
  placeholder = 'Type and press Enter for a new line…',
  showPriority = false,
  addLabel = 'Add',
}) {
  const { t } = useI18n();
  const list = Array.isArray(items) ? items : [];
  const refs = useRef([]);

  const setAt = (index, value) => {
    const next = [...list];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length ? next : ['']);
  };

  const insertAt = (index, value = '') => {
    const next = [...list];
    next.splice(index, 0, value);
    onChange(next);
    requestAnimationFrame(() => refs.current[index]?.focus());
  };

  const move = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const onKeyDown = (e, index) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const el = e.target;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const next = [...list];
      next[index] = before;
      next.splice(index + 1, 0, after);
      onChange(next);
      requestAnimationFrame(() => {
        const node = refs.current[index + 1];
        if (node) {
          node.focus();
          node.setSelectionRange(0, 0);
        }
      });
    }
    if (e.key === 'Backspace' && !e.target.value && list.length > 1) {
      e.preventDefault();
      removeAt(index);
      requestAnimationFrame(() => {
        const prev = refs.current[Math.max(0, index - 1)];
        if (prev) {
          prev.focus();
          const len = prev.value.length;
          prev.setSelectionRange(len, len);
        }
      });
    }
  };

  const onPaste = (e, index) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    const parts = text
      .split(/\r?\n/)
      .map((p) => p.replace(/^\s*\d+[).:-]\s*/, '').trim())
      .filter(Boolean);
    if (!parts.length) return;
    const el = e.target;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const first = `${before}${parts[0]}`.trim();
    const lastExtra = after.trim();
    const middle = parts.slice(1);
    const next = [...list];
    next[index] = first;
    const insert = [...middle];
    if (lastExtra) insert.push(lastExtra);
    next.splice(index + 1, 0, ...insert);
    onChange(next);
  };

  return (
    <div className="ordered-list-editor">
      {list.map((item, index) => (
        <div className="ordered-list-row" key={`row-${index}`}>
          <span
            className={showPriority ? 'ordered-list-priority' : 'ordered-list-bullet'}
            title={showPriority ? t('list.priorityHint') : undefined}
          >
            {index + 1}
          </span>
          <input
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="text"
            className="ordered-list-input"
            value={item}
            placeholder={placeholder}
            onChange={(e) => setAt(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            onPaste={(e) => onPaste(e, index)}
          />
          <div className="ordered-list-actions">
            <button
              type="button"
              className="icon-btn"
              title={t('list.moveUp')}
              onClick={() => move(index, -1)}
              disabled={index === 0}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('list.moveDown')}
              onClick={() => move(index, 1)}
              disabled={index === list.length - 1}
            >
              ↓
            </button>
            <button
              type="button"
              className="icon-btn danger"
              title={t('list.remove')}
              onClick={() => removeAt(index)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary ordered-list-add"
        onClick={() => insertAt(list.length, '')}
      >
        + {addLabel}
      </button>
    </div>
  );
}
