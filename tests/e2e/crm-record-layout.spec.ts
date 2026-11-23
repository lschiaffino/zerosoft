import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM: ficha de contacto, empresa y deal en tres columnas (como HubSpot).
 * A 1280: propiedades a la izquierda, pestañas Resumen / Actividad en el
 * medio, asociaciones a la derecha. A 390: una columna, con Propiedades y
 * Asociaciones como pestañas, sin scroll lateral.
 *
 * Los registros se crean por API y se abren por id: la cuenta demo es
 * compartida y una fila nueva puede no estar en la primera página. Los
 * elementos se buscan por testid, rol o atributo, no por su texto.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const KINDS = ['contact', 'company', 'deal'] as const;
type Kind = (typeof KINDS)[number];
const QUICK = ['note', 'email', 'call', 'task', 'meeting'] as const;
type Tab = 'overview' | 'activity' | 'properties' | 'related';

test.describe.configure({ timeout: 150_000 });
// La ficha carga las tres columnas de una vez: en `next dev` puede pasar los 5 s por defecto.
const expect = baseExpect.configure({ timeout: 20_000 });

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function noSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

async function json<T>(res: Promise<{ ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

interface Seed {
  tag: string;
  paths: Record<Kind, string>;
  names: Record<Kind, string>;
  ids: Record<Kind, string>;
  email: string;
}

/** Una empresa, un contacto en ella y un deal con los dos, creados recién. */
async function seed(request: APIRequestContext): Promise<Seed> {
  const tag = uid();
  const names = { company: `Columns Co ${tag}`, contact: `Cora Columns ${tag}`, deal: `Columns deal ${tag}` };
  const email = `cora-${tag}@columns.example`;
  const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: names.company, domain: `columns-${tag}.example` } }));
  const contact = await json<{ id: string }>(
    request.post('/api/crm/contacts', {
      data: { firstName: 'Cora', lastName: `Columns ${tag}`, email, jobTitle: 'Buyer', companyId: company.id },
    }),
  );
  const pipeline = await json<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `Columns ${tag}` } }));
  const stage = await json<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Open' } }));
  const deal = await json<{ id: string }>(
    request.post('/api/crm/deals', {
      data: { name: names.deal, amount: 4200, pipelineId: pipeline.id, stageId: stage.id, companyId: company.id, contactIds: [contact.id] },
    }),
  );
  return {
    tag,
    names,
    email,
    ids: { contact: contact.id, company: company.id, deal: deal.id },
    paths: {
      contact: `/en/app/crm/contacts/${contact.id}`,
      company: `/en/app/crm/companies/${company.id}`,
      deal: `/en/app/crm/deals/${deal.id}`,
    },
  };
}

/**
 * Registros sin asociar con nombres muy largos: quedan como opciones de los selectores
 * "asociar existente". Un <select> mide lo que su opción más larga, así que con ellos se
 * ve si una tarjeta se sale de la pantalla (en la cuenta compartida siempre hay alguno).
 */
async function seedLongOptions(request: APIRequestContext, tag: string) {
  const long = `Unlinked record with a very long name that keeps going and going and going ${tag}`;
  await json(request.post('/api/crm/companies', { data: { name: `${long} company` } }));
  await json(request.post('/api/crm/contacts', { data: { firstName: long, lastName: 'contact', email: `long-${tag}@columns.example` } }));
  const pipelines = await json<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
  const pipeline = pipelines.rows.find((p) => p.stages.length > 0)!;
  await json(request.post('/api/crm/deals', { data: { name: `${long} deal`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id } }));
}

const tab = (page: Page, key: Tab) => page.getByTestId(`record-tab-${key}`);
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);
const toggle = (c: Locator) => c.getByTestId('record-card-toggle');
const prop = (page: Page, key: string) => page.getByTestId('record-about').locator(`[data-prop="${key}"]`);
const quick = (page: Page, type: (typeof QUICK)[number]) => page.getByTestId(`record-quick-${type}`);
const composer = (page: Page) => page.getByTestId('record-panel-activity').locator('form.tl-composer');
/** La barra del timeline (búsqueda, filtros, crear): está siempre que se ve la pestaña Actividad. */
const timelineTools = (page: Page) => page.getByTestId('record-panel-activity').getByTestId('timeline-search');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, 'el elemento tiene caja').not.toBeNull();
  return b!;
}

/** El nombre de cada acción rápida entra en su botón, con aire a los costados. */
async function quickLabelsFit(page: Page) {
  for (const type of QUICK) {
    const fit = await quick(page, type).evaluate((btn) => {
      const label = btn.querySelector('span')!;
      const b = btn.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      return { clipped: label.scrollWidth > label.clientWidth + 1, left: l.left - b.left, right: b.right - l.right };
    });
    expect(fit.clipped, `${type} cortado`).toBe(false);
    expect(fit.left, `${type} toca el borde izquierdo`).toBeGreaterThanOrEqual(2);
    expect(fit.right, `${type} toca el borde derecho`).toBeGreaterThanOrEqual(2);
  }
}

test.describe('ficha en tres columnas a 1280', () => {
  test.use({ viewport: DESKTOP });

  test('contacto, empresa y deal: izquierda, medio y derecha a la vista a la vez; abre en el Resumen', async ({ page, request }) => {
    const errors = watchErrors(page);
    const s = await seed(request);
    for (const kind of KINDS) {
      await page.goto(s.paths[kind], { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1, name: s.names[kind] })).toBeVisible();

      const left = page.getByTestId('record-left');
      const mid = page.getByTestId('record-middle');
      const right = page.getByTestId('record-right');
      await expect(left).toBeVisible();
      await expect(mid).toBeVisible();
      await expect(right).toBeVisible();
      const [l, m, r] = await Promise.all([box(left), box(mid), box(right)]);
      // Tres columnas una al lado de la otra, sin pisarse, y el medio es la más ancha.
      expect(l.x + l.width).toBeLessThanOrEqual(m.x + 1);
      expect(m.x + m.width).toBeLessThanOrEqual(r.x + 1);
      expect(Math.abs(l.y - r.y)).toBeLessThan(40);
      expect(m.width).toBeGreaterThan(l.width);
      expect(m.width).toBeGreaterThan(r.width);
      expect(r.x + r.width).toBeLessThanOrEqual(DESKTOP.width);

      // Izquierda: identidad, acciones rápidas y propiedades. Derecha: asociaciones.
      await expect(left.getByRole('heading', { level: 1 })).toBeVisible();
      for (const type of QUICK) await expect(quick(page, type)).toBeVisible();
      await quickLabelsFit(page);
      await expect(page.getByTestId('record-about').locator('.prop-row').first()).toBeVisible();
      await expect(right.locator('.rec-card').first()).toBeVisible();

      // Medio: dos pestañas, abre en el Resumen; Propiedades y Asociaciones ya están a los costados.
      await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');
      await expect(tab(page, 'activity')).toBeVisible();
      await expect(tab(page, 'properties')).toBeHidden();
      await expect(tab(page, 'related')).toBeHidden();
      await expect(page.getByTestId('record-highlights')).toBeVisible();
      await expect(page.getByTestId('record-recent-communications')).toBeVisible();
      await noSideScroll(page);
    }

    // Las asociaciones del seed: en su tarjeta con su cuenta, y resumidas en el Resumen.
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await expect(card(page, 'contact.companies')).toContainText(s.names.company);
    await expect(card(page, 'contact.deals')).toContainText(s.names.deal);
    await expect(card(page, 'contact.deals').locator('.rec-card-count')).toHaveText('1');
    await expect(page.getByTestId('record-summary-companies').getByRole('link', { name: s.names.company })).toBeVisible();
    await expect(page.getByTestId('record-summary-deals').getByRole('link', { name: s.names.deal })).toBeVisible();
    // El email del contacto es un link para escribirle.
    await expect(prop(page, 'email').getByRole('link')).toHaveAttribute('href', `mailto:${s.email}`);
    await page.goto(s.paths.company, { waitUntil: 'networkidle' });
    await expect(card(page, 'company.contacts')).toContainText(s.names.contact);
    await expect(card(page, 'company.deals')).toContainText(s.names.deal);
    await expect(page.getByTestId('record-summary-contacts').getByRole('link', { name: s.names.contact })).toBeVisible();
    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    await expect(card(page, 'deal.contacts')).toContainText(s.names.contact);
    await expect(card(page, 'deal.companies')).toContainText(s.names.company);
    await expect(page.getByTestId('record-summary-companies').getByRole('link', { name: s.names.company })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('una propiedad se edita en la columna izquierda con el timeline a la vista, y queda guardada', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(`${s.paths.contact}?tab=activity`, { waitUntil: 'networkidle' });
    const row = prop(page, 'jobTitle');
    await expect(row.locator('.prop-btn')).toHaveText('Buyer');
    // El timeline sigue en pantalla mientras se edita.
    await expect(timelineTools(page)).toBeVisible();

    await row.locator('.prop-btn').click();
    const input = row.locator('input');
    await expect(input).toBeFocused();
    // Esc cancela sin guardar.
    await input.fill('Nope');
    await input.press('Escape');
    await expect(row.locator('.prop-btn')).toHaveText('Buyer');

    await row.locator('.prop-btn').click();
    const title = `Head of buying ${s.tag}`;
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/crm/contacts/${s.ids.contact}`) && r.request().method() === 'PATCH');
    await row.locator('input').fill(title);
    await row.locator('input').press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(row.locator('.prop-btn')).toHaveText(title);
    // La línea clave de la identidad se actualiza sola.
    await expect(page.getByTestId('record-left').locator('.rec-keyline')).toContainText(title);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(prop(page, 'jobTitle').locator('.prop-btn')).toHaveText(title);

    // Lo mismo en empresa y deal: un texto y un número.
    await page.goto(s.paths.company, { waitUntil: 'networkidle' });
    const industry = prop(page, 'industry');
    await industry.locator('.prop-btn').click();
    const savedCo = page.waitForResponse((r) => r.url().endsWith(`/api/crm/companies/${s.ids.company}`) && r.request().method() === 'PATCH');
    await industry.locator('input').fill('Logistics');
    await industry.locator('input').press('Enter');
    expect((await savedCo).ok()).toBe(true);
    await expect(industry.locator('.prop-btn')).toHaveText('Logistics');

    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    const amount = prop(page, 'amount');
    await amount.locator('.prop-btn').click();
    const savedDeal = page.waitForResponse((r) => r.url().endsWith(`/api/crm/deals/${s.ids.deal}`) && r.request().method() === 'PATCH');
    await amount.locator('input').fill('5300');
    await amount.locator('input').press('Enter');
    expect((await savedDeal).ok()).toBe(true);
    await expect(amount.locator('.prop-btn')).toContainText('5,300');
    await expect(page.getByTestId('record-left').locator('.record-amount')).toContainText('5,300');
  });

  test('una tarjeta de asociaciones se pliega, sigue plegada al recargar y "Agregar" la abre', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    const deals = card(page, 'contact.deals');
    await expect(toggle(deals)).toHaveAttribute('aria-expanded', 'true');
    await expect(deals.getByRole('link', { name: s.names.deal })).toBeVisible();
    // Como en HubSpot: "+ Agregar" en el encabezado, abierta o plegada (abre el selector con búsqueda).
    await expect(deals.getByTestId('record-card-add')).toBeVisible();
    await expect(deals.getByTestId('assoc-add')).toBeHidden();

    // El control está quieto bajo el mouse: pasar por encima no lo mueve ni lo esconde.
    const before = await box(toggle(deals));
    await toggle(deals).hover();
    await expect(toggle(deals)).toBeVisible();
    const after = await box(toggle(deals));
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    await toggle(deals).click();
    await expect(toggle(deals)).toHaveAttribute('aria-expanded', 'false');
    await expect(deals.getByRole('link', { name: s.names.deal })).toBeHidden();
    // El título y la cuenta siguen a la vista.
    await expect(deals.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(deals.locator('.rec-card-count')).toHaveText('1');

    await page.reload({ waitUntil: 'networkidle' });
    const again = card(page, 'contact.deals');
    await expect(toggle(again)).toHaveAttribute('aria-expanded', 'false');
    await expect(again.getByRole('link', { name: s.names.deal })).toBeHidden();
    // Las demás no se tocaron.
    await expect(toggle(card(page, 'contact.companies'))).toHaveAttribute('aria-expanded', 'true');
    // Vale para todos los contactos, no para uno: otro contacto la abre plegada también.
    const other = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Otto', lastName: `Other ${s.tag}`, email: `otto-${s.tag}@columns.example` } }));
    await page.goto(`/en/app/crm/contacts/${other.id}`, { waitUntil: 'networkidle' });
    await expect(toggle(card(page, 'contact.deals'))).toHaveAttribute('aria-expanded', 'false');

    // Plegada, "Agregar" la abre y abre el selector con el foco en la búsqueda; Esc lo cierra.
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await card(page, 'contact.deals').getByTestId('record-card-add').click();
    await expect(toggle(card(page, 'contact.deals'))).toHaveAttribute('aria-expanded', 'true');
    await expect(card(page, 'contact.deals').getByRole('link', { name: s.names.deal })).toBeVisible();
    await expect(card(page, 'contact.deals').getByTestId('assoc-picker-search')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card(page, 'contact.deals').getByTestId('assoc-picker')).toHaveCount(0);

    // Las tarjetas de propiedades se pliegan igual.
    const lifecycle = card(page, 'contact.lifecycle');
    await toggle(lifecycle).click();
    await expect(lifecycle.locator('.prop-row').first()).toBeHidden();
    await toggle(lifecycle).click();
    await expect(lifecycle.locator('.prop-row').first()).toBeVisible();
    // Y las que traen su propio título: plegadas dejan el título y nada más, tampoco los botones de su cabecera.
    const ai = card(page, 'contact.ai');
    await expect(ai.locator('.ai-actions')).toBeVisible();
    await toggle(ai).click();
    await expect(ai.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(ai.locator('.ai-actions')).toBeHidden();
    await toggle(ai).click();
    await expect(ai.locator('.ai-actions')).toBeVisible();
    const leads = card(page, 'contact.leads');
    await expect(leads.getByRole('button').nth(1)).toBeVisible();
    await toggle(leads).click();
    await expect(leads.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(leads.getByRole('button')).toHaveCount(1);
    await toggle(leads).click();
    // Una empresa sin nada para asociar a su tarjeta de madre no ofrece "Agregar" aunque esté plegada...
    // (con la cuenta compartida siempre hay otra empresa, así que se prueba el caso con algo para asociar).
    await page.goto(s.paths.company, { waitUntil: 'networkidle' });
    const parent = card(page, 'company.parent');
    await toggle(parent).click();
    await expect(parent.getByTestId('record-card-add')).toBeVisible();
    await toggle(parent).click();
    await expect(parent.getByTestId('record-card-add')).toHaveCount(0);
  });

  test('Resumen y Actividad cambian sin volver a pedir la ficha; las acciones rápidas abren el composer', async ({ page, request }) => {
    const s = await seed(request);
    const call = `Columns call ${s.tag}`;
    await json(request.post('/api/crm/activities', { data: { type: 'call', subject: call, contactId: s.ids.contact } }));
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('record-recent-communications')).toContainText(call);
    await expect(composer(page)).toHaveCount(0);

    // Desde acá, ningún pedido de la página del registro: cambiar de pestaña es del navegador.
    const documentRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(`/crm/contacts/${s.ids.contact}`) && !r.url().includes('/api/')) documentRequests.push(r.url());
    });
    await tab(page, 'activity').click();
    await expect(page).toHaveURL(/[?&]tab=activity/);
    await expect(tab(page, 'activity')).toHaveAttribute('aria-current', 'page');
    await expect(timelineTools(page)).toBeVisible();
    await expect(page.getByTestId('record-highlights')).toHaveCount(0);
    // Los costados no cambian con la pestaña.
    await expect(page.getByTestId('record-about').locator('.prop-row').first()).toBeVisible();
    await expect(card(page, 'contact.companies')).toContainText(s.names.company);
    await tab(page, 'overview').click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page.getByTestId('record-highlights')).toBeVisible();
    await expect(composer(page)).toBeHidden();

    // Acción rápida desde el Resumen: pasa a Actividad con el composer en "tarea" y el foco adentro.
    await quick(page, 'task').click();
    await expect(page).toHaveURL(/[?&]tab=activity/);
    await expect(composer(page)).toBeVisible();
    // La lista sigue en "Todas": la acción elige qué se escribe, no filtra el timeline.
    const types = page.getByTestId('record-panel-activity').getByRole('tablist');
    await expect(types.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(composer(page)).toHaveAttribute('data-kind', 'task');
    await expect(composer(page).locator('input, textarea').first()).toBeFocused();
    expect(documentRequests, 'cambiar de pestaña no vuelve a pedir la ficha').toEqual([]);

    // Con el timeline ya en pantalla, otra acción cambia el tipo.
    await quick(page, 'note').click();
    await expect(composer(page)).toHaveAttribute('data-kind', 'note');
    await expect(composer(page).locator('input, textarea').first()).toBeFocused();
    const subject = `Columns note ${s.tag}`;
    await composer(page).locator('textarea').fill(subject);
    await composer(page).locator('button[type="submit"]').click();
    const items = page.getByTestId('record-panel-activity').locator('.timeline .tl-item');
    await expect(items.filter({ hasText: subject })).toBeVisible();

    // El filtro por tipo sigue andando (pestañas en el orden: todas, nota, tarea, llamada…).
    await types.getByRole('tab').nth(3).click();
    await expect(items.filter({ hasText: subject })).toHaveCount(0);
    await expect(items.filter({ hasText: call })).toBeVisible();
    await types.getByRole('tab').first().click();
    await expect(items.filter({ hasText: subject })).toBeVisible();
    // Lo que se estaba escribiendo no se pierde al ir al Resumen y volver.
    await quick(page, 'note').click();
    await composer(page).locator('textarea').fill('Half written');
    await tab(page, 'overview').click();
    await page.getByTestId('record-see-activity').click();
    await expect(composer(page)).toBeVisible();
    await expect(composer(page).locator('textarea')).toHaveValue('Half written');

    // Los links guardados: Actividad (también en plural), y las pestañas de la ficha anterior.
    await page.goto(`${s.paths.contact}?tab=activities`, { waitUntil: 'networkidle' });
    await expect(tab(page, 'activity')).toHaveAttribute('aria-current', 'page');
    await expect(timelineTools(page)).toBeVisible();
    await page.goto(`${s.paths.contact}?tab=properties`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('contact-score-card').first()).toBeVisible();
    await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');
    await page.goto(`${s.paths.contact}?tab=related`, { waitUntil: 'networkidle' });
    await expect(card(page, 'contact.lists')).toBeVisible();
    await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');

    // Deal: productos y cotizaciones viven en el Resumen, y la etapa queda arriba de las pestañas.
    await page.goto(`${s.paths.deal}?tab=related#quotes`, { waitUntil: 'networkidle' });
    await expect(page.locator('#line-items')).toBeVisible();
    await expect(page.locator('#quotes')).toBeVisible();
    await expect(page.getByTestId('record-middle').locator('.record-stage')).toBeVisible();
    await noSideScroll(page);
  });

  test('los menús de la ficha cierran con Esc y con un clic afuera', async ({ page, request }) => {
    const s = await seed(request);
    for (const kind of KINDS) {
      await page.goto(s.paths[kind], { waitUntil: 'networkidle' });
      const more = page.getByTestId('record-more');
      const menu = page.getByRole('menu');
      await more.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(more).toBeFocused();

      await more.click();
      await expect(menu).toBeVisible();
      // Afuera: el nombre del registro, en la otra punta de la pantalla.
      await page.getByRole('heading', { level: 1 }).click();
      await expect(menu).toBeHidden();

      // El primer ítem abre su panel y Esc lo cierra.
      await more.click();
      await menu.getByRole('menuitem').first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });
});

test.describe('ficha en una columna a 390', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('identidad y acciones arriba, cuatro pestañas, sin scroll lateral', async ({ page, request }) => {
    const errors = watchErrors(page);
    const s = await seed(request);
    await seedLongOptions(request, s.tag);
    for (const kind of KINDS) {
      await page.goto(s.paths[kind], { waitUntil: 'networkidle' });
      const name = page.getByRole('heading', { level: 1, name: s.names[kind] });
      await expect(name).toBeVisible();
      const actions = page.locator('.rec-quick');
      await expect(quick(page, 'note')).toBeVisible();
      await quickLabelsFit(page);
      for (const key of ['overview', 'activity', 'properties', 'related'] as const) await expect(tab(page, key)).toBeVisible();

      // Orden: nombre, acciones rápidas, pestañas, contenido.
      const nav = page.locator('.rec3-tabs');
      const [n, q, t] = await Promise.all([box(name), box(actions), box(nav)]);
      expect(n.y).toBeLessThan(q.y);
      expect(q.y + q.height).toBeLessThanOrEqual(t.y + 1);
      expect(q.x + q.width).toBeLessThanOrEqual(PHONE.width);

      // Resumen (default): propiedades y asociaciones esperan en su pestaña.
      const about = page.getByTestId('record-about');
      const right = page.getByTestId('record-right');
      await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('record-highlights')).toBeVisible();
      await expect(about).toBeHidden();
      await expect(right).toBeHidden();
      expect((await box(page.getByTestId('record-highlights'))).y).toBeGreaterThan(t.y);
      await noSideScroll(page);

      await tab(page, 'activity').click();
      await expect(page).toHaveURL(/[?&]tab=activity/);
      await expect(timelineTools(page)).toBeVisible();
      await expect(about).toBeHidden();
      await expect(right).toBeHidden();
      await noSideScroll(page);

      await tab(page, 'properties').click();
      await expect(page).toHaveURL(/[?&]tab=properties/);
      await expect(tab(page, 'properties')).toHaveAttribute('aria-current', 'page');
      await expect(about.locator('.prop-row').first()).toBeVisible();
      const a = await box(about);
      expect(a.x + a.width).toBeLessThanOrEqual(PHONE.width);
      await expect(composer(page)).toBeHidden();
      await expect(right).toBeHidden();
      await noSideScroll(page);

      await tab(page, 'related').click();
      await expect(page).toHaveURL(/[?&]tab=related/);
      await expect(right.locator('.rec-card').first()).toBeVisible();
      await expect(about).toBeHidden();
      const r = await box(right);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(PHONE.width);
      await noSideScroll(page);

      await tab(page, 'overview').click();
      await expect(page).not.toHaveURL(/tab=/);
      await expect(page.getByTestId('record-highlights')).toBeVisible();
      await expect(right).toBeHidden();
      await noSideScroll(page);
    }

    // Un link viejo a las cotizaciones del deal cae en la pestaña que ahora las tiene.
    await page.goto(`${s.paths.deal}?tab=related#quotes`, { waitUntil: 'networkidle' });
    await expect(tab(page, 'overview')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#quotes')).toBeVisible();
    await expect(page.locator('#line-items')).toBeVisible();
    await noSideScroll(page);
    expect(errors).toEqual([]);
  });

  test('editar una propiedad, plegar una tarjeta y abrir el composer desde otra pestaña', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(`${s.paths.contact}?tab=properties`, { waitUntil: 'networkidle' });
    const row = prop(page, 'jobTitle');
    await row.locator('.prop-btn').click();
    const title = `Buyer at 390 ${s.tag}`;
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/crm/contacts/${s.ids.contact}`) && r.request().method() === 'PATCH');
    await row.locator('input').fill(title);
    await row.locator('input').press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(row.locator('.prop-btn')).toHaveText(title);
    await noSideScroll(page);

    // Acción rápida desde Propiedades: pasa a Actividad con el composer listo.
    await quick(page, 'call').click();
    await expect(page).toHaveURL(/[?&]tab=activity/);
    await expect(composer(page)).toBeVisible();
    await expect(composer(page)).toHaveAttribute('data-kind', 'call');
    await noSideScroll(page);

    await page.goto(`${s.paths.contact}?tab=related`, { waitUntil: 'networkidle' });
    const companies = card(page, 'contact.companies');
    await expect(companies.getByRole('link', { name: s.names.company })).toBeVisible();
    await toggle(companies).click();
    await expect(companies.getByRole('link', { name: s.names.company })).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(toggle(card(page, 'contact.companies'))).toHaveAttribute('aria-expanded', 'false');
    await toggle(card(page, 'contact.companies')).click();
    await expect(card(page, 'contact.companies').getByRole('link', { name: s.names.company })).toBeVisible();
    await noSideScroll(page);
  });

  test('el menú de la ficha cierra con Esc y con un toque afuera', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    const more = page.getByTestId('record-more');
    const menu = page.getByRole('menu');
    await more.click();
    await expect(menu).toBeVisible();
    const m = await box(menu);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(PHONE.width);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await more.click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(menu).toBeHidden();
    await noSideScroll(page);
  });
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('la ficha en los cinco aspectos, claro y oscuro: tres columnas a 1280 y una a 390 sin scroll lateral', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(480_000);
  const s = await seed(request);
  await seedLongOptions(request, s.tag);
  // Un nombre largo y una reunión, para ver cómo aguanta la columna angosta.
  const long = await json<{ id: string }>(
    request.post('/api/crm/contacts', {
      data: {
        firstName: 'Maximiliana Encarnación',
        lastName: `de la Santísima Trinidad ${s.tag}`,
        email: `a-very-long-address-for-columns-${s.tag}@subdomain.columns.example`,
        jobTitle: 'Regional procurement and partnerships director',
        companyId: s.ids.company,
      },
    }),
  );
  await json(request.post('/api/crm/activities', { data: { type: 'meeting', subject: `Columns look meeting ${s.tag}`, body: 'Asked for the yearly plan.', contactId: long.id } }));
  const shots = process.env.RECORD_SHOTS_DIR;
  try {
    for (const look of LOOKS) {
      await setLook(request, look);
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1280, 390]) {
          const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
          await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
          const page = await context.newPage();
          const errors = watchErrors(page);
          const targets: Array<[string, string]> = [
            ['contact', `/en/app/crm/contacts/${long.id}`],
            ['deal', s.paths.deal],
            ...(width === 390
              ? ([
                  ['contact-about', `/en/app/crm/contacts/${long.id}?tab=properties`],
                  ['company-assoc', `${s.paths.company}?tab=related`],
                ] as Array<[string, string]>)
              : ([['company-activity', `${s.paths.company}?tab=activity`]] as Array<[string, string]>)),
          ];
          for (const [name, path] of targets) {
            await page.goto(path, { waitUntil: 'networkidle' });
            await expect(page.locator('html')).toHaveAttribute('data-look', look);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await quickLabelsFit(page);
            if (width === 1280) {
              const [l, m, r] = await Promise.all([
                box(page.getByTestId('record-left')),
                box(page.getByTestId('record-middle')),
                box(page.getByTestId('record-right')),
              ]);
              expect(l.x + l.width).toBeLessThanOrEqual(m.x + 1);
              expect(m.x + m.width).toBeLessThanOrEqual(r.x + 1);
              expect(r.x + r.width).toBeLessThanOrEqual(width);
            }
            await noSideScroll(page);
            const body = await page.screenshot({ fullPage: true });
            await info.attach(`record-${name}-${look}-${theme}-${width}`, { body, contentType: 'image/png' });
            if (shots) await page.screenshot({ fullPage: true, path: `${shots}/record-${name}-${look}-${theme}-${width}.png` });
          }
          expect(errors).toEqual([]);
          await context.close();
        }
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});

async function sql(q: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: q, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Una persona nueva con su cuenta creada (la primera visita la da de alta). */
async function person(browser: Browser, baseURL: string, label: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `rec-${label}-${uid()}@columns-e2e.io`;
  const ctx = await browser.newContext({ baseURL, viewport: DESKTOP });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/teams/members');
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  return { ctx, id };
}

/** Los valores del card de valor en deals, como números (sin moneda ni separadores). */
async function rollupNumbers(page: Page): Promise<number[]> {
  const texts = await page.getByTestId('company-rollup').locator('dd').allTextContents();
  return texts.map((t) => Number(t.replace(/[^0-9.]/g, '')));
}

test('un member que solo ve lo suyo: la empresa no muestra deals, hijas ni empresa principal ocultas', async ({ browser, baseURL }) => {
  // Workspace propio (no el demo compartido): la visibilidad 'mine' es de todo el workspace.
  const owner = await person(browser, baseURL!, 'owner');
  const member = await person(browser, baseURL!, 'member');
  try {
    const team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Columns team', ?)", [team, owner.id]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, member.id]);
    await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, member.id]);
    const api = owner.ctx.request;
    await json(api.put('/api/crm/visibility', { data: { visibility: 'mine' } }));

    const tag = uid();
    const hiddenName = `Hidden child ${tag}`;
    const hiddenDeal = `Hidden deal ${tag}`;
    const parent = await json<{ id: string }>(api.post('/api/crm/companies', { data: { name: `Parent ${tag}`, ownerId: member.id } }));
    const visibleChild = (
      await json<{ id: string }>(api.post('/api/crm/companies', { data: { name: `Visible child ${tag}`, ownerId: member.id, parentCompanyId: parent.id } }))
    ).id;
    const hidden = await json<{ id: string }>(
      api.post('/api/crm/companies', { data: { name: hiddenName, ownerId: owner.id, parentCompanyId: parent.id } }),
    );
    const pipeline = await json<{ id: string }>(api.post('/api/crm/pipelines', { data: { name: `Scope ${tag}` } }));
    const stage = await json<{ id: string }>(api.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Open' } }));
    const deal = (name: string, ownerId: string, amount: number, companyId: string) =>
      json<{ id: string }>(api.post('/api/crm/deals', { data: { name, amount, ownerId, companyId, pipelineId: pipeline.id, stageId: stage.id } }));
    await deal(`Mine on parent ${tag}`, member.id, 130, parent.id);
    const other = await deal(hiddenDeal, owner.id, 5000, parent.id);
    await deal(`Mine on child ${tag}`, member.id, 70, visibleChild);
    await deal(`Other on hidden ${tag}`, owner.id, 9000, hidden.id);
    // Un contacto del member cuya empresa principal es la oculta.
    const contact = await json<{ id: string }>(
      api.post('/api/crm/contacts', { data: { firstName: 'Scoped', lastName: tag, email: `scoped-${tag}@columns.example`, ownerId: member.id, companyId: hidden.id } }),
    );

    const page = await member.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(`/en/app/crm/companies/${parent.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('company-rollup')).toBeVisible();
    // Empresa: su deal de 130. Árbol: 130 + 70 en dos deals, con una sola hija.
    await expect.poll(() => rollupNumbers(page)).toEqual([130, 0, 200, 0, 2]);
    const body = page.locator('body');
    await expect(body).not.toContainText(hiddenName);
    await expect(body).not.toContainText(hiddenDeal);
    expect(await page.content()).not.toContain(hidden.id);
    expect(await page.content()).not.toContain(other.id);

    // Contacto: la propiedad Empresa queda vacía y sin selector.
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'domcontentloaded' });
    const company = prop(page, 'companyId');
    await expect(company).toBeVisible();
    await expect(company.locator('select')).toHaveCount(0);
    await expect(body).not.toContainText(hiddenName);
    expect(errors).toEqual([]);
  } finally {
    await owner.ctx.close();
    await member.ctx.close();
  }
});
