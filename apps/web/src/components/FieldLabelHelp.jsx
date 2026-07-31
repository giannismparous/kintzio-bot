import React from 'react';

export default function FieldLabelHelp({ label, help }) {
  if (!help) return label;

  return (
    <span className="field-label-with-help">
      {label}
      <span
        className="field-help-trigger"
        tabIndex={0}
        role="button"
        aria-label={help}
        data-help={help}
      >
        ?
      </span>
    </span>
  );
}
