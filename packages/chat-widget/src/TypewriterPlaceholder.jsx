import React, { useEffect, useState } from 'react';

export default function TypewriterPlaceholder({ phrases = [], intervalMs = 2800 }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState('');

  useEffect(() => {
    if (!phrases.length) return undefined;
    let char = 0;
    let deleting = false;
    let phraseIdx = index;
    let timer;

    const tick = () => {
      const full = phrases[phraseIdx % phrases.length] || '';
      if (!deleting) {
        char += 1;
        setShown(full.slice(0, char));
        if (char >= full.length) {
          deleting = true;
          timer = setTimeout(tick, intervalMs);
          return;
        }
        timer = setTimeout(tick, 28);
      } else {
        char -= 1;
        setShown(full.slice(0, Math.max(0, char)));
        if (char <= 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
          setIndex(phraseIdx);
        }
        timer = setTimeout(tick, 16);
      }
    };

    timer = setTimeout(tick, 200);
    return () => clearTimeout(timer);
  }, [phrases, intervalMs]);

  return (
    <span className="typewriter-placeholder">
      {shown}
      <span className="typewriter-cursor" aria-hidden="true" />
    </span>
  );
}
