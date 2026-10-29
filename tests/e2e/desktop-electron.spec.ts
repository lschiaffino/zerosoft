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
  mintedNonces: string[];
  dictationError: string;
  consumedNonces: string[];
};

test.describe('app de escritorio', () => {
  test.skip(!built, 'desktop/ sin compilar');
  // Arrancar Electron y la primera carga de /app con next start tardan; con la máquina cargada, más.
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

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
    test.setTimeout(180_000);
    server = baseURL!;
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-desktop-e2e-'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executablePath = require(path.join(root, 'node_modules', 'electron')) as unknown as string;
    app = await electron.launch({
      executablePath,
      args: [root],
      env: { ...process.env, ZEROSOFT_SERVER: baseURL!, ZEROSOFT_DESKTOP_TEST: '1', ZEROSOFT_USER_DATA: userData } as Record<string, string>,
      timeout: 150_000,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    // app.close() espera que todas las ventanas cierren; una captura colgada (permiso del sistema
    // pendiente) lo traba. Se sale con app.exit y, si no alcanza, se mata el proceso que lanzamos.
    if (app) {
      const proc = app.process();
      await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
      await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('carga la app con el puente solo para el servidor y la navegación cerrada', async ({ baseURL }) => {
    const win = await mainWindow();
    await win.waitForURL(/\/app/, { timeout: 150_000 });
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

  test('un link con autostart (en Talk, un mail, un deep link) abre la reunión sin grabar', async ({ request, baseURL }) => {
    const win = await mainWindow();
    for (const autostart of ['desktop', 'A'.repeat(32)]) {
      await win.goto(`${baseURL}/en/app/voice?new=1&autostart=${autostart}`);
      await win.waitForURL(/\/app\/voice\/meetings\/[^/?]+/, { timeout: 30_000 });
      const id = new URL(win.url()).pathname.split('/').pop()!;
      await new Promise((r) => setTimeout(r, 3000));
      const s = (await (await request.get(`/api/voice/sessions/${id}`)).json()) as { status: string };
      expect(s.status, autostart).not.toBe('recording');
    }
    expect(await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.consumedNonces)).toEqual([]);
    // zerosoft://open saca autostart y zerosoft://notes abre sin grabar: ninguno crea un nonce.
    await app.evaluate(async (_e, u) => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.deepLink(u), 'zerosoft://open?path=/app/voice?new=1%26autostart=desktop');
    await app.evaluate(async () => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.deepLink('zerosoft://notes'));
    expect(await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.mintedNonces)).toEqual([]);
  });

  test('notas de reunión desde el menú: nonce de un solo uso, grabación con capture=desktop', async ({ request }) => {
    await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.startNotes());
    const win = await mainWindow();
    await win.waitForURL(/\/app\/voice\/meetings\/[^/?]+$/, { timeout: 30_000 });
    const id = new URL(win.url()).pathname.split('/').pop()!;
    const hooks = () => app.evaluate(() => {
      const h = (globalThis as unknown as { __zsTest: Hooks }).__zsTest;
      return { minted: h.mintedNonces, consumed: h.consumedNonces };
    });
    // La página canjeó el nonce que creó main (una vez).
    await expect.poll(async () => (await hooks()).consumed, { timeout: 20_000 }).toEqual((await hooks()).minted);
    // La reunión figura "grabando" solo cuando la captura arrancó: con micrófono, graba y se corta;
    // si el sistema no da el micrófono (permiso pendiente), queda libre y la página muestra el error.
    const status = async () => ((await (await request.get(`/api/voice/sessions/${id}`)).json()) as { status: string; capture: string });
    const started = await expect
      .poll(async () => (await win.locator('.vc-recorder-row .vc-rec-time').count()) > 0, { timeout: 25_000 })
      .toBe(true)
      .then(() => true, () => false);
    if (started) {
      expect(await status()).toMatchObject({ status: 'recording', capture: 'desktop' });
      // La ventana está escondida en el modo test: el botón se toca por DOM.
      await win.locator('.vc-recorder-row button.btn-primary').dispatchEvent('click');
      await expect.poll(async () => (await status()).status, { timeout: 30_000 }).not.toBe('recording');
    } else {
      test.info().annotations.push({ type: 'mic', description: 'Electron no recibió el micrófono en esta máquina: se verifica que la reunión no quede "grabando".' });
      expect((await status()).status).not.toBe('recording');
    }
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
    if ((await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.dictationError)) === 'mic') {
      // Sin micrófono en Electron (permiso del sistema pendiente en esta máquina): no hay qué mandar.
      test.info().annotations.push({ type: 'mic', description: 'Electron no recibió el micrófono: el envío al servidor no se probó en esta corrida.' });
      return;
    }
    const pasted = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.pasted);
    expect(pasted.at(-1)?.toLowerCase()).toContain('desktop dictation');
    const labels = await app.evaluate(() => (globalThis as unknown as { __zsTest: Hooks }).__zsTest.overlayLabels);
    expect(labels).toEqual(expect.arrayContaining(['Listening', 'Cleaning up', 'Pasted']));
  });
});
