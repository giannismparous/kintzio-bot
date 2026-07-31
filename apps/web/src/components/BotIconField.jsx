import React, { useEffect, useRef, useState } from 'react';
import { DefaultAvatar } from '@kintzio/chat-widget';
import { useI18n } from '../lib/i18n.jsx';
import IconCropModal from './IconCropModal.jsx';

export default function BotIconField({
  iconUrl,
  accent = '#c45f2f',
  uploading = false,
  onUpload,
  onRemove,
  onPreviewChange,
}) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const localUrlRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  const [displayUrl, setDisplayUrl] = useState(iconUrl || '');
  const [visible, setVisible] = useState(Boolean(iconUrl));

  const clearLocalPreview = () => {
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (!iconUrl) {
      if (!localUrlRef.current) {
        setDisplayUrl('');
        setVisible(false);
      }
      return undefined;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      setDisplayUrl(iconUrl);
      setVisible(true);
      clearLocalPreview();
      onPreviewChange?.(null);
    };
    img.onerror = () => {
      if (cancelled) return;
      // Keep local preview if remote fails to load.
      if (!localUrlRef.current) setVisible(false);
    };
    img.src = iconUrl;
    return () => {
      cancelled = true;
    };
  }, [iconUrl, onPreviewChange]);

  useEffect(
    () => () => {
      clearLocalPreview();
    },
    []
  );

  const hasCustom = Boolean(displayUrl);
  const pickFile = () => {
    if (uploading) return;
    inputRef.current?.click();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setCropFile(file);
  };

  const onCropped = async (blob) => {
    setCropFile(null);
    clearLocalPreview();
    const preview = URL.createObjectURL(blob);
    localUrlRef.current = preview;
    setDisplayUrl(preview);
    setVisible(true);
    onPreviewChange?.(preview);

    const file = new File([blob], 'icon.png', { type: 'image/png' });
    await onUpload(file);
  };

  const handleRemove = async () => {
    clearLocalPreview();
    setDisplayUrl('');
    setVisible(false);
    onPreviewChange?.(null);
    await onRemove();
  };

  return (
    <div className="bot-icon-field">
      <label>{t('icon.label')}</label>
      <div className="bot-icon-row">
        <div
          className={`bot-icon-preview${uploading ? ' is-uploading' : ''}${
            visible && hasCustom ? ' has-image' : ''
          }`}
          aria-hidden="true"
        >
          {hasCustom ? (
            <img
              src={displayUrl}
              alt=""
              className={`bot-icon-img${visible ? ' is-ready' : ''}`}
              decoding="async"
            />
          ) : (
            <DefaultAvatar size={72} accent={accent} />
          )}
          {uploading && <span className="bot-icon-spinner" />}
        </div>
        <div className="bot-icon-meta">
          <div className="bot-icon-status">
            {uploading
              ? t('icon.uploading')
              : hasCustom
                ? t('icon.custom')
                : t('icon.default')}
          </div>
          <p className="muted" style={{ margin: '0.2rem 0 0.65rem', fontSize: '0.82rem' }}>
            {hasCustom ? t('icon.customHelp') : t('icon.defaultHelp')}
          </p>
          <div className="bot-icon-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading}
              onClick={pickFile}
            >
              {hasCustom ? t('icon.change') : t('icon.upload')}
            </button>
            {hasCustom && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={uploading}
                onClick={handleRemove}
              >
                {t('icon.remove')}
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFile}
      />

      {cropFile && (
        <IconCropModal
          file={cropFile}
          accent={accent}
          onCancel={() => setCropFile(null)}
          onCropped={onCropped}
        />
      )}
    </div>
  );
}
