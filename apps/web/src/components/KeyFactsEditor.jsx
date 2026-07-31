import React from 'react';
import { useI18n } from '../lib/i18n.jsx';

const emptyFact = () => ({ title: '', body: '' });

/**
 * Editable list of authoritative Q&A-style facts (title + body).
 * These are always injected into chat context, ahead of RAG chunks.
 */
export default function KeyFactsEditor({ items, onChange }) {
  const { t } = useI18n();
  const list = Array.isArray(items) && items.length ? items : [emptyFact()];

  const setAt = (index, patch) => {
    const next = list.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next);
  };

  const removeAt = (index) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length ? next : [emptyFact()]);
  };

  const add = () => onChange([...list, emptyFact()]);

  return (
    <div className="key-facts-editor">
      {list.map((fact, index) => (
        <div className="key-fact-row" key={`fact-${index}`}>
          <div className="key-fact-head">
            <input
              type="text"
              className="key-fact-title"
              placeholder={t('keyFacts.titlePlaceholder')}
              value={fact.title || ''}
              onChange={(e) => setAt(index, { title: e.target.value })}
            />
            <button
              type="button"
              className="icon-btn danger"
              title={t('list.remove')}
              onClick={() => removeAt(index)}
            >
              ×
            </button>
          </div>
          <textarea
            className="key-fact-body"
            placeholder={t('keyFacts.bodyPlaceholder')}
            value={fact.body || ''}
            rows={3}
            onChange={(e) => setAt(index, { body: e.target.value })}
          />
        </div>
      ))}
      <button type="button" className="btn btn-secondary ordered-list-add" onClick={add}>
        + {t('keyFacts.addAnswer')}
      </button>
    </div>
  );
}
