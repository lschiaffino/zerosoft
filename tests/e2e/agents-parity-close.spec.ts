import { createHmac } from 'node:crypto';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Clave falsa armada en partes para que el escaneo de secretos no la confunda con una real.
const FAKE_STRIPE_KEY = ['rk', 'test', 'abcdefghijklmnopqrstuvwx'].join('_');

/**
 * Agents, cierre de paridad: procedimientos, botones y formularios,
 * canales (email, Slack, teléfono), conexiones, fuentes de Zendesk, test A/B
 * y acceso por agente. El modelo es el falso de lib/agents-ai.ts (cookie
 * agents_ai_fake=on); Stripe, Shopify, Slack, Meta y Zendesk usan el modo
 * fake (AGENTS_INTEGRATIONS_FAKE) y Twilio el de CRM_VOICE_FAKE.
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeAi(context: BrowserContext) {
  await context.addCookies([{ name: 'agents_ai_fake', value: 'on', url: `http://localhost:${BASE}` }]);
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function createAgent(request: APIRequestContext, name: string, patch: Record<string, unknown> = {}): Promise<string> {
  const body = await ok<{ id: string }>(request.post('/api/agents', { data: { name } }));
  if (Object.keys(patch).length) await ok(request.patch(`/api/agents/${body.id}`, { data: patch }));
  return body.id;
}

async function getSettings(request: APIRequestContext, id: string) {
  return (await ok<{ agent: { settings: Record<string, unknown>; tools: Record<string, unknown> } }>(request.get(`/api/agents/${id}`))).agent;
}

async function ask(page: Page, text: string) {
  const box = page.getByPlaceholder('Write a message…');
  await box.fill(text);
  await box.press('Enter');
  await expect(page.locator('.ag-msg.is-assistant').last()).not.toContainText('Thinking', { timeout: 15_000 });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const step = (s: Record<string, unknown>) => ({ text: '', field: null, answerType: 'text', options: [], formId: null, condition: null, goto: null, tool: null, args: {}, ...s });

test('procedimiento con botones en el playground; el editor se ve en claro, oscuro y 390 px', async ({ page, context, request }) => {
  await fakeAi(context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await createAgent(request, `Procedures ${uid()}`);
  const agent = await getSettings(request, id);
  await ok(
    request.patch(`/api/agents/${id}`, {
      data: {
        settings: {
          ...agent.settings,
          procedures: [
            {
              id: 'refund',
              name: 'Refund',
              trigger: 'The visitor wants a refund',
              keywords: ['refund'],
              steps: [
                step({ id: 'q1', kind: 'ask', text: 'What email did you use?', field: 'email', answerType: 'email' }),
                step({ id: 'q2', kind: 'ask', text: 'Was it delivered?', field: 'delivered', answerType: 'choice', options: ['Yes', 'No'] }),
                step({ id: 'b1', kind: 'branch', condition: { field: 'delivered', op: 'equals', value: 'No' }, goto: 'h1' }),
                step({ id: 'e1', kind: 'end', text: 'Refund started for {{email}}.' }),
                step({ id: 'h1', kind: 'handoff', text: 'Not delivered' }),
              ],
            },
          ],
        },
      },
    }),
  );

  await page.goto(`/en/app/agents/${id}`, { waitUntil: 'networkidle' });
  const proc = page.getByTestId('ag-procedures');
  await expect(proc.getByRole('heading', { name: 'Refund' })).toBeVisible();
  await expect(proc.getByLabel('Question').first()).toHaveValue('What email did you use?');
  // Agregar un paso marca el cambio sin guardar.
  await proc.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).first().click();

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await proc.scrollIntoViewIfNeeded();
    await noHorizontalScroll(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole('tab', { name: 'Playground' }).click();
  await ask(page, 'I need a refund');
  await expect(page.locator('.ag-msg.is-assistant').last()).toContainText('What email did you use?');
  await ask(page, 'it is ana@example.com');
  const buttons = page.locator('.ag-reply-buttons');
  await expect(buttons.getByRole('button', { name: 'Yes' })).toBeVisible();
  await buttons.getByRole('button', { name: 'Yes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ag-msg.is-assistant').last()).toContainText('Refund started for ana@example.com.', { timeout: 15_000 });
  await expect(page.locator('.ag-reply-buttons')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('formulario en la página pública: se valida, se envía y queda el contacto', async ({ page, context, request }) => {
  await fakeAi(context);
  const id = await createAgent(request, `Forms ${uid()}`);
  const handle = `forms-${uid()}`;
  const agent = await getSettings(request, id);
  await ok(
    request.patch(`/api/agents/${id}`, {
      data: {
        publicHandle: handle,
        tools: { ...agent.tools, enabled: ['show_form', 'handoff_to_human'] },
        settings: {
          ...agent.settings,
          forms: [
            {
              id: 'lead',
              name: 'Lead',
              title: 'Leave your details',
              submitLabel: 'Send details',
              saveToCrm: true,
              fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, options: [] },
                { key: 'email', label: 'Email', type: 'email', required: true, options: [] },
              ],
            },
          ],
        },
      },
    }),
  );
  const email = `lead-${uid()}@example.com`;
  await page.goto(`/en/a/${handle}`, { waitUntil: 'networkidle' });
  await ask(page, '/tool show_form {"formId":"lead"}');
  const form = page.locator('.ag-reply-form');
  await expect(form.getByText('Leave your details')).toBeVisible();
  await form.getByRole('button', { name: 'Send details' }).click();
  await expect(form.getByRole('alert')).toHaveText('Fill in the required fields.');
  await form.getByLabel('Name *').fill('Ana Lead');
  await form.getByLabel('Email *').fill(email);
  await form.getByRole('button', { name: 'Send details' }).click();
  await expect(page.locator('.ag-msg.is-user').last()).toContainText(`Email: ${email}`);
  await expect(page.locator('.ag-reply-form')).toHaveCount(0);

  const convs = await ok<{ conversations: Array<{ id: string }> }>(request.get(`/api/agents/${id}/conversations`));
  const detail = await ok<{ toolCalls: Array<{ tool: string; output: { saved?: boolean } }> }>(request.get(`/api/agents/${id}/conversations/${convs.conversations[0].id}`));
  expect(detail.toolCalls.find((c) => c.tool === 'form_submit')?.output.saved).toBe(true);
  // Un formulario inválido por la API se rechaza.
  const bad = await request.post(`/api/agents/public/${handle}`, { data: { visitorKey: 'k'.repeat(20), message: 'x', form: { id: 'lead', values: { name: 'Ana' } } }, headers: { cookie: 'agents_ai_fake=on' } });
  expect(bad.status()).toBe(200); // stream NDJSON
  expect(await bad.text()).toMatch(/form_(invalid|not_found)/);
});

test('canales: Slack conectado con su URL firmada, teléfono y email', async ({ page, context, request }) => {
  await fakeAi(context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await createAgent(request, `Channels ${uid()}`);
  await page.goto(`/en/app/agents/${id}?tab=channels`, { waitUntil: 'networkidle' });

  // Slack: conectar con la app del dueño (modo fake), la URL de eventos queda a la vista.
  const slack = page.getByTestId('ag-integration-slack');
  await slack.getByRole('button', { name: 'Connect' }).click();
  await slack.getByLabel('Bot token').fill('xoxb-1234567890-abcdefghij');
  const signingSecret = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  await slack.getByLabel('Signing secret').fill(signingSecret);
  await slack.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slack.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText(`/api/agents/${id}/slack`)).toBeVisible();

  const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac('sha256', signingSecret).update(`v0:${ts}:${body}`).digest('hex')}`;
  const verify = await request.post(`/api/agents/${id}/slack`, { data: body, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig } });
  expect(await verify.json()).toEqual({ challenge: 'abc123' });
  const forged = await request.post(`/api/agents/${id}/slack`, { data: body, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=bad' } });
  expect(forged.status()).toBe(401);
  // Un mensaje directo abre una conversación del agente con source 'slack'.
  const event = JSON.stringify({ type: 'event_callback', event_id: `Ev${uid()}`, team_id: 'T1', event: { type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'hello from slack', ts: '1.1' } });
  const sig2 = `v0=${createHmac('sha256', signingSecret).update(`v0:${ts}:${event}`).digest('hex')}`;
  await ok(request.post(`/api/agents/${id}/slack`, { data: event, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig2, cookie: 'agents_ai_fake=on' } }));
  await expect.poll(async () => (await ok<{ conversations: unknown[] }>(request.get(`/api/agents/${id}/conversations`))).conversations.length, { timeout: 15_000 }).toBe(1);

  // Teléfono: número de la cuenta (fake) y la llamada contesta por TwiML.
  // El número que el admin de la instancia asignó al workspace demo (AGENTS_VOICE_NUMBERS).
  const number = '+14155550142';
  await page.getByLabel('Twilio number').selectOption(number);
  await page.getByRole('button', { name: 'Save number' }).click();
  await expect(page.getByText('/api/agents/voice')).toBeVisible();
  const call = `CA${'0'.repeat(26)}${uid()}`.slice(0, 34);
  const start = await request.post('/api/agents/voice', { form: { To: number, From: '+5491155550000', CallSid: call }, headers: { cookie: 'agents_ai_fake=on' } });
  expect(await start.text()).toContain('<Gather input="speech"');
  const turn = await request.post('/api/agents/voice?step=turn&s=0', { form: { To: number, From: '+5491155550000', CallSid: call, SpeechResult: 'what are your hours' }, headers: { cookie: 'agents_ai_fake=on' } });
  // El agente (modelo falso) contesta y la llamada sigue escuchando.
  expect(await turn.text()).toMatch(/<Gather input="speech"[^>]*><Say language="en-US">[^<]+<\/Say><\/Gather>/);

  // Email: el interruptor es parte de la configuración (se guarda con el resto).
  await page.getByRole('switch', { name: 'Answer emails' }).check();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await getSettings(request, id)).settings.answerEmails).toBe(true);

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('el agente contesta un email que llega al widget y la respuesta sale por email', async ({ request }) => {
  const id = await createAgent(request, `Email ${uid()}`);
  const agent = await getSettings(request, id);
  await ok(request.patch(`/api/agents/${id}`, { data: { settings: { ...agent.settings, answerEmails: true } } }));
  const w = await ok<{ id: string }>(request.post('/api/chat/widgets', { data: { name: `Agent mail ${uid()}` } }));
  await ok(request.post(`/api/agents/${id}/widgets`, { data: { widgetId: w.id, assigned: true } }));
  const mail = await ok<{ address: string }>(request.get(`/api/chat/widgets/${w.id}/email`));
  const res = await ok<{ status: string; conversationId: string }>(
    request.post('/api/chat/inbound-email', {
      headers: { cookie: 'agents_ai_fake=on' },
      data: { type: 'email.received', data: { email_id: `e-${uid()}`, from: 'Pia <pia@cliente.test>', to: [mail.address], subject: 'Hours', text: 'What are your hours?' } },
    }),
  );
  expect(res.status).toBe('added');
  await expect
    .poll(async () => {
      const list = await ok<{ conversations: Array<{ id: string }> }>(request.get(`/api/agents/${id}/conversations`));
      if (!list.conversations[0]) return '';
      const d = await ok<{ messages: Array<{ role: string; content: string }> }>(request.get(`/api/agents/${id}/conversations/${list.conversations[0].id}`));
      return d.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ');
    }, { timeout: 20_000 })
    .toMatch(/\S/);
});

test('conexiones de Stripe y Shopify, Zendesk y búsqueda semántica', async ({ page, context, request }) => {
  await fakeAi(context);
  const id = await createAgent(request, `Commerce ${uid()}`);
  await page.goto(`/en/app/agents/${id}?tab=tools`, { waitUntil: 'networkidle' });
  const advanced = page.locator('.ui-disclosure-toggle').first();
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  const stripe = page.getByTestId('ag-integration-stripe');
  await stripe.getByRole('button', { name: 'Connect' }).click();
  await stripe.getByLabel('Secret key').fill(FAKE_STRIPE_KEY);
  await stripe.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(stripe.getByText('test key ending in uvwx')).toBeVisible();
  const integrations = await ok<{ integrations: unknown }>(request.get(`/api/agents/${id}/integrations`));
  expect(JSON.stringify(integrations)).not.toContain('abcdefghijklmnop');
  await stripe.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(stripe.getByText('Not connected', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Knowledge' }).click();
  await page.getByLabel('Zendesk subdomain').fill('acme');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('ag-sources').getByText('acme.zendesk.com')).toBeVisible();
  await ok(request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } }));
  await expect(page.getByTestId('ag-sources').getByText('2 articles')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('switch', { name: 'Use semantic search' }).check();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('ag-semantic-status')).toContainText(/passages indexed|Nothing to index/, { timeout: 20_000 });
});

test('test A/B y acceso por agente', async ({ page, request }) => {
  const id = await createAgent(request, `AB ${uid()}`, { instructions: 'first' });
  await ok(request.post(`/api/agents/${id}/versions`, { data: { note: 'one' } }));
  await ok(request.patch(`/api/agents/${id}`, { data: { instructions: 'second' } }));
  await ok(request.post(`/api/agents/${id}/versions`, { data: { note: 'two' } }));
  await page.goto(`/en/app/agents/${id}?tab=versions`, { waitUntil: 'networkidle' });
  await page.getByLabel('Version B').selectOption({ label: 'v1 · one' });
  await page.getByLabel('% of new conversations').fill('30');
  await page.getByRole('button', { name: 'Start test' }).click();
  await expect(page.getByTestId('ag-ab-running')).toContainText('Version 1 answers 30% of new conversations');
  await expect(page.getByRole('row', { name: /A: live/ })).toBeVisible();
  await page.getByRole('button', { name: 'End test' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'End test' }).click();
  await expect(page.getByText('Start test')).toBeVisible();

  await page.getByRole('tab', { name: 'Instructions' }).click();
  await page.getByLabel('Members by default').selectOption('none');
  await expect(page.getByLabel('Members by default')).toHaveValue('none');
  const access = await ok<{ access: { members: string } }>(request.get(`/api/agents/${id}/access`));
  expect(access.access.members).toBe('none');
  // El demo es owner: sigue viendo el agente en la lista.
  const list = await ok<{ agents: Array<{ id: string }> }>(request.get('/api/agents'));
  expect(list.agents.some((a) => a.id === id)).toBe(true);
});

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Otra persona del workspace demo (cookie zs_e2e_as), con las apps indicadas. */
async function member(browser: Browser, apps: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `agents-qa-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL: `http://localhost:${BASE}` });
  await ctx.addCookies([
    { name: 'zs_e2e_as', value: email, url: `http://localhost:${BASE}` },
    { name: 'agents_ai_fake', value: 'on', url: `http://localhost:${BASE}` },
  ]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  await p.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  await sql("UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [team, id]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)", [team, id, apps]);
  return { ctx, id };
}

test('acceso: un viewer no consulta Stripe en el playground ni lee o contesta conversaciones de un agente oculto', async ({ request, browser }) => {
  const id = await createAgent(request, `Access QA ${uid()}`);
  const a = await getSettings(request, id);
  const handle = `accqa-${uid()}`;
  await ok(request.post(`/api/agents/${id}/integrations`, { data: { kind: 'stripe', key: FAKE_STRIPE_KEY } }));
  await ok(request.patch(`/api/agents/${id}`, { data: { publicHandle: handle, tools: { ...a.tools, enabled: ['stripe_customer'] } } }));
  const viewer = await member(browser, '["agents"]');
  const hidden = await member(browser, '["agents"]');
  await ok(request.patch(`/api/agents/${id}/access`, { data: { person: { id: hidden.id, role: 'none' } } }));

  const pg = await viewer.ctx.request.post(`/api/agents/${id}/messages`, { data: { message: '/tool stripe_customer {"email":"ana@example.com"}' } });
  const text = await pg.text();
  expect(text).not.toContain('INV-0042');
  expect(text).toContain('playground_no_access');

  const pub = await request.post(`/api/agents/public/${handle}`, { data: { visitorKey: 'v'.repeat(20), message: 'private question' }, headers: { cookie: 'agents_ai_fake=on' } });
  const conv = /"conversationId":"([^"]+)"/.exec(await pub.text())?.[1] ?? '';
  expect(conv).not.toBe('');
  expect((await hidden.ctx.request.get(`/api/agents/${id}/conversations/${conv}`)).status()).toBe(404);
  expect((await hidden.ctx.request.post(`/api/agents/${id}/conversations/${conv}`, { data: { message: 'reply' } })).status()).toBe(404);
  expect((await viewer.ctx.request.post(`/api/agents/${id}/conversations/${conv}`, { data: { message: 'reply' } })).status()).toBe(403);
  // Un editor sin la app CRM no puede activar una herramienta del CRM.
  await ok(request.patch(`/api/agents/${id}/access`, { data: { person: { id: viewer.id, role: 'editor' } } }));
  const cur = await getSettings(request, id);
  const enable = await viewer.ctx.request.patch(`/api/agents/${id}`, { data: { tools: { ...cur.tools, enabled: ['stripe_customer', 'crm_find_contact'] } } });
  expect(((await enable.json()) as { error?: string }).error).toBe('tool_app_access');
  await viewer.ctx.close();
  await hidden.ctx.close();
});
