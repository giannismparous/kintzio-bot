import React, { useEffect } from 'react';

export default function UnsavedChangesDialog({
  title,
  message,
  stayLabel,
  leaveLabel,
  saveLabel,
  busy = false,
  onStay,
  onLeave,
  onSave,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onStay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay, busy]);

  return (
    <div
      className="confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-dialog-title"
      onClick={busy ? undefined : onStay}
    >
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 id="unsaved-dialog-title" className="confirm-dialog-title">
          {title}
        </h3>
        {message && <p className="confirm-dialog-message">{message}</p>}
        <div className="confirm-dialog-actions confirm-dialog-actions--spread">
          <button type="button" className="btn btn-ghost" onClick={onLeave} disabled={busy}>
            {leaveLabel}
          </button>
          <div className="confirm-dialog-actions-main">
            <button type="button" className="btn btn-secondary" onClick={onStay} disabled={busy}>
              {stayLabel}
            </button>
            <button type="button" className="btn btn-accent" onClick={onSave} disabled={busy}>
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
