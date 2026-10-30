import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Hiring de punta a punta: puesto desde plantilla con su equipo y publicado,
 * postulación con CV en la página de empleos, el candidato en el pipeline,
 * arrastrarlo a Entrevista, agendar con el link de Cal, el interviewer que no
 * ve los scorecards ajenos hasta enviar el suyo, la oferta aprobada que el
 * candidato acepta, y el acceso: sin la app se bloquea y fuera del equipo no
 * se ve al candidato.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Otra persona del workspace demo (cookie zs_e2e_as) con las apps dadas. */
async function member(browser: Browser, baseURL: string, label: string, apps: string): Promise<{ ctx: BrowserContext; id: string; name: string }> {
  const email = `${label}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  await p.close();
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const row = (await sql('SELECT id, name FROM users WHERE email = ?', [email]))[0];
  const id = String(row.id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, [demoTeam, id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return { ctx, id, name: String(row.name ?? email.split('@')[0]) };
}

test('Hiring: de la plantilla a la oferta aceptada, con privacidad por equipo', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(300_000);
  // Cal necesita una dirección pública para los links de agenda.
  const cal = (await (await request.get('/api/calendar/config')).json()) as { handle: string | null };
  if (!cal.handle) expect((await request.put('/api/calendar/config', { data: { handle: `demo-${uid()}` } })).ok()).toBe(true);

  const interviewer = await member(browser, baseURL!, 'interviewer', '["hiring"]');
  const outsider = await member(browser, baseURL!, 'outsider', '["hiring"]');
  const noApp = await member(browser, baseURL!, 'noapp', '["crm"]');

  try {
    // 1. Puesto desde la plantilla, equipo y publicar.
    const title = `Software Engineer ${uid()}`;
    await page.goto('/en/app/hiring/jobs/new', { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: /Software Engineer/ }).check();
    await page.locator('input[name="title"]').fill(title);
    await page.getByRole('button', { name: 'Create job' }).click();
    await expect(page).toHaveURL(/\/en\/app\/hiring\/jobs\/job_[^/]+\/edit/);
    const jobId = /jobs\/(job_[^/?#]+)/.exec(page.url())![1];
    await expect(page.locator('#hr-desc')).toHaveValue(/About the role/);

    await page.getByRole('tab', { name: 'Hiring team' }).click();
    await page.getByLabel(`Role of ${interviewer.name}`).selectOption('interviewer');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Job published.')).toBeVisible();
    const job = (await (await request.get(`/api/hiring/jobs/${jobId}`)).json()) as { job: { slug: string; status: string }; stages: Array<{ id: string; name: string; kind: string }> };
    expect(job.job.status).toBe('published');
    const interviewStage = job.stages.find((s) => s.kind === 'interview')!;

    // 2. Postularse en la página de empleos, con CV.
    const { settings } = (await (await request.get('/api/hiring/settings')).json()) as { settings: { handle: string } };
    const email = `ana-${uid()}@example.com`;
    const candidateName = `Ana Candidate ${uid()}`;
    const visitor = await browser.newContext({ baseURL });
    const vp = await visitor.newPage();
    await vp.goto(`/careers/${settings.handle}`, { waitUntil: 'networkidle' });
    await vp.getByRole('link', { name: new RegExp(title) }).click();
    await expect(vp.getByRole('heading', { name: title })).toBeVisible();
    const ld = JSON.parse((await vp.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld).toMatchObject({ '@type': 'JobPosting', title, hiringOrganization: { '@type': 'Organization' } });
    expect((await visitor.request.get(`/careers/${settings.handle}/sitemap.xml`)).status()).toBe(200);
    await vp.getByLabel('Full name').fill(candidateName);
    await vp.getByLabel('Email').fill(email);
    await vp.locator('input[name="resume"]').setInputFiles({ name: 'ana.pdf', mimeType: 'application/pdf', buffer: PDF });
    await vp.getByRole('group', { name: /authorized to work/ }).getByLabel('Yes').check();
    await vp.getByLabel(/Years of professional experience/).fill('5');
    await vp.getByRole('checkbox', { name: /stores and processes my data/ }).check();
    await vp.getByRole('button', { name: 'Submit application' }).click();
    await expect(vp.getByText('Application received')).toBeVisible();
    await visitor.close();

    // 3. El candidato aparece en el pipeline.
    await page.goto(`/en/app/hiring/jobs/${jobId}`, { waitUntil: 'networkidle' });
    const card = page.locator('.hr-card', { hasText: candidateName });
    await expect(card).toBeVisible();
    const appId = String(await card.getAttribute('data-app'));
    const candidateId = String((await sql('SELECT candidate_id FROM hiring_applications WHERE id = ?', [appId]))[0].candidate_id);

    // 4. Arrastrarlo a Entrevista.
    await card.locator('.hr-card-meta').dragTo(page.locator(`section[data-stage="${interviewStage.id}"]`));
    await expect(page.getByText(`${candidateName} moved to ${interviewStage.name}.`)).toBeVisible();
    await expect.poll(async () => String((await sql('SELECT stage_id FROM hiring_applications WHERE id = ?', [appId]))[0].stage_id)).toBe(interviewStage.id);

    // 5. Agendar con el link de Cal (auto-agenda del candidato).
    await page.goto(`/en/app/hiring/candidates/${candidateId}?app=${appId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Interviews' }).click();
    await page.getByRole('button', { name: 'Send scheduling link' }).click();
    await page.getByRole('dialog', { name: 'Send scheduling link' }).getByRole('button', { name: 'Create link' }).click();
    const linkInput = page.getByLabel('Scheduling link', { exact: true });
    await expect(linkInput).toBeVisible();
    const link = new URL(await linkInput.inputValue());
    expect(link.pathname).toMatch(/^\/en\/book\/[^/]+\/interview-[a-f0-9]+$/);
    const booking = await browser.newContext({ baseURL });
    const bp = await booking.newPage();
    await bp.goto(`${link.pathname}${link.search}`, { waitUntil: 'networkidle' });
    await expect(bp.getByText(new RegExp(title)).first()).toBeVisible();
    const eventTypeId = String((await sql('SELECT event_type_id FROM hiring_interviews WHERE application_id = ?', [appId]))[0].event_type_id);
    let start: string | null = null;
    for (let d = 1; d <= 10 && !start; d++) {
      const day = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
      const { slots } = (await (await booking.request.get(`/api/calendar/event-types/${eventTypeId}/slots?date=${day}&timezone=UTC`)).json()) as { slots: Array<{ start: string }> };
      start = slots?.[0]?.start ?? null;
    }
    expect(start, 'Cal ofrece horarios con todos los evaluadores libres').toBeTruthy();
    const booked = await booking.request.post('/api/calendar/bookings', { data: { eventTypeId, email, name: candidateName, start, timezone: 'UTC' } });
    expect(booked.status(), await booked.text()).toBe(201);
    await booking.close();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Interviews' }).click();
    await expect(page.getByTestId('hr-interview').first()).toContainText('scheduled');

    // 6. Scorecards: la persona demo (recruiter) puntúa primero; el interviewer no la ve hasta enviar la suya.
    const crit = (await sql('SELECT criteria FROM hiring_stages WHERE id = ?', [interviewStage.id]))[0].criteria as string;
    const ratings = Object.fromEntries((JSON.parse(crit) as Array<{ id: string }>).map((c) => [c.id, 4]));
    expect((await request.post(`/api/hiring/applications/${appId}/scorecards`, { data: { stageId: interviewStage.id, ratings, overall: 'strong_yes', notes: 'Demo notes' } })).status()).toBe(201);
    const ip = await interviewer.ctx.newPage();
    await ip.goto(`/en/app/hiring/candidates/${candidateId}?app=${appId}`, { waitUntil: 'networkidle' });
    await ip.getByRole('tab', { name: 'Scorecards' }).click();
    await expect(ip.getByTestId('hr-hidden-scores')).toContainText('hidden until you submit yours');
    await expect(ip.getByTestId('hr-scorecard')).toHaveCount(0);
    await expect(ip.getByText('Demo notes')).toHaveCount(0);
    const api = (await (await interviewer.ctx.request.get(`/api/hiring/applications/${appId}/scorecards`)).json()) as { scorecards: unknown[]; hidden: number };
    expect(api).toMatchObject({ scorecards: [], hidden: 1 });
    const form = ip.getByRole('form', { name: /Your scorecard/ });
    for (const fieldset of await form.locator('fieldset').all()) {
      const legend = (await fieldset.locator('legend').textContent()) ?? '';
      await fieldset.getByLabel(legend === 'Overall recommendation' ? 'Yes' : 'Good', { exact: true }).check();
    }
    await form.getByLabel('Notes').fill('Solid interview');
    await form.getByRole('button', { name: 'Submit scorecard' }).click();
    await expect(ip.getByText('Scorecard submitted.')).toBeVisible();
    await expect(ip.getByTestId('hr-scorecard')).toHaveCount(2);
    await expect(ip.getByText('Demo notes')).toBeVisible();
    // El interviewer no gestiona el puesto: no lo mueve ni ve las ofertas.
    expect((await interviewer.ctx.request.patch(`/api/hiring/applications/${appId}`, { data: { action: 'move', stageId: job.stages[0].id } })).status()).toBe(403);
    await ip.close();

    // 7. Oferta: crearla, aprobarla (admin), enviarla y el candidato la acepta.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Offers' }).click();
    await page.getByRole('button', { name: 'New offer' }).click();
    const offerDialog = page.getByRole('dialog', { name: 'New offer' });
    await offerDialog.getByLabel('Salary').fill('60000');
    await offerDialog.getByLabel('Start date').fill('2026-12-01');
    await offerDialog.getByRole('button', { name: 'Create offer' }).click();
    await expect(page.getByTestId('hr-offer')).toContainText('Waiting for approval');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('hr-offer')).toContainText('Approved');
    await page.getByRole('button', { name: 'Send to candidate' }).click();
    const offerLink = page.getByLabel('Offer link', { exact: true });
    await expect(offerLink).toBeVisible();
    const offerUrl = new URL(await offerLink.inputValue());
    const cand = await browser.newContext({ baseURL });
    const cp = await cand.newPage();
    await cp.goto(offerUrl.pathname, { waitUntil: 'networkidle' });
    await expect(cp.getByRole('heading', { name: title })).toBeVisible();
    await cp.getByLabel('Your full name').fill(candidateName.toLowerCase());
    await cp.getByLabel('I accept this offer.').check();
    await cp.getByRole('button', { name: 'Accept offer' }).click();
    await expect(cp.getByText('You accepted the offer')).toBeVisible();
    await cand.close();
    await expect.poll(async () => String((await sql('SELECT status FROM hiring_applications WHERE id = ?', [appId]))[0].status)).toBe('hired');

    // 8. Sin la app: bloqueado en páginas y API.
    const np = await noApp.ctx.newPage();
    await np.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await expect(np).toHaveURL(/\/en\/app\?blocked=hiring/);
    expect((await noApp.ctx.request.get('/api/hiring/jobs')).status()).toBe(401);
    expect((await noApp.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(401);
    await np.close();

    // 9. Con la app pero fuera del equipo: el candidato no existe para esa persona.
    const op = await outsider.ctx.newPage();
    // Con loading.tsx la página ya está en streaming: el 404 llega como la página de no encontrado, sin datos.
    await op.goto(`/en/app/hiring/candidates/${candidateId}`, { waitUntil: 'networkidle' });
    await expect(op.locator('body')).not.toContainText(candidateName);
    await expect(op.locator('body')).not.toContainText(email);
    expect((await outsider.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);
    expect((await outsider.ctx.request.get(`/api/hiring/candidates/${candidateId}/resume`)).status()).toBe(404);
    const list = (await (await outsider.ctx.request.get('/api/hiring/applications?status=all')).json()) as { applications: Array<{ id: string }> };
    expect(list.applications.some((a) => a.id === appId)).toBe(false);
    const search = (await (await outsider.ctx.request.get(`/api/search?q=${encodeURIComponent(candidateName)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.includes(candidateId))).toEqual([]);
    await op.goto(`/en/app/hiring/jobs/${jobId}`, { waitUntil: 'networkidle' });
    await expect(op.getByText("You are not on this job's hiring team")).toBeVisible();
    await expect(op.getByText(candidateName)).toHaveCount(0);
    await op.close();
  } finally {
    await interviewer.ctx.close();
    await outsider.ctx.close();
    await noApp.ctx.close();
  }
});

test('Hiring: knock-out marcado, duplicado por email y anti-spam en la página de empleos', async ({ request }) => {
  const created = (await (await request.post('/api/hiring/jobs', { data: { title: `Support ${uid()}`, template: 'customer-support' } })).json()) as { job: { id: string; slug: string } };
  expect((await request.patch(`/api/hiring/jobs/${created.job.id}`, { data: { status: 'published' } })).ok()).toBe(true);
  const { settings } = (await (await request.get('/api/hiring/settings')).json()) as { settings: { handle: string } };
  const email = `ko-${uid()}@example.com`;
  const form = (answer: string, extra: Record<string, string> = {}) => ({
    handle: settings.handle,
    job: created.job.slug,
    name: 'Kay Out',
    email,
    consent: 'on',
    'answers[shifts]': answer,
    ...extra,
    resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF },
  });
  expect((await request.post('/api/hiring/public/apply', { multipart: form('no') })).status()).toBe(201);
  // El mismo email otra vez: no hay otra postulación.
  expect((await request.post('/api/hiring/public/apply', { multipart: form('no') })).status()).toBe(201);
  const apps = (await (await request.get(`/api/hiring/applications?jobId=${created.job.id}&knockedOut=1`)).json()) as { applications: Array<{ email: string; knockedOut: boolean; status: string }> };
  expect(apps.applications.filter((a) => a.email === email)).toHaveLength(1);
  expect(apps.applications[0]).toMatchObject({ knockedOut: true, status: 'active' });
  // Campo trampa: responde como si nada y no guarda.
  const botEmail = `bot-${uid()}@example.com`;
  expect((await request.post('/api/hiring/public/apply', { multipart: { ...form('yes'), email: botEmail, website: 'http://spam.example' } })).status()).toBe(201);
  expect(await sql('SELECT 1 FROM hiring_candidates WHERE email = ?', [botEmail])).toHaveLength(0);
  // Un "PDF" que no lo es.
  const bad = await request.post('/api/hiring/public/apply', { multipart: { ...form('yes'), email: `bad-${uid()}@example.com`, resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<script>alert(1)</script>') } } });
  expect(bad.status()).toBe(415);
});
