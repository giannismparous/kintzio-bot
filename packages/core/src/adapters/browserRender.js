let browserInstance = null;
let playwrightModule = null;

async function loadPlaywright() {
  if (playwrightModule) return playwrightModule;
  try {
    playwrightModule = await import('playwright');
    return playwrightModule;
  } catch {
    throw new Error(
      'JavaScript page rendering requires Playwright. Run: npm install && npx playwright install chromium'
    );
  }
}

function launchOptions() {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROMIUM_PATH ||
    '';

  const fromEnv = String(process.env.PLAYWRIGHT_CHROMIUM_ARGS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Default container-safe args; locally Playwright's bundled Chromium works without these
  const args =
    fromEnv.length > 0
      ? fromEnv
      : process.env.NODE_ENV === 'production'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        : [];

  const opts = { headless: true };
  if (args.length) opts.args = args;
  // Only override executable when explicitly set — otherwise use Playwright's
  // bundled Chromium (same as local `npx playwright install chromium`).
  if (executablePath) opts.executablePath = executablePath;
  return opts;
}

export async function getBrowser() {
  if (browserInstance) return browserInstance;
  const { chromium } = await loadPlaywright();
  try {
    browserInstance = await chromium.launch(launchOptions());
  } catch (err) {
    throw new Error(
      `Could not start Chromium for site scraping: ${err.message}. ` +
        'Locally run: npx playwright install chromium. On Render, the Docker image must run playwright install chromium.'
    );
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (!browserInstance) return;
  await browserInstance.close().catch(() => {});
  browserInstance = null;
}

/**
 * Reuse one browser context per site crawl / batch.
 */
export class BrowserRenderSession {
  #context = null;

  async render(url) {
    if (!this.#context) {
      const browser = await getBrowser();
      this.#context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (compatible; KintzioBot/0.1; +https://kintzio.netlify.app)',
        locale: 'el-GR',
        viewport: { width: 1280, height: 720 },
      });
    }

    const page = await this.#context.newPage();
    try {
      // Match local behavior: prefer DOM ready, then wait for hydrated content
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page
        .waitForFunction(
          () => {
            const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
            if (text.length > 120) return true;
            const root = document.querySelector('#root, #app, #__next, main, [role="main"]');
            return Boolean(root && root.children && root.children.length > 0);
          },
          { timeout: 25000 }
        )
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
      return { html: await page.content(), finalUrl: page.url() };
    } finally {
      await page.close();
    }
  }

  async close() {
    if (!this.#context) return;
    await this.#context.close().catch(() => {});
    this.#context = null;
  }
}
