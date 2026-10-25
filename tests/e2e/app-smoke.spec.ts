import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Smoke parejo para todas las apps con ítems creados por la persona. Cada
 * spec de app prueba lo que su builder pidió; este recorre la misma lista de
 * chequeos en todas (lista, sidebar, ⌘K, detalle, renombrar, borrar, temas y
 * 390px) para que no se escape otro "la pizarra no aparece en el sidebar".
 * Una tabla por app: agregar una app nueva es sumar una fila.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
/** PDF de una página, suficiente para la biblioteca de documentos del CRM. */
const SMOKE_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

interface Created {
  id: string;
  /** Lo que la UI muestra como nombre del ítem. */
  name: string;
}

interface AppCase {
  app: string;
  /** Página principal con la lista. */
  list: string;
  create: (request: APIRequestContext, name: string) => Promise<Created>;
  detail: (item: Created) => string;
  rename?: (request: APIRequestContext, item: Created, name: string) => Promise<void>;
  remove?: (request: APIRequestContext, item: Created) => Promise<void>;
  /** Lista los ítems en el sidebar del shell (#side-branch), como Docs. */
  sidebar?: boolean;
  /** URL del detalle cuando no lleva el id (los teams de Track usan su clave: /track/team/WEB). */
  detailUrl?: (item: Created) => RegExp;
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** Proyecto de Track compartido por los issues del smoke. */
let trackProjectId: string | null = null;
async function trackProject(request: APIRequestContext): Promise<string> {
  if (!trackProjectId) trackProjectId = (await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Smoke issues ${uid()}` } }))).id;
  return trackProjectId;
}

/** Objeto propio "Smoke things" (slug smoke-things) compartido por los registros del smoke. */
let smokeObjectId: string | null = null;
async function smokeObject(request: APIRequestContext): Promise<string> {
  if (smokeObjectId) return smokeObjectId;
  const { rows } = await ok<{ rows: Array<{ id: string; slug: string }> }>(request.get('/api/crm/objects'));
  smokeObjectId =
    rows.find((o) => o.slug === 'smoke-things')?.id ??
    (await ok<{ id: string }>(request.post('/api/crm/objects', { data: { singular: 'Smoke thing', plural: 'Smoke things' } }))).id;
  return smokeObjectId;
}

/** Número de WhatsApp falso (GROUPS_FAKE=1) compartido por los grupos del smoke. */
let groupsNumberId: string | null = null;
async function groupsNumber(request: APIRequestContext): Promise<string> {
  if (groupsNumberId) return groupsNumberId;
  const { id } = await ok<{ id: string }>(request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'Smoke line' } }));
  await ok(request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } }));
  // El número falso queda conectado a los ~1,5 s (como si se escaneara el QR).
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  groupsNumberId = id;
  return id;
}

const APPS: AppCase[] = [
  {
    app: 'Docs',
    list: '/en/app/docs',
    sidebar: true,
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/docs/pages', { data: { title: name } }))).id, name }),
    detail: (i) => `/en/app/docs/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/docs/pages/${i.id}`, { data: { title: name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/docs/pages/${i.id}`))),
  },
  {
    app: 'Notes',
    list: '/en/app/notes',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/notes', { data: { title: name, content: [] } }))).id, name }),
    detail: (i) => `/en/app/notes?note=${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/notes/${i.id}`, { data: { title: name } }))),
    // Borrar una nota la manda a la papelera.
    remove: async (request, i) => void (await ok(request.patch(`/api/notes/${i.id}`, { data: { trashed: true } }))),
  },
  {
    app: 'Board',
    list: '/en/app/board',
    sidebar: true,
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/boards', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/board/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/boards/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/boards/${i.id}`))),
  },
  {
    // Teams de Track (lo que antes se llamaba proyecto): clave, estados y cycles.
    app: 'Track teams',
    list: '/en/app/track/teams',
    sidebar: true,
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/track/projects', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/track/team/${i.id}`,
    detailUrl: () => /\/app\/track\/team\/SMOKE-/,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/track/projects/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/track/projects/${i.id}`))),
  },
  {
    app: 'Track issues',
    list: '/en/app/track/issues',
    create: async (request, name) => {
      const project = await trackProject(request);
      return { id: (await ok<{ id: string }>(request.post(`/api/track/projects/${project}/issues`, { data: { title: name } }))).id, name };
    },
    detail: (i) => `/en/app/track/issues/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/track/issues/${i.id}`, { data: { title: name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/track/issues/${i.id}`))),
  },
  {
    // Projects de Track (como los de Linear).
    app: 'Track projects',
    list: '/en/app/track/projects',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/track/plans', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/track/projects/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/track/plans/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/track/plans/${i.id}`))),
  },
  {
    app: 'Track initiatives',
    list: '/en/app/track/initiatives',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/track/initiatives', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/track/initiatives/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/track/initiatives/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/track/initiatives/${i.id}`))),
  },
  {
    app: 'Track dashboards',
    list: '/en/app/track/dashboards',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/track/dashboards', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/track/dashboards/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/track/dashboards/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/track/dashboards/${i.id}`))),
  },
  {
    app: 'CRM contacts',
    list: '/en/app/crm/contacts',
    create: async (request, name) => {
      const [firstName, lastName] = name.split(' ');
      const body = { firstName, lastName, email: `${lastName}@smoke.example.com` };
      return { id: (await ok<{ id: string }>(request.post('/api/crm/contacts', { data: body }))).id, name };
    },
    detail: (i) => `/en/app/crm/contacts/${i.id}`,
    rename: async (request, i, name) => {
      const [firstName, lastName] = name.split(' ');
      await ok(request.patch(`/api/crm/contacts/${i.id}`, { data: { firstName, lastName } }));
    },
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/contacts/${i.id}`))),
  },
  {
    app: 'CRM companies',
    list: '/en/app/crm/companies',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/crm/companies/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/companies/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/companies/${i.id}`))),
  },
  {
    app: 'CRM deals',
    list: '/en/app/crm/deals',
    create: async (request, name) => {
      const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
      const pipeline = pipelines.rows[0];
      const body = { name, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: 100 };
      return { id: (await ok<{ id: string }>(request.post('/api/crm/deals', { data: body }))).id, name };
    },
    detail: (i) => `/en/app/crm/deals/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/deals/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/deals/${i.id}`))),
  },
  {
    app: 'CRM AI agent runs',
    list: '/en/app/crm/agents',
    create: async (request, name) => {
      // El agente de contactos no usa IA: necesita un contacto con datos faltantes.
      await ok(request.post('/api/crm/contacts', { data: { email: `smoke.agent${uid().replace(/\d/g, 'x')}@smoke-agent.example.com` } }));
      return { id: (await ok<{ id: string }>(request.post('/api/crm/ai/runs', { data: { agent: 'enrich_contacts', name } }))).id, name };
    },
    detail: (i) => `/en/app/crm/agents/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/ai/runs/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/ai/runs/${i.id}`))),
  },
  {
    app: 'CRM leads',
    list: '/en/app/crm/leads',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/crm/leads', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/crm/leads/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/leads/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/leads/${i.id}`))),
  },
  {
    // El objeto mismo: su lista es /app/crm/objects y cuelga en el sidebar del CRM. id = slug (la URL).
    app: 'CRM custom objects',
    list: '/en/app/crm/objects',
    sidebar: true,
    create: async (request, name) => {
      const o = await ok<{ slug: string }>(request.post('/api/crm/objects', { data: { singular: name, plural: name } }));
      return { id: o.slug, name };
    },
    detail: (i) => `/en/app/crm/objects/${i.id}`,
    rename: async (request, i, name) => {
      const { rows } = await ok<{ rows: Array<{ id: string; slug: string }> }>(request.get('/api/crm/objects'));
      await ok(request.patch(`/api/crm/objects/${rows.find((o) => o.slug === i.id)!.id}`, { data: { plural: name } }));
    },
    remove: async (request, i) => {
      const { rows } = await ok<{ rows: Array<{ id: string; slug: string }> }>(request.get('/api/crm/objects'));
      const r = await request.delete(`/api/crm/objects/${rows.find((o) => o.slug === i.id)!.id}`);
      expect(r.status()).toBe(204);
    },
  },
  {
    app: 'CRM object records',
    list: '/en/app/crm/objects/smoke-things',
    create: async (request, name) => {
      const id = await smokeObject(request);
      return { id: (await ok<{ id: string }>(request.post(`/api/crm/objects/${id}/records`, { data: { name } }))).id, name };
    },
    detail: (i) => `/en/app/crm/objects/smoke-things/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/records/${i.id}`, { data: { name } }))),
    remove: async (request, i) => {
      const r = await request.delete(`/api/crm/records/${i.id}`);
      expect(r.status()).toBe(204);
    },
  },
  {
    app: 'CRM playbooks',
    list: '/en/app/crm/playbooks',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/crm/playbooks', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/crm/playbooks/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/playbooks/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/playbooks/${i.id}`))),
  },
  {
    app: 'CRM custom reports',
    list: '/en/app/crm/reports/custom',
    create: async (request, name) =>
      ({ id: (await ok<{ id: string }>(request.post('/api/crm/custom-reports', { data: { name, config: { source: 'deals' } } }))).id, name }),
    detail: (i) => `/en/app/crm/reports/custom/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/custom-reports/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/custom-reports/${i.id}`))),
  },
  {
    app: 'Cal event types',
    list: '/en/app/calendar/event-types',
    create: async (request, name) => {
      const body = { title: name, slug: `smoke-${uid()}`, durationMin: 30, active: true };
      return { id: (await ok<{ id: string }>(request.post('/api/calendar/event-types', { data: body }))).id, name };
    },
    detail: (i) => `/en/app/calendar/event-types/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/calendar/event-types/${i.id}`, { data: { title: name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/calendar/event-types/${i.id}`))),
  },
  {
    app: 'Link',
    list: '/en/app/links',
    create: async (request, name) => {
      const body = { url: `https://example.com/${uid()}`, slug: `smoke-${uid()}`, title: name };
      return { id: (await ok<{ id: string }>(request.post('/api/links', { data: body }))).id, name };
    },
    detail: (i) => `/en/app/links/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/links/${i.id}`, { data: { title: name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/links/${i.id}`))),
  },
  {
    app: 'Chat widgets',
    list: '/en/app/chat/widgets',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/chat/widgets', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/chat/widgets/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/chat/widgets/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/chat/widgets/${i.id}`))),
  },
  {
    app: 'Flow',
    list: '/en/app/flow',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/flow/flows', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/flow/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/flow/flows/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/flow/flows/${i.id}`))),
  },
  {
    app: 'Agents',
    list: '/en/app/agents',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/agents', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/agents/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/agents/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/agents/${i.id}`))),
  },
  {
    app: 'Groups',
    list: '/en/app/groups/list',
    create: async (request, name) => {
      const numberId = await groupsNumber(request);
      const res = await ok<{ results: Array<{ ok: boolean; chatId?: string; error?: string }> }>(
        request.post('/api/groups/create', { data: { numberId, name, phones: ['+15550009001'] } }),
      );
      expect(res.results[0].ok, res.results[0].error).toBe(true);
      return { id: res.results[0].chatId!, name };
    },
    detail: (i) => `/en/app/groups/list/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/groups/chats/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/groups/chats/${i.id}`))),
  },
  {
    app: 'CRM Documents',
    list: '/en/app/crm/documents',
    create: async (request, name) => {
      const file = { name: 'smoke.pdf', mimeType: 'application/pdf', buffer: Buffer.from(SMOKE_PDF) };
      const res = await ok<{ id: string; name: string }>(request.post('/api/crm/documents', { multipart: { file, name } }));
      return { id: res.id, name: res.name };
    },
    detail: (i) => `/en/app/crm/documents/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/documents/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/documents/${i.id}`))),
  },
  {
    app: 'CRM Videos',
    list: '/en/app/crm/videos',
    create: async (request, name) => {
      const file = { name: 'smoke.webm', mimeType: 'video/webm', buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]) };
      const res = await ok<{ id: string; title: string }>(request.post('/api/crm/videos', { multipart: { file, title: name } }));
      return { id: res.id, name: res.title };
    },
    detail: (i) => `/en/app/crm/videos/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/crm/videos/${i.id}`, { data: { title: name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/crm/videos/${i.id}`))),
  },
  {
    app: 'Robots',
    list: '/en/app/robots',
    create: async (request, name) => ({ id: (await ok<{ id: string }>(request.post('/api/robots', { data: { name } }))).id, name }),
    detail: (i) => `/en/app/robots/${i.id}`,
    rename: async (request, i, name) => void (await ok(request.patch(`/api/robots/${i.id}`, { data: { name } }))),
    remove: async (request, i) => void (await ok(request.delete(`/api/robots/${i.id}`))),
  },
];

/** Errores de JS, de consola y respuestas 5xx mientras corre el test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** El contenido de la página (sin el sidebar del shell). */
const content = (page: Page) => page.locator('main.app-content');
const sideBranch = (page: Page) => page.locator('#side-branch');
/** Nombres únicos de dos palabras (los contactos los parten en nombre y apellido). */
const freshName = () => `Smoke ${uid()}${uid()}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

for (const c of APPS) {
  test.describe(`smoke ${c.app}`, () => {
    test('crear: aparece en la lista', async ({ page, request }) => {
      const errors = watchErrors(page);
      const item = await c.create(request, freshName());
      await page.goto(c.list, { waitUntil: 'networkidle' });
      await expect(content(page).getByText(item.name).first()).toBeVisible();
      expect(errors, errors.join('\n')).toEqual([]);
    });

    if (c.sidebar) {
      test('sidebar: lo lista y marca el abierto', async ({ page, request }) => {
        const item = await c.create(request, freshName());
        await page.goto(c.list, { waitUntil: 'networkidle' });
        const link = sideBranch(page).getByRole('link', { name: item.name });
        await expect(link).toBeVisible();
        await page.goto(c.detail(item), { waitUntil: 'networkidle' });
        await expect(sideBranch(page).getByRole('link', { name: item.name })).toHaveAttribute('aria-current', 'page');
      });
    }

    test('⌘K: lo encuentra y lo abre', async ({ page, request }) => {
      const item = await c.create(request, freshName());
      await page.goto(c.list, { waitUntil: 'networkidle' });
      await page.keyboard.press('ControlOrMeta+k');
      const dialog = page.getByRole('dialog', { name: 'Search' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').fill(item.name);
      const option = dialog.getByRole('option', { name: new RegExp(item.name) });
      await expect(option.first()).toBeVisible();
      await option.first().click();
      await expect(page).toHaveURL(c.detailUrl ? c.detailUrl(item) : new RegExp(item.id));
    });

    test('detalle: abre sin errores', async ({ page, request }) => {
      const errors = watchErrors(page);
      const item = await c.create(request, freshName());
      const res = await page.goto(c.detail(item), { waitUntil: 'networkidle' });
      expect(res?.status()).toBeLessThan(400);
      // Sin error boundary: el nombre del ítem está en la página.
      await expect
        .poll(async () => page.evaluate((name) => {
          const main = document.querySelector('main.app-content');
          if (!main) return false;
          const inputs = Array.from(main.querySelectorAll('input, textarea')) as Array<HTMLInputElement>;
          return (main.textContent ?? '').includes(name) || inputs.some((el) => el.value.includes(name));
        }, item.name))
        .toBe(true);
      await expect(content(page).getByRole('alert').filter({ hasText: /something went wrong|error/i })).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    if (c.rename) {
      test('renombrar: la lista (y el sidebar) muestran el nombre nuevo', async ({ page, request }) => {
        const item = await c.create(request, freshName());
        await page.goto(c.list, { waitUntil: 'networkidle' });
        await expect(content(page).getByText(item.name).first()).toBeVisible();
        const renamed = freshName();
        await c.rename!(request, item, renamed);
        // Navegar dentro de la app (detalle y vuelta) no deja la lista vieja en caché.
        // Abrir y salir sin tocar nada no pregunta por cambios sin guardar.
        const prompts: string[] = [];
        page.on('dialog', (d) => {
          prompts.push(d.type());
          void d.accept();
        });
        await page.goto(c.detail(item), { waitUntil: 'networkidle' });
        await page.goto(c.list, { waitUntil: 'networkidle' });
        expect(prompts, 'diálogo al salir del detalle sin cambios').toEqual([]);
        await expect(content(page).getByText(renamed).first()).toBeVisible();
        await expect(content(page).getByText(item.name)).toHaveCount(0);
        if (c.sidebar) {
          await expect(sideBranch(page).getByRole('link', { name: renamed })).toBeVisible();
          await expect(sideBranch(page).getByRole('link', { name: item.name })).toHaveCount(0);
        }
      });
    }

    if (c.remove) {
      test('borrar: sale de la lista (y del sidebar)', async ({ page, request }) => {
        const item = await c.create(request, freshName());
        await page.goto(c.list, { waitUntil: 'networkidle' });
        await expect(content(page).getByText(item.name).first()).toBeVisible();
        await c.remove!(request, item);
        await page.goto(c.list, { waitUntil: 'networkidle' });
        await expect(content(page).getByText(item.name)).toHaveCount(0);
        if (c.sidebar) await expect(sideBranch(page).getByRole('link', { name: item.name })).toHaveCount(0);
      });
    }

    for (const theme of ['light', 'dark'] as const) {
      test(`lista en tema ${theme} sin errores`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        const errors = watchErrors(page);
        await page.goto(c.list, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(content(page)).not.toBeEmpty();
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }

    test('390px: la lista no scrollea en horizontal', async ({ page, request }) => {
      await c.create(request, freshName());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(c.list, { waitUntil: 'networkidle' });
      const { scroll, inner } = await page.evaluate(() => ({
        scroll: document.scrollingElement!.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner + 1);
    });
  });
}

// En DEMO_MODE toda request es el mismo usuario demo (con datos de seed) y no
// hay forma barata de entrar como una persona nueva sin ítems.
test.fixme('estado vacío con un usuario nuevo', () => {});
