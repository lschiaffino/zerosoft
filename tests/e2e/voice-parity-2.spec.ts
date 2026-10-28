import http from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

/**
 * Voice, ronda 2: calendario (Google falso de Cal) con brief y aviso,
 * carpetas, compartir por link, recipes, email de seguimiento, Slack y Notion
 * falsos, Command Mode, transforms, aprender del historial, uso del equipo,
 * retención y MCP. Transcripción e IA falsas (VOICE_TRANSCRIBE_PROVIDER=fake,
 * VOICE_AI_FAKE=1).
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write'], { origin: baseURL! });
});

const uid = () => Math.random().toString(36).slice(2, 8);
const content = (page: Page) => page.locator('main.app-content');

async function meetingWithNotes(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/voice/sessions', { data: { title } });
  const { id } = (await res.json()) as { id: string };
  await page.request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Pricing per seat\nAnnual billing agreed' } });
  return id;
}

test('calendario: eventos de Google con asistentes, brief, tomar notas y aviso previo', async ({ page }) => {
  await page.goto('/en/app/calendar/settings?tab=connections', { waitUntil: 'networkidle' });
  const google = page.locator('.cal-conn').filter({ hasText: 'Google Calendar' });
  if (await google.getByRole('button', { name: 'Connect' }).isVisible()) {
    await google.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Google Calendar connected.')).toBeVisible();
  }

  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  const upcoming = page.getByTestId('voice-upcoming');
  const event = upcoming.locator('li').filter({ hasText: 'Pricing review' });
  await expect(event).toBeVisible();
  await expect(event).toContainText('Google Calendar');
  await expect(event).toContainText('Ana Guest');

  // Brief: sin reuniones anteriores con Ana todavía.
  await event.getByRole('button', { name: 'Brief' }).click();
  const brief = page.getByRole('dialog', { name: /Before Pricing review/ });
  await expect(brief).toContainText(/no previous meetings|Based on/);
  await page.keyboard.press('Escape');
  await expect(brief).toBeHidden();

  // Tomar notas: la reunión sale del evento con su asistente.
  const btn = event.getByRole('button', { name: 'Take notes' });
  const open = event.getByRole('link', { name: 'Open notes' });
  if (await btn.isVisible()) await btn.click();
  else await open.click();
  await expect(page).toHaveURL(/\/app\/voice\/meetings\//);
  await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue('Pricing review');
  await page.getByRole('tab', { name: 'Links' }).click();
  await expect(page.locator('.vc-attendees')).toContainText('Ana Guest');
  // Brief dentro de la reunión.
  await page.getByRole('button', { name: /Prepare a brief|Update brief/ }).click();
  await expect(page.locator('.vc-brief')).toContainText(/no previous meetings|Based on/);

  // De vuelta, el evento ya abre esas notas.
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('voice-upcoming').locator('li').filter({ hasText: 'Pricing review' }).getByRole('link', { name: 'Open notes' })).toBeVisible();

  // Aviso previo: el evento empieza en 4 minutos; con 5 minutos de anticipación avisa.
  await page.request.patch('/api/voice/settings', { data: { reminders: true, reminderMinutes: 5 } });
  await page.evaluate(() => Object.keys(localStorage).forEach((k) => k.startsWith('zs-voice-reminded') && localStorage.removeItem(k)));
  await page.goto('/en/app/notes', { waitUntil: 'networkidle' });
  const reminder = page.getByTestId('voice-reminder');
  await expect(reminder).toContainText('Pricing review', { timeout: 20_000 });
  await expect(reminder).toContainText(/Starts in/);
  await reminder.getByRole('button', { name: 'Dismiss' }).click();
  await expect(reminder).toBeHidden();
  await page.request.patch('/api/voice/settings', { data: { reminderMinutes: 2 } });
});

test('carpetas: crear, subcarpeta, mover, filtrar, renombrar y borrar sin perder reuniones', async ({ page }) => {
  const title = `Folder meeting ${uid()}`;
  await page.request.post('/api/voice/sessions', { data: { title } });
  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  const folders = page.getByRole('navigation', { name: 'Meeting folders' });
  const name = `Clients ${uid()}`;
  await folders.getByRole('button', { name: 'New folder' }).click();
  await folders.getByRole('textbox', { name: 'Folder name' }).fill(name);
  await folders.getByRole('textbox', { name: 'Folder name' }).press('Enter');
  await expect(content(page).getByRole('heading', { name })).toBeVisible();
  await expect(page).toHaveURL(/folder=/);
  await expect(content(page).getByText('No meetings in this folder yet.')).toBeVisible();

  // Subcarpeta.
  await page.getByRole('button', { name: 'New subfolder' }).click();
  await folders.getByRole('textbox', { name: 'Folder name' }).fill('Acme');
  await folders.getByRole('textbox', { name: 'Folder name' }).press('Enter');
  await expect(content(page).getByRole('heading', { name: /Acme/ })).toBeVisible();

  // Mover la reunión desde "Todas".
  await folders.getByRole('button', { name: 'All meetings' }).click();
  const row = page.getByTestId('voice-meeting-row').filter({ hasText: title });
  await row.getByRole('combobox', { name: `Folder of “${title}”` }).selectOption({ label: `${name} / Acme` });
  await folders.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByTestId('voice-meeting-row').filter({ hasText: title })).toBeVisible();

  // Renombrar y borrar la carpeta: la reunión queda.
  await page.getByRole('button', { name: 'Rename folder' }).click();
  const renamed = `${name} B`;
  await folders.getByRole('textbox', { name: 'Folder name' }).fill(renamed);
  await folders.getByRole('textbox', { name: 'Folder name' }).press('Enter');
  await expect(content(page).getByRole('heading', { name: renamed })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(content(page).getByRole('heading', { name: renamed })).toBeVisible();
  await page.getByRole('button', { name: 'Delete folder' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete folder' }).click();
  await expect(folders.getByRole('button', { name: new RegExp(`^${renamed}`) })).toHaveCount(0);
  await expect(page.getByTestId('voice-meeting-row').filter({ hasText: title })).toBeVisible();
});

test('compartir por link, email de seguimiento, recipes y Notion', async ({ page, request }) => {
  const title = `Shared call ${uid()}`;
  const id = await meetingWithNotes(page, title);
  await request.post(`/api/voice/sessions/${id}/enhance`, { data: { locale: 'en' } });
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });

  // Compartir: link de workspace, se abre de solo lectura, se revoca.
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByTestId('voice-share');
  await expect(share.getByRole('radio', { name: /People in this workspace/ })).toBeChecked();
  await share.getByRole('button', { name: 'Create link' }).click();
  await expect(share.getByText('Link created.')).toBeVisible();
  const url = await share.getByRole('textbox', { name: 'Link to the meeting' }).inputValue();
  expect(url).toMatch(/\/en\/m\/[\w-]{20,}$/);
  await share.getByRole('radio', { name: /Anyone with the link/ }).check();
  await share.getByRole('button', { name: 'Save' }).click();
  await expect(share.getByText('Saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Shared by link')).toBeVisible();

  const viewer = await page.context().newPage();
  await viewer.goto(url, { waitUntil: 'networkidle' });
  await expect(viewer.getByTestId('voice-shared-meeting')).toContainText(title);
  await expect(viewer.getByTestId('voice-shared-meeting')).toContainText('read only');
  // Sin la transcripción: no se incluyó.
  await expect(viewer.getByText('Transcript', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await share.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(share.getByText(/Stopped sharing/)).toBeVisible();
  await page.keyboard.press('Escape');
  const gone = await viewer.goto(url);
  expect(gone?.status()).toBe(404);
  await viewer.close();

  // Email de seguimiento: borrador editable que abre Gmail.
  await page.getByRole('button', { name: 'Follow-up email' }).click();
  const fu = page.getByTestId('voice-followup');
  await fu.getByRole('button', { name: 'Write the draft' }).click();
  await expect(fu.getByRole('textbox', { name: 'Subject' })).toHaveValue(/Follow-up/);
  await fu.getByRole('textbox', { name: 'To' }).fill('ana@acme.test');
  await expect(fu.getByRole('link', { name: 'Open in Gmail' })).toHaveAttribute('href', /mail\.google\.com.*to=ana%40acme\.test/);
  await expect(fu.getByRole('link', { name: 'Open in Outlook' })).toHaveAttribute('href', /outlook\.office\.com/);
  await fu.getByRole('button', { name: 'Save draft' }).click();
  await expect(fu.getByText('Draft saved.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Recipe de fábrica con / en el chat de la reunión.
  await page.getByRole('tab', { name: 'Ask' }).click();
  const ask = page.getByRole('combobox', { name: 'Ask about this meeting' });
  await ask.fill('/act');
  await expect(page.getByRole('option', { name: /Action items/ })).toBeVisible();
  await ask.press('Enter');
  await expect(page.locator('.vc-msg.is-user').last()).toContainText('/Action items');
  await expect(page.locator('.vc-msg.is-assistant').last()).not.toBeEmpty();

  // Notion con una credencial de Flow (Notion falso).
  await request.post('/api/flow/credentials', { data: { name: `notion_${uid()}`, type: 'notion', data: { token: 'ntn_fake' } } });
  await page.getByRole('button', { name: 'Slack or Notion' }).click();
  const send = page.getByTestId('voice-send');
  await send.getByRole('textbox', { name: /Parent page/ }).fill('https://www.notion.so/Team-0123456789abcdef0123456789abcdef');
  await send.getByRole('button', { name: 'Create Notion page' }).click();
  await expect(send.getByText('Created a page in Notion.')).toBeVisible();
});

test('recipes propios en ajustes y entre reuniones; ⌘K los encuentra', async ({ page }) => {
  const name = `Risks ${uid()}`;
  await page.goto('/en/app/voice/settings?tab=prompts', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New recipe' }).click();
  await page.getByLabel('Name').first().fill(name);
  await page.getByLabel('Prompt').first().fill('List the risks mentioned.');
  await page.getByRole('checkbox', { name: 'Share with the workspace' }).check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('voice-recipe-row').filter({ hasText: name })).toContainText('Shared');

  await page.goto('/en/app/voice', { waitUntil: 'networkidle' });
  const ask = page.getByRole('combobox', { name: 'Ask your meetings' });
  await ask.fill(`/${name}`);
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await ask.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill(name);
  await dialog.getByRole('option', { name: new RegExp(name) }).first().click();
  await expect(page).toHaveURL(/tab=prompts&prompt=/);
  await expect(page.getByTestId('voice-recipe-row').filter({ hasText: name })).toHaveClass(/is-highlight/);

  // Borrar sin recargar.
  await page.getByTestId('voice-recipe-row').filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('voice-recipe-row').filter({ hasText: name })).toHaveCount(0);
});

test('dictado: Command Mode, transforms y aprender de una corrección', async ({ page, context, baseURL }) => {
  await page.request.patch('/api/voice/settings', { data: { commandMode: true, learnCorrections: true, showBar: true } });
  await context.addCookies([{ name: 'voice_fake_text', value: encodeURIComponent('make it shorter'), url: baseURL! }]);
  // El dictado global lee Command Mode de los ajustes al cargar: se espera esa respuesta.
  await Promise.all([page.waitForResponse((r) => r.url().includes('/api/voice/settings') && r.ok()), page.goto('/en/app/voice/dictation', { waitUntil: 'networkidle' })]);
  const field = page.getByRole('textbox', { name: 'Try it here' });
  await field.fill('First sentence here. Second sentence there.');
  await field.press('ControlOrMeta+a');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
  await expect(page.getByRole('status').filter({ hasText: /Say what to do|Opening/ })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');
  await expect(field).toHaveValue('First sentence here.', { timeout: 15_000 });
  await expect(page.getByText(/Rewrote the selection/)).toBeVisible();

  await page.request.patch('/api/voice/settings', { data: { commandMode: false } });

  // Transform desde el lápiz del campo (el botón del campo no sale en la página de Dictado: probamos en una reunión).
  const meeting = (await (await page.request.post('/api/voice/sessions', { data: { title: `Transforms ${uid()}` } })).json()) as { id: string };
  await page.goto(`/en/app/voice/meetings/${meeting.id}`, { waitUntil: 'networkidle' });
  const notes = page.getByRole('textbox', { name: 'My notes' });
  await notes.fill('One idea. Another idea.');
  await notes.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Rewrite the selected text' }).click();
  await page.getByRole('menuitem', { name: 'Bullet list' }).click();
  await expect(notes).toHaveValue('- One idea\n- Another idea', { timeout: 15_000 });
  await page.goto('/en/app/voice/dictation', { waitUntil: 'networkidle' });

  // Aprender: corregir un dictado del historial suma el término al diccionario.
  await context.addCookies([{ name: 'voice_fake_text', value: encodeURIComponent(`call zerosof ${uid()} today`), url: baseURL! }]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start dictating' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Stop and clean up' }).click();
  const row = page.getByTestId('voice-dictation-row').first();
  await expect(row).toContainText(/zerosof/i);
  await row.getByRole('button', { name: 'Edit' }).click();
  const editor = row.getByRole('textbox');
  await editor.fill((await editor.inputValue()).replace(/zerosof\b/i, 'ZeroSoft'));
  await editor.blur();
  const learned = page.getByTestId('voice-learned');
  await expect(learned).toContainText('ZeroSoft');
  await learned.getByRole('button', { name: 'Undo' }).click();
  await expect(learned).toHaveCount(0);
});

test('ajustes: reuniones (avisos y retención), equipo, MCP; 390px y oscuro', async ({ page, context, baseURL }) => {
  await page.goto('/en/app/voice/settings?tab=meetings', { waitUntil: 'networkidle' });
  await page.getByLabel('Delete transcripts after').selectOption('30');
  await page.getByRole('button', { name: 'Save' }).nth(1).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Delete transcripts after')).toHaveValue('30');
  await page.getByLabel('Delete transcripts after').selectOption('0');
  await page.getByRole('button', { name: 'Save' }).nth(1).click();
  await expect(page.getByLabel('Delete transcripts of everyone after')).toBeVisible();

  await page.goto('/en/app/voice/settings?tab=team', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('voice-team-usage').or(page.getByText('Nobody used Voice in this period.'))).toBeVisible();

  await page.goto('/en/app/voice/settings?tab=desktop', { waitUntil: 'networkidle' });
  await expect(page.getByText('/api/v1/voice/mcp').first()).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const path of ['/en/app/voice', '/en/app/voice/settings?tab=team', '/en/app/voice/settings?tab=prompts']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path, { waitUntil: 'networkidle' });
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${path} ${theme}`).toBeLessThanOrEqual(inner + 1);
    }
  }
});

test('API: MCP solo con voice:read y solo las reuniones propias', async ({ request }) => {
  const res = await request.post('/api/v1/voice/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  expect(res.status()).toBe(401);
});

// ---------- Webhooks voice.* (entrega real) ----------

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Una persona más en el workspace demo, con el rol pedido. */
async function teammate(role: 'admin' | 'member'): Promise<string> {
  const id = `voice-${uid()}`;
  await sql('INSERT INTO users (id, email, name, handle) VALUES (?, ?, ?, ?)', [id, `${id}@example.com`, `Voice ${role}`, id]);
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  await sql('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [team, id, role]);
  return id;
}

/** Un receptor de webhooks local que guarda lo que le llega. */
function receiver() {
  const got: Array<{ event: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ event: String(req.headers['zerosoft-event'] ?? ''), body });
      res.writeHead(200).end('ok');
    });
  });
  return new Promise<{ url: string; got: typeof got; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/hook`, got, close: () => server.close() });
    }),
  );
}

test('webhooks: voice.* llega al webhook de quien grabó y no al de otra persona (admin) del workspace', async ({ request }) => {
  const mine = await receiver();
  const theirs = await receiver();
  try {
    const events = ['voice.meeting.completed', 'voice.notes.ready'];
    const a = (await (await request.post('/api/webhooks', { data: { url: mine.url, events } })).json()) as { id: string };
    const b = (await (await request.post('/api/webhooks', { data: { url: theirs.url, events } })).json()) as { id: string };
    // El segundo webhook pasa a ser de un admin del mismo workspace.
    const admin = await teammate('admin');
    await sql('UPDATE webhooks SET created_by = ? WHERE id = ?', [admin, b.id]);

    // Reunión de la persona demo: grabar y cortar.
    const title = `Webhook call ${uid()}`;
    const { id } = (await (await request.post('/api/voice/sessions', { data: { title } })).json()) as { id: string };
    await request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Annual billing agreed' } });
    expect((await request.patch(`/api/voice/sessions/${id}`, { data: { status: 'recording', recorderId: `tab-${uid()}abcdef` } })).ok()).toBe(true);
    expect((await request.patch(`/api/voice/sessions/${id}`, { data: { status: 'done' } })).ok()).toBe(true);

    await expect.poll(() => mine.got.filter((g) => g.event === 'voice.meeting.completed' && g.body.includes(title)).length, { timeout: 20_000 }).toBe(1);
    // La nota con IA se arma sola al cortar: también llega voice.notes.ready.
    await expect.poll(() => mine.got.filter((g) => g.event === 'voice.notes.ready' && g.body.includes(title)).length, { timeout: 30_000 }).toBe(1);
    const deliveries = (await (await request.get(`/api/webhooks/${a.id}/deliveries`)).json()) as { rows: Array<{ status: string; event: string }> };
    expect(deliveries.rows.filter((r) => r.event.startsWith('voice.')).every((r) => r.status === 'delivered')).toBe(true);

    // Reunión del admin (cerrada por el cron como grabación colgada): llega a su webhook, no al de la persona demo.
    const adminMeeting = `vs-${uid()}`;
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await sql(
      `INSERT INTO voice_sessions (id, workspace_id, person_id, kind, title, status, started_at, created_at, updated_at, recorder_seen_at, last_chunk_at)
       VALUES (?, 'demo', ?, 'meeting', ?, 'recording', ?, ?, ?, ?, ?)`,
      [adminMeeting, admin, `Admin call ${uid()}`, old, old, old, old, old],
    );
    expect((await request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
    await expect.poll(() => theirs.got.filter((g) => g.body.includes(adminMeeting)).length, { timeout: 20_000 }).toBeGreaterThan(0);

    // Nada de la reunión demo llegó al webhook del admin, ni la del admin al de demo.
    expect(theirs.got.some((g) => g.body.includes(title))).toBe(false);
    expect(mine.got.some((g) => g.body.includes(adminMeeting))).toBe(false);
  } finally {
    mine.close();
    theirs.close();
  }
});

test('carpetas ajenas: filtrar por una carpeta que no es tuya da 404', async ({ request }) => {
  expect((await request.get('/api/voice/sessions?kind=meeting&folderId=not-mine')).status()).toBe(404);
  expect((await request.get('/api/voice/sessions?kind=meeting&folder=not-mine')).status()).toBe(404);
  expect((await request.get('/api/voice/sessions?kind=meeting&folder=none')).ok()).toBe(true);
});

test('acceso por app: una persona sin Voice no ve páginas, APIs, MCP, links compartidos ni el dictado', async ({ request, browser, baseURL }) => {
  test.setTimeout(120_000);
  // Una reunión del owner compartida con todo el workspace.
  const title = `Sin Voice ${uid()}`;
  const { id } = (await (await request.post('/api/voice/sessions', { data: { title } })).json()) as { id: string };
  const share = (await (await request.put(`/api/voice/sessions/${id}/share`, { data: { access: 'workspace' } })).json()) as { share: { token: string } };

  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `novoice-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' }); // crea su usuario
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    // Páginas: redirigen al inicio con el aviso, sin datos de Voice.
    await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=voice/);
    expect(await p.content()).not.toContain(title);
    // Sin dictado global ni avisos de reunión en el resto de la app.
    await p.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await expect(p.locator('.vc-bar')).toHaveCount(0);
    await expect(p.getByTestId('voice-reminder')).toHaveCount(0);
    // APIs, búsqueda y MCP.
    for (const path of ['/api/voice/sessions?kind=meeting', '/api/voice/events', '/api/voice/settings', '/api/voice/shared', `/api/voice/sessions/${id}`]) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(title)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/voice'))).toEqual([]);
    expect((await ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['voice:read'] } })).status()).toBe(403);
    const key = (await (await ctx.request.post('/api/keys', { data: { name: 'crm only' } })).json()) as { key: string };
    const mcp = await request.post('/api/v1/voice/mcp', {
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status()).toBe(403);
    // El link "para el workspace" no le abre la reunión.
    await p.goto(`/en/m/${share.share.token}`, { waitUntil: 'networkidle' });
    await expect(p.getByTestId('voice-share-gate')).toHaveAttribute('data-state', 'forbidden');
    expect(await p.content()).not.toContain(title);
  } finally {
    await ctx.close();
  }
});
