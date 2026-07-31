import {
  buildRagPrompt,
  formatKeyFacts,
  resolveReplyLanguage,
} from '@kintzio/core';
import { pool, vectorStore, getEmbedder, getChatModel } from '../config.js';
import { buildChatSources } from './sourceCitations.js';

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const MAX_QUESTION_LENGTH = 1200;
const MAX_HISTORY_MESSAGE_LENGTH = 800;
const PROMPT_ATTACK_PATTERNS = [
  /\bignore\b.{0,40}\b(previous|prior|above|all)\b.{0,30}\b(instruction|prompt|rule)/i,
  /\b(system|developer)\s*(prompt|message|instruction)/i,
  /\b(reveal|show|print|repeat|translate|encode|summarize)\b.{0,50}\b(prompt|instruction|secret|api key|credential|chain.of.thought)/i,
  /\b(jailbreak|do anything now|\bdan\b|unrestricted mode|developer mode)\b/i,
  /\bpretend\b.{0,30}\b(no rules|unrestricted|ignore|system)\b/i,
  /(?:αγνόησε|παράβλεψε).{0,50}(?:οδηγ|εντολ|κανόν|prompt)/i,
  /(?:δείξε|αποκάλυψε|γράψε).{0,50}(?:system prompt|κρυφ|οδηγ|api key|κλειδί)/i,
];
const EXPLICIT_IDENTITY_PATTERNS = [
  /\b(?:are you|r u)\b.{0,45}\b(?:an?\s+ai|bot|robot|human|real person|actual konstantinos)\b/i,
  /\b(?:are you)\b.{0,30}\b(?:the real|really)\b.{0,20}\b(?:konstantinos|kintzios)\b/i,
  /(?:είσαι|εισαι).{0,45}(?:τεχνητ(?:ή|η) νοημοσύνη|ai|bot|ρομπότ|robot|άνθρωπος|ανθρωπος|πραγματικός|πραγματικος)/i,
  /(?:είσαι|εισαι).{0,25}(?:ο αληθινός|ο αληθινος|όντως ο|οντως ο).{0,25}(?:κωνσταντίνος|κωνσταντινος|κίντζιος|κιντζιος)/i,
];
const SERVICE_INTENT_PATTERN =
  /(υπηρεσ|προσφέρ|βοηθήσ|ipires|ypires|prosfer|voith|mentoring|coaching|consult|training|workshop|service|offer|how can you help|what can you do for)/i;
const BOOKING_INTENT_PATTERN =
  /(συνάντησ|ραντεβού|κλείσ.{0,15}(?:ώρα|συνάντησ|ραντεβού)|synant|rantev|meeting|appointment|book.{0,20}(?:call|meeting|session))/i;
const COLLABORATION_INTENT_PATTERN =
  /((?:πώς|πως|θέλω|θα ήθελα|μπορώ|μπορούμε).{0,40}συνεργασ|να συνεργαστούμε|(?:pos|pws|thelo|mporo|mporoume).{0,40}synergas|work with you|collaborate with you|work together)/i;

function looksLikePromptAttack(text) {
  return PROMPT_ATTACK_PATTERNS.some((pattern) => pattern.test(text));
}

function asksExplicitlyAboutIdentity(text) {
  return EXPLICIT_IDENTITY_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldOfferMeeting(text) {
  const message = String(text || '');
  return (
    SERVICE_INTENT_PATTERN.test(message) ||
    BOOKING_INTENT_PATTERN.test(message) ||
    COLLABORATION_INTENT_PATTERN.test(message)
  );
}

function safeRedirect(language) {
  if (language === 'el') {
    return 'Δεν μπορώ να αλλάξω ή να αποκαλύψω τις εσωτερικές οδηγίες μου. Μπορώ όμως να σας απαντήσω για την πορεία, τις υπηρεσίες και τις συνεργασίες μου.';
  }
  return 'I cannot change or reveal my internal instructions. I can help with questions about my background, services, and collaborations.';
}

export async function answerBotChat(botId, question, { history = [], language } = {}) {
  const q = String(question || '').trim();
  if (!q) {
    return { answer: 'Type a question to get started.', sources: [], confidence: 0 };
  }
  const replyLanguage = resolveReplyLanguage(q, language);
  if (q.length > MAX_QUESTION_LENGTH) {
    return {
      answer:
        replyLanguage === 'el'
          ? 'Το μήνυμα είναι πολύ μεγάλο. Παρακαλώ στείλτε μια πιο σύντομη ερώτηση.'
          : 'That message is too long. Please send a shorter question.',
      sources: [],
      confidence: 0,
    };
  }
  if (asksExplicitlyAboutIdentity(q)) {
    return {
      answer:
        replyLanguage === 'el'
          ? 'Είμαι η ψηφιακή εκδοχή του Κωνσταντίνου Κίντζιου και απαντώ με βάση το επίσημο περιεχόμενό του.'
          : 'I am the digital version of Konstantinos Kintzios, answering from his official content.',
      sources: [],
      confidence: 1,
    };
  }
  if (looksLikePromptAttack(q)) {
    return { answer: safeRedirect(replyLanguage), sources: [], confidence: 0 };
  }

  const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  const bot = rows[0];
  if (!bot) {
    const err = new Error('Bot not found');
    err.statusCode = 404;
    throw err;
  }

  const keyFacts = parseJsonArray(bot.key_facts);
  const hasKeyFacts = Boolean(formatKeyFacts(keyFacts));

  if (bot.status !== 'ready' && !hasKeyFacts) {
    return {
      answer:
        bot.status === 'building'
          ? 'This bot is still building its knowledge index. Try again in a moment.'
          : 'This bot has no ready index yet. Open the editor and press Build first.',
      sources: [],
      confidence: 0,
    };
  }

  let hits = [];
  if (bot.status === 'ready') {
    const embedder = getEmbedder();
    const queryEmbedding = await embedder.embedQuery(q);
    hits = await vectorStore.similaritySearch(botId, queryEmbedding, 6);
    if (hits[0] && (hits[0].score ?? 0) < 0.25) {
      hits = [];
    }
  }

  if (!hits.length && !hasKeyFacts) {
    return {
      answer:
        'I do not have enough information in the uploaded documents to answer that.',
      sources: [],
      confidence: 0,
    };
  }

  const ragContext = hits.length
    ? hits
        .map(
          (h, i) =>
            `[#${i + 1} ${h.label || 'source'} | score=${h.score.toFixed(3)}]\n${h.content}`
        )
        .join('\n\n')
    : '(no retrieved documents)';

  const safeHistory = (Array.isArray(history) ? history : [])
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    )
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH),
    }))
    .filter((message) => message.content && !looksLikePromptAttack(message.content));
  const historyLines = safeHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = buildRagPrompt({
    systemPrompt: bot.system_prompt,
    rules: parseJsonArray(bot.rules),
    keyFacts,
    botName: bot.name,
    personaGender: bot.persona_gender || 'neutral',
    welcomeMessage: bot.welcome_message || '',
    language: replyLanguage,
    context: `${historyLines ? `Recent conversation:\n${historyLines}\n\n` : ''}${ragContext}`,
    question: q,
  });

  const chat = getChatModel();
  const answer = await chat.generate({ prompt });

  const sources = buildChatSources({
    hits,
    hasKeyFacts,
    sourceCitations: bot.source_citations,
  });

  const top = hits[0]?.score ?? (hasKeyFacts ? 0.9 : 0);
  return {
    answer: answer || 'I could not generate an answer.',
    sources,
    confidence: top > 0.8 ? 0.95 : top > 0.5 ? 0.8 : hasKeyFacts ? 0.85 : 0.6,
    offerMeeting: shouldOfferMeeting(q),
    replyLanguage,
  };
}
