import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createClient } from '@libsql/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * App de escritorio (desktop/) contra el servidor de los e2e: carga /app,
 * expone el puente solo al origen del servidor, hace el login en el
 * navegador (simulado: el test hace de navegador con su sesión) y vuelve por
 * zerosoft://, muestra avisos nativos que abren su página y dicta con el
 * micrófono falso de Chromium contra /api/voice/dictate.
 *
 * Corre si desktop/ está instalado y compilado (cd desktop && npm install && npm run build).
 */
const root = path.join(__dirname, '..', '..', 'desktop');
const built = fs.existsSync(path.join(root, 'dist', 'main.js')) && fs.existsSync(path.join(root, 'node_modules', 'electron'));

type Hooks = {
  openedExternal: string[];
  notifications: Array<{ title: string; body: string; click: () => void }>;
  pasted: string[];
  overlayLabels: string[];
  badge: number;
  deepLink: (url: string) => Promise<void>;
  pollBadge: () => Promise<void>;
  startDictation: () => void;
  stopDictation: () => Promise<void>;
  startNotes: (eventKey?: string | null) => void;
  displayRequests: string[];
};

test.describe('app de escritorio', () => {
  test.skip(!built, 'desktop/ sin compilar');
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let userData: string;
  let server = '';

  /** La ventana de la app (el overlay del dictado también es una ventana, de archivo local). */
  async function mainWindow() {
    for (let i = 0; i < 200; i++) {
      const w = app.windows().find((p) => p.url().startsWith(server));
      if (w) return w;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('sin ventana de la app');
  }

  test.beforeAll(async ({ baseURL }) => {
    server = baseURL!;
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-desktop-e2e-'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executablePath = require(path.join(root, 'node_modules', 'electron')) as unknown as string;
    app = await electron.launch({
      executablePath,
      args: [root],
      env: { ...process.env, ZEROSOFT_SERVER: baseURL!, ZEROSOFT_DESKTOP_TEST: '1', ZEROSOFT_USER_DATA: userData } as Record<string, string>,
      timeout: 60_000,
    });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('carga la app con el puente solo para el servidor y la navegación cerrada', async ({ baseURL }) => {
    const win = await mainWindow();
    await win.waitForURL(/\/app/, { timeout: 60_000 });
    expect(new URL(win.url()).origin).toBe(baseURL);
    const bridge = await win.evaluate(() => {
      const b = (window as unknown as { zerosoftDesktop?: Record<string, unknown> }).zerosoftDesktop;
      return b ? { version: b.version, startLogin: typeof b.startLogin, keys: Object.keys(b).sort() } : null;
    });
    expect(bridge).toEqual({ version: '0.1.0', startLogin: 'function', keys: ['dictation', 'openSettings', 'platform', 'startLogin', 'systemAudio', 'version'] });
    // Sin Node en la página.
    expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    // Un link externo va al navegador del sistema y la ventana no se mueve.
    await win.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://example.com/docs';
      a.textContent = 'x';
      document.body.append(a);
      a.click();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.openedExternal)).toContain('https://example.com/docs');
    expect(new URL(win.url()).origin).toBe(baseURL);
  });

  test('login en el navegador y vuelta por zerosoft:// con un código de un solo uso', async ({ request, baseURL }) => {
    const win = await mainWindow();
    await win.evaluate(() => (window as unknown as { zerosoftDesktop: { startLogin: () => void } }).zerosoftDesktop.startLogin());
    const opened = await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.openedExternal.find((u) => u.includes('/api/desktop/login'))))
      .toBeTruthy()
      .then(() => app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.openedExternal.find((u) => u.includes('/api/desktop/login'))!));
    const loginUrl = new URL(opened);
    expect(loginUrl.origin).toBe(baseURL);
    expect(loginUrl.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // "El navegador": ve la confirmación con su sesión y confirma.
    const confirm = await request.get(loginUrl.toString());
    expect(confirm.status()).toBe(200);
    expect(await confirm.text()).toContain('demo@zerosoft.ai');
    const done = await request.post('/api/desktop/login', {
      form: { challenge: loginUrl.searchParams.get('challenge')!, state: loginUrl.searchParams.get('state')!, locale: 'en' },
      headers: { origin: baseURL! },
    });
    expect(done.status()).toBe(200);
    const link = /href="(zerosoft:\/\/auth\/callback\?[^"]+)"/.exec(await done.text())![1].replace(/&amp;/g, '&');

    // Un state ajeno no hace nada; el bueno deja la sesión puesta y guardada cifrada.
    await app.evaluate(async (_e, l) => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.deepLink(l.replace(/state=[^&]+/, `state=${'x'.repeat(32)}`)), link);
    expect(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:zerosoft').cookies.get({})).some((c: { name: string }) => c.name.endsWith('next-auth.session-token')))).toBe(false);
    await app.evaluate(async (_e, l) => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.deepLink(l), link);
    await expect
      .poll(() => app.evaluate(async ({ session }) => (await session.fromPartition('persist:zerosoft').cookies.get({})).map((c: { name: string }) => c.name)))
      .toContain('next-auth.session-token');
    expect(fs.existsSync(path.join(userData, 'session.bin'))).toBe(true);
    expect(fs.readFileSync(path.join(userData, 'session.bin')).includes(Buffer.from('next-auth'))).toBe(false);
    // El mismo código no sirve dos veces.
    const code = new URL(link).searchParams.get('code');
    const again = await request.post('/api/desktop/token', { data: { code, verifier: 'v'.repeat(43) } });
    expect(again.status()).toBe(400);
  });

  test('aviso nativo de la campana: el clic abre su página', async () => {
    const hooks = () => app.evaluate(() => {
      const h = (globalThis as unknown as { __zsTest: Hooks }).__zsTest;
      return { notifications: h.notifications.map((n) => n.title), badge: h.badge };
    });
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pollBadge());
    const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
    const title = `Desktop ping ${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at)
            VALUES (?, 'demo', 'mention', ?, 'from the e2e', '/app/notes', NULL, 'e2e', 'e2e', '{}', ?)`,
      args: [crypto.randomUUID(), title, new Date().toISOString()],
    });
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pollBadge());
    await expect.poll(async () => (await hooks()).notifications).toContain(title);
    expect((await hooks()).badge).toBeGreaterThan(0);
    await app.evaluate((_e, t) => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.notifications.find((n) => n.title === t)!.click(), title);
    const win = await mainWindow();
    await win.waitForURL(/\/app\/notes/);
  });

  test('notas de reunión: abre Voice, crea la reunión y graba con el audio del sistema', async ({ request }) => {
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.startNotes());
    const win = await mainWindow();
    await win.waitForURL(/\/app\/voice\/meetings\/[^/?]+$/, { timeout: 30_000 });
    const id = new URL(win.url()).pathname.split('/').pop()!;
    // El grabador de la web empezó solo, con capture=desktop.
    await expect.poll(async () => ((await (await request.get(`/api/voice/sessions/${id}`)).json()) as { status: string }).status, { timeout: 20_000 }).toBe('recording');
    const detail = (await (await request.get(`/api/voice/sessions/${id}`)).json()) as { capture: string };
    expect(detail.capture).toBe('desktop');
    // La captura del sistema pasó por el handler (sin selector); con permiso de pantalla trae loopback.
    expect((await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.displayRequests)).length).toBeGreaterThan(0);
    await win.getByRole('button', { name: 'Stop', exact: true }).first().click();
    await expect.poll(async () => ((await (await request.get(`/api/voice/sessions/${id}`)).json()) as { status: string }).status, { timeout: 30_000 }).not.toBe('recording');
  });

  test('dictado: micrófono → /api/voice/dictate → texto pegado', async ({ baseURL }) => {
    const said = `desktop dictation ${Date.now()}`;
    await app.evaluate(
      async ({ session }, a) => session.fromPartition('persist:zerosoft').cookies.set({ url: a.url, name: 'voice_fake_text', value: encodeURIComponent(a.said) }),
      { url: baseURL!, said },
    );
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.startDictation());
    await new Promise((r) => setTimeout(r, 1500));
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.stopDictation());
    const pasted = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pasted);
    expect(pasted.at(-1)?.toLowerCase()).toContain('desktop dictation');
    const labels = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.overlayLabels);
    expect(labels).toEqual(expect.arrayContaining(['Listening', 'Cleaning up', 'Pasted']));
  });
});
