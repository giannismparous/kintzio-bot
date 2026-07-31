import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DefaultAvatar } from '@kintzio/chat-widget';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useConfirm } from '../lib/useConfirm.jsx';
import AppLoading from '../components/AppLoading.jsx';

function StatusBadge({ status }) {
  const { t } = useI18n();
  const key = status || 'draft';
  return <span className={`badge badge-${key}`}>{t(`status.${key}`)}</span>;
}

function BotListIcon({ bot }) {
  const accent = bot.theme?.accent || '#d97757';
  return (
    <div className="bot-item-icon" aria-hidden="true">
      {bot.iconUrl ? (
        <img src={bot.iconUrl} alt="" />
      ) : (
        <DefaultAvatar size={44} accent={accent} />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bot-stat">
      <span className="bot-stat-value">{value}</span>
      <span className="bot-stat-label">{label}</span>
    </div>
  );
}

export default function BotsPage() {
  const { username, ready, user } = useAuth();
  const { t, dateLocale } = useI18n();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [bots, setBots] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/bots', { username });
      setBots(data.bots || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !user) return;
    load();
  }, [ready, user?.id, username]);

  const duplicate = async (id) => {
    try {
      const data = await api(`/bots/${id}/duplicate`, { method: 'POST', username });
      navigate(`/bots/${data.bot.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    const bot = bots.find((b) => b.id === id);
    const ok = await confirm({
      title: t('bots.deleteTitle'),
      message: bot
        ? t('bots.deleteMessage', { name: bot.name })
        : t('bots.deleteMessageGeneric'),
      confirmLabel: t('bots.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/bots/${id}`, { method: 'DELETE', username });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bots-page">
      <div className="bots-page-header">
        <div>
          <h2 className="section-title">{t('bots.title')}</h2>
        </div>
        <Link className="btn btn-accent" to="/bots/new">
          {t('bots.new')}
        </Link>
      </div>

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="bots-loading">
          <span className="app-loading-spinner" aria-hidden="true" />
          <span className="muted">{t('common.loading')}</span>
        </div>
      )}

      {!loading && bots.length === 0 && (
        <div className="bots-empty">
          <p className="bots-empty-title">{t('bots.empty')}</p>
        </div>
      )}

      {!loading && bots.length > 0 && (
        <div className="bot-stack">
          {bots.map((bot) => {
            const sources = bot.sourceCount ?? 0;
            const chunks = bot.chunkCount || 0;
            const canTest = Boolean(bot.lastBuiltAt) || chunks > 0;
            return (
              <article className="bot-item" key={bot.id}>
                <div className="bot-item-top">
                  <div className="bot-item-heading">
                    <BotListIcon bot={bot} />
                    <h3 className="bot-item-name">{bot.name}</h3>
                    <StatusBadge status={bot.status} />
                  </div>
                  <div className="bot-stats">
                    <Stat
                      value={sources}
                      label={sources === 1 ? t('bots.source') : t('bots.sources')}
                    />
                    <Stat
                      value={chunks}
                      label={chunks === 1 ? t('bots.chunk') : t('bots.chunks')}
                    />
                  </div>
                </div>

                {bot.lastBuiltAt && (
                  <p className="muted bot-item-meta">
                    {t('bots.lastBuilt', {
                      date: new Date(bot.lastBuiltAt).toLocaleString(dateLocale),
                    })}
                  </p>
                )}
                {bot.buildError && <p className="error-text">{bot.buildError}</p>}

                <div className="bot-item-footer">
                  <Link className="btn btn-accent bot-edit-btn" to={`/bots/${bot.id}`}>
                    {t('bots.edit')}
                  </Link>
                  {canTest && (
                    <Link className="btn btn-outline" to={`/bots/${bot.id}/test`}>
                      {t('bots.test')}
                    </Link>
                  )}
                  <div className="bot-item-links">
                    <button type="button" onClick={() => duplicate(bot.id)}>
                      {t('common.duplicate')}
                    </button>
                    <button type="button" className="danger-link" onClick={() => remove(bot.id)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {dialog}
    </div>
  );
}
