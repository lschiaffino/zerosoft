import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM, bloque C1: notas con formato (negrita, listas, link, @mención) en el timeline de la ficha y en la
 * vista previa, y el hilo de comentarios de cada actividad ("Add comment" de HubSpot): contar, abrir,
 * comentar con @mención, editar y borrar lo propio; un compañero ve el hilo pero no edita lo ajeno. El HTML
 * crudo de una nota no se ejecuta. A 1280 y a 390 (sin scroll lateral, toques de 40px). Textos inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function json<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function seedContact(request: APIRequestContext) {
  const tag = uid();
  const contact = await json<{ id: string }>(
    request.post('/api/crm/contacts', { data: { firstName: 'Rita', lastName: `Rich ${tag}`, email: `c1-${tag}@c1-e2e.io` } }),
  );
  return { tag, contact, path: `/en/app/crm/contacts/${contact.id}?tab=activity` };
}

const panel = (page: Page) => page.getByTestId('record-panel-activity');
const items = (page: Page) => panel(page).getByTestId('crm-timeline-item');

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sin scroll lateral').toBeLessThanOrEqual(0);
}

async function teammate(browser: Browser, baseURL: string, viewport = DESKTOP): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `c1-mate-${uid()}@c1-e2e.io`;
  const ctx = await browser.newContext({ baseURL, viewport });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ?, name = 'Mia Mate' WHERE email = ?", args: [String(team), email] });
    return { ctx, email };
  } finally {
    db.close();
  }
}

for (const [name, viewport] of [
  ['1280', DESKTOP],
  ['390', PHONE],
] as const) {
  test.describe(`notas con formato y comentarios a ${name}`, () => {
    test.use({ viewport });

    test('nota con negrita, lista y link; se edita con el mismo editor', async ({ page, request }) => {
      test.setTimeout(120_000);
      const s = await seedContact(request);
      await page.goto(s.path, { waitUntil: 'networkidle' });
      await panel(page).getByTestId('timeline-tab-note').click();
      await panel(page).getByTestId('timeline-create-note').click();
      const composer = panel(page).getByTestId('timeline-composer');
      const editor = composer.getByTestId('timeline-note-editor');
      await expect(editor).toBeFocused();

      // Barra de formato fija, con toques de 40px.
      const bar = composer.getByTestId('rte-fixed-toolbar');
      await expect(bar).toBeVisible();
      for (const b of await bar.getByRole('button').all()) {
        const box = (await b.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(40);
      }

      await editor.pressSequentially(`Kickoff ${s.tag} `);
      await bar.locator('[data-format="bold"]').click();
      await editor.pressSequentially('agreed');
      await bar.locator('[data-format="bold"]').click();
      await editor.press('Enter');
      await bar.locator('[data-format="slash.bullet"]').click();
      await editor.pressSequentially('first item');
      await editor.press('Enter');
      await editor.pressSequentially('second item');
      await composer.getByRole('button', { name: 'Save note' }).click();
      await expect(composer).toHaveCount(0);

      const card = items(page).filter({ hasText: `Kickoff ${s.tag}` });
      const body = card.getByTestId('timeline-item-body');
      await expect(body.locator('strong')).toHaveText('agreed');
      await expect(body.locator('ul > li')).toHaveCount(2);
      const rows = (await json<{ rows: Array<{ body: string; body_format: string }> }>(request.get(`/api/crm/activities?contactId=${s.contact.id}`))).rows;
      const saved = rows.find((r) => r.body.includes(`Kickoff ${s.tag}`))!;
      expect(saved.body_format).toBe('md');
      expect(saved.body).toContain('**agreed**');
      expect(saved.body).toMatch(/^- first item$/m);

      // Editar: mismo editor, ⌘/Ctrl+Enter guarda.
      await card.getByTestId('timeline-item-menu').click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const edit = card.getByTestId('timeline-note-edit');
      await expect(edit).toBeFocused();
      await edit.press('ControlOrMeta+End');
      await edit.press('Enter');
      await edit.press('Enter');
      await edit.pressSequentially('Follow up');
      await edit.press('ControlOrMeta+Enter');
      await expect(card.getByTestId('timeline-note-edit')).toHaveCount(0);
      await expect(body).toContainText('Follow up');
      await expect(body.locator('strong')).toHaveText('agreed');
      await noSideScroll(page);
    });

    test('el HTML crudo de una nota se muestra como texto y no corre', async ({ page, request }) => {
      const s = await seedContact(request);
      await json(
        request.post('/api/crm/activities', {
          data: { type: 'note', bodyFormat: 'md', body: `Safe ${s.tag} <img src=x onerror="window.__c1=1"> [bad](javascript:alert(1)) [ok](https://example.test)`, contactId: s.contact.id },
        }),
      );
      await page.goto(s.path, { waitUntil: 'networkidle' });
      const body = items(page).filter({ hasText: `Safe ${s.tag}` }).getByTestId('timeline-item-body');
      await expect(body).toBeVisible();
      await expect(body.locator('img')).toHaveCount(0);
      await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
      await expect(body.getByRole('link', { name: 'ok' })).toHaveAttribute('href', 'https://example.test');
      expect(await page.evaluate(() => (window as unknown as { __c1?: number }).__c1)).toBeUndefined();
      // Una nota de antes (texto plano) se sigue leyendo igual.
      await json(request.post('/api/crm/activities', { data: { type: 'note', body: `Plain ${s.tag} *not bold*`, contactId: s.contact.id } }));
      await page.reload({ waitUntil: 'networkidle' });
      const plain = items(page).filter({ hasText: `Plain ${s.tag}` }).getByTestId('timeline-item-body');
      await expect(plain).toHaveText(`Plain ${s.tag} *not bold*`);
    });

    test('comentarios: contar, comentar con @mención, editar y borrar lo propio; el compañero no edita lo ajeno', async ({ page, request, browser, baseURL }) => {
      test.setTimeout(150_000);
      const mate = await teammate(browser, baseURL!, viewport);
      try {
        const s = await seedContact(request);
        await json(request.post('/api/crm/activities', { data: { type: 'note', body: `Thread ${s.tag}`, contactId: s.contact.id } }));
        await json(request.post('/api/crm/activities', { data: { type: 'call', subject: `Call ${s.tag}`, contactId: s.contact.id } }));
        await page.goto(s.path, { waitUntil: 'networkidle' });
        const card = items(page).filter({ hasText: `Thread ${s.tag}` });
        const toggle = card.getByTestId('timeline-comments-toggle');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(40);
        // La llamada también tiene su hilo.
        await expect(items(page).filter({ hasText: `Call ${s.tag}` }).getByTestId('timeline-comments-toggle')).toBeVisible();

        await toggle.click();
        const input = card.getByTestId('timeline-comment-input');
        await expect(input).toBeVisible();
        await input.click();
        await input.pressSequentially(`Ping @${mate.email.slice(0, 12)}`);
        const menu = card.getByTestId('track-md-menu');
        await expect(menu).toBeVisible();
        await menu.getByRole('option').filter({ hasText: mate.email }).click();
        await input.pressSequentially('please check');
        await card.getByTestId('timeline-comment-save').click();
        const comment = card.getByTestId('timeline-comment');
        await expect(comment).toHaveCount(1);
        await expect(comment.getByTestId('timeline-comment-body')).toContainText('@Mia Mate');
        await expect(toggle).toContainText('1 comment');

        // Editar lo propio; el menú cierra con Esc.
        await comment.getByTestId('timeline-comment-menu').click();
        await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveCount(0);
        await comment.getByTestId('timeline-comment-menu').click();
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        const edit = comment.getByTestId('timeline-comment-edit');
        await edit.press('ControlOrMeta+End');
        await edit.pressSequentially(' today');
        await edit.press('ControlOrMeta+Enter');
        await expect(comment.getByTestId('timeline-comment-body')).toContainText('today');
        await expect(comment).toContainText('(edited)');
        await noSideScroll(page);

        // El compañero ve el hilo y la mención, pero no puede editar ni borrar el comentario ajeno.
        const matePage = await mate.ctx.newPage();
        await matePage.goto(s.path, { waitUntil: 'networkidle' });
        const mateCard = items(matePage).filter({ hasText: `Thread ${s.tag}` });
        await expect(mateCard.getByTestId('timeline-comments-toggle')).toContainText('1 comment');
        await mateCard.getByTestId('timeline-comments-toggle').click();
        await expect(mateCard.getByTestId('timeline-comment')).toHaveCount(1);
        await expect(mateCard.getByTestId('timeline-comment-menu')).toHaveCount(0);
        const notes = await json<{ rows: Array<{ title: string }> }>(mate.ctx.request.get('/api/notifications'));
        expect(notes.rows.some((n) => /mentioned you in a comment/.test(n.title))).toBe(true);
        await matePage.close();

        // Borrar lo propio, con confirmación.
        await comment.getByTestId('timeline-comment-menu').click();
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
        await card.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
        await expect(card.getByTestId('timeline-comment')).toHaveCount(0);
        await expect(toggle).toContainText('Comment');
      } finally {
        await mate.ctx.close();
      }
    });
  });
}

test('vista previa: la nota rápida también va con formato', async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  const s = await seedContact(request);
  await page.goto(`/en/app/crm/contacts?q=${s.tag}`, { waitUntil: 'networkidle' });
  await page.getByTestId('record-name').first().click();
  const preview = page.getByTestId('record-preview');
  await expect(preview.getByTestId('preview-quick-note')).toBeVisible();
  await preview.getByTestId('preview-quick-note').click();
  const editor = preview.getByTestId('preview-composer-body');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Quick ');
  await preview.getByTestId('rte-fixed-toolbar').locator('[data-format="italic"]').click();
  await editor.pressSequentially('styled');
  await preview.getByTestId('preview-composer-save').click();
  await expect(preview.getByTestId('preview-recent')).toContainText('Quick styled');
  const rows = (await json<{ rows: Array<{ body: string; body_format: string }> }>(request.get(`/api/crm/activities?contactId=${s.contact.id}`))).rows;
  expect(rows[0].body_format).toBe('md');
  expect(rows[0].body).toMatch(/Quick [_*]styled[_*]/);
});
