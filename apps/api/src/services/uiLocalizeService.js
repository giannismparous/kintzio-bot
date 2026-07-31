import {
  normalizeSuggestedQuestions,
  resolveTestUiCopy,
} from '@kintzio/core';
import { getChatModel } from '../config.js';

const cache = new Map();

function cacheKey(language, welcomeMessage, suggestedQuestions) {
  return `${language}\0${welcomeMessage}\0${JSON.stringify(normalizeSuggestedQuestions(suggestedQuestions))}`;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function localizeBotUiCopy({
  welcomeMessage,
  suggestedQuestions,
  language,
  botName = 'Assistant',
}) {
  const resolved = resolveTestUiCopy({ welcomeMessage, suggestedQuestions, language, botName });
  if (resolved) return resolved;

  if (language !== 'el') {
    return {
      welcomeMessage: String(welcomeMessage || '').trim(),
      suggestedQuestions: normalizeSuggestedQuestions(suggestedQuestions),
    };
  }

  const key = cacheKey(language, welcomeMessage, suggestedQuestions);
  if (cache.has(key)) return cache.get(key);

  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  const welcome = String(welcomeMessage || '').trim();
  const chat = getChatModel();

  const prompt = [
    'Translate chatbot UI strings to natural modern Greek (Ελληνικά).',
    'Return ONLY valid JSON with this shape:',
    '{"welcomeMessage":"...","suggestedQuestions":["..."]}',
    '',
    'Rules:',
    `- Keep the bot name "${botName}" unchanged if it appears.`,
    '- Keep the same number of suggested questions as the input.',
    '- Write concise, natural UI copy suitable for welcome text and suggestion chips.',
    '- Do not add markdown or commentary.',
    '',
    `Welcome message:\n${welcome || '(empty)'}`,
    '',
    `Suggested questions:\n${JSON.stringify(questions)}`,
  ].join('\n');

  const response = await chat.generate({ prompt });
  const parsed = extractJsonObject(response);
  const result = {
    welcomeMessage: String(parsed.welcomeMessage || welcome).trim(),
    suggestedQuestions: normalizeSuggestedQuestions(parsed.suggestedQuestions).length
      ? normalizeSuggestedQuestions(parsed.suggestedQuestions)
      : questions,
  };

  cache.set(key, result);
  return result;
}
