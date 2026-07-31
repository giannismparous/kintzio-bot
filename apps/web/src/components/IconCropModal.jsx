import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';

const VIEW = 280;
const OUT = 256;

/**
 * Square crop modal — drag to pan, zoom slider, export PNG.
 */
export default function IconCropModal({ file, accent = '#c45f2f', onCancel, onCropped }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      const fit = Math.max(VIEW / image.width, VIEW / image.height);
      setMinZoom(fit);
      setZoom(fit);
      setOffset({
        x: (VIEW - image.width * fit) / 2,
        y: (VIEW - image.height * fit) / 2,
      });
    };
    image.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const clampOffset = (x, y, z) => {
    if (!img) return { x, y };
    const w = img.width * z;
    const h = img.height * z;
    const minX = Math.min(0, VIEW - w);
    const minY = Math.min(0, VIEW - h);
    const maxX = Math.max(0, VIEW - w);
    const maxY = Math.max(0, VIEW - h);
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setOffset(clampOffset(drag.current.ox + dx, drag.current.oy + dy, zoom));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onZoomChange = (next) => {
    if (!img) return;
    const z = Number(next);
    const cx = VIEW / 2;
    const cy = VIEW / 2;
    const scale = z / zoom;
    const nx = cx - (cx - offset.x) * scale;
    const ny = cy - (cy - offset.y) * scale;
    setZoom(z);
    setOffset(clampOffset(nx, ny, z));
  };

  const apply = async () => {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT, OUT);
    const scale = OUT / VIEW;
    ctx.drawImage(
      img,
      offset.x * scale,
      offset.y * scale,
      img.width * zoom * scale,
      img.height * zoom * scale
    );
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.92));
    onCropped(blob);
  };

  return (
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('crop.ariaLabel')}
    >
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-modal-head">
          <div>
            <strong>{t('crop.title')}</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {t('crop.subtitle')}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>

        <div className="crop-stage">
          <div
            className="crop-viewport"
            style={{ width: VIEW, height: VIEW, borderColor: accent }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {url && img && (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: img.width * zoom,
                  height: img.height * zoom,
                  maxWidth: 'none',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            )}
          </div>
        </div>

        <div className="crop-controls">
          <label className="crop-zoom">
            <span className="muted">{t('crop.zoom')}</span>
            <input
              type="range"
              min={minZoom}
              max={minZoom * 3}
              step={0.01}
              value={zoom}
              onChange={(e) => onZoomChange(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-accent" onClick={apply} disabled={!img}>
            {t('crop.useCrop')}
          </button>
        </div>
      </div>
    </div>
  );
}
