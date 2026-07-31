const DIALOGOS_WELCOME_EN =
  'Hi — I am Kintzio. Ask me anything about what I have learned from your documents.';

const DIALOGOS_QUESTIONS_EN = [
  'What can Kintzio do for me?',
  'What are the main points in the knowledge base?',
  'How can I get started?',
  'Who do you serve?',
  'How can I contact you?',
];

const DIALOGOS_WELCOME_EL =
  'Γεια — είμαι το Kintzio. Ρωτήστε με οτιδήποτε σχετικά με όσα έχω μάθει από τα έγγραφά σας.';

const DIALOGOS_QUESTIONS_EL = [
  'Τι μπορεί να κάνει για μένα το Kintzio;',
  'Ποια είναι τα κύρια σημεία στη βάση γνώσης;',
  'Πώς μπορώ να ξεκινήσω;',
  'Ποιους εξυπηρετείτε;',
  'Πώς μπορώ να επικοινωνήσω μαζί σας;',
];

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

export function personalizeUiCopy(copy, botName) {
  const name = String(botName || '').trim() || 'Kintzio';
  const replaceName = (text) => String(text || '').replace(/Kintzio/g, name);
  return {
    welcomeMessage: replaceName(copy.welcomeMessage),
    suggestedQuestions: (copy.suggestedQuestions || []).map(replaceName),
  };
}

export function matchesKintzioDefaults(welcomeMessage, suggestedQuestions) {
  const welcome = String(welcomeMessage || '').trim();
  const questions = normalizeSuggestedQuestions(suggestedQuestions);
  if (welcome !== DIALOGOS_WELCOME_EN) return false;
  if (questions.length !== DIALOGOS_QUESTIONS_EN.length) return false;
  return questions.every((question, index) => question === DIALOGOS_QUESTIONS_EN[index]);
}

/** Instant UI copy for test mode — no API required for Kintzio defaults. */
export function resolveTestUiCopy({ welcomeMessage, suggestedQuestions, language, botName }) {
  const welcome = String(welcomeMessage || '').trim();
  const questions = normalizeSuggestedQuestions(suggestedQuestions);

  if (language === 'en') {
    return personalizeUiCopy({ welcomeMessage: welcome, suggestedQuestions: questions }, botName);
  }

  if (language === 'el' && matchesKintzioDefaults(welcome, questions)) {
    return personalizeUiCopy(
      {
        welcomeMessage: DIALOGOS_WELCOME_EL,
        suggestedQuestions: [...DIALOGOS_QUESTIONS_EL],
      },
      botName
    );
  }

  return null;
}
