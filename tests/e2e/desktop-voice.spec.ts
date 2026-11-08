import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Dictado de escritorio de punta a punta contra el servidor de los e2e:
 *
 * - Una voz de verdad (archivo WAV hecho con `say` en Mac) entra por el
 *   micrófono falso de Chromium, pasa por el overlay (MediaRecorder), sube a
 *   /api/voice/dictate (transcripción falsa del servidor de e2e) y se "pega".
 * - Sin conexión el audio queda guardado y se manda de nuevo después.
 * - Ajustes: bienvenida, General, Voice (guardado en el servidor, el mismo
 *   que ve la web), Diccionario, Historial y Cuenta.
 *
 * Corre si desktop/ está instalado y compilado (cd desktop && npm install && npm run build).
 * Con DESKTOP_SHOTS=<carpeta> guarda capturas del overlay y de Ajustes.
 */
const root = path.join(__dirname, '..', '..', 'desktop');
const built = fs.existsSync(path.join(root, 'dist', 'main.js')) && fs.existsSync(path.join(root, 'node_modules', 'electron'));
const shots = process.env.DESKTOP_SHOTS || '';

type Hooks = {
  pasted: string[];
  overlayLabels: string[];
  startDictation: (opts?: { handsFree?: boolean }) => void;
  stopDictation: () => Promise<void>;
  dictationError: string;
  lastFailure: string;
  timings: Array<{ audioMs: number; serverMs: number; pasteMs: number; totalMs: number }>;
  retryPending: (id: string) => Promise<{ ok: boolean; text?: string; failure?: string }>;
  listPending: () => Array<{ id: string; failure: string }>;
  settingsTab: (tab: string) => void;
};


test.describe('escritorio: dictado y Ajustes de Voice', () => {
  test.skip(!built, 'desktop/ sin compilar');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let app: ElectronApplication;
  let userData: string;
  let wav = '';
  let micWorks = true;

  async function settingsPage(): Promise<Page> {
    for (let i = 0; i < 120; i++) {
      const w = app.windows().find((p) => p.url().includes('settings.html'));
      if (w) return w;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('sin ventana de Ajustes');
  }

  /** En el modo test las ventanas no se muestran solas: Ajustes se muestra sin foco para capturarla. */
  type Win = { webContents: { getURL: () => string }; showInactive: () => void };
  async function showSettings() {
    await app.evaluate(({ BrowserWindow }) =>
      (BrowserWindow.getAllWindows() as unknown as Win[]).forEach((w: Win) => {
        if (w.webContents.getURL().includes('settings.html')) w.showInactive();
      }),
    );
  }

  async function overlayPage(): Promise<Page> {
    for (let i = 0; i < 120; i++) {
      const w = app.windows().find((p) => p.url().includes('overlay.html'));
      if (w) return w;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('sin overlay');
  }

  async function shot(page: Page, name: string, opts: { dark?: boolean; width?: number } = {}) {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await page.emulateMedia({ colorScheme: opts.dark ? 'dark' : 'light' });
    if (opts.width) await page.setViewportSize({ width: opts.width, height: 760 });
    await page.screenshot({ path: path.join(shots, `${name}${opts.dark ? '-dark' : ''}.png`) });
  }

  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(180_000);
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-desktop-voice-'));
    if (process.platform === 'darwin') {
      wav = path.join(userData, 'speech.wav');
      try {
        execFileSync('say', ['-o', wav, '--data-format=LEI16@48000', 'The launch moves to Tuesday. Please send the contract by Friday.']);
      } catch {
        wav = '';
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executablePath = require(path.join(root, 'node_modules', 'electron')) as unknown as string;
    app = await electron.launch({
      executablePath,
      args: [root],
      env: {
        ...process.env,
        ZEROSOFT_SERVER: baseURL!,
        ZEROSOFT_DESKTOP_TEST: '1',
        ZEROSOFT_USER_DATA: userData,
        ...(wav ? { ZEROSOFT_FAKE_AUDIO: wav } : {}),
      } as Record<string, string>,
      timeout: 150_000,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    if (app) {
      const proc = app.process();
      await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
      await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('voz por el micrófono → overlay con reloj → servidor → pegado, con capture=desktop', async ({ baseURL, request }) => {
    const said = `desktop voice ${Date.now()}`;
    await app.evaluate(
      async ({ session }, a) => session.fromPartition('persist:zerosoft').cookies.set({ url: a.url, name: 'voice_fake_text', value: encodeURIComponent(a.said) }),
      { url: baseURL!, said },
    );
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.startDictation());
    const overlay = await overlayPage();
    await expect(overlay.locator('body')).toHaveAttribute('data-phase', 'recording');
    await expect(overlay.locator('#clock')).toHaveText(/^0:0\d$/);
    await expect(overlay.locator('#hint')).not.toBeEmpty();
    await new Promise((r) => setTimeout(r, 2200));
    await expect(overlay.locator('#clock')).toHaveText(/^0:0[2-9]$/);
    await shot(overlay, 'hud-recording');
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.stopDictation());
    if ((await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.dictationError)) === 'mic') {
      micWorks = false;
      test.info().annotations.push({ type: 'mic', description: 'Electron no recibió el micrófono falso en esta máquina.' });
      return;
    }
    const pasted = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pasted);
    expect(pasted.at(-1)?.toLowerCase()).toContain('desktop voice');
    const timings = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.timings);
    expect(timings.length).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'latency', description: JSON.stringify(timings.at(-1)) });
    // En el historial del servidor (el mismo que lista la web), marcado como del escritorio.
    const res = await request.get('/api/voice/sessions?kind=dictation&limit=5');
    const { sessions } = (await res.json()) as { sessions: Array<{ text: string; capture: string }> };
    const mine = sessions.find((x) => x.text.toLowerCase().includes('desktop voice'));
    expect(mine?.capture).toBe('desktop');
  });

  test('sin conexión: el audio queda guardado y se manda de nuevo', async ({ baseURL }) => {
    test.skip(!micWorks, 'sin micrófono en Electron');
    await app.evaluate(({ session }) => session.fromPartition('persist:zerosoft').enableNetworkEmulation({ offline: true }));
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.startDictation());
    await new Promise((r) => setTimeout(r, 1200));
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.stopDictation());
    expect(await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.lastFailure)).toBe('offline');
    const overlay = await overlayPage();
    await expect(overlay.locator('body')).toHaveAttribute('data-phase', 'error');
    await expect(overlay.locator('#label')).toContainText(/connection/i);
    await shot(overlay, 'hud-offline');
    const pending = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.listPending());
    expect(pending).toHaveLength(1);
    expect(pending[0].failure).toBe('offline');

    // Historial de Ajustes: la fila de "sin mandar" con Mandar de nuevo.
    await app.evaluate(({ session }) => session.fromPartition('persist:zerosoft').disableNetworkEmulation());
    const said = `retried ${Date.now()}`;
    await app.evaluate(
      async ({ session }, a) => session.fromPartition('persist:zerosoft').cookies.set({ url: a.url, name: 'voice_fake_text', value: encodeURIComponent(a.said) }),
      { url: baseURL!, said },
    );
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.settingsTab('history'));
    const page = await settingsPage();
    await showSettings();
    await expect(page.locator('#pending li')).toHaveCount(1);
    await shot(page, 'settings-history-pending');
    await page.locator('#pending button', { hasText: /send again/i }).click();
    await expect(page.locator('#pending')).toHaveCount(0);
    const pasted = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pasted);
    expect(pasted.at(-1)).toContain('retried');
    expect(await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.listPending())).toHaveLength(0);
    // El historial lista lo dictado, con Copiar y Pegar.
    await expect(page.locator('#history li').first()).toBeVisible();
    await expect(page.locator('#history li').first().getByRole('button', { name: /copy/i })).toBeVisible();
  });

  test('Ajustes: bienvenida, General, Voice en el servidor, Diccionario y Cuenta', async ({ request }) => {
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.settingsTab('start'));
    const page = await settingsPage();
    await showSettings();
    await expect(page.locator('[data-panel="start"] h1')).toBeVisible();
    await expect(page.locator('.step').first()).toContainText(/sign/i);
    await expect(page.locator('#try')).toBeVisible();
    await shot(page, 'settings-start');
    await shot(page, 'settings-start', { dark: true });

    // Teclado: flechas entre pestañas.
    await page.locator('#tab-start').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tab-general')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-general')).toBeFocused();
    await page.getByLabel(/only press the shortcut/i).check();
    await expect(page.locator('#hotkey')).toBeDisabled();
    await page.getByLabel(/hold the keys, or press/i).check();
    await expect(page.locator('#hotkey')).toBeEnabled();
    await page.locator('#restore').uncheck();
    await expect(page.locator('.status')).toHaveText(/saved/i);
    await page.locator('#restore').check();
    await shot(page, 'settings-general');

    // Voice: lo mismo que /api/voice/settings (la web).
    await page.locator('#tab-voice').click();
    await expect(page.locator('#cleanup')).toBeVisible();
    await page.locator('#cleanup').selectOption('raw');
    await expect(page.locator('#ai')).toBeDisabled();
    await expect(page.locator('#style-email')).toBeDisabled();
    await expect.poll(async () => ((await (await request.get('/api/voice/settings')).json()) as { settings: { cleanupMode: string } }).settings.cleanupMode).toBe('raw');
    await page.locator('#language').selectOption('es');
    await expect.poll(async () => ((await (await request.get('/api/voice/settings')).json()) as { settings: { language: string } }).settings.language).toBe('es');
    await shot(page, 'settings-voice');
    await shot(page, 'settings-voice', { dark: true });
    await page.locator('#cleanup').selectOption('per_app');
    await page.locator('#language').selectOption('auto');
    await expect(page.locator('#style-email')).toBeEnabled();

    // Diccionario: agregar (Enter) y borrar, igual que en la web.
    await page.locator('#tab-dictionary').click();
    const word = `Zerosoftio${Date.now() % 10000}`;
    await page.locator('#dict-kind').selectOption('replace');
    await page.locator('#dict-phrase').fill('zero soft io');
    await page.locator('#dict-repl').fill(word);
    await page.locator('#dict-repl').press('Enter');
    await expect(page.locator('.list li', { hasText: word })).toBeVisible();
    const entries = ((await (await request.get('/api/voice/dictionary')).json()) as { entries: Array<{ replacement: string }> }).entries;
    expect(entries.some((e) => e.replacement === word)).toBe(true);
    await shot(page, 'settings-dictionary');
    await page.locator('.list li', { hasText: word }).getByRole('button', { name: /delete/i }).click();
    await expect(page.locator('.list li', { hasText: word })).toHaveCount(0);

    // Cuenta (DEMO_MODE: siempre la persona demo) y servidor inválido.
    await page.locator('#tab-account').click();
    await expect(page.locator('#account-state')).toContainText('@');
    await page.locator('#server').fill('ftp://nope');
    await page.locator('#server').press('Enter');
    await expect(page.locator('.status')).toHaveText(/https/i);
    await shot(page, 'settings-account');

    // 390 px: sin scroll horizontal.
    await page.locator('#tab-history').click();
    await page.setViewportSize({ width: 390, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, 'settings-history-390', { width: 390 });
    await shot(page, 'settings-history-390', { dark: true, width: 390 });
  });
});
