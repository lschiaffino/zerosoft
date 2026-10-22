import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Regresiones del benchmark (tanda 3): el widget de Chat conserva el hilo al
 * resolver, la página pública de un agente no muestra errores para el dueño,
 * el tablero de deals acepta el drop en toda la columna y el composer del
 * timeline guarda con Cmd/Ctrl+Enter con un solo selector de tipo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

test('chat: el agente resuelve con el widget abierto y el visitante sigue viendo el hilo y la encuesta', async ({ page, request }) => {
  const widget = await (await request.post('/api/chat/widgets', { data: { name: `Resolve ${uid()}` } })).json();
  await page.goto('/en/privacy', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ url: `/api/chat/widget.js?id=${widget.id}` });
  await page.locator('#zs-chat-btn').click();
  const box = page.locator('#zs-chat-box');
  await expect(box).toBeVisible();

  const posted = page.waitForResponse((r) => r.url().includes('/api/chat/messages') && r.request().method() === 'POST');
  await box.getByPlaceholder('Type a message…').fill('Hi, my order is late');
  await box.getByPlaceholder('Type a message…').press('Enter');
  const { conversation } = await (await posted).json();
  await expect(box.getByText('Hi, my order is late')).toBeVisible();

  const reply = await request.post(`/api/chat/conversations/${conversation.id}/messages`, { data: { body: 'It ships today' } });
  expect(reply.ok()).toBe(true);
  await expect(box.getByText('It ships today')).toBeVisible({ timeout: 15_000 });

  const resolved = await request.patch(`/api/chat/conversations/${conversation.id}`, { data: { status: 'resolved' } });
  expect(resolved.ok()).toBe(true);
  // Aparece la encuesta (siguiente poll) y el hilo sigue ahí después de otro poll.
  await expect(box.getByText('How would you rate your experience?')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6_000);
  await expect(box.getByText('Hi, my order is late')).toBeVisible();
  await expect(box.getByText('It ships today')).toBeVisible();
  await expect(box.getByText('How would you rate your experience?')).toBeVisible();

  // Escribir de nuevo abre otra conversación: el hilo empieza de cero.
  const second = page.waitForResponse((r) => r.url().includes('/api/chat/messages') && r.request().method() === 'POST');
  await box.getByPlaceholder('Type a message…').fill('One more question');
  await box.getByPlaceholder('Type a message…').press('Enter');
  const next = await (await second).json();
  expect(next.conversation.id).not.toBe(conversation.id);
  await expect(box.getByText('One more question')).toBeVisible();
  await expect(box.getByText('It ships today')).toHaveCount(0);
});

test('agents: la página pública nunca devuelve el código de error pensado para el dueño', async ({ page }) => {
  const created = await (await page.request.post('/api/agents', { data: { name: `Public ${uid()}` } })).json();
  const id = created.agent?.id ?? created.id;
  const handle = `pub-${uid()}`;
  const patched = await page.request.patch(`/api/agents/${id}`, { data: { publicHandle: handle } });
  expect(patched.ok()).toBe(true);
  // El server de e2e no tiene AI: antes la API pública respondía "ai_disabled".
  const res = await page.request.post(`/api/agents/public/${handle}`, { data: { visitorKey: 'v'.repeat(24), message: 'hola' } });
  const text = await res.text();
  expect(text).not.toContain('ai_disabled');
  expect(text).not.toContain('ai_no_credits');
  // Sin modelo: o un error neutro, o (si el agente deriva) el aviso de derivación.
  expect(text.includes('unavailable') || text.includes('"handoff":true')).toBe(true);
});

async function pipelineWithStages(request: APIRequestContext, names: string[]) {
  const p = await (await request.post('/api/crm/pipelines', { data: { name: `Bench ${uid()}` } })).json();
  const stages: Array<{ id: string; name: string }> = [];
  for (const n of names) {
    stages.push(await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: n } })).json());
  }
  return { id: p.id as string, stages };
}

test('crm tablero: soltar en el título, en "+ Add deal" o en el espacio vacío mueve el deal', async ({ page, request }) => {
  const p = await pipelineWithStages(request, ['Lead', 'Qualified', 'Proposal', 'Demo']);
  const [lead, qualified, proposal, demo] = p.stages;
  const deal = await (await request.post('/api/crm/deals', { data: { name: `Drop ${uid()}`, pipelineId: p.id, stageId: lead.id } })).json();
  // Una columna alta para que las otras tengan espacio vacío debajo.
  for (let i = 0; i < 4; i++) {
    await request.post('/api/crm/deals', { data: { name: `Filler ${i} ${uid()}`, pipelineId: p.id, stageId: lead.id } });
  }
  // Ancho para que las cuatro columnas entren sin scroll horizontal.
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });

  const col = (stageId: string) => page.locator('.kb-col').filter({ has: page.locator(`.kb-cards[data-stage-id="${stageId}"]`) });
  async function dragTo(x: number, y: number) {
    const card = page.locator(`.kb-card[data-deal-id="${deal.id}"]`);
    const from = (await card.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
  }
  async function stageOf(): Promise<string> {
    const saved = await (await request.get(`/api/crm/deals/${deal.id}`)).json();
    return (saved.deal ?? saved).stage_id;
  }

  // 1. Título de la columna.
  const head = (await col(qualified.id).locator('.kb-col-head').boundingBox())!;
  await dragTo(head.x + head.width / 2, head.y + head.height / 2);
  await expect(page.locator(`.kb-cards[data-stage-id="${qualified.id}"] .kb-card[data-deal-id="${deal.id}"]`)).toBeVisible();
  await expect.poll(stageOf).toBe(qualified.id);

  // 2. Botón "+ Add deal".
  const add = (await col(proposal.id).locator('.kb-add').boundingBox())!;
  await dragTo(add.x + add.width / 2, add.y + add.height / 2);
  await expect(page.locator(`.kb-cards[data-stage-id="${proposal.id}"] .kb-card[data-deal-id="${deal.id}"]`)).toBeVisible();
  await expect.poll(stageOf).toBe(proposal.id);

  // 3. Espacio vacío debajo del botón (la columna llega al alto de la más alta).
  const demoCol = (await col(demo.id).boundingBox())!;
  const demoAdd = (await col(demo.id).locator('.kb-add').boundingBox())!;
  expect(demoCol.y + demoCol.height).toBeGreaterThan(demoAdd.y + demoAdd.height + 40);
  await dragTo(demoCol.x + demoCol.width / 2, demoCol.y + demoCol.height - 15);
  await expect(page.locator(`.kb-cards[data-stage-id="${demo.id}"] .kb-card[data-deal-id="${deal.id}"]`)).toBeVisible();
  await expect.poll(stageOf).toBe(demo.id);
});

test('crm timeline: Cmd/Ctrl+Enter guarda y el tipo sale de una sola fuente', async ({ page, request }) => {
  const contact = await (
    await request.post('/api/crm/contacts', { data: { firstName: 'Kbd', lastName: uid(), email: `kbd-${uid()}@example.com` } })
  ).json();
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
  const composer = page.locator('form.tl-composer');
  const rows = async () =>
    ((await (await request.get(`/api/crm/activities?contactId=${contact.id}`)).json()).rows as Array<{ type: string; body: string | null }>);

  // Nota con Ctrl+Enter (Meta+Enter en Mac, los dos sirven).
  await composer.locator('textarea').fill('Saved from the keyboard');
  await composer.locator('textarea').press('Control+Enter');
  await expect.poll(async () => (await rows()).find((r) => r.body === 'Saved from the keyboard')?.type).toBe('note');
  await expect(composer.locator('textarea')).toHaveValue('');

  // En una pestaña de tipo no hay select: lo que se ve es lo que se guarda.
  await page.getByRole('tab', { name: /^Call/ }).click();
  await expect(composer.locator('.tl-type-select')).toHaveCount(0);
  await expect(composer.getByRole('button', { name: 'Log call' })).toBeVisible();
  await composer.locator('textarea').fill('Called about pricing');
  await composer.locator('textarea').press('Meta+Enter');
  await expect.poll(async () => (await rows()).find((r) => r.body === 'Called about pricing')?.type).toBe('call');

  // En "All" el select elige el tipo y el botón lo refleja.
  await page.getByRole('tab', { name: /^All/ }).click();
  const select = composer.locator('.tl-type-select');
  await expect(select).toHaveValue('call');
  await select.selectOption('meeting');
  await expect(composer.getByRole('button', { name: 'Log meeting' })).toBeVisible();
  await composer.locator('textarea').fill('Kickoff meeting');
  await composer.locator('textarea').press('Control+Enter');
  await expect.poll(async () => (await rows()).find((r) => r.body === 'Kickoff meeting')?.type).toBe('meeting');
});
