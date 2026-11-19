import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * CRM: ficha de contacto, empresa y deal en tres columnas (como HubSpot).
 * A 1280: propiedades a la izquierda, pestañas Resumen / Actividad en el
 * medio, asociaciones a la derecha. A 390: una columna, con Propiedades y
 * Asociaciones como pestañas, sin scroll lateral.
 *
 * Los registros se crean por API y se abren por id: la cuenta demo es
 * compartida y una fila nueva puede no estar en la primera página.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const KINDS = ['contact', 'company', 'deal'] as const;
type Kind = (typeof KINDS)[number];

test.describe.configure({ timeout: 150_000 });
// La ficha carga las tres columnas de una vez: una navegación entre pestañas puede pasar los 5 s por defecto.
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
}

/** Una empresa, un contacto en ella y un deal con los dos, creados recién. */
async function seed(request: APIRequestContext): Promise<Seed> {
  const tag = uid();
  const names = { company: `Columns Co ${tag}`, contact: `Cora Columns ${tag}`, deal: `Columns deal ${tag}` };
  const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: names.company, domain: `columns-${tag}.example` } }));
  const contact = await json<{ id: string }>(
    request.post('/api/crm/contacts', {
      data: { firstName: 'Cora', lastName: `Columns ${tag}`, email: `cora-${tag}@columns.example`, jobTitle: 'Buyer', companyId: company.id },
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
    ids: { contact: contact.id, company: company.id, deal: deal.id },
    paths: {
      contact: `/en/app/crm/contacts/${contact.id}`,
      company: `/en/app/crm/companies/${company.id}`,
      deal: `/en/app/crm/deals/${deal.id}`,
    },
  };
}

const tabsNav = (page: Page) => page.getByRole('navigation', { name: 'Record sections' });
const tabLink = (page: Page, name: string) => tabsNav(page).getByRole('link', { name, exact: true });
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, 'el elemento tiene caja').not.toBeNull();
  return b!;
}

test.describe('ficha en tres columnas a 1280', () => {
  test.use({ viewport: DESKTOP });

  test('contacto, empresa y deal: izquierda, medio y derecha a la vista a la vez', async ({ page, request }) => {
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
      const quick = left.getByRole('group', { name: 'Quick actions' });
      for (const action of ['Note', 'Email', 'Call', 'Task', 'Meeting']) {
        await expect(quick.getByRole('button', { name: action, exact: true })).toBeVisible();
      }
      await expect(page.getByTestId('record-about').locator('.prop-row').first()).toBeVisible();
      await expect(right.locator('.rec-card').first()).toBeVisible();

      // Medio: dos pestañas; Propiedades y Asociaciones ya están a los costados.
      await expect(tabLink(page, 'Overview')).toBeVisible();
      await expect(tabLink(page, 'Activities')).toHaveAttribute('aria-current', 'page');
      await expect(tabLink(page, 'About')).toBeHidden();
      await expect(tabLink(page, 'Associations')).toBeHidden();
      await expect(mid.locator('.tl-composer')).toBeVisible();
      await noSideScroll(page);
    }

    // Las asociaciones del seed, cada una en su tarjeta con su cuenta.
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await expect(card(page, 'contact.companies')).toContainText(s.names.company);
    await expect(card(page, 'contact.deals')).toContainText(s.names.deal);
    await expect(card(page, 'contact.deals').locator('.rec-card-count')).toHaveText('1');
    await page.goto(s.paths.company, { waitUntil: 'networkidle' });
    await expect(card(page, 'company.contacts')).toContainText(s.names.contact);
    await expect(card(page, 'company.deals')).toContainText(s.names.deal);
    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    await expect(card(page, 'deal.contacts')).toContainText(s.names.contact);
    await expect(card(page, 'deal.companies')).toContainText(s.names.company);
    expect(errors).toEqual([]);
  });

  test('una propiedad se edita en la columna izquierda con el timeline a la vista, y queda guardada', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    const about = page.getByTestId('record-about');
    const row = about.locator('.prop-row').filter({ hasText: 'Job title' });
    await expect(row.locator('.prop-btn')).toHaveText('Buyer');
    // El timeline sigue en pantalla mientras se edita.
    await expect(page.getByTestId('record-middle').locator('.tl-composer')).toBeVisible();

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
    await expect(page.getByTestId('record-about').locator('.prop-row').filter({ hasText: 'Job title' }).locator('.prop-btn')).toHaveText(title);

    // Lo mismo en empresa y deal: un select y un número.
    await page.goto(s.paths.company, { waitUntil: 'networkidle' });
    const industry = page.getByTestId('record-about').locator('.prop-row').filter({ hasText: 'Industry' });
    await industry.locator('.prop-btn').click();
    const savedCo = page.waitForResponse((r) => r.url().endsWith(`/api/crm/companies/${s.ids.company}`) && r.request().method() === 'PATCH');
    await industry.locator('input').fill('Logistics');
    await industry.locator('input').press('Enter');
    expect((await savedCo).ok()).toBe(true);
    await expect(industry.locator('.prop-btn')).toHaveText('Logistics');

    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    const amount = page.getByTestId('record-about').locator('.prop-row').filter({ hasText: 'Amount' });
    await amount.locator('.prop-btn').click();
    const savedDeal = page.waitForResponse((r) => r.url().endsWith(`/api/crm/deals/${s.ids.deal}`) && r.request().method() === 'PATCH');
    await amount.locator('input').fill('5300');
    await amount.locator('input').press('Enter');
    expect((await savedDeal).ok()).toBe(true);
    await expect(amount.locator('.prop-btn')).toContainText('5,300');
    await expect(page.getByTestId('record-left').locator('.record-amount')).toContainText('5,300');
  });

  test('una tarjeta de asociaciones se pliega, sigue plegada al recargar y "Add" la abre', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    const deals = card(page, 'contact.deals');
    const toggle = deals.locator('.rec-card-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Collapse Deals');
    await expect(deals.getByRole('link', { name: s.names.deal })).toBeVisible();

    // El control está quieto bajo el mouse: pasar por encima no lo mueve ni lo esconde.
    const before = await box(toggle);
    await toggle.hover();
    await expect(toggle).toBeVisible();
    const after = await box(toggle);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Expand Deals');
    await expect(deals.getByRole('link', { name: s.names.deal })).toBeHidden();
    // El título y la cuenta siguen a la vista.
    await expect(deals.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(deals.locator('.rec-card-count')).toHaveText('1');

    await page.reload({ waitUntil: 'networkidle' });
    const again = card(page, 'contact.deals');
    await expect(again.locator('.rec-card-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(again.getByRole('link', { name: s.names.deal })).toBeHidden();
    // Las demás no se tocaron.
    await expect(card(page, 'contact.companies').locator('.rec-card-toggle')).toHaveAttribute('aria-expanded', 'true');
    // Vale para todos los contactos, no para uno: otro contacto la abre plegada también.
    const other = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Otto', lastName: `Other ${s.tag}`, email: `otto-${s.tag}@columns.example` } }));
    await page.goto(`/en/app/crm/contacts/${other.id}`, { waitUntil: 'networkidle' });
    await expect(card(page, 'contact.deals').locator('.rec-card-toggle')).toHaveAttribute('aria-expanded', 'false');

    // "Add" abre la tarjeta y deja el foco en el selector de asociar.
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await card(page, 'contact.deals').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card(page, 'contact.deals').locator('.rec-card-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(card(page, 'contact.deals').getByRole('link', { name: s.names.deal })).toBeVisible();
    await expect(card(page, 'contact.deals').locator('.assoc-add-row').locator('select, button, a').first()).toBeFocused();

    // Las tarjetas de propiedades y las que traen su propio título se pliegan igual.
    const lifecycle = card(page, 'contact.lifecycle');
    await lifecycle.locator('.rec-card-toggle').click();
    await expect(lifecycle.locator('.prop-row').first()).toBeHidden();
    await lifecycle.locator('.rec-card-toggle').click();
    await expect(lifecycle.locator('.prop-row').first()).toBeVisible();
    const ai = card(page, 'contact.ai');
    await expect(ai.locator('.ai-actions')).toBeVisible();
    await ai.locator('.rec-card-toggle').click();
    await expect(ai.getByRole('heading', { name: 'AI summary' })).toBeVisible();
    await expect(ai.locator('.ai-actions')).toBeHidden();
    await ai.locator('.rec-card-toggle').click();
    await expect(ai.locator('.ai-actions')).toBeVisible();
  });

  test('pestañas del medio: Resumen y Actividad; las acciones rápidas abren el composer', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.contact, { waitUntil: 'networkidle' });
    await tabLink(page, 'Overview').click();
    await expect(page).toHaveURL(/tab=overview/);
    await expect(tabLink(page, 'Overview')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('record-highlights')).toBeVisible();
    await expect(page.getByTestId('record-recent-activity')).toBeVisible();
    await expect(page.locator('.tl-composer')).toHaveCount(0);
    // Los costados no cambian con la pestaña.
    await expect(page.getByTestId('record-about').locator('.prop-row').first()).toBeVisible();
    await expect(card(page, 'contact.companies')).toContainText(s.names.company);

    // Acción rápida desde Resumen: va a Actividad con el composer en "Task" y el foco adentro.
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Task', exact: true }).click();
    await expect(page).toHaveURL(/tab=activity/);
    const composer = page.locator('.tl-composer');
    await expect(composer).toBeVisible();
    const types = page.getByRole('tablist', { name: 'Activity type' });
    // La lista sigue en "All": la acción elige qué se escribe, no filtra el timeline.
    await expect(types.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
    await expect(composer.getByLabel('Activity type')).toHaveValue('task');
    await expect(composer.getByRole('button', { name: 'Add task' })).toBeVisible();
    await expect(composer.locator('input, textarea').first()).toBeFocused();

    // Con el timeline ya en pantalla, otra acción cambia el tipo sin navegar.
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Note', exact: true }).click();
    await expect(composer.getByLabel('Activity type')).toHaveValue('note');
    await expect(composer.locator('input, textarea').first()).toBeFocused();
    const subject = `Columns note ${s.tag}`;
    await composer.locator('input').first().fill(subject);
    await composer.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('.timeline .tl-item').filter({ hasText: subject })).toBeVisible();

    // El filtro por tipo sigue andando, y el Resumen muestra la nota entre lo reciente.
    await types.getByRole('tab', { name: /^Call/ }).click();
    await expect(page.locator('.timeline .tl-item').filter({ hasText: subject })).toHaveCount(0);
    await types.getByRole('tab', { name: /^All/ }).click();
    await expect(page.locator('.timeline .tl-item').filter({ hasText: subject })).toBeVisible();
    await tabLink(page, 'Overview').click();
    await expect(page.getByTestId('record-recent-activity')).toContainText(subject);
    await page.getByTestId('record-recent-activity').getByRole('link', { name: 'See all activity' }).click();
    await expect(page.locator('.tl-composer')).toBeVisible();

    // Los links guardados de la ficha anterior abren la misma ficha, con los costados a la vista.
    await page.goto(`${s.paths.contact}?tab=properties`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('contact-score-card').first()).toBeVisible();
    await expect(tabLink(page, 'Activities')).toHaveAttribute('aria-current', 'page');
    await page.goto(`${s.paths.contact}?tab=related`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
    await expect(tabLink(page, 'Overview')).toHaveAttribute('aria-current', 'page');

    // Deal: productos y cotizaciones viven en el Resumen, y la etapa queda arriba de las pestañas.
    await page.goto(`${s.paths.deal}?tab=overview`, { waitUntil: 'networkidle' });
    await expect(page.locator('#line-items')).toBeVisible();
    await expect(page.locator('#quotes')).toBeVisible();
    await expect(page.getByTestId('record-middle').locator('.record-stage')).toBeVisible();
    await noSideScroll(page);
  });

  test('los menús de la ficha cierran con Esc y con un clic afuera', async ({ page, request }) => {
    const s = await seed(request);
    for (const kind of KINDS) {
      await page.goto(s.paths[kind], { waitUntil: 'networkidle' });
      const more = page.getByRole('button', { name: 'More', exact: true });
      const menu = page.getByRole('menu', { name: 'More' });
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

      // El historial abre en su panel y Esc lo cierra.
      await more.click();
      await menu.getByRole('menuitem', { name: 'History' }).click();
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
    for (const kind of KINDS) {
      await page.goto(s.paths[kind], { waitUntil: 'networkidle' });
      const name = page.getByRole('heading', { level: 1, name: s.names[kind] });
      await expect(name).toBeVisible();
      const quick = page.getByRole('group', { name: 'Quick actions' });
      await expect(quick.getByRole('button', { name: 'Note', exact: true })).toBeVisible();
      for (const tab of ['Overview', 'Activities', 'About', 'Associations']) await expect(tabLink(page, tab)).toBeVisible();

      // Orden: nombre, acciones rápidas, pestañas, contenido.
      const [n, q, t] = await Promise.all([box(name), box(quick), box(tabsNav(page))]);
      expect(n.y).toBeLessThan(q.y);
      expect(q.y + q.height).toBeLessThanOrEqual(t.y + 1);
      expect(q.x + q.width).toBeLessThanOrEqual(PHONE.width);

      // Actividad (default): el timeline; propiedades y asociaciones esperan en su pestaña.
      const about = page.getByTestId('record-about');
      const right = page.getByTestId('record-right');
      await expect(tabLink(page, 'Activities')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.tl-composer')).toBeVisible();
      await expect(about).toBeHidden();
      await expect(right).toBeHidden();
      expect((await box(page.locator('.tl-composer'))).y).toBeGreaterThan(t.y);
      await noSideScroll(page);

      await tabLink(page, 'About').click();
      await expect(page).toHaveURL(/tab=properties/);
      await expect(tabLink(page, 'About')).toHaveAttribute('aria-current', 'page');
      await expect(about.locator('.prop-row').first()).toBeVisible();
      await expect(page.locator('.tl-composer')).toBeHidden();
      await expect(right).toBeHidden();
      await noSideScroll(page);

      await tabLink(page, 'Associations').click();
      await expect(page).toHaveURL(/tab=related/);
      await expect(right.locator('.rec-card').first()).toBeVisible();
      await expect(about).toBeHidden();
      const r = await box(right);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(PHONE.width);
      await noSideScroll(page);

      await tabLink(page, 'Overview').click();
      await expect(page).toHaveURL(/tab=overview/);
      await expect(page.getByTestId('record-highlights')).toBeVisible();
      await expect(right).toBeHidden();
      await noSideScroll(page);
    }
    expect(errors).toEqual([]);
  });

  test('editar una propiedad, plegar una tarjeta y abrir el composer desde otra pestaña', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(`${s.paths.contact}?tab=properties`, { waitUntil: 'networkidle' });
    const row = page.getByTestId('record-about').locator('.prop-row').filter({ hasText: 'Job title' });
    await row.locator('.prop-btn').click();
    const title = `Buyer at 390 ${s.tag}`;
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/crm/contacts/${s.ids.contact}`) && r.request().method() === 'PATCH');
    await row.locator('input').fill(title);
    await row.locator('input').press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(row.locator('.prop-btn')).toHaveText(title);
    await noSideScroll(page);

    // Acción rápida desde Propiedades: pasa a Actividad con el composer listo.
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Call', exact: true }).click();
    await expect(page).toHaveURL(/tab=activity/);
    await expect(page.locator('.tl-composer')).toBeVisible();
    await expect(page.locator('.tl-composer').getByLabel('Activity type')).toHaveValue('call');
    await noSideScroll(page);

    await page.goto(`${s.paths.contact}?tab=related`, { waitUntil: 'networkidle' });
    const companies = card(page, 'contact.companies');
    await expect(companies.getByRole('link', { name: s.names.company })).toBeVisible();
    await companies.locator('.rec-card-toggle').click();
    await expect(companies.getByRole('link', { name: s.names.company })).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(card(page, 'contact.companies').locator('.rec-card-toggle')).toHaveAttribute('aria-expanded', 'false');
    await card(page, 'contact.companies').locator('.rec-card-toggle').click();
    await expect(card(page, 'contact.companies').getByRole('link', { name: s.names.company })).toBeVisible();
    await noSideScroll(page);
  });

  test('el menú "More" cierra con Esc y con un toque afuera', async ({ page, request }) => {
    const s = await seed(request);
    await page.goto(s.paths.deal, { waitUntil: 'networkidle' });
    const more = page.getByRole('button', { name: 'More', exact: true });
    const menu = page.getByRole('menu', { name: 'More' });
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
  test.setTimeout(420_000);
  const s = await seed(request);
  // Un nombre largo y una nota, para ver cómo aguanta la columna angosta.
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
  await json(request.post('/api/crm/activities', { data: { type: 'note', subject: `Columns look note ${s.tag}`, body: 'Asked for the yearly plan.', contactId: long.id } }));
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
            ['deal', `${s.paths.deal}?tab=overview`],
            ...(width === 390 ? ([['contact-about', `/en/app/crm/contacts/${long.id}?tab=properties`], ['company-assoc', `${s.paths.company}?tab=related`]] as Array<[string, string]>) : ([['company', s.paths.company]] as Array<[string, string]>)),
          ];
          for (const [name, path] of targets) {
            await page.goto(path, { waitUntil: 'networkidle' });
            await expect(page.locator('html')).toHaveAttribute('data-look', look);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
