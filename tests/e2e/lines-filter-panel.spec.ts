import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Lines: el panel de filtros de la bandeja, de punta a punta contra el
 * proveedor falso (GROUPS_FAKE=1). Abrir el panel, elegir varias personas, una
 * etiqueta y un período, aplicar, ver los chips y la lista filtrada, sacar un
 * chip, restablecer, descartar con Esc o un clic afuera, las pestañas como
 * atajos del panel, guardar como lista y volver a abrirla, una lista guardada
 * con el formato anterior, el teclado y el teléfono (hoja en dos pasos).
 *
 * Todos los nombres y números son inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ timeout: 180_000 });

interface NumberInfo {
  id: string;
  webhookPath: string;
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, chatName: string) {
  const res = await request.post(n.webhookPath, {
    data: {
      events: [{ type: 'message', chatId, isGroup: true, chatName, fromMe: false, senderPhone: '5490000000101', senderName: 'Cliente de prueba', providerMessageId: `fp-${uid()}`, body: 'Buen día' }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function sql(statement: string, args: Array<string | number | null> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

interface World {
  tag: string;
  n: NumberInfo;
  ana: { id: string; name: string };
  luis: { id: string; name: string };
  label: { id: string; name: string };
  /** a: Ana + etiqueta. b: Luis + etiqueta. c: Luis. d: sin asignar + etiqueta. e: Ana + etiqueta, último mensaje hace 20 días. */
  names: Record<'a' | 'b' | 'c' | 'd' | 'e', string>;
  ids: Record<'a' | 'b' | 'c' | 'd' | 'e', string>;
  cleanup: () => Promise<void>;
}

/** Un workspace con dos personas más, una etiqueta y cinco chats en una línea propia. */
async function world(request: APIRequestContext): Promise<World> {
  const tag = uid();
  // Primero un pedido a la app: crea la base y el usuario demo si es la primera prueba de la corrida.
  const n = await fakeNumber(request, `Línea ${tag}`);
  const demo = String((await sql("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'"))[0].id);
  const ana = { id: `fp-ana-${tag}`, name: `Ana Prueba ${tag}` };
  const luis = { id: `fp-luis-${tag}`, name: `Luis Prueba ${tag}` };
  const team = `fp-team-${tag}`;
  // Más gente en el workspace: con varias opciones, el editor ofrece su buscador.
  const extras = ['Uno', 'Dos', 'Tres', 'Cuatro'].map((x) => ({ id: `fp-${x.toLowerCase()}-${tag}`, name: `Extra ${x} ${tag}` }));
  const everyone = [ana, luis, ...extras];
  for (const p of everyone) await sql('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [p.id, `${p.id}@test.local`, p.name]);
  await sql('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)', [team, `Equipo ${tag}`, demo]);
  for (const p of everyone) await sql('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [team, p.id, 'member']);

  // Una segunda línea: con más de una, el panel ofrece el campo "Línea".
  const spare = await fakeNumber(request, `Otra ${tag}`);
  const made = (await (await request.post('/api/groups/labels', { data: { name: `Mayorista ${tag}`, color: 'green' } })).json()) as { id: string; name: string };
  const names = { a: `Alfa ${tag}`, b: `Beta ${tag}`, c: `Gama ${tag}`, d: `Delta ${tag}`, e: `Eco ${tag}` };
  const ids = {} as World['ids'];
  let i = 0;
  for (const k of ['a', 'b', 'c', 'd', 'e'] as const) {
    await inbound(request, n, `12036300${Date.now()}${i++}@g.us`, names[k]);
    ids[k] = String((await sql('SELECT id FROM groups_chats WHERE name = ?', [names[k]]))[0].id);
  }
  const patch = async (id: string, data: Record<string, unknown>) => expect((await request.patch(`/api/groups/chats/${id}`, { data })).ok()).toBe(true);
  await patch(ids.a, { assignedTo: ana.id, labelIds: [made.id] });
  await patch(ids.b, { assignedTo: luis.id, labelIds: [made.id] });
  await patch(ids.c, { assignedTo: luis.id });
  await patch(ids.d, { labelIds: [made.id] });
  await patch(ids.e, { assignedTo: ana.id, labelIds: [made.id] });
  await sql('UPDATE groups_chats SET last_message_at = ? WHERE id = ?', [new Date(Date.now() - 20 * 86_400_000).toISOString(), ids.e]);

  return {
    tag,
    n,
    ana,
    luis,
    label: { id: made.id, name: made.name },
    names,
    ids,
    cleanup: async () => {
      for (const num of [n, spare]) await request.delete(`/api/groups/numbers/${num.id}`).catch(() => null);
      await sql('DELETE FROM team_members WHERE team_id = ?', [team]);
      await sql('DELETE FROM teams WHERE id = ?', [team]);
      for (const p of everyone) await sql('DELETE FROM users WHERE id = ?', [p.id]);
    },
  };
}

const row = (page: Page, name: string) => page.locator('.gr-row', { hasText: name });
const filterButton = (page: Page) => page.getByTestId('lines-filter-button');
const panel = (page: Page) => page.getByRole('dialog', { name: 'Filters' });
const chips = (page: Page) => page.getByTestId('filter-chips');
/** Un campo de la lista de la izquierda (su nombre, más lo que tenga puesto), sin confundirlo con el título de una categoría. */
const field = (dlg: Locator, name: string) =>
  dlg.getByRole('navigation', { name: 'Filter fields' }).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d+ selected| set)?$`) });
const picked = (dlg: Locator) => dlg.locator('.ui-filter-count');

/** La bandeja con la búsqueda puesta en la etiqueta del test: solo sus chats. */
async function openInbox(page: Page, w: World) {
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  // Con `next dev` la primera carga puede recompilar y recargar la página: se vuelve a escribir hasta que la lista responde.
  await expect(async () => {
    await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(w.tag);
    await expect(row(page, w.names.a)).toBeVisible();
  }).toPass({ timeout: 30_000 });
}

async function expectRows(page: Page, w: World, shown: Array<keyof World['names']>) {
  for (const k of ['a', 'b', 'c', 'd', 'e'] as const) {
    if (shown.includes(k)) await expect(row(page, w.names[k])).toBeVisible();
    else await expect(row(page, w.names[k])).toHaveCount(0);
  }
}

test('panel de filtros: elegir, aplicar, chips, sacar uno, restablecer y descartar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const w = await world(request);
  try {
    await openInbox(page, w);
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);
    await expect(chips(page)).toHaveCount(0);

    // Abrir: la lista no se mueve, el panel flota sobre la lista y la conversación.
    const listBox = await page.locator('.gr-rows').boundingBox();
    await filterButton(page).click();
    const dlg = panel(page);
    await expect(dlg).toBeVisible();
    await expect(filterButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(dlg.getByRole('searchbox', { name: 'Search filters…' })).toBeFocused();
    expect(await page.locator('.gr-rows').boundingBox()).toEqual(listBox);
    const box = (await dlg.boundingBox())!;
    const listRight = (await page.locator('.gr-list').boundingBox())!.width + (await page.locator('.gr-list').boundingBox())!.x;
    expect(box.x + box.width).toBeGreaterThan(listRight + 200);
    expect(box.width).toBeLessThanOrEqual(900);
    // Los selects de antes ya no están.
    await expect(page.locator('.gr-list-head').getByRole('combobox', { name: 'Assigned to' })).toHaveCount(0);
    await expect(page.locator('.gr-list-head').getByRole('combobox', { name: 'Label' })).toHaveCount(0);

    // Dos personas (se suman).
    await field(dlg, 'Assigned to').click();
    await expect(dlg.getByRole('heading', { name: 'Assigned to' })).toBeVisible();
    await dlg.getByRole('searchbox', { name: 'Filter the options of Assigned to' }).fill('zzzz');
    await expect(dlg.getByText('No options match.')).toBeVisible();
    await dlg.getByRole('searchbox', { name: 'Filter the options of Assigned to' }).fill(`prueba ${w.tag}`);
    await expect(dlg.getByText('Select all (2)')).toBeVisible();
    await dlg.getByLabel(w.ana.name).check();
    await expect(picked(dlg)).toHaveText('1 selected');
    // "Elegir todo" marca lo que se ve con el filtro puesto.
    await dlg.getByLabel('Select all (2)').check();
    await expect(dlg.getByLabel(w.luis.name)).toBeChecked();
    await expect(picked(dlg)).toHaveText('2 selected');
    // Una etiqueta.
    await field(dlg, 'Labels').click();
    await dlg.getByLabel(w.label.name).check();
    // Un período.
    await field(dlg, 'Last message').click();
    await dlg.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(dlg.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
    // Hasta aplicar es un borrador: la lista sigue igual.
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);

    const asked = page.waitForRequest((req) => req.url().includes('/api/groups/chats') && req.url().includes('f='));
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg).toHaveCount(0);
    expect(decodeURIComponent((await asked).url())).toContain(`"assignees":["${w.ana.id}","${w.luis.id}"]`);
    // (Ana o Luis) y etiqueta y último mensaje en 7 días.
    await expectRows(page, w, ['a', 'b']);
    await expect(filterButton(page)).toBeFocused();
    await expect(filterButton(page)).toHaveAccessibleName('Filters, 3 active');
    await expect(chips(page).locator('[data-chip="assignee"]')).toContainText(`Assigned to: ${w.ana.name}, ${w.luis.name}`);
    await expect(chips(page).locator('[data-chip="labels"]')).toContainText(`Labels: ${w.label.name}`);
    await expect(chips(page).locator('[data-chip="lastMessage"]')).toContainText('Last message: Last 7 days');

    // Sacar un chip.
    await chips(page).getByRole('button', { name: 'Remove filter: Last message' }).click();
    await expectRows(page, w, ['a', 'b', 'e']);
    await chips(page).getByRole('button', { name: 'Remove filter: Labels' }).click();
    await expectRows(page, w, ['a', 'b', 'c', 'e']);
    await expect(filterButton(page)).toHaveAccessibleName('Filters, 1 active');

    // Un chip abre el panel en su campo, con lo elegido marcado.
    await chips(page).locator('[data-chip="assignee"]').getByRole('button', { name: /Assigned to:/ }).click();
    await expect(panel(page).getByRole('heading', { name: 'Assigned to' })).toBeVisible();
    await expect(panel(page).getByLabel(w.ana.name)).toBeChecked();
    // Esc descarta lo tocado.
    await panel(page).getByLabel('Unassigned').check();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(filterButton(page)).toBeFocused();
    await expectRows(page, w, ['a', 'b', 'c', 'e']);
    await expect(chips(page).locator('[data-chip="assignee"]')).not.toContainText('Unassigned');

    // Un clic afuera también.
    await filterButton(page).click();
    await field(panel(page), 'Unread').click();
    await panel(page).getByRole('group', { name: 'Unread' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.mouse.click(5, 5);
    await expect(panel(page)).toHaveCount(0);
    await expectRows(page, w, ['a', 'b', 'c', 'e']);

    // "Sin asignar" se suma a las personas.
    await filterButton(page).click();
    await panel(page).getByLabel('Unassigned').check();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);
    await expect(chips(page).locator('[data-chip="assignee"]')).toContainText('+1');

    // Restablecer: vacía el borrador y, al aplicar, la lista vuelve entera.
    await filterButton(page).click();
    await panel(page).getByRole('button', { name: 'Reset filters' }).click();
    await expect(picked(panel(page))).toHaveText('0 selected');
    await expect(chips(page)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expect(chips(page)).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName('Filters');
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);

    // "Limpiar" saca todos los chips de una vez.
    await filterButton(page).click();
    await field(panel(page), 'Labels').click();
    await panel(page).getByLabel('No label').check();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expectRows(page, w, ['c']);
    await chips(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);
  } finally {
    await w.cleanup();
  }
  expect(errors).toEqual([]);
});

test('panel de filtros: pestañas como atajos, teclado y estados vacíos', async ({ page, request }) => {
  const errors = watchErrors(page);
  const w = await world(request);
  try {
    // "a" queda leído: el resto, sin leer.
    expect((await request.patch(`/api/groups/chats/${w.ids.a}`, { data: { read: true } })).ok()).toBe(true);
    await openInbox(page, w);
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });

    // Lo que se pone en el panel marca la pestaña (y no repite un chip).
    await filterButton(page).click();
    await field(panel(page), 'Unread').click();
    await panel(page).getByRole('group', { name: 'Unread' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expect(tab('Unread')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('All')).toHaveAttribute('aria-selected', 'false');
    await expect(chips(page)).toHaveCount(0);
    await expectRows(page, w, ['b', 'c', 'd', 'e']);

    // Y la pestaña se ve en el panel.
    await tab('All').click();
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);
    await tab('Unassigned').click();
    await expectRows(page, w, ['d']);
    await filterButton(page).click();
    await field(panel(page), 'Assigned to').click();
    await expect(panel(page).getByLabel('Unassigned')).toBeChecked();
    // Sumar una persona en el panel: ya no es la pestaña "Sin asignar", es un filtro con su chip.
    await panel(page).getByLabel(w.luis.name).check();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expect(tab('Unassigned')).toHaveAttribute('aria-selected', 'false');
    await expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    await expect(chips(page).locator('[data-chip="assignee"]')).toContainText(`Unassigned, ${w.luis.name}`);
    await expectRows(page, w, ['b', 'c', 'd']);
    // Una pestaña deja lo que no es suyo.
    await tab('Unread').click();
    await expect(chips(page).locator('[data-chip="assignee"]')).toBeVisible();
    await expectRows(page, w, ['b', 'c', 'd']);
    await chips(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(tab('All')).toHaveAttribute('aria-selected', 'true');

    // Teclado: buscar un filtro, Enter lo abre; flechas en la lista; Enter en una casilla aplica.
    await filterButton(page).focus();
    await page.keyboard.press('Enter');
    const dlg = panel(page);
    await expect(dlg.getByRole('searchbox', { name: 'Search filters…' })).toBeFocused();
    await page.keyboard.type('zzzz');
    await expect(dlg.getByText('No filters match.').first()).toBeVisible();
    await dlg.getByRole('searchbox', { name: 'Search filters…' }).fill('ticket');
    await expect(field(dlg, 'Open ticket')).toBeVisible();
    await expect(field(dlg, 'Labels')).toHaveCount(0);
    await dlg.getByRole('searchbox', { name: 'Search filters…' }).fill('');
    await page.keyboard.press('ArrowDown');
    await expect(field(dlg, 'Chat status')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(field(dlg, 'Unread')).toBeFocused();
    await expect(dlg.getByRole('heading', { name: 'Unread' })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(field(dlg, 'Chat status')).toBeFocused();
    // Una categoría se pliega y se despliega.
    await dlg.getByRole('button', { name: 'Assignment' }).click();
    await expect(field(dlg, 'Assigned to')).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Assignment' }).click();
    await expect(field(dlg, 'Assigned to')).toBeVisible();
    // Buscar "chat type" y Enter: abre el campo con el foco en su editor.
    await dlg.getByRole('searchbox', { name: 'Search filters…' }).fill('chat type');
    await page.keyboard.press('Enter');
    await expect(dlg.getByRole('heading', { name: 'Chat type' })).toBeVisible();
    await dlg.getByLabel('1:1 chats').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    // Todos los chats del test son grupos: nada coincide.
    await expect(page.getByText('No chat or message matches that search.')).toBeVisible();
    await expect(chips(page).locator('[data-chip="kind"]')).toContainText('Chat type: 1:1 chats');
    // El foco no sale del panel con Tab.
    await filterButton(page).click();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await chips(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expectRows(page, w, ['a', 'b', 'c', 'd', 'e']);

    // Sin búsqueda, unos filtros que no dan nada lo dicen.
    await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill('');
    await filterButton(page).click();
    await field(panel(page), 'Line').click();
    await panel(page).getByLabel(`Línea ${w.tag}`).check();
    await field(panel(page), 'Open ticket').click();
    await panel(page).getByRole('group', { name: 'Open ticket' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No chats match these filters.')).toBeVisible();
    await chips(page).getByRole('button', { name: 'Clear', exact: true }).click();
  } finally {
    await w.cleanup();
  }
  expect(errors).toEqual([]);
});

test('panel de filtros: guardar como lista, volver a abrirla y una lista con el formato anterior', async ({ page, request }) => {
  const errors = watchErrors(page);
  const w = await world(request);
  const listIds: string[] = [];
  try {
    await openInbox(page, w);
    await filterButton(page).click();
    await field(panel(page), 'Assigned to').click();
    await panel(page).getByLabel(w.ana.name).check();
    await panel(page).getByLabel(w.luis.name).check();
    await field(panel(page), 'Labels').click();
    await panel(page).getByLabel(w.label.name).check();
    // "Guardar como lista" desde el panel aplica lo elegido y abre el nombre de la lista.
    await panel(page).getByRole('button', { name: 'Save as list' }).click();
    await expect(panel(page)).toHaveCount(0);
    const save = page.getByRole('dialog', { name: 'Save as list' });
    const listName = `Mayoristas ${w.tag}`;
    await save.getByLabel('List name').fill(listName);
    await save.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\?list=/);
    const listId = new URL(page.url()).searchParams.get('list')!;
    listIds.push(listId);
    await expect(page.getByRole('heading', { level: 1, name: listName })).toBeVisible();
    await expectRows(page, w, ['a', 'b', 'e']);
    const stored = (await (await request.get('/api/groups/lists')).json()) as { lists: Array<{ id: string; filters: Record<string, unknown> }> };
    expect(stored.lists.find((l) => l.id === listId)?.filters).toEqual({ q: w.tag, assignees: [w.ana.id, w.luis.id], labels: [w.label.id] });

    // Salir a "Todos los chats" los saca; volver a la lista los trae de nuevo.
    await page.getByRole('link', { name: 'All chats' }).click();
    await expect(chips(page)).toHaveCount(0);
    await page.goto(`/en/app/lines/inbox?list=${listId}`, { waitUntil: 'networkidle' });
    await expect(chips(page).locator('[data-chip="assignee"]')).toContainText(`${w.ana.name}, ${w.luis.name}`);
    await expect(chips(page).locator('[data-chip="labels"]')).toContainText(w.label.name);
    await expect(page.getByRole('searchbox', { name: 'Search chats and messages' })).toHaveValue(w.tag);
    await expectRows(page, w, ['a', 'b', 'e']);
    // Cambiar un filtro ofrece guardar los cambios.
    await chips(page).getByRole('button', { name: 'Remove filter: Labels' }).click();
    await expectRows(page, w, ['a', 'b', 'c', 'e']);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

    // Una lista guardada antes del panel (una pestaña, un tipo y una etiqueta sueltos) sigue cargando.
    const oldId = `fp-old-${w.tag}`;
    listIds.push(oldId);
    const demo = String((await sql("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'"))[0].id);
    const now = new Date().toISOString();
    await sql('INSERT INTO groups_saved_lists (id, user_id, owner_id, shared, name, filters, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)', [
      oldId,
      demo,
      demo,
      `Antigua ${w.tag}`,
      JSON.stringify({ filter: 'unanswered', kind: 'group', labelIds: [w.label.id], assignee: w.ana.id, q: w.tag }),
      now,
      now,
    ]);
    await page.goto(`/en/app/lines/inbox?list=${oldId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: `Antigua ${w.tag}` })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Waiting', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Groups', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(chips(page).locator('[data-chip="assignee"]')).toContainText(`Assigned to: ${w.ana.name}`);
    await expect(chips(page).locator('[data-chip="labels"]')).toContainText(w.label.name);
    await expectRows(page, w, ['a', 'e']);
    // Sin tocarla, no hay nada que guardar.
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    // La API la devuelve con el formato de ahora y da los mismos chats.
    const viaList = (await (await request.get(`/api/groups/chats?list=${oldId}`)).json()) as { rows: Array<{ name: string }> };
    expect(viaList.rows.map((r) => r.name).sort()).toEqual([w.names.a, w.names.e].sort());
  } finally {
    for (const id of listIds) await request.delete(`/api/groups/lists/${id}`).catch(() => null);
    await w.cleanup();
  }
  expect(errors).toEqual([]);
});

test('panel de filtros en el teléfono: hoja a pantalla completa en dos pasos', async ({ browser, request, baseURL }) => {
  const w = await world(request);
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    const errors = watchErrors(mobile);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
      await mobile.evaluate(() => window.sessionStorage.clear());
      await mobile.reload({ waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.getByRole('searchbox', { name: 'Search chats and messages' }).fill(w.tag);
      await expect(row(mobile, w.names.a)).toBeVisible();
      await filterButton(mobile).click();
      const dlg = panel(mobile);
      await expect(dlg).toBeVisible();
      // Ocupa toda la pantalla.
      const box = (await dlg.boundingBox())!;
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.y)).toBe(0);
      expect(Math.round(box.width)).toBe(PHONE.width);
      // Paso 1: la lista de campos (el editor no se ve).
      await expect(field(dlg, 'Assigned to')).toBeVisible();
      await expect(dlg.getByRole('heading', { name: 'Assigned to' })).toBeHidden();
      await check(mobile, `lines filtros 390 ${theme} campos`);
      // Paso 2: el editor, con "volver".
      await field(dlg, 'Assigned to').click();
      await expect(dlg.getByRole('heading', { name: 'Assigned to' })).toBeVisible();
      await expect(dlg.getByRole('navigation', { name: 'Filter fields' })).toBeHidden();
      await dlg.getByLabel(w.ana.name).check();
      await check(mobile, `lines filtros 390 ${theme} editor`);
      await dlg.getByRole('button', { name: 'Filters', exact: true }).click();
      await expect(field(dlg, 'Assigned to')).toBeVisible();
      // El campo muestra cuánto tiene puesto.
      await expect(field(dlg, 'Assigned to')).toContainText('1 selected');
      await field(dlg, 'Last message').click();
      await dlg.getByRole('button', { name: 'Last 30 days' }).click();
      await check(mobile, `lines filtros 390 ${theme} fecha`);
      await dlg.getByRole('button', { name: 'Apply' }).click();
      await expect(dlg).toHaveCount(0);
      await expect(chips(mobile).locator('[data-chip="assignee"]')).toContainText(w.ana.name);
      await expect(row(mobile, w.names.a)).toBeVisible();
      await expect(row(mobile, w.names.b)).toHaveCount(0);
      await check(mobile, `lines filtros 390 ${theme} chips`);
      await chips(mobile).getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(chips(mobile)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await phone.close();
    await w.cleanup();
  }
});
