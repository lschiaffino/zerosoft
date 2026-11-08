import fs from 'fs';
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { createClient } from '@libsql/client';

/**
 * Rec, compartir como Drive: lo nuevo nace restringido; quien grabó invita por
 * email con rol; un miembro del workspace entra con su cuenta; alguien de
 * afuera entra con el link mágico del mail; un desconocido no ve nada (ni el
 * título, ni archivos, ni comentarios, ni la tarjeta del link) y puede pedir
 * acceso; el link vencido frena al link pero no a las personas invitadas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function mailsTo(email: string): Array<{ subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE!;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === email);
}

async function magicLink(email: string, after = 0): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      const m = mailsTo(email).slice(after).pop();
      link = m ? /https?:\/\/\S+invite=[\w-]+/.exec(m.text)?.[0] : undefined;
      return !!link;
    })
    .toBe(true);
  return new URL(link!).pathname + new URL(link!).search;
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

const tiny = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);

/** Video listo, sin tocar la privacidad: nace con el default del workspace. */
async function upload(request: APIRequestContext, title: string): Promise<{ id: string; shareId: string; privacy: string }> {
  const { video } = await ok<{ video: { id: string; shareId: string; privacy: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }));
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: tiny, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } }));
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title } }));
  return video;
}

async function asPerson(browser: Browser, baseURL: string, who: string) {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: who, url: baseURL }]);
  return { ctx, page: await ctx.newPage(), request: ctx.request };
}

/** Lo que ve alguien sin acceso: nada del video por ningún camino. */
async function expectLockedOut(request: APIRequestContext, shareId: string, title: string) {
  const html = await (await request.get(`/en/v/${shareId}`)).text();
  expect(html).not.toContain(title);
  // Ni la miniatura ni el título en la vista previa del link (la imagen general del sitio sí puede estar).
  expect(html).not.toContain(`/api/rec/v/${shareId}/file`);
  expect(html).not.toContain('application/json+oembed');
  for (const kind of ['video', 'thumb', 'captions', 'gif']) expect((await request.get(`/api/rec/v/${shareId}/file?kind=${kind}`)).status()).toBe(403);
  expect((await request.get(`/api/rec/v/${shareId}/comments`)).status()).toBe(403);
  expect((await request.post(`/api/rec/v/${shareId}/comments`, { data: { kind: 'comment', body: 'hola', name: 'x' } })).status()).toBe(403);
  expect((await request.post(`/api/rec/v/${shareId}/track`, { data: { duration: 2 } })).status()).toBe(403);
  const embed = await (await request.get(`/en/v/${shareId}/embed`)).text();
  expect(embed).not.toContain(title);
  const oembed = await request.get(`/api/rec/oembed?url=${encodeURIComponent(`https://x.test/en/v/${shareId}`)}`);
  expect(oembed.status()).toBe(404);
}

test('restringido por defecto: dueño, miembro invitado, externo con link mágico y desconocido', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(150_000);
  const title = `Privado ${uid()}`;
  const v = await upload(request, title);
  expect(v.privacy).toBe('people');

  // Dueño: abre el modal, ve "Restringido" y suma personas.
  await page.goto(`/en/app/rec/${v.id}`);
  await expect(page.getByTestId('rec-detail')).toContainText('Restricted');
  await page.getByTestId('rec-share').click();
  const share = page.getByRole('dialog', { name: /Share/ });
  await expect(share.getByTestId('rec-share-access')).toHaveValue('people');
  await expect(share.getByTestId('rec-share-people-list')).toContainText('Nobody invited yet', { timeout: 30_000 });

  // Miembro del workspace (con su cuenta) y alguien de afuera (sin cuenta), con roles distintos.
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const memberEmail = `mate-${uid()}@darwin-e2e.io`;
  const outsider = `afuera-${uid()}@e2e.dev`;
  const member = await asPerson(browser, baseURL!, memberEmail);
  await member.page.goto('/en/app');
  const memberId = String((await sql('SELECT id FROM users WHERE email = ?', [memberEmail]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [memberId]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["rec"]')`, [demoTeam, memberId]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, memberId]);

  // Antes de invitarlo, el miembro tampoco lo ve (restringido no es "workspace").
  await member.page.goto(`/en/v/${v.shareId}`);
  await expect(member.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'forbidden');
  expect(await member.page.content()).not.toContain(title);

  await share.getByTestId('rec-share-add-input').fill(memberEmail);
  await share.getByTestId('rec-share-add-role').selectOption('commenter');
  await share.getByTestId('rec-share-add').click();
  await expect(share.getByTestId('rec-share-person').filter({ hasText: memberEmail })).toBeVisible();
  await share.getByTestId('rec-share-add-input').fill(outsider);
  await share.getByTestId('rec-share-add-role').selectOption('viewer');
  await share.getByTestId('rec-share-add-input').press('Enter');
  await expect(share.getByTestId('rec-share-person').filter({ hasText: outsider })).toBeVisible();
  await expect(share.getByTestId('rec-share-add-msg')).toContainText('Invitation sent');
  await expect(share.getByTestId('rec-share-person').filter({ hasText: outsider })).toContainText('Not watched yet');
  if (process.env.REC_SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `test-results/rec-share-1280-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.keyboard.press('Escape');
  await expect(share).toBeHidden();

  // Miembro invitado: entra con su cuenta, ve y comenta.
  await member.page.goto(`/en/v/${v.shareId}`);
  await expect(member.page.getByRole('heading', { name: title })).toBeVisible();
  expect((await member.request.get(`/api/rec/v/${v.shareId}/file`, { headers: { range: 'bytes=0-1' } })).ok()).toBe(true);
  await member.page.getByLabel('Add a comment').fill('Visto, gracias');
  await member.page.getByTestId('rec-comment-send').click();
  await expect(member.page.getByTestId('rec-comment').filter({ hasText: 'Visto, gracias' })).toBeVisible();
  // El aviso en la app del miembro.
  expect((await sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'rec_access' AND source_id = ?", [memberId, v.id]))[0].n).toBe(1);
  await member.ctx.close();

  // Externo: sin sesión, el link del mail pide un clic, lo usa y abre el video.
  const ext = await asPerson(browser, baseURL!, 'session');
  await expectLockedOut(ext.request, v.shareId, title);
  const mail = mailsTo(outsider).pop()!;
  expect(mail.subject).not.toContain(title);
  expect(mail.text).not.toContain(title);
  const link = await magicLink(outsider);
  await ext.page.goto(link);
  await expect(ext.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'invite');
  await ext.page.getByTestId('rec-invite-open').click();
  await expect(ext.page.getByRole('heading', { name: title })).toBeVisible();
  await expect(ext.page).not.toHaveURL(/invite=/);
  // Rol de lector: mira, no comenta (ni por la API).
  await expect(ext.page.getByTestId('rec-comments-viewonly')).toBeVisible();
  await expect(ext.page.getByLabel('Add a comment')).toHaveCount(0);
  expect((await ext.request.post(`/api/rec/v/${v.shareId}/comments`, { data: { kind: 'comment', body: 'no', name: 'x' } })).status()).toBe(403);
  await ok(ext.request.post(`/api/rec/v/${v.shareId}/track`, { data: { duration: 2, position: 1 } }));
  // El mismo link no sirve dos veces (otro navegador): pide uno nuevo.
  const again = await asPerson(browser, baseURL!, 'session');
  await again.page.goto(link);
  await again.page.getByTestId('rec-invite-open').click();
  await expect(again.page.getByTestId('rec-invite-used')).toBeVisible();
  const sentBefore = mailsTo(outsider).length;
  await again.page.locator('#rec-magic-email').fill(outsider);
  await again.page.getByTestId('rec-magic-submit').click();
  await expect(again.page.getByTestId('rec-magic-sent')).toBeVisible();
  await again.page.goto(await magicLink(outsider, sentBefore));
  await again.page.getByTestId('rec-invite-open').click();
  await expect(again.page.getByRole('heading', { name: title })).toBeVisible();
  await again.ctx.close();

  // Quién miró: el dueño lo ve en el modal y en la analítica.
  await page.reload();
  await page.getByTestId('rec-share').click();
  await expect(share.getByTestId('rec-share-person').filter({ hasText: outsider })).toContainText('Watched');
  const stats = await ok<{ viewers: Array<{ email: string }> }>(request.get(`/api/rec/videos/${v.id}/analytics`));
  expect(stats.viewers.map((x) => x.email)).toContain(outsider);

  // Quitar corta el acceso al toque, con la cookie ya puesta.
  await share.getByRole('button', { name: `Remove ${outsider}` }).click();
  await expect(share.getByTestId('rec-share-person').filter({ hasText: outsider })).toHaveCount(0);
  await ext.page.reload();
  await expect(ext.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'signin');
  await expectLockedOut(ext.request, v.shareId, title);
  await ext.ctx.close();
});

test('desconocido: no ve nada, pide acceso con su email y el dueño aprueba', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const title = `Pedido ${uid()}`;
  const v = await upload(request, title);
  const asker = `pide-${uid()}@e2e.dev`;
  const stranger = await asPerson(browser, baseURL!, 'session');
  await expectLockedOut(stranger.request, v.shareId, title);
  await stranger.page.goto(`/en/v/${v.shareId}`);
  await expect(stranger.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'signin');
  if (process.env.REC_SHOTS) {
    for (const [w, scheme] of [[1280, 'light'], [390, 'dark']] as const) {
      await stranger.page.setViewportSize({ width: w, height: 844 });
      await stranger.page.emulateMedia({ colorScheme: scheme });
      await stranger.page.screenshot({ path: `test-results/rec-gate-${w}-${scheme}.png`, fullPage: true });
    }
  }
  await stranger.page.locator('#rec-magic-email').fill(asker);
  await stranger.page.locator('#rec-magic-name').fill('Persona Que Pide');
  await stranger.page.getByTestId('rec-magic-submit').click();
  await expect(stranger.page.getByTestId('rec-magic-sent')).toBeVisible();
  // Nada le llegó todavía: no estaba invitado.
  expect(mailsTo(asker)).toHaveLength(0);
  // El access sin estar frente al portón no sirve (p. ej., en un video abierto).
  const open = await upload(request, `Abierto ${uid()}`);
  await ok(request.patch(`/api/rec/videos/${open.id}`, { data: { privacy: 'link' } }));
  expect((await stranger.request.post(`/api/rec/v/${open.shareId}/access`, { data: { email: asker } })).status()).toBe(400);

  const n = await sql("SELECT href FROM notifications WHERE type = 'rec_access' AND source_id = ?", [v.id]);
  expect(n).toHaveLength(1);
  await page.goto(`/en${String(n[0].href)}`);
  await expect(page.getByTestId('rec-share-requests')).toContainText(asker);
  await page.getByTestId('rec-request-approve').click();
  await expect(page.getByTestId('rec-share-person').filter({ hasText: asker })).toBeVisible();
  await stranger.page.goto(await magicLink(asker));
  await stranger.page.getByTestId('rec-invite-open').click();
  await expect(stranger.page.getByRole('heading', { name: title })).toBeVisible();
  await stranger.ctx.close();
});

test('link vencido: frena al link (sin decir el título si hay contraseña) pero no a las personas invitadas', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const title = `Vence ${uid()}`;
  const v = await upload(request, title);
  const guest = `vence-${uid()}@e2e.dev`;
  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-share').click();
  const share = page.getByRole('dialog', { name: /Share/ });
  await share.getByTestId('rec-share-add-input').fill(guest);
  await share.getByTestId('rec-share-add').click();
  await expect(share.getByTestId('rec-share-person').filter({ hasText: guest })).toBeVisible();
  // Abrir a cualquiera con el link, con vencimiento.
  await share.getByTestId('rec-share-access').selectOption('link');
  await expect(share.getByTestId('rec-share-access-help')).toContainText('Anyone who has the link');
  await share.getByTestId('rec-share-expires').fill('2030-01-01T10:00');
  await share.getByTestId('rec-share-save').click();
  await expect(share).toBeHidden();
  await sql("UPDATE rec_videos SET expires_at = '2000-01-01 00:00:00' WHERE id = ?", [v.id]);

  const anon = await asPerson(browser, baseURL!, 'session');
  await anon.page.goto(`/en/v/${v.shareId}`);
  await expect(anon.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'expired');
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(410);
  expect((await anon.request.get(`/api/rec/oembed?url=${encodeURIComponent(`https://x.test/en/v/${v.shareId}`)}`)).status()).toBe(404);
  // Con contraseña, ni el portón de vencido dice el título.
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { password: 'clave-segura' } }));
  expect(await (await anon.request.get(`/en/v/${v.shareId}`)).text()).not.toContain(title);
  await anon.ctx.close();

  // La persona invitada entra igual.
  const inv = await asPerson(browser, baseURL!, 'session');
  await inv.page.goto(await magicLink(guest));
  await inv.page.getByTestId('rec-invite-open').click();
  await expect(inv.page.getByRole('heading', { name: title })).toBeVisible();
  await inv.ctx.close();
});

test('modal de compartir en el teléfono (390 y 360 px, claro y oscuro): pantalla completa, sin scroll horizontal, toques de 40 px y teclado', async ({ page, request }) => {
  test.setTimeout(90_000);
  const v = await upload(request, `Angosto ${'x'.repeat(70)} ${uid()}`);
  await ok(request.post(`/api/rec/videos/${v.id}/people`, { data: { emails: [`un-email-bastante-largo-${uid()}@una-empresa-con-nombre-largo.dev`], role: 'viewer', notify: false } }));
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [360, 'light'], [360, 'dark']] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/en/app/rec/${v.id}`);
    await page.getByTestId('rec-share').click();
    const share = page.getByRole('dialog', { name: /Share/ });
    await expect(share.getByTestId('rec-share-person')).toHaveCount(1, { timeout: 30_000 });
    // Medir con la animación de entrada terminada (sube desde abajo).
    await page.waitForFunction(() => (document.querySelector('dialog.rec-share') as HTMLElement | null)?.getAnimations().length === 0);
    const m = await page.evaluate(() => {
      const d = document.querySelector('dialog.rec-share') as HTMLElement;
      const r = d.getBoundingClientRect();
      const foot = d.querySelector('.ui-modal-foot')!.getBoundingClientRect();
      const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const small = [...d.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio]), summary, label.ui-check')]
        .filter(visible)
        .filter((el) => el.getBoundingClientRect().height < 40)
        .map((el) => `${el.tagName}.${(el as HTMLElement).className}:${Math.round(el.getBoundingClientRect().height)}`);
      const tinyText = [...d.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')]
        .filter(visible)
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => (el as HTMLElement).id || el.tagName);
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        dialogOverflow: d.scrollWidth > d.clientWidth + 1,
        fullScreen: Math.round(r.left) === 0 && Math.round(r.width) === window.innerWidth && Math.round(r.height) === window.innerHeight,
        footInView: foot.bottom <= window.innerHeight + 1 && foot.top >= 0,
        small,
        tinyText,
      };
    });
    expect(m).toEqual({ pageOverflow: false, dialogOverflow: false, fullScreen: true, footInView: true, small: [], tinyText: [] });
    if (process.env.REC_SHOTS) await page.screenshot({ path: `test-results/rec-share-${width}-${scheme}.png` });
    // Teclado: el foco arranca adentro, Tab no se escapa del diálogo y Esc cierra.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog.rec-share'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(share).toBeHidden();
  }
});
