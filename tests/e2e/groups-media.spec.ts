import http from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Groups, media por el QR administrado contra un Evolution API simulado en
 * PORT + 31 (playwright.config.ts apunta GROUPS_BRIDGE_URL ahí): subir y
 * mandar una imagen y un documento (con el cuerpo que espera Evolution
 * 2.3.7), recibir una imagen, una nota de voz y un documento por el webhook
 * (se bajan con getBase64FromMediaMessage y quedan en nuestro storage) y
 * verlos en el chat.
 */

const PORT = Number(process.env.E2E_PORT) || 3210;
const uid = () => Math.random().toString(36).slice(2, 8);
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const OGG = Buffer.from('OggS\0voice-note-bytes');

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

interface Hit {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** Evolution API v2 simulado: conectado de una, manda media y devuelve los archivos recibidos en base64. */
function startEvolution(inbound: Record<string, { base64: string; mimetype: string; fileName?: string }>) {
  const hits: Hit[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://x');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      hits.push({ method: req.method ?? 'GET', path: url.pathname, body });
      const json = (code: number, out: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      };
      const p = url.pathname;
      if (p === '/instance/create') return json(201, { instance: { instanceName: body?.instanceName }, hash: 'x' });
      if (p.startsWith('/webhook/set/')) return json(201, {});
      if (p.startsWith('/instance/connectionState/')) return json(200, { instance: { state: 'open' } });
      if (p.startsWith('/instance/fetchInstances')) return json(200, [{ ownerJid: '5491100007777@s.whatsapp.net' }]);
      if (p.startsWith('/group/fetchAllGroups/')) return json(200, []);
      if (p.startsWith('/message/sendText/') || p.startsWith('/message/sendMedia/') || p.startsWith('/message/sendWhatsAppAudio/'))
        return json(201, { key: { id: `OUT-${++n}`, fromMe: true } });
      if (p.startsWith('/chat/getBase64FromMediaMessage/')) {
        const id = String(((body?.message as { key?: { id?: string } }) ?? {}).key?.id ?? '');
        const file = inbound[id];
        return file ? json(201, { mediaType: 'x', ...file }) : json(400, { error: 'Message not found' });
      }
      if (p.startsWith('/instance/logout/') || p.startsWith('/instance/delete/')) return json(200, { status: 'SUCCESS' });
      return json(404, { error: 'not found' });
    });
  });
  return { server, hits };
}

async function upload(request: APIRequestContext, name: string, mimeType: string, buffer: Buffer) {
  const res = await request.post('/api/groups/upload', { multipart: { file: { name, mimeType, buffer } } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { url: string; mimetype: string; filename: string; size: number; width?: number; height?: number };
}

test('media por Evolution: subir y mandar imagen y documento, recibir imagen, nota de voz y documento', async ({ browser, baseURL }) => {
  const { server, hits } = startEvolution({
    'IN-IMG': { base64: PNG.toString('base64'), mimetype: 'image/png' },
    'IN-PTT': { base64: OGG.toString('base64'), mimetype: 'audio/ogg; codecs=opus' },
    'IN-DOC': { base64: PDF.toString('base64'), mimetype: 'application/pdf', fileName: 'Factura 0042.pdf' },
  });
  await new Promise<void>((resolve) => server.listen(PORT + 31, '127.0.0.1', () => resolve()));
  const email = `groups-media-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  await ctx.request.get('/api/groups/numbers');
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
  const page = await ctx.newPage();
  try {
    // Número por QR administrado, conectado.
    const created = await ctx.request.post('/api/groups/numbers', { data: { provider: 'managed', name: `Media ${uid()}` } });
    expect(created.status()).toBe(201);
    const number = (await created.json()) as { id: string };
    const state = await ctx.request.post(`/api/groups/numbers/${number.id}/connect`, { data: {} });
    expect(((await state.json()) as { status: string }).status).toBe('connected');
    const createHit = hits.find((h) => h.path === '/instance/create')!;
    const instance = String(createHit.body?.instanceName);
    const hookPath = new URL(String((createHit.body?.webhook as { url: string }).url)).pathname;
    const remoteJid = '5491100003333@s.whatsapp.net';
    const hook = (data: unknown) => ctx.request.post(hookPath, { data: { event: 'messages.upsert', instance, data } });

    // Un mensaje de texto abre el chat.
    expect((await hook({ key: { remoteJid, fromMe: false, id: `T-${uid()}` }, pushName: 'Marta Media', message: { conversation: 'Hola, te paso los archivos' } })).ok()).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        const rows = ((await (await ctx.request.get('/api/groups/chats?limit=100')).json()) as { rows: Array<{ id: string; name: string }> }).rows;
        chatId = rows.find((r) => r.name === 'Marta Media')?.id ?? '';
        return chatId;
      })
      .not.toBe('');

    // Subida: varios archivos a la vez; un tipo no permitido vuelve con su código.
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'logo.png');
    form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'brief.pdf');
    const multi = await ctx.request.post('/api/groups/upload', { multipart: form });
    expect(multi.status()).toBe(201);
    const multiBody = (await multi.json()) as { files: Array<{ filename: string; size: number }>; errors: unknown[] };
    expect(multiBody.files.map((f) => f.filename)).toEqual(['logo.png', 'brief.pdf']);
    expect(multiBody.errors).toEqual([]);
    const svg = await ctx.request.post('/api/groups/upload', { multipart: { file: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') } } });
    expect(svg.status()).toBe(415);
    expect(((await svg.json()) as { error: string }).error).toBe('file_type_not_allowed');

    // Mandar una imagen con texto.
    const img = await upload(ctx.request, 'foto.png', 'image/png', PNG);
    expect(img).toMatchObject({ mimetype: 'image/png', filename: 'foto.png', size: PNG.length, width: 1, height: 1 });
    const sentImg = await ctx.request.post(`/api/groups/chats/${chatId}/messages`, { data: { body: 'la foto', media: img } });
    expect(sentImg.status()).toBe(201);
    expect(await sentImg.json()).toMatchObject({ status: 'sent', body: 'la foto', media: { kind: 'image', url: expect.stringContaining(img.url), name: 'foto.png', size: PNG.length, width: 1 } });
    const imgHit = hits.find((h) => h.path === `/message/sendMedia/${instance}` && h.body?.mediatype === 'image')!;
    // Subida local (sin Blob): va en base64; Evolution la convierte a JPEG y saca el mimetype del nombre.
    expect(imgHit.body).toMatchObject({ number: remoteJid, mediatype: 'image', mimetype: 'image/jpeg', media: PNG.toString('base64'), fileName: 'foto.jpg', caption: 'la foto' });

    // Mandar un documento: nombre original y texto.
    const doc = await upload(ctx.request, 'Propuesta Q4.pdf', 'application/pdf', PDF);
    const sentDoc = await ctx.request.post(`/api/groups/chats/${chatId}/messages`, { data: { body: 'la propuesta', media: doc } });
    expect(await sentDoc.json()).toMatchObject({ status: 'sent', media: { kind: 'document', name: 'Propuesta Q4.pdf' } });
    const docHit = hits.find((h) => h.path === `/message/sendMedia/${instance}` && h.body?.mediatype === 'document')!;
    expect(docHit.body).toMatchObject({ mimetype: 'application/pdf', media: PDF.toString('base64'), fileName: 'Propuesta Q4.pdf', caption: 'la propuesta' });

    // Recibir una imagen, una nota de voz y un documento (como los manda Evolution).
    const res = await hook([
      { key: { remoteJid, fromMe: false, id: 'IN-IMG' }, pushName: 'Marta Media', message: { imageMessage: { mimetype: 'image/png', caption: 'el comprobante', fileLength: PNG.length, width: 1, height: 1 } } },
      { key: { remoteJid, fromMe: false, id: 'IN-PTT' }, pushName: 'Marta Media', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 6, fileLength: OGG.length } } },
      { key: { remoteJid, fromMe: false, id: 'IN-DOC' }, pushName: 'Marta Media', message: { documentMessage: { mimetype: 'application/pdf', fileName: 'Factura 0042.pdf', pageCount: 1, fileLength: PDF.length } } },
    ]);
    expect(res.ok()).toBe(true);
    type Msg = { body: string; direction: string; media: { url: string; kind: string; name: string; ptt?: boolean; duration?: number; pages?: number; pending?: boolean } | null };
    let inbound: Msg[] = [];
    await expect
      .poll(
        async () => {
          const all = ((await (await ctx.request.get(`/api/groups/chats/${chatId}/messages`)).json()) as { messages: Msg[] }).messages;
          inbound = all.filter((m) => m.direction === 'in' && m.media);
          return inbound.filter((m) => m.media!.url.startsWith('/uploads/chat/')).length;
        },
        { timeout: 20_000 },
      )
      .toBe(3);
    expect(inbound.map((m) => m.media!.kind)).toEqual(['image', 'voice', 'document']);
    expect(inbound[1].media).toMatchObject({ ptt: true, duration: 6 });
    expect(inbound[2].media).toMatchObject({ name: 'Factura 0042.pdf', pages: 1 });
    // El archivo guardado es el que mandó WhatsApp.
    const voice = await ctx.request.get(inbound[1].media!.url);
    expect(voice.ok()).toBe(true);
    expect(Buffer.from(await voice.body())).toEqual(OGG);

    // En el chat: las imágenes (mandada y recibida) y el documento recibido.
    await page.goto(`/en/app/groups/inbox/${chatId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 2, name: 'Marta Media' })).toBeVisible();
    await expect(page.locator('.gr-messages img')).toHaveCount(2);
    await expect(page.locator('.gr-messages').getByText('Factura 0042.pdf')).toBeVisible();
    await expect(page.locator('.gr-messages').getByText('Propuesta Q4.pdf')).toBeVisible();
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
