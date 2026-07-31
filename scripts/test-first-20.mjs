import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_ID = '7c1e1708-93eb-5e52-8f3c-e8fbf4f92df4';
const API_URL = process.env.KINTZIO_API_URL || 'http://localhost:8790';
const DELAY_MS = 2000;
const RUN_LABEL = String(process.env.KINTZIO_RUN_LABEL || 'first-20-answers').replace(
  /[^a-z0-9-_]/gi,
  '-'
);

const questions = [
  'Ποιος είναι ο Κωνσταντίνος Κίντζιος;',
  'Με τι ακριβώς ασχολείται;',
  'Πώς μπορεί να βοηθήσει μια επιχείρηση;',
  'Τι υπηρεσίες προσφέρει σε ιδιώτες;',
  'Ποια είναι η επαγγελματική του φιλοσοφία;',
  'Πώς ξεκίνησε την επαγγελματική του πορεία;',
  'Ποιες εμπειρίες επηρέασαν περισσότερο τη ζωή του;',
  'Γιατί ασχολείται τόσο έντονα με την εργασιακή κουλτούρα;',
  'Πώς αντιλαμβάνεται την επιτυχία;',
  'Τι σημαίνει για εκείνον ανθρωποκεντρική ηγεσία;',
  'Ποια είναι η διαφορά μεταξύ manager και ηγέτη;',
  'Πώς μπορεί μια εταιρεία να αναπτύξει καλύτερους managers;',
  'Τι προκαλεί την τοξικότητα σε ένα εργασιακό περιβάλλον;',
  'Πώς μπορεί να βελτιωθεί η επικοινωνία μέσα σε μια ομάδα;',
  'Πώς μπορεί μια επιχείρηση να κρατήσει τους καλούς εργαζομένους της;',
  'Ποια είναι τα συχνότερα λάθη που κάνουν οι εργοδότες;',
  'Πόσο σημαντικές είναι οι ήπιες δεξιότητες στην εργασία;',
  'Τι χρειάζεται ένας νέος για να ξεκινήσει σωστά την καριέρα του;',
  'Μετράει περισσότερο το πτυχίο ή οι δεξιότητες;',
  'Πώς μπορεί κάποιος να καταλάβει ποια καριέρα του ταιριάζει;',
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ask(question) {
  const response = await fetch(`${API_URL}/bots/${BOT_ID}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User': 'kintzio',
    },
    body: JSON.stringify({
      message: question,
      history: [],
      language: 'el',
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status}: ${body.message || body.error || 'Request failed'}`);
  }
  return {
    answer: String(body.answer || ''),
    displayedSources: Array.isArray(body.sources) ? body.sources.length : 0,
    confidence: body.confidence ?? null,
  };
}

const results = [];
for (const [index, question] of questions.entries()) {
  if (index > 0) await sleep(DELAY_MS);
  process.stdout.write(`[${index + 1}/20] ${question}\n`);
  try {
    const result = await ask(question);
    results.push({ number: index + 1, question, ...result });
    process.stdout.write(`  answered (${result.answer.length} characters)\n`);
  } catch (error) {
    results.push({
      number: index + 1,
      question,
      answer: '',
      displayedSources: null,
      confidence: null,
      error: error.message,
    });
    process.stdout.write(`  failed: ${error.message}\n`);
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../test-results');
await fs.mkdir(outputDir, { recursive: true });

const timestamp = new Date().toISOString();
const jsonPath = path.join(outputDir, `${RUN_LABEL}.json`);
const markdownPath = path.join(outputDir, `${RUN_LABEL}.md`);
await fs.writeFile(
  jsonPath,
  `${JSON.stringify({ timestamp, delayMs: DELAY_MS, independentRequests: true, results }, null, 2)}\n`
);

const markdown = [
  '# Kintzio chatbot — first 20 answers',
  '',
  `Run: ${timestamp}`,
  '',
  'Each question was sent independently with empty history and a 2-second delay.',
  '',
  ...results.flatMap((result) => [
    `## ${result.number}. ${result.question}`,
    '',
    result.error ? `ERROR: ${result.error}` : result.answer,
    '',
    `Displayed sources: ${result.displayedSources ?? 'n/a'}`,
    '',
  ]),
].join('\n');
await fs.writeFile(markdownPath, `${markdown}\n`);

const failures = results.filter((result) => result.error);
process.stdout.write(
  `Completed ${results.length} questions with ${failures.length} failures.\nSaved ${markdownPath}\n`
);
if (failures.length) process.exitCode = 1;
