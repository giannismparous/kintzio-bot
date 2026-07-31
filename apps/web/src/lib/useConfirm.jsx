import React, { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export function useConfirm() {
  const [pending, setPending] = useState(null);

  const confirm = useCallback(
    ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) =>
      new Promise((resolve) => {
        setPending({ title, message, confirmLabel, cancelLabel, danger, resolve });
      }),
    []
  );

  const close = (result) => {
    if (!pending) return;
    pending.resolve(result);
    setPending(null);
  };

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, dialog };
}
