import { expect, test, type APIRequestContext } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Hiring entero en los cinco aspectos a 390 (claro y oscuro alternados) y en
 * el aspecto por defecto a 1280, claro y oscuro: inicio, puestos, editor por
 * pestaña, pipeline en tablero y lista, candidatos, perfil por pestaña,
 * informes, plantillas, ajustes y la página de empleos. Sin scroll lateral,
 * nada fuera de pantalla y sin errores del servidor. Con nombres largos a
 * propósito, para ver columnas y titulares.
 */

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const uid = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function seed(request: APIRequestContext) {
  const { job } = await ok<{ job: { id: string; slug: string } }>(request.post('/api/hiring/jobs', { data: { title: `Senior Customer Experience Operations Specialist for Latin America ${uid()}`, template: 'customer-support' } }));
  await ok(request.patch(`/api/hiring/jobs/${job.id}`, { data: { status: 'published', department: 'Customer Experience and Operations', location: 'Buenos Aires, Argentina' } }));
  const { settings } = await ok<{ settings: { handle: string } }>(request.get('/api/hiring/settings'));
  await ok(request.put('/api/hiring/settings', { data: { published: true } }));
  const applied = await request.post('/api/hiring/public/apply', {
    multipart: { handle: settings.handle, job: job.slug, name: 'Maximiliana Alejandra Fernández de la Torre Etcheverry', email: `long-${uid()}@a-very-long-company-domain-example.com`, consent: 'on', 'answers[shifts]': 'yes', resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } },
  });
  expect(applied.status(), await applied.text()).toBe(201);
  const manual = await ok<{ candidateId: string; applicationId: string }>(request.post('/api/hiring/applications', { data: { jobId: job.id, name: `Looks Candidate ${uid()}`, email: `looks-${uid()}@example.com`, tags: ['priority', 'spanish-speaker', 'night-shift'] } }));
  await ok(request.post(`/api/hiring/applications/${manual.applicationId}/notes`, { data: { body: 'A longer internal note to see how the timeline wraps a paragraph that goes on for a while without breaks.' } }));
  return { job: job.id, slug: job.slug, handle: settings.handle, candidate: manual.candidateId, app: manual.applicationId };
}

test('Hiring: todas las páginas en los cinco aspectos, claro y oscuro, 1280 y 390', async ({ browser, request, baseURL }) => {
  test.setTimeout(900_000);
  const s = await seed(request);
  const pages: Array<{ url: string; tab?: string }> = [
    { url: '/en/app/hiring' },
    { url: '/en/app/hiring/jobs' },
    { url: '/en/app/hiring/jobs/new' },
    { url: `/en/app/hiring/jobs/${s.job}` },
    { url: `/en/app/hiring/jobs/${s.job}?view=list` },
    ...['details', 'form', 'team', 'stages'].map((tab) => ({ url: `/en/app/hiring/jobs/${s.job}/edit?tab=${tab}` })),
    { url: '/en/app/hiring/candidates' },
    ...['timeline', 'resume', 'scorecards', 'interviews', 'offers'].map((tab) => ({ url: `/en/app/hiring/candidates/${s.candidate}?app=${s.app}`, tab })),
    { url: '/en/app/hiring/reports' },
    { url: '/en/app/hiring/templates' },
    { url: '/en/app/hiring/settings' },
    { url: `/careers/${s.handle}` },
    { url: `/careers/${s.handle}/${s.slug}` },
  ];
  const combos: Array<{ look: (typeof LOOKS)[number]; theme: 'light' | 'dark'; phone: boolean }> = [
    { look: 'current', theme: 'light', phone: false },
    { look: 'current', theme: 'dark', phone: false },
    ...LOOKS.map((look, i) => ({ look, theme: i % 2 ? ('dark' as const) : ('light' as const), phone: true })),
  ];
  const errors: string[] = [];
  try {
    for (const { look, theme, phone } of combos) {
      await ok(request.put('/api/profile/look', { data: { look } }));
      const ctx = await browser.newContext({ baseURL, viewport: phone ? PHONE : { width: 1280, height: 860 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
      await setTheme(ctx, baseURL!, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${page.url()} pageerror ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
      });
      for (const { url, tab } of pages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        if (tab) {
          await page.locator(`[data-profile-tab="${tab}"]`).click();
          await settle(page);
        }
        if (url.startsWith('/en/app/')) await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await check(page, `hiring ${look} ${theme} ${phone ? 390 : 1280} ${url}${tab ? ` ${tab}` : ''}`, { tap: phone });
      }
      // Diálogos: rechazar y editar desde el perfil.
      await page.goto(`/en/app/hiring/candidates/${s.candidate}?app=${s.app}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      for (const open of ['hr-reject-open', 'hr-edit-open']) {
        const btn = page.getByTestId(open);
        if (!(await btn.count())) continue;
        await btn.click();
        await expect(page.locator('dialog[open]')).toBeVisible();
        await check(page, `hiring ${look} ${theme} ${phone ? 390 : 1280} dialog ${open}`, { tap: phone });
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
      }
      await ctx.close();
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
