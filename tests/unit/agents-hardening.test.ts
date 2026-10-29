import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { conversationForChat, createAgent, getAgentRow, updateAgent } from '@/lib/agents';
import { createChatConversation, createChatMessage, createChatWidget, getOrCreateChatVisitor } from '@/lib/chat-data';
import { redactIdleConversations } from '@/lib/agents-privacy';
import type { AgentRow } from '@/lib/db';
import { processPendingSitemaps, syncSitemaps } from '@/lib/agents-knowledge';
import { makeUser } from './helpers';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pdfToText } from '@/lib/pdf-text';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
});
import { parseSitemap } from '@/lib/agents-knowledge';
import { redactDeep, secretVariants } from '@/lib/agents-secrets';
import { businessContacts, redactJsonText, redactPii } from '@/lib/agents-privacy';
import { isPrivateIp } from '@/lib/safe-fetch';

describe('endurecimiento', () => {
  it('PDF bomba: 300 referencias al mismo stream no se inflan 300 veces', () => {
    const buf = readFileSync(path.join(__dirname, 'fixtures/pdf-bomb-300.pdf'));
    const t0 = Date.now();
    let code = '';
    try {
      pdfToText(buf);
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
    }
    expect(['pdf_too_complex', 'pdf_no_text', '']).toContain(code);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('sitemap patológico de 5 MB se parsea en menos de 1 s', () => {
    const evil = '<urlset>' + '<loc'.repeat(1_250_000);
    const t0 = Date.now();
    parseSitemap(evil);
    parseSitemap('<url>' + '<url><loc>x'.repeat(400_000));
    parseSitemap('<urlset>' + '<loc>'.repeat(1_000_000));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(parseSitemap('<urlset><url><loc> https://a.test/x?a=1&amp;b=2 </loc></url><location>no</location></urlset>').urls).toEqual(['https://a.test/x?a=1&b=2']);
  });

  it('secretos: el valor, lo que sigue al esquema y el usuario/clave de Basic', () => {
    const basic = `Basic ${Buffer.from('apiuser:s3cretpass99').toString('base64')}`;
    const v = [...secretVariants('Bearer tok_ABCDEFGH123'), ...secretVariants(basic)];
    const out = redactDeep(
      { content: 'echo tok_ABCDEFGH123', structured: { auth: { header: 'Bearer tok_ABCDEFGH123' }, list: ['s3cretpass99', 42] }, user: 'apiuser:s3cretpass99' },
      v,
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('tok_ABCDEFGH123');
    expect(json).not.toContain('s3cretpass99');
    expect(out.structured.auth.header).toBe('[redacted]');
    expect(out.structured.list[1]).toBe(42);
  });

  it('PII: JSON válido, números que no son teléfonos y datos del negocio', () => {
    const raw = JSON.stringify({ email: 'ana@acme.com', ts: 1730000000123, lat: -34.603722, note: 'llamame al 11 5555-1234', id: 'ord_1730000000', amount: 1234567.89 });
    const out = JSON.parse(redactJsonText(raw) as string) as Record<string, unknown>;
    expect(out).toMatchObject({ email: '[email]', ts: 1730000000123, lat: -34.603722, note: 'llamame al [phone]', id: 'ord_1730000000', amount: 1234567.89 });
    expect(redactPii('pedido 1730000000 a las 14:30, coordenadas -34.603722, -58.381592')).toBe('pedido 1730000000 a las 14:30, coordenadas -34.603722, -58.381592');
    expect(redactPii('mi whatsapp 1155551234')).toBe('mi whatsapp [phone]');
    const keep = businessContacts(['Escribinos a soporte@acme.com o al +54 11 4000-1000']);
    expect(redactPii('Soporte: soporte@acme.com / +54 11 4000-1000. Mi mail: yo@x.com', keep)).toBe('Soporte: soporte@acme.com / +54 11 4000-1000. Mi mail: [email]');
  });

  it('SSRF: 6to4 y 198.18/15 cuentan como red privada', () => {
    expect(isPrivateIp('2002:7f00:1::1')).toBe(true);
    expect(isPrivateIp('198.18.0.1')).toBe(true);
    expect(isPrivateIp('198.19.255.1')).toBe(true);
    expect(isPrivateIp('198.20.0.1')).toBe(false);
  });

  it('secretos: partes cortas, base64 y mayúsculas', () => {
    const v = secretVariants('Bearer sk_live_ABCDEFGHIJ.k9x2');
    const echo = `TOKEN=SK_LIVE_ABCDEFGHIJ.K9X2 b64=${Buffer.from('sk_live_ABCDEFGHIJ.k9x2').toString('base64')} part=ABCDEFGHIJ`;
    const out = redactDeep(echo, v);
    expect(out).not.toMatch(/abcdefghij/i);
    expect(out).not.toContain(Buffer.from('sk_live_ABCDEFGHIJ.k9x2').toString('base64'));
  });

  it('cola de sitemaps: dos crons a la vez listan una sola vez; cambiar el prefijo durante el listado vuelve a listar', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const owner = await makeUser('sm-claim');
    const agent = await createAgent(owner.id, owner.id, { name: 'SM' });
    let fetches = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/sitemap.xml')) {
        fetches++;
        await gate;
        return new Response('<urlset><url><loc>https://sm.test/help/a</loc></url><url><loc>https://sm.test/blog/b</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } });
      }
      return new Response('nope', { status: 404 });
    });
    await syncSitemaps(owner.id, agent.id, [{ url: 'https://sm.test/sitemap.xml', prefix: '' }]);
    const a = processPendingSitemaps();
    const b = processPendingSitemaps();
    await new Promise((r) => setTimeout(r, 30));
    // Mientras lista, alguien guarda otro filtro.
    await syncSitemaps(owner.id, agent.id, [{ url: 'https://sm.test/sitemap.xml', prefix: '/help' }]);
    release();
    const [na, nb] = await Promise.all([a, b]);
    expect(na + nb).toBe(1);
    expect(fetches).toBe(1);
    const row = (await getDb().prepare('SELECT status, prefix FROM agent_sitemaps WHERE agent_id = ?').get(agent.id)) as { status: string; prefix: string };
    expect(row).toEqual({ status: 'pending', prefix: '/help' });
    expect(await processPendingSitemaps()).toBe(1);
    const urls = (await getDb().prepare('SELECT url FROM agent_knowledge_urls WHERE agent_id = ? AND origin IS NOT NULL').all(agent.id)) as Array<{ url: string }>;
    expect(urls.map((u) => u.url)).toEqual(['https://sm.test/help/a']);
    // Ya listado: otra corrida no lo toma.
    expect(await processPendingSitemaps()).toBe(0);
  });

  it('Chat: después de derivar, los mensajes nuevos del inbox se vuelven a tapar en el pase horario', async () => {
    const owner = await makeUser('pii-chat');
    const created = await createAgent(owner.id, owner.id, { name: 'PII chat' });
    const res = await updateAgent(owner.id, created.id, {
      settings: { channelInstructions: { chat: '', public: '', api: '' }, citations: true, visitorContext: false, memory: false, redactPii: true, blockedCountries: [], blockedWords: [], scorecard: [], aiScoring: false, redactNames: false, semanticSearch: false, answerEmails: false, forms: [], procedures: [], voice: { language: 'en-US' as const, greeting: '', handoffNumber: '' } },
    });
    expect(res.ok).toBe(true);
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const widget = await createChatWidget(owner.id, null, { name: 'w' } as Parameters<typeof createChatWidget>[2]);
    const visitor = await getOrCreateChatVisitor(widget.id, `v-${crypto.randomUUID()}`);
    const chat = await createChatConversation(widget.id, visitor.id);
    const conv = await conversationForChat(agent, chat.id, 'hola');
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const first = await createChatMessage(chat.id, 'visitor', { body: 'mi mail es ana@acme.com' });
    await getDb().prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?').run(ago(180), first.id);
    await getDb().prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(ago(170), conv.id);
    expect(await redactIdleConversations()).toBe(1);
    // (Pasó el tiempo: la redacción anterior marcó hace 2 h.)
    await getDb().prepare('UPDATE agent_conversations SET redacted_at = ? WHERE id = ?').run(ago(120), conv.id);
    // Derivada: sigue con el equipo; el agente no tiene actividad nueva.
    const later = await createChatMessage(chat.id, 'visitor', { body: 'y el de mi socio bo@acme.com' });
    await getDb().prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?').run(ago(65), later.id);
    expect(await redactIdleConversations()).toBe(1);
    const bodies = (await getDb().prepare('SELECT body FROM chat_messages WHERE conversation_id = ?').all(chat.id)) as Array<{ body: string }>;
    expect(bodies.map((b) => b.body).join(' ')).not.toContain('@acme.com');
    expect(await redactIdleConversations()).toBe(0);
  });
});
