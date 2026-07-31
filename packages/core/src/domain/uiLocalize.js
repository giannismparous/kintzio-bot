import { KINTZIO_DEFAULTS } from './defaults.js';

export const KINTZIO_DEFAULTS_EL = {
  welcomeMessage:
    'Γεια — είμαι το Kintzio. Ρωτήστε με οτιδήποτε σχετικά με όσα έχω μάθει από τα έγγραφά σας.',
  suggestedQuestions: [
    'Τι μπορεί να κάνει για μένα το Kintzio;',
    'Ποια είναι τα κύρια σημεία στη βάση γνώσης;',
    'Πώς μπορώ να ξεκινήσω;',
    'Ποιους εξυπηρετείτε;',
    'Πώς μπορώ να επικοινωνήσω μαζί σας;',
  ],
};

export function personalizeUiCopy(copy, botName) {
  const name = String(botName || '').trim() || 'Kintzio';
  const replaceName = (text) => String(text || '').replace(/Kintzio/g, name);
  return {
    welcomeMessage: replaceName(copy.welcomeMessage),
    suggestedQuestions: (copy.suggestedQuestions || []).map(replaceName),
  };
}

export function normalizeSuggestedQuestions(list) {
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      return normalizeSuggestedQuestions(parsed);
    } catch {
      return [];
    }
  }
  return (Array.isArray(list) ? list : [])
    .map((item) => (typeof item === 'string' ? item : item?.text))
    .map((text) => String(text || '').trim())
    .filter(Boolean);
}

export function matchesKintzioDefaults(welcomeMessage, suggestedQuestions) {
  const welcome = String(welcomeMessage || '').trim();
  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  const defaultWelcome = KINTZIO_DEFAULTS.welcomeMessage.trim();
  const defaultQuestions = normalizeSuggestedQuestions(KINTZIO_DEFAULTS.suggestedQuestions);

  if (welcome !== defaultWelcome) return false;
  if (questions.length !== defaultQuestions.length) return false;
  return questions.every((question, index) => question === defaultQuestions[index]);
}

/** Instant UI copy for test mode when no model call is needed. */
export function resolveTestUiCopy({ welcomeMessage, suggestedQuestions, language, botName }) {
  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  const welcome = String(welcomeMessage || '').trim();

  if (language === 'en') {
    return personalizeUiCopy({ welcomeMessage: welcome, suggestedQuestions: questions }, botName);
  }

  if (language === 'el' && matchesKintzioDefaults(welcome, questions)) {
    return personalizeUiCopy(
      {
        welcomeMessage: KINTZIO_DEFAULTS_EL.welcomeMessage,
        suggestedQuestions: [...KINTZIO_DEFAULTS_EL.suggestedQuestions],
      },
      botName
    );
  }

  return null;
}
