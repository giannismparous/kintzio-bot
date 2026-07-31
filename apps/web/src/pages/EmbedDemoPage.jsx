import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getApiUrl } from '../lib/api.js';

const DEFAULT_BOT_ID = '7c1e1708-93eb-5e52-8f3c-e8fbf4f92df4';

export default function EmbedDemoPage() {
  const { id: routeId } = useParams();
  const id = routeId || DEFAULT_BOT_ID;

  useEffect(() => {
    const src = `${getApiUrl()}/embed/${id}.js`;
    const existing = document.querySelector(`script[data-df-embed="${id}"]`);
    if (existing) {
      return undefined;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.dfEmbed = id;
    document.body.appendChild(script);
    return () => {
      // leave script; widget owns DOM nodes for demo session
    };
  }, [id]);

  return <main style={{ minHeight: '100vh' }} aria-label="Kintzio chatbot" />;
}
