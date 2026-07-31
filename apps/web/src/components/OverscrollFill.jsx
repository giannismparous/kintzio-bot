import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './OverscrollFill.css';

const TOP_BG = '#f3efe6';
const BOTTOM_BG = '#ebe4d6';
const EDGE_THRESHOLD = 120;

/** Keeps rubber-band / overscroll areas matching the page gradient edges (simasia v3 pattern). */
export default function OverscrollFill() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');

    const syncBackdrop = () => {
      const scrollY = window.scrollY;
      const atTop = scrollY < EDGE_THRESHOLD;
      const atBottom =
        scrollY + window.innerHeight >= document.documentElement.scrollHeight - EDGE_THRESHOLD;

      const backdrop = atBottom && !atTop ? BOTTOM_BG : TOP_BG;

      document.documentElement.classList.toggle('page-backdrop-top', !atBottom || atTop);
      document.documentElement.classList.toggle('page-backdrop-bottom', atBottom && !atTop);
      document.documentElement.style.backgroundColor = backdrop;
      document.body.style.backgroundColor = backdrop;
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = backdrop;
      if (meta) meta.setAttribute('content', backdrop);
    };

    syncBackdrop();
    window.addEventListener('scroll', syncBackdrop, { passive: true });
    window.addEventListener('resize', syncBackdrop, { passive: true });
    return () => {
      window.removeEventListener('scroll', syncBackdrop);
      window.removeEventListener('resize', syncBackdrop);
    };
  }, [pathname]);

  return (
    <>
      <div className="overscroll-fill overscroll-fill--top" aria-hidden="true" />
      <div className="overscroll-fill overscroll-fill--bottom" aria-hidden="true" />
    </>
  );
}
