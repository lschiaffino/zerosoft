import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Onboarding de una persona nueva de punta a punta (/app/welcome y el inicio):
 * el borrador se retoma al recargar, las apps elegidas arman "Tus apps", el
 * segundo tramo conecta Google Calendar (proveedor falso) y vuelve al paso,
 * elige la herramienta de origen, baja la app de escritorio (release falso) y
 * espera a que la app avise; "Primeros pasos" en el inicio sale de los datos
 * y se oculta. Cada persona entra con la cookie zs_e2e_as (E2E_IDENTITY_COOKIE).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function newPerson(browser: Browser, opts: { width?: number; scheme?: 'light' | 'dark'; desktopApp?: boolean } = {}): Promise<{ ctx: BrowserContext; p: Page; email: string }> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, userAgent: MAC_UA, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `new-${uid()}@onb-e2e.io`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // El instalador es de GitHub: la descarga se simula sin salir a internet.
  await ctx.route('https://github.com/**', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="zerosoft.dmg"' }, body: 'x' }),
  );
  if (opts.desktopApp) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'zerosoftDesktop', { value: Object.freeze({ version: '0.1.0', platform: 'darwin', systemAudio: false, dictation: true, startLogin() {}, openSettings() {} }) });
    });
  }
  return { ctx, p: await ctx.newPage(), email };
}

async function noHorizontalScroll(p: Page, label: string) {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test('persona nueva: borrador retomable, apps, Google Calendar, origen, escritorio y "Primeros pasos"', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p, email } = await newPerson(browser);
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await p.waitForURL(/\/en\/app\/welcome$/);
    await expect(p.getByRole('heading', { name: 'How will you use zerosoft?' })).toBeVisible();
    await p.getByText('Just me').click();
    await p.getByTestId('wl-next').click();
    // El foco va al título de cada paso; Enter en un campo sigue.
    await expect(p.getByRole('heading', { name: 'About you' })).toBeFocused();
    await p.getByText('Engineering', { exact: true }).click();
    await p.getByLabel('Your name').fill('Mara');
    await p.getByLabel('Your name').press('Enter');
    await expect(p.getByRole('heading', { name: 'Which apps will you use?' })).toBeVisible();
    await expect(p.getByText('Picked for engineering. Change anything.')).toBeVisible();
    for (const k of ['track', 'docs', 'talk', 'notes', 'cal', 'board']) await expect(p.locator(`[data-testid="wl-app"][data-app="${k}"] input`)).toBeChecked();
    await expect(p.locator('[data-testid="wl-app"][data-app="crm"] input')).not.toBeChecked();

    // Cerrar y volver: retoma en el mismo paso, con lo que había.
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: 'networkidle' });
    await expect(p.getByRole('heading', { name: 'Which apps will you use?' })).toBeVisible();
    await expect(p.getByText('We kept your answers from last time.')).toBeVisible();
    await p.locator('[data-testid="wl-app"][data-app="board"]').click();
    await expect(p.getByText('5 apps')).toBeVisible();
    await p.getByRole('button', { name: 'Back' }).click();
    await expect(p.getByLabel('Your name')).toHaveValue('Mara');
    await p.getByTestId('wl-next').click();
    await expect(p.locator('[data-testid="wl-app"][data-app="board"] input')).not.toBeChecked();
    await p.getByTestId('wl-next').click();

    // Segundo tramo: solo Cal pide conexión (no eligió CRM ni Groups).
    await expect(p.getByRole('heading', { name: 'Connect your accounts' })).toBeVisible();
    await expect(p.getByText('Your workspace is ready')).toBeVisible();
    await expect(p.getByTestId('wl-connect-email')).toHaveCount(0);
    await p.getByTestId('wl-connect-calendar').getByRole('link', { name: 'Connect' }).click();
    // Vuelve al mismo paso, conectado, con la URL limpia.
    await expect(p.getByTestId('wl-connect-result')).toHaveText('Google Calendar is connected.');
    await expect(p.getByTestId('wl-connect-calendar')).toContainText('Connected');
    await expect(p).toHaveURL(/\/en\/app\/welcome$/);

    await p.getByTestId('wl-next').click();
    await expect(p.getByRole('heading', { name: 'Coming from another tool?' })).toBeVisible();
    await p.getByText('Linear', { exact: true }).click();
    await expect(p.getByTestId('wl-import-go')).toHaveText('Import from Linear');
    await expect(p.getByTestId('wl-import-go')).toHaveAttribute('href', '/en/app/settings/import?source=track:linear');
    await p.getByRole('button', { name: 'Later' }).click();

    // La app de escritorio: el instalador del Mac, los pasos al descargar y la espera.
    await expect(p.getByRole('heading', { name: 'Get zerosoft on your computer' })).toBeVisible();
    const dl = p.getByTestId('desktop-download');
    await expect(dl).toHaveAttribute('href', /zerosoft-0\.1\.0-mac-(arm64|x64)\.dmg$/);
    await expect(p.getByTestId('desktop-steps')).toHaveCount(0);
    const download = p.waitForEvent('download');
    await dl.click();
    await download;
    await expect(p.getByRole('heading', { name: 'Downloading. Now install it' })).toBeFocused();
    await expect(p.getByTestId('desktop-steps')).toContainText('Open Anyway');
    await expect(p.getByText('When you sign in on the desktop app, this step marks itself done.')).toBeVisible();
    const after = await sql('SELECT profile FROM users WHERE email = ?', [email]);
    expect(JSON.parse(String(after[0].profile)).desktopDownloadedAt).toBeTruthy();
    // La app de escritorio avisa (lo hace DesktopSeen dentro de la app): el paso se marca solo.
    expect((await ctx.request.post('/api/onboarding', { data: { kind: 'desktop', event: 'seen', platform: 'darwin', version: '0.1.0' } })).ok()).toBe(true);
    await expect(p.getByTestId('desktop-done')).toHaveText('Desktop app connected to your account.', { timeout: 15_000 });

    await p.getByRole('button', { name: 'Go to Home' }).click();
    await p.waitForURL(/\/en\/app$/);
    const gs = p.getByTestId('getting-started');
    await expect(gs).toBeVisible();
    await expect(p.getByTestId('getting-started-progress')).toHaveText('3 of 4 done');
    await expect(p.getByTestId('gs-calendar')).toHaveAttribute('data-done', '1');
    await expect(p.getByTestId('gs-desktop')).toHaveAttribute('data-done', '1');
    await expect(p.getByTestId('gs-import')).toHaveAttribute('data-done', '0');
    await expect(p.getByTestId('gs-import')).toContainText('Bring your data from Linear');
    await expect(p.getByTestId('gs-import').getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/en/app/settings/import?source=track:linear');
    await expect(p.getByTestId('gs-invite')).toHaveCount(0);

    // "Tus apps" son las elegidas.
    const featured = p.getByTestId('home-featured');
    for (const name of ['Track', 'Docs', 'Notes', 'Cal', 'Talk']) await expect(featured.getByRole('link', { name: `Open ${name}` })).toBeVisible();
    await expect(featured.getByRole('link', { name: 'Open Board' })).toHaveCount(0);

    // El menú de la cuenta lleva a la app de escritorio.
    await p.getByTestId('workspace-switcher').click();
    await expect(p.getByTestId('side-download')).toHaveAttribute('href', '/en/app/download');
    await p.keyboard.press('Escape');

    // Ocultar: se va sin recargar y no vuelve.
    await p.getByTestId('getting-started-hide').click();
    await expect(gs).toBeHidden();
    await p.reload({ waitUntil: 'networkidle' });
    await expect(p.getByTestId('getting-started')).toHaveCount(0);
    // El onboarding terminado no se vuelve a ver.
    await p.goto('/en/app/welcome', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app$/);

    // El estado que leen otros (emails del ciclo de vida) sale de la API.
    const state = (await (await ctx.request.get('/api/onboarding')).json()) as { state: { pending: string[]; desktop: { seenAt: string | null }; apps: string[] } };
    expect(state.state.pending).toEqual(['import']);
    expect(state.state.desktop.seenAt).toBeTruthy();
    expect(state.state.apps).toEqual(['track', 'docs', 'talk', 'notes', 'cal']);
  } finally {
    await ctx.close();
  }
});

test('en portugués a 390 px y en oscuro: cada paso sin scroll horizontal, y "Pular o resto"', async ({ browser }) => {
  test.setTimeout(90_000);
  const { ctx, p } = await newPerson(browser, { width: 390, scheme: 'dark' });
  try {
    await p.goto('/pt/app', { waitUntil: 'networkidle' });
    await expect(p.getByRole('heading', { name: 'Como você vai usar o zerosoft?' })).toBeVisible();
    await noHorizontalScroll(p, 'use');
    await p.getByText('Com a minha equipe').click();
    await p.getByTestId('wl-next').click();
    await p.getByLabel('Nome da equipe').fill('Equipe com um nome bem comprido para ver se quebra direito no telefone');
    await p.getByTestId('wl-next').click();
    await noHorizontalScroll(p, 'you');
    await p.getByText('Suporte', { exact: true }).click();
    await p.getByTestId('wl-next').click();
    await expect(p.getByRole('heading', { name: 'Quais apps você vai usar?' })).toBeVisible();
    await noHorizontalScroll(p, 'apps');
    await p.getByTestId('wl-next').click();
    await noHorizontalScroll(p, 'invite');
    await p.getByRole('button', { name: 'Pular por agora' }).click();
    await expect(p.getByRole('heading', { name: 'Conecte suas contas' })).toBeVisible();
    await noHorizontalScroll(p, 'connect');
    await p.getByTestId('wl-next').click();
    await noHorizontalScroll(p, 'import');
    await p.getByTestId('wl-next').click();
    await expect(p.getByRole('heading', { name: 'Tenha o zerosoft no seu computador' })).toBeVisible();
    await noHorizontalScroll(p, 'desktop');
    await p.getByRole('button', { name: 'Voltar' }).click();
    await p.getByRole('button', { name: 'Voltar' }).click();
    await p.getByRole('button', { name: 'Pular o resto' }).click();
    await p.waitForURL(/\/pt\/app$/);
    await expect(p.getByTestId('getting-started')).toContainText('Primeiros passos');
    await expect(p.getByTestId('gs-whatsapp')).toContainText('Conecte uma linha de WhatsApp');
    await noHorizontalScroll(p, 'home');
    await p.goto('/pt/app/download', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('desktop-download')).toBeVisible();
    await noHorizontalScroll(p, 'download');
  } finally {
    await ctx.close();
  }
});

test('dentro de la app de escritorio: sin paso de descarga, sin entrada en el menú y la app avisa sola', async ({ browser }) => {
  const { ctx, p, email } = await newPerson(browser, { desktopApp: true });
  try {
    await p.goto('/es/app', { waitUntil: 'networkidle' });
    await p.getByText('Solo yo').click();
    await p.getByTestId('wl-next').click();
    await p.getByTestId('wl-next').click();
    // Sin rol: Track, Notes, Docs, Cal, Board y Link. Se saca Cal: no hay nada que conectar.
    await p.locator('[data-testid="wl-app"][data-app="cal"]').click();
    await p.getByTestId('wl-next').click();
    await expect(p.getByRole('heading', { name: '¿Venís de otra herramienta?' })).toBeVisible();
    await expect(p.getByText('Configuración 1 de 1')).toBeVisible();
    await p.getByRole('button', { name: 'Ir al inicio' }).click();
    await p.waitForURL(/\/es\/app$/);
    // La app avisa una vez desde cualquier página (DesktopSeen): queda en el perfil y el paso se marca.
    await expect
      .poll(async () => JSON.parse(String((await sql('SELECT profile FROM users WHERE email = ?', [email]))[0].profile)).desktopPlatform ?? null)
      .toBe('darwin');
    const row = await sql('SELECT profile FROM users WHERE email = ?', [email]);
    expect(JSON.parse(String(row[0].profile))).toMatchObject({ desktopVersion: '0.1.0' });
    // Lo único pendiente era el escritorio: con eso hecho, "Primeros pasos" dice que está todo.
    await p.reload({ waitUntil: 'networkidle' });
    await expect(p.getByTestId('getting-started-progress')).toHaveText('2 de 2 listos');
    await expect(p.getByTestId('getting-started')).toContainText('Ya está todo.');
    await p.getByTestId('workspace-switcher').click();
    await expect(p.getByTestId('side-settings')).toBeVisible();
    await expect(p.getByTestId('side-download')).toHaveCount(0);
    await p.goto('/es/app/download', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('desktop-done')).toContainText('Estás en la app de escritorio.');
  } finally {
    await ctx.close();
  }
});
