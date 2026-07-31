import { getApiUrl } from './api.js';

export const EMBED_STEPS = [
  'Copy the embed code below.',
  'Paste it just before the closing </body> tag on your site, or into your CMS HTML / embed block.',
  'Save and publish your page — the chat launcher appears in the bottom corner for visitors.',
];

export function getEmbedSnippet(botId) {
  if (!botId) return '';
  return `<script src="${getApiUrl()}/embed/${botId}.js" async></script>`;
}
