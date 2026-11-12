import http from 'http';
import { e2eDb } from './helpers/db';
import { expect, test } from '@playwright/test';

/**
 * Lines: reenviar una nota de voz desde el menú del mensaje, con un número
 * por QR administrado contra un Evolution API simulado en PORT + 31 (como
 * groups-media.spec.ts). Evolution no tiene reenvío nativo: sale una copia,
 * como nota de voz (sendWhatsAppAudio con el archivo que llegó), y acá queda
 * marcada "Forwarded". Con LINES_SHOTS=<carpeta> guarda capturas del menú y
 * del modal.
 */

const PORT = Number(process.env.E2E_PORT) || 3210;
const uid = () => Math.random().toString(36).slice(2, 8);
const OGG = Buffer.from('OggS\0voice-note-to-forward');

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

interface Hit {
  path: string;
  body: Record<string, unknown> | null;
}

function startEvolution() {
  const hits: Hit[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const p = new URL(req.url ?? '/', 'http://x').pathname;
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      hits.push({ path: p, body });
      const json = (code: number, out: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      };
      if (p === '/instance/create') return json(201, { instance: { instanceName: body?.instanceName }, hash: 'x' });
      if (p.startsWith('/webhook/set/')) return json(201, {});
      if (p.startsWith('/instance/connectionState/')) return json(200, { instance: { state: 'open' } });
      if (p.startsWith('/instance/fetchInstances')) return json(200, [{ ownerJid: '5491100007777@s.whatsapp.net' }]);
      if (p.startsWith('/group/fetchAllGroups/')) return json(200, []);
      if (p.startsWith('/message/send')) return json(201, { key: { id: `OUT-${++n}`, fromMe: true } });
      if (p.startsWith('/chat/getBase64FromMediaMessage/')) return json(201, { mediaType: 'audioMessage', base64: OGG.toString('base64'), mimetype: 'audio/ogg; codecs=opus' });
      if (p.startsWith('/instance/logout/') || p.startsWith('/instance/delete/')) return json(200, { status: 'SUCCESS' });
      return json(200, {});
    });
  });
  return { server, hits };
}

test('Lines: reenviar una nota de voz por Evolution sale como nota de voz y queda "Forwarded"', async ({ browser, baseURL }) => {
  const { server, hits } = startEvolution();
  await new Promise<void>((resolve) => server.listen(PORT + 31, '127.0.0.1', () => resolve()));
  const email = `lines-fwd-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  await ctx.request.get('/api/groups/numbers');
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    const created = await ctx.request.post('/api/groups/numbers', { data: { provider: 'managed', name: `Fwd ${uid()}` } });
    expect(created.status()).toBe(201);
    const number = (await created.json()) as { id: string };
    await ctx.request.post(`/api/groups/numbers/${number.id}/connect`, { data: {} });
    const createHit = hits.find((h) => h.path === '/instance/create')!;
    const instance = String(createHit.body?.instanceName);
    const hookPath = new URL(String((createHit.body?.webhook as { url: string }).url)).pathname;
    const marta = '5491100004441@s.whatsapp.net';
    const nico = '5491100004442@s.whatsapp.net';
    const hook = (data: unknown) => ctx.request.post(hookPath, { data: { event: 'messages.upsert', instance, data } });
    expect((await hook({ key: { remoteJid: nico, fromMe: false, id: `T-${uid()}` }, pushName: 'Nico Reenvío', message: { conversation: 'Pasame el audio de Marta' } })).ok()).toBe(true);
    expect(
      (
        await hook([
          { key: { remoteJid: marta, fromMe: false, id: `T-${uid()}` }, pushName: 'Marta Reenvío', message: { conversation: 'Te mando un audio' } },
          { key: { remoteJid: marta, fromMe: false, id: `PTT-${uid()}` }, pushName: 'Marta Reenvío', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 6, fileLength: OGG.length } } },
        ])
      ).ok(),
    ).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        const rows = ((await (await ctx.request.get('/api/groups/chats?limit=100')).json()) as { rows: Array<{ id: string; name: string }> }).rows;
        chatId = rows.find((r) => r.name === 'Marta Reenvío')?.id ?? '';
        return chatId && rows.some((r) => r.name === 'Nico Reenvío');
      })
      .toBe(true);

    await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
    const voice = page.locator('.gr-msg', { has: page.locator('.wa-voice') }).last();
    await expect(voice).toBeVisible();
    await voice.hover();
    await voice.locator('.wa-chevron').click();
    await expect(page.getByRole('menuitem', { name: 'Forward' })).toBeVisible();
    if (process.env.LINES_SHOTS) await page.screenshot({ path: `${process.env.LINES_SHOTS}/lines-forward-menu.png` });
    await page.getByRole('menuitem', { name: 'Forward' }).click();
    const modal = page.getByRole('dialog', { name: 'Forward message' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('.gr-quote')).toContainText(/Voice message/i);
    await modal.getByRole('searchbox').fill('Nico');
    await modal.getByText('Nico Reenvío').click();
    if (process.env.LINES_SHOTS) await page.screenshot({ path: `${process.env.LINES_SHOTS}/lines-forward-modal.png` });
    await modal.getByRole('button', { name: 'Forward to 1 chat' }).click();
    await expect(page.getByText('Forwarded to 1 chat')).toBeVisible();

    // Salió como nota de voz, con el archivo que llegó.
    const audio = hits.find((h) => h.path === `/message/sendWhatsAppAudio/${instance}`);
    expect(audio?.body).toMatchObject({ number: nico, audio: OGG.toString('base64'), encoding: true });

    // En el chat de Nico: la nota de voz, marcada "Forwarded", con su duración.
    const rows = ((await (await ctx.request.get('/api/groups/chats?limit=100')).json()) as { rows: Array<{ id: string; name: string }> }).rows;
    const nicoId = rows.find((r) => r.name === 'Nico Reenvío')!.id;
    const msgs = ((await (await ctx.request.get(`/api/groups/chats/${nicoId}/messages`)).json()) as { messages: Array<{ direction: string; forwarded?: boolean; media: { kind: string; duration?: number } | null }> })
      .messages;
    expect(msgs.find((m) => m.direction === 'out')).toMatchObject({ forwarded: true, media: { kind: 'voice', duration: 6 } });
    await page.goto(`/en/app/lines/inbox/${nicoId}`, { waitUntil: 'networkidle' });
    const copy = page.locator('.gr-msg', { has: page.locator('.wa-voice') }).last();
    await expect(copy.locator('.gr-forwarded')).toHaveText(/Forwarded/);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
