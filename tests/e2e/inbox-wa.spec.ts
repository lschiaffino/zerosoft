import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox con la cara de WhatsApp Web, con el WhatsApp falso (GROUPS_FAKE=1):
 * nombres reales (el asunto del grupo, nunca el id), fotos, la fila de la
 * lista (quién mandó, tipo de media, tildes), claro y oscuro, 1280 y 390.
 * Con INBOX_SHOTS=<carpeta> guarda capturas para la pasada visual.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = (end: string) => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${end}`;

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

async function shot(page: Page, name: string) {
  const dir = process.env.INBOX_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

type Ev = Record<string, unknown>;

async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: Ev[]) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
  expect(res.ok()).toBe(true);
}

function message(chatId: string, over: Ev = {}): Ev {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '15550001002' : chatId.replace(/@.*/, ''),
    senderName: group ? 'Beto Prueba' : 'Ana Prueba',
    providerMessageId: `in-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('lista como WhatsApp: asunto real del grupo, foto, quién mandó, tipo de media y tildes', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const dm = `${phone('2')}@s.whatsapp.net`;
  const tag = uid();
  // Un grupo que llega sin asunto (como los del historial): nunca se muestra el id.
  const groupId = `5491149${Math.floor(100000 + Math.random() * 899999)}-14100${Math.floor(10000 + Math.random() * 89999)}@g.us`;
  await events(request, acc, [
    message(dm, { senderName: `Ana ${tag}`, body: 'Te paso la dirección' }),
    message(dm, { fromMe: true, providerMessageId: `out-${tag}`, body: 'Gracias!', status: 'sent', timestamp: new Date(Date.now() + 1000).toISOString() }),
    message(groupId, { body: '', media: { url: '', type: 'audio/ogg', name: '', info: { kind: 'voice', ptt: true, duration: 9 } } }),
  ]);
  await events(request, acc, [{ type: 'status', providerMessageId: `out-${tag}`, status: 'read' }]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const dmRow = page.locator('.ib-item', { hasText: `Ana ${tag}` });
  await expect(dmRow).toBeVisible();
  await expect(dmRow.locator('.wa-ticks.is-read')).toBeVisible();
  await expect(dmRow.locator('.wa-row-text')).toHaveText('Gracias!');
  // La foto (número par en el WhatsApp falso) llega por /api/inbox/avatar con la sesión. Abrir el chat pide sus datos.
  await dmRow.locator('.ib-row-btn').click();
  await expect(page.locator('.ib-wa-thread .wa-head img.wa-avatar')).toBeVisible({ timeout: 20_000 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(dmRow.locator('img.wa-avatar')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => dmRow.locator('img.wa-avatar').evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);

  const groupDigits = groupId.replace(/@.*/, '');
  await expect(page.locator('.ib-list')).not.toContainText(groupDigits);
  const groupRow = page.locator('.ib-item', { hasText: `Grupo ${groupDigits.replace(/\D/g, '').slice(-4)}` });
  await expect(groupRow).toBeVisible({ timeout: 45_000 });
  await expect(groupRow.locator('.wa-row-sender')).toHaveText('Beto Prueba:');
  await expect(groupRow.locator('.wa-row-text')).toHaveText('Voice message');
  await expect(groupRow.locator('.wa-unread')).toHaveText('1');
  await shot(page, 'list-1280-light');
  expect(errors, errors.join('\n')).toEqual([]);
});

/** Un grupo con de todo: varios remitentes, respuesta, reacciones, foto, audio, documento, ubicación, contacto, encuesta, reenviado, editado y borrado. */
async function seedGroup(request: APIRequestContext, acc: { id: string; secret: string }, title: string): Promise<string> {
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const t0 = Date.now() - 3 * 86_400_000;
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const tag = uid();
  const ref = (id: string) => ({ providerMessageId: id, chatId: gid, fromMe: false });
  await events(request, acc, [
    message(gid, { chatName: title, providerMessageId: `g1-${tag}`, senderPhone: '15550001002', senderName: 'Beto Prueba', body: '¿Quién viene el sábado? *Traigan* _algo_ para tomar', timestamp: at(0) }),
    message(gid, { providerMessageId: `g2-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: 'Yo voy 🙋‍♀️', timestamp: at(1) }),
    message(gid, { providerMessageId: `g3-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: 'Llevo hielo', timestamp: at(2) }),
    message(gid, { providerMessageId: `img-${tag}`, senderPhone: '15550001002', senderName: 'Beto Prueba', body: 'Así quedó la terraza', media: { url: '', type: 'image/png', name: '', fetchRef: ref(`img-${tag}`), info: { kind: 'image', width: 480, height: 320 } }, timestamp: at(3) }),
    message(gid, { providerMessageId: `aud-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', body: '', media: { url: '', type: 'audio/ogg', name: '', fetchRef: ref(`aud-${tag}`), info: { kind: 'voice', ptt: true, duration: 2 } }, timestamp: at(4) }),
    message(gid, { providerMessageId: `doc-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', body: '', media: { url: '', type: 'application/pdf', name: 'Lista de compras.pdf', fetchRef: ref(`doc-${tag}`), info: { kind: 'document', pages: 2, size: 48_000 } }, timestamp: at(5) }),
    message(gid, { providerMessageId: `g4-${tag}`, fromMe: true, senderPhone: '', senderName: '', body: 'Yo llevo la carne', status: 'read', replyToProviderId: `g1-${tag}`, timestamp: at(6) }),
    message(gid, { providerMessageId: `g5-${tag}`, senderPhone: '15550001002', senderName: 'Beto Prueba', body: '', location: { lat: -34.6037, lng: -58.3816, name: 'Plaza de prueba', address: 'Av. Inventada 123' }, timestamp: at(7) }),
    message(gid, { providerMessageId: `g6-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: '', contacts: [{ name: 'Eva Prueba', phones: ['+1 555 000 1009'] }], timestamp: at(8) }),
    message(gid, { providerMessageId: `g7-${tag}`, senderPhone: '15550001002', senderName: 'Beto Prueba', body: '', poll: { question: '¿A qué hora?', options: ['12:00', '13:00', '14:00'], multi: false }, timestamp: at(9) }),
    message(gid, { providerMessageId: `g8-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', body: 'Les paso esto que me llegó', forwarded: true, timestamp: at(10) }),
    message(gid, { providerMessageId: `g8b-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', body: 'La receta: https://example.test/receta', timestamp: at(10.5) }),
    message(gid, { providerMessageId: `g9-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: 'Mensaje que después se borra', timestamp: at(11) }),
    message(gid, { providerMessageId: `g10-${tag}`, fromMe: true, senderPhone: '', senderName: '', body: '👍', status: 'delivered', timestamp: at(12) }),
  ]);
  await events(request, acc, [
    { type: 'reaction', chatId: gid, targetProviderMessageId: `g1-${tag}`, emoji: '❤️', senderPhone: '15550001003', senderName: 'Carla Prueba', fromMe: false },
    { type: 'reaction', chatId: gid, targetProviderMessageId: `g1-${tag}`, emoji: '❤️', senderPhone: '15550001004', senderName: 'Dani Prueba', fromMe: false },
    { type: 'reaction', chatId: gid, targetProviderMessageId: `g4-${tag}`, emoji: '😂', senderPhone: '15550001002', senderName: 'Beto Prueba', fromMe: false },
    { type: 'edit', chatId: gid, providerMessageId: `g3-${tag}`, body: 'Llevo hielo y vasos' },
    { type: 'revoke', chatId: gid, providerMessageId: `g9-${tag}` },
    { type: 'presence', chatId: gid, who: '15550001002', state: 'composing' },
  ]);
  return gid;
}

test('conversación como WhatsApp: burbujas, nombres de color, cita, reacciones, media, editado y borrado', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const title = `Asado ${uid()}`;
  await seedGroup(request, acc, title);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible();
  // Remitentes con nombre de color; la tanda de Carla lleva un solo nombre (cola en el primero).
  await expect(thread.locator('.gr-msg', { hasText: 'Yo voy' }).locator('.gr-msg-author')).toHaveText(/Carla Prueba/);
  await expect(thread.locator('.gr-msg', { hasText: 'Llevo hielo y vasos' }).locator('.gr-msg-author')).toHaveCount(0);
  await expect(thread.locator('.gr-msg', { hasText: 'Llevo hielo y vasos' })).toHaveClass(/is-cont/);
  await expect(thread.locator('.gr-msg', { hasText: 'Llevo hielo y vasos' }).locator('.wa-edited')).toHaveText('Edited');
  // Formato de WhatsApp (*negrita*, _cursiva_).
  await expect(thread.locator('.gr-msg', { hasText: '¿Quién viene' }).locator('strong, b').first()).toHaveText('Traigan');
  // Respuesta con su cita y reacciones agrupadas.
  const mine = thread.locator('.gr-msg-out', { hasText: 'Yo llevo la carne' });
  await expect(mine.locator('.gr-quote')).toContainText('¿Quién viene el sábado?');
  await expect(mine.locator('.wa-ticks.is-read')).toBeVisible();
  await expect(thread.locator('.gr-msg-in', { hasText: '¿Quién viene' }).locator('.ib-wa-reactions')).toContainText('❤️');
  // Media: foto (abre el visor), audio, documento, ubicación, contacto, encuesta, reenviado, borrado.
  await expect(thread.locator('.wa-image img:not(.wa-thumb)')).toBeVisible();
  await thread.locator('.wa-image').click();
  await expect(page.locator('.wa-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wa-viewer')).toBeHidden();
  await expect(thread.locator('.wa-voice')).toBeVisible();
  // Transcripción del audio (Voice falso en e2e) y vista previa del link (lector falso).
  await expect(thread.locator('.wa-transcript').first()).toBeVisible({ timeout: 20_000 });
  await expect(thread.locator('.wa-linkcard', { hasText: 'example.test page' })).toBeVisible();
  await expect(thread.locator('.wa-doc', { hasText: 'Lista de compras.pdf' })).toBeVisible();
  await expect(thread.locator('.wa-location', { hasText: 'Plaza de prueba' })).toBeVisible();
  await expect(thread.locator('.wa-contact', { hasText: 'Eva Prueba' })).toBeVisible();
  await expect(thread.locator('.ib-wa-poll', { hasText: '¿A qué hora?' })).toBeVisible();
  await expect(thread.locator('.gr-forwarded')).toHaveText(/Forwarded/);
  await expect(thread.locator('.wa-deleted', { hasText: 'This message was deleted' })).toBeVisible();
  await expect(thread.locator('.wa-day').first()).toBeVisible();
  // Escribiendo en un grupo: con el nombre.
  await expect(thread.locator('.wa-head-sub')).toHaveText('Beto Prueba is typing…');
  await shot(page, 'convo-1280-light');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('acciones de mensaje: responder, reaccionar, editar, destacar, borrar y reenviar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const dm = `${phone('6')}@s.whatsapp.net`;
  const other = `${phone('8')}@s.whatsapp.net`;
  const name = `Lola ${uid()}`;
  const otherName = `Mateo ${uid()}`;
  await events(request, acc, [message(dm, { senderName: name, body: '¿Me pasás el link?' }), message(other, { senderName: otherName, body: 'hola' })]);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  const incoming = thread.locator('.gr-msg-in', { hasText: '¿Me pasás el link?' });

  // Responder desde el menú (flecha): la cita queda arriba del campo y sale con el mensaje.
  await incoming.hover();
  await incoming.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  await expect(thread.locator('.wa-replying .gr-quote')).toContainText('¿Me pasás el link?');
  const field = page.getByRole('textbox', { name: 'Message' });
  await field.fill('Sí, ahí va: https://example.test/x');
  await field.press('Enter');
  const reply = thread.locator('.gr-msg-out', { hasText: 'ahí va' });
  await expect(reply.locator('.gr-quote')).toContainText('¿Me pasás el link?');
  await expect(thread.locator('.wa-replying')).toHaveCount(0);

  // Reaccionar con la barra rápida; otra vez el mismo emoji la saca.
  await incoming.hover();
  await incoming.getByRole('button', { name: 'React' }).click();
  await thread.locator('.gr-emoji-picker').getByRole('button', { name: '🙏' }).click();
  await expect(incoming.locator('.ib-wa-reactions')).toContainText('🙏');
  await incoming.locator('.ib-wa-reactions').click();
  await thread.locator('.gr-emoji-picker').getByRole('button', { name: '🙏' }).click();
  await expect(incoming.locator('.ib-wa-reactions')).toHaveCount(0);

  // Editar lo propio: el campo trae el texto, Enter guarda y queda "Edited".
  await reply.hover();
  await reply.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(field).toHaveValue('Sí, ahí va: https://example.test/x');
  await field.fill('Sí, ahí va el link: https://example.test/x');
  await field.press('Enter');
  await expect(thread.locator('.gr-msg-out', { hasText: 'ahí va el link' }).locator('.wa-edited')).toBeVisible();
  await expect(field).toHaveValue('');

  // Destacar.
  await incoming.hover();
  await incoming.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Star' }).click();
  await expect(incoming.locator('.wa-star')).toBeVisible();

  // Reenviar a otro chat.
  await incoming.hover();
  await incoming.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Forward' }).click();
  const fwd = page.getByRole('dialog', { name: 'Forward to' });
  await fwd.getByRole('textbox').fill(otherName.slice(0, 7));
  await fwd.getByText(otherName).click();
  await fwd.getByRole('button', { name: 'Send to 1 chat' }).click();
  await expect(page.locator('.ib-toast', { hasText: 'Forwarded to 1 chat' })).toBeVisible();

  // Info del mensaje y borrar para todos.
  const edited = thread.locator('.gr-msg-out', { hasText: 'ahí va el link' });
  await edited.hover();
  await edited.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Message info' }).click();
  await expect(page.getByRole('dialog', { name: 'Message info' })).toBeVisible();
  await page.keyboard.press('Escape');
  await edited.hover();
  await edited.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await expect(thread.locator('.wa-deleted', { hasText: 'You deleted this message' })).toBeVisible();

  // Borrar para mí: deja de verse.
  await incoming.hover();
  await incoming.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Delete for me' }).click();
  await expect(thread.locator('.gr-msg-in', { hasText: '¿Me pasás el link?' })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('info del grupo y del contacto: foto, integrantes, lo compartido, resumen con IA, silenciar y bloquear', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const title = `Vecinos ${uid()}`;
  await seedGroup(request, acc, title);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
  await page.locator('.ib-wa-thread .wa-head-who').click();
  const panel = page.getByRole('complementary', { name: 'Group info' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.ib-wa-hero-name')).toHaveText(title);
  // Lo compartido: la foto del grupo y el documento.
  await expect(panel.locator('.ib-wa-grid .ib-wa-thumb img')).toHaveCount(1);
  await panel.getByRole('tab', { name: 'Docs' }).click();
  await expect(panel.locator('.ib-wa-row', { hasText: 'Lista de compras.pdf' })).toBeVisible();
  // Resumen con IA (modelo falso en e2e).
  await panel.getByRole('button', { name: 'Summarize' }).click();
  await expect(panel.locator('.ib-wa-summary-text')).toContainText('mensajes');
  await shot(page, 'info-group-1440');
  // Silenciar desde el panel: la fila muestra el ícono.
  await panel.getByRole('button', { name: 'Mute notifications' }).click();
  await panel.getByRole('button', { name: 'For 8 hours' }).click();
  await expect(page.locator('.ib-item', { hasText: title }).getByRole('img', { name: 'Muted' })).toBeVisible();
  // Esc cierra el panel (la conversación queda).
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('.ib-wa-thread')).toBeVisible();

  // Contacto: info, bloquear con confirmación.
  const name = `Nico ${uid()}`;
  await events(request, acc, [message(`${phone('2')}@s.whatsapp.net`, { senderName: name, body: 'hola!' })]);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await page.locator('.ib-wa-thread .wa-head-who').click();
  const info = page.getByRole('complementary', { name: 'Contact info' });
  await expect(info.locator('.ib-wa-hero-sub')).toContainText('+54 9 11');
  await info.getByRole('button', { name: `Block ${name}` }).click();
  await info.getByRole('alertdialog').getByRole('button', { name: 'Block' }).click();
  await expect(page.locator('.ib-toast', { hasText: `${name} is blocked` })).toBeVisible();
  await expect(info.getByRole('button', { name: `Unblock ${name}` })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('teléfono: deslizar un mensaje responde y deslizar una fila la archiva', async ({ page, request }) => {
  const acc = await linkWhatsapp(request);
  const name = `Olga ${uid()}`;
  await events(request, acc, [message(`${phone('2')}@s.whatsapp.net`, { senderName: name, body: 'Deslizame para responder' })]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const swipe = async (selector: string, dx: number) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    const y = box.y + box.height / 2;
    const x = box.x + (dx > 0 ? 20 : box.width - 20);
    const fire = (type: string, cx: number) =>
      page.locator(selector).first().dispatchEvent(type, { pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, isPrimary: true, pointerId: 7 });
    await fire('pointerdown', x);
    for (let i = 1; i <= 6; i++) await fire('pointermove', x + (dx * i) / 6);
    await fire('pointerup', x + dx);
  };
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await swipe('.ib-wa-thread .gr-msg-in', 100);
  await expect(page.locator('.wa-replying .gr-quote')).toContainText('Deslizame para responder');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await swipe(`.ib-item:has-text("${name}")`, -120);
  await expect(page.locator('.ib-toast', { hasText: 'Marked done' })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: name })).toHaveCount(0);
});

test('estilo de chats: WhatsApp o zerosoft desde el menú y desde Ajustes, guardado por persona', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  await request.put('/api/chat-style', { data: { style: 'whatsapp' } });
  const title = `Estilo ${uid()}`;
  await seedGroup(request, acc, title);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const root = page.locator('.ib-app');
  await expect(root).toHaveAttribute('data-chat-style', 'whatsapp');
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
  // Desde el "…" de la conversación.
  await page.locator('.ib-wa-thread .gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Chat style: zerosoft' }).click();
  await expect(root).toHaveAttribute('data-chat-style', 'zerosoft');
  // Sin fondo de chat ni colas.
  expect(await page.locator('.wa-messages').evaluate((el) => getComputedStyle(el).getPropertyValue('--wa-doodle').trim())).toBe('transparent');
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      // Guardado en el servidor: sigue después de recargar.
      await expect(root).toHaveAttribute('data-chat-style', 'zerosoft');
      await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
      await expect(page.locator('.ib-wa-thread .gr-msg').first()).toBeVisible();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await shot(page, `zerosoft-${width}-${theme}`);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Desde Ajustes de Inbox, de vuelta a WhatsApp.
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /WhatsApp/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(root).toHaveAttribute('data-chat-style', 'whatsapp');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('claro y oscuro a 1280 y 390 sin errores ni scroll horizontal', async ({ page, context, baseURL, request }) => {
  const acc = await linkWhatsapp(request);
  await events(request, acc, [message(`${phone('4')}@s.whatsapp.net`, { senderName: `Carla ${uid()} con un nombre bastante largo para ver el corte`, body: 'Un mensaje largo para ver que la vista previa se corta con puntos suspensivos y no desborda' })]);
  const title = `Club ${uid()}`;
  await seedGroup(request, acc, title);
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(page.locator('.ib-item').first()).toBeVisible();
      const overflow = () => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
      expect(await overflow()).toBeLessThanOrEqual(1);
      await shot(page, `list-${width}-${theme}`);
      await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
      await expect(page.locator('.ib-wa-thread .gr-msg').first()).toBeVisible();
      await expect(page.locator('.wa-image img:not(.wa-thumb)')).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(1);
      await shot(page, `convo-${width}-${theme}`);
      expect(errors, errors.join('\n')).toEqual([]);
    }
  }
});
