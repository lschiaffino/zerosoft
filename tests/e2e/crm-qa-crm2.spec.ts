import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Arreglos del QA de las tandas C3-C6 del CRM: playbook desde "registrar
 * llamada" (antes el <form> anidado hacía submit GET), páginas públicas de
 * documentos y videos sin chrome del sitio, archivos servidos por ruta API y
 * tareas de llamada/email que siguen siendo tareas.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

async function ok<T = unknown>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (r.status() === 204 ? null : await r.json()) as T;
}

async function activities(request: APIRequestContext, contactId: string) {
  return (await ok<{ rows: Array<{ id: string; type: string; subject: string; body: string; outcome: string }> }>(
    request.get(`/api/crm/activities?contactId=${contactId}`),
  )).rows;
}

test('registrar llamada → Playbooks: guarda respuestas, propiedad y una sola llamada', async ({ page, request }) => {
  const pbName = `Call script ${uid()}`;
  const pb = await ok<{ id: string }>(request.post('/api/crm/playbooks', { data: { name: pbName, body: '## Opening\nAsk about the team.' } }));
  await ok(
    request.patch(`/api/crm/playbooks/${pb.id}`, {
      data: {
        questions: [
          { id: 'role', label: 'What is your role?', type: 'text', options: [], property: 'contact:jobTitle' },
          { id: 'pain', label: 'What hurts today?', type: 'longtext', options: [], property: '' },
        ],
      },
    }),
  );
  const contact = await ok<{ id: string }>(
    request.post('/api/crm/contacts', { data: { firstName: 'Phone', lastName: uid(), email: `${uid()}@pt.test`, phone: '+1 415 555 0177' } }),
  );
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
  const before = page.url();
  // El link tel: abriría la app de teléfono: en el test solo se evita la navegación (el registro abre igual).
  await page.evaluate(() =>
    document.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('a[href^="tel:"]')) e.preventDefault();
    }),
  );
  await page.getByRole('link', { name: 'Call', exact: true }).first().click();
  const log = page.getByRole('form', { name: 'Log this touch' });
  await expect(log).toBeVisible();
  await log.getByRole('radio', { name: 'Connected' }).check();
  await log.getByRole('textbox', { name: 'Note' }).pressSequentially('Talked to the VP');
  await log.getByTestId('playbook-launcher').click();
  await page.getByRole('menuitem', { name: pbName }).click();

  const runner = page.getByTestId('playbook-runner');
  await expect(runner.getByText('Ask about the team.')).toBeVisible();
  await runner.getByLabel('What is your role?').pressSequentially('VP Ops');
  const pain = runner.getByLabel('What hurts today?');
  await pain.pressSequentially('Line one');
  await pain.press('Enter');
  await pain.pressSequentially('Line two');
  // Clic dentro del drawer: no cierra el registro de la llamada (que lo contiene).
  await runner.getByText('Ask about the team.').click();
  await expect(runner).toBeVisible();
  await runner.getByTestId('playbook-save').click();
  await expect(runner).toBeHidden();
  // Sin submit nativo: la URL no cambió (antes quedaba con ?call-outcome=…).
  expect(page.url()).toBe(before);

  const rows = await activities(request, contact.id);
  const calls = rows.filter((r) => r.type === 'call');
  expect(calls).toHaveLength(1);
  expect(calls[0].subject).toBe(`Playbook: ${pbName}`);
  expect(calls[0].outcome).toBe('connected');
  expect(calls[0].body).toContain('Talked to the VP');
  expect(calls[0].body).toContain('What hurts today?\nLine one\nLine two');
  const saved = await ok<{ job_title?: string; jobTitle?: string }>(request.get(`/api/crm/contacts/${contact.id}`));
  expect(JSON.stringify(saved)).toContain('VP Ops');

  // En el timeline las respuestas conservan los saltos de línea.
  const body = page.locator('.tl-item', { hasText: `Playbook: ${pbName}` }).locator('.tl-body');
  await expect(body).toBeVisible();
  expect(await body.innerText()).toContain('Line one\nLine two');
});

test('documentos y videos públicos: páginas limpias, archivos por API y link borrado', async ({ page, request }) => {
  const name = `Deck ${uid()}`;
  const doc = await ok<{ id: string }>(
    request.post('/api/crm/documents', { multipart: { file: { name: 'deck.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF) }, name } }),
  );
  const link = await ok<{ id: string; token: string }>(request.post(`/api/crm/documents/${doc.id}/links`, { data: {} }));

  // Archivo por ruta API (con next start, /uploads no se sirve).
  const inApp = await request.get(`/api/crm/documents/${doc.id}/file`);
  expect(inApp.status()).toBe(200);
  expect(inApp.headers()['content-type']).toBe('application/pdf');
  expect((await request.get(`/api/crm/d/${link.token}/file`)).status()).toBe(200);
  await page.goto(`/en/app/crm/documents/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', `/api/crm/documents/${doc.id}/file`);

  // /view: sin header, footer ni feedback del sitio; con "Powered by".
  await page.goto(`/en/view/${link.token}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Powered by zerosoft')).toBeVisible();
  await expect(page.locator('.site-footer')).toHaveCount(0);
  await expect(page.locator('.fl-root')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Changelog' })).toHaveCount(0);

  // Link borrado: cartel tipo /gone (sin el 404 del sitio).
  await ok(request.delete(`/api/crm/documents/${doc.id}/links?linkId=${link.id}`));
  const gone = await page.goto(`/en/view/${link.token}`, { waitUntil: 'domcontentloaded' });
  expect(gone?.status()).toBe(404);
  await expect(page.getByTestId('media-gone')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
  await expect(page.locator('.site-footer')).toHaveCount(0);

  // Video: /watch limpio y el archivo sale por la API con rangos.
  const title = `Hello ${uid()}`;
  const video = await ok<{ id: string; token: string }>(
    request.post('/api/crm/videos', {
      multipart: { file: { name: 'hi.webm', mimeType: 'video/webm', buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6]) }, title },
    }),
  );
  const ranged = await request.get(`/api/crm/v/${video.token}/file`, { headers: { range: 'bytes=0-3' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-range']).toBe('bytes 0-3/10');
  expect((await ranged.body()).length).toBe(4);
  expect((await request.get(`/api/crm/videos/${video.id}/file`)).status()).toBe(200);
  await page.goto(`/en/watch/${video.token}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('video source')).toHaveAttribute('src', `/api/crm/v/${video.token}/file`);
  await expect(page.getByText('Powered by zerosoft')).toBeVisible();
  await expect(page.locator('.site-footer')).toHaveCount(0);
  await expect(page.locator('.fl-root')).toHaveCount(0);
  await ok(request.delete(`/api/crm/videos/${video.id}`));
  await page.goto(`/en/watch/${video.token}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('media-gone')).toBeVisible();
});

test('tarea nueva de tipo Call: queda en Tasks y en la cola, y no cuenta como contacto hasta completarla', async ({ page, request }) => {
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Taskcall', lastName: uid(), email: `${uid()}@tc.test` } }));
  const subject = `Call back ${uid()}`;
  await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
  await page.getByTestId('crm-quick-task').click();
  await page.getByRole('textbox', { name: 'Subject' }).pressSequentially(subject);
  await page.getByLabel('Activity type').selectOption('call');
  // Vencida hace mucho: la cola va de la más vieja a la más nueva, así que es la primera.
  await page.getByLabel('Due date', { exact: true }).fill('1999-01-04T09:00');
  await page.getByLabel('Contact').selectOption(contact.id);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await page.goto('/en/app/crm/tasks?bucket=overdue', { waitUntil: 'networkidle' });
  const row = page.locator('.task-row', { hasText: subject });
  await expect(row).toBeVisible();
  await expect(row.locator('.task-type')).toHaveText('Call');

  const rows = await activities(request, contact.id);
  const task = rows.find((r) => r.subject === subject)!;
  expect(task.type).toBe('task');
  let c = await ok<Record<string, unknown>>(request.get(`/api/crm/contacts/${contact.id}`));
  expect(JSON.stringify(c)).not.toMatch(/"last_contacted_at":"\d/);

  await page.goto('/en/app/crm/tasks/queue?scope=overdue', { waitUntil: 'networkidle' });
  const qcard = page.getByTestId('queue-card');
  await expect(qcard.getByRole('heading', { name: subject })).toBeVisible();
  await expect(qcard.getByTestId('queue-kind')).toHaveText('Call');

  await ok(request.patch(`/api/crm/activities/${task.id}`, { data: { done: true } }));
  c = await ok<Record<string, unknown>>(request.get(`/api/crm/contacts/${contact.id}`));
  expect(JSON.stringify(c)).toMatch(/"last_contacted_at":"\d/);
});

async function firstPipeline(request: APIRequestContext) {
  const body = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; name: string; is_won: number; is_lost: number }> }> }>(
    request.get('/api/crm/pipelines'),
  );
  const p = body.rows[0];
  return { id: p.id, open: p.stages.filter((s) => !s.is_won && !s.is_lost) };
}

test('board: el primer Tab ofrece "Skip to the board" y M abre un menú de etapas real', async ({ page, request }) => {
  const p = await firstPipeline(request);
  const name = `Menu ${uid()}`;
  await ok(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 10 } }));
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });

  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText('Skip to the board');
  await page.keyboard.press('Enter');
  await expect(page.locator('.kb-card').first()).toBeFocused();

  const card = page.locator('.kb-card', { hasText: name });
  await card.focus();
  await page.keyboard.press('m');
  const menu = page.getByRole('menu', { name: 'Move to…' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(card).toBeFocused();

  await page.keyboard.press('m');
  await expect(menu.getByRole('menuitem', { name: p.open[1].name })).toBeVisible();
  await menu.getByRole('menuitem', { name: p.open[1].name }).focus();
  await page.keyboard.press('Enter');
  const moved = page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"] .kb-card`, { hasText: name });
  await expect(moved).toBeVisible();
  await expect(moved).toBeFocused();
});

test('⌘K encuentra formularios, aprobaciones y scores; acciones para Forecast', async ({ page, request }) => {
  const formName = `Signup ${uid()}`;
  await ok(request.post('/api/crm/forms', { data: { name: formName } }));
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('combobox').fill(formName);
  await expect(search.getByRole('option', { name: new RegExp(formName) }).first()).toBeVisible();
  await search.getByRole('combobox').fill('forecast');
  await expect(search.getByRole('option', { name: /Open the forecast/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('playbooks: renombrar y borrar desde la lista, sin recargar', async ({ page, request }) => {
  const name = `Row ${uid()}`;
  await ok(request.post('/api/crm/playbooks', { data: { name } }));
  await page.goto('/en/app/crm/playbooks', { waitUntil: 'networkidle' });
  const row = page.getByTestId('playbook-row').filter({ hasText: name });
  await row.getByTestId('playbook-row-rename').click();
  // En modo renombrar la fila ya no tiene el nombre como texto (está en el input).
  const input = page.getByTestId('playbook-rename-input');
  await expect(input).toBeFocused();
  await input.fill('');
  await input.pressSequentially(`${name} v2`);
  await input.press('Enter');
  await expect(page.getByTestId('playbook-row').filter({ hasText: `${name} v2` })).toBeVisible();
  await page.getByTestId('playbook-row').filter({ hasText: `${name} v2` }).getByTestId('playbook-row-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete playbook' }).click();
  await expect(page.getByTestId('playbook-row').filter({ hasText: name })).toHaveCount(0);
});

test.describe('detalle de tarea: vencimiento en la hora local', () => {
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires', locale: 'en-US' });

  test('"About this task" muestra el Due date como el encabezado (no el UTC crudo) y se edita en la hora local', async ({ page, request }) => {
    const task = await ok<{ id: string }>(
      request.post('/api/crm/activities', { data: { type: 'task', subject: `Due ${uid()}`, dueAt: '2026-11-20T18:30:00Z' } }),
    );
    await page.goto(`/en/app/crm/tasks/${task.id}`, { waitUntil: 'networkidle' });
    const header = (await page.locator('.record-meta').innerText()).match(/Due: (.+)/)![1].trim();
    const row = page.locator('.prop-row', { has: page.locator('.prop-label', { hasText: /^Due date$/ }) });
    await expect(row.locator('.prop-value').first()).toHaveText(header);
    await expect(row).not.toContainText('2026-11-20 18:30');
    // Al editar, el datetime-local trae la hora del navegador (15:30 en Buenos Aires).
    await row.locator('button.prop-btn').click();
    const input = row.locator('input[type="datetime-local"]');
    await expect(input).toHaveValue('2026-11-20T15:30');
    await input.fill('2026-11-21T09:00');
    await input.press('Enter');
    await expect
      .poll(async () => {
        const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
        try {
          return String((await db.execute({ sql: 'SELECT due_at FROM crm_activities WHERE id = ?', args: [task.id] })).rows[0]?.due_at);
        } finally {
          db.close();
        }
      })
      .toBe('2026-11-21 12:00:00');
  });
});
