import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'zlib';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, sendAgentMessage, toAgentDto, updateAgent } from '@/lib/agents';
import type { AgentUpdatePayload } from '@/lib/agents-config';
import { applyCitations } from '@/lib/agent-tools';
import { withDraft } from '@/lib/agents-draft';
import { discardDraft, listChanges, listVersions, publishAgent, restoreVersion } from '@/lib/agents-versions';
import {
  addKnowledgeFile,
  createQa,
  csvToKnowledgeText,
  extractFileText,
  importQaCsv,
  listSuggestions,
  parseQaCsv,
  parseSitemap,
} from '@/lib/agents-knowledge';
import { contentStreamText, parseToUnicode, pdfToText } from '@/lib/pdf-text';
import { buildPdf } from '@/lib/pdf-lite';
import { redactConversation, redactPii } from '@/lib/agents-privacy';
import { staticRuleIssues } from '@/lib/agents-quality';
import { csvCell, exportConversationsCsv } from '@/lib/agents-export';
import { memoryRefFor } from '@/lib/agents-context';
import { addMcpServer, listMcpServers, mcpToolKey, readJsonRpc } from '@/lib/agents-mcp';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'ALLOW_PRIVATE_WEBHOOKS', 'RATE_LIMIT_DISABLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RATE_LIMIT_DISABLED = 'true';
});

afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const TOOLS = { calEventTypeId: null, calDays: 7, trackProjectId: null, flowIds: [], robotIds: [], docsPageIds: [], docsActorId: null, httpAllowedDomains: [], requireApproval: [] };

async function setupAgent(label: string, patch: AgentUpdatePayload = {}) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  if (Object.keys(patch).length) {
    const res = await updateAgent(owner.id, created.id, patch, owner.id);
    if (!res.ok) throw new Error(res.error);
  }
  return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

describe('versiones: borrador, publicar y volver atrás', () => {
  it('sin versiones guarda en vivo; al publicar, lo guardado queda en borrador hasta publicar de nuevo', async () => {
    const { owner, agent } = await setupAgent('ver-flow', { instructions: 'v0 rules' });
    expect(agent.instructions).toBe('v0 rules');
    const v1 = await publishAgent(owner.id, agent.id, owner.id, 'first');
    expect(v1.ok).toBe(true);

    const saved = await updateAgent(owner.id, agent.id, { instructions: 'draft rules', name: 'Renamed' }, owner.id);
    expect(saved.ok && saved.agent.instructions).toBe('draft rules');
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    // En vivo sigue lo publicado; el nombre se aplica al guardar.
    expect(row.instructions).toBe('v0 rules');
    expect(row.name).toBe('Renamed');
    expect(withDraft(row).instructions).toBe('draft rules');

    // El playground corre el borrador; la página pública, lo publicado.
    const model = scriptedModel([{ text: 'ok' }]);
    setAiModelOverride(model);
    await sendAgentMessage({ agent: row, channel: 'playground', text: 'hi', createdBy: owner.id });
    await getDb().prepare('UPDATE agents SET public_handle = ? WHERE id = ?').run(`v-${crypto.randomUUID().slice(0, 8)}`, agent.id);
    await sendAgentMessage({ agent: (await getAgentRow(owner.id, agent.id)) as AgentRow, channel: 'public', visitorKey: 'p'.repeat(20), text: 'hi' });
    const systems = model.doGenerateCalls.map((c) => JSON.stringify(c.prompt[0]));
    expect(systems[0]).toContain('draft rules');
    expect(systems[1]).toContain('v0 rules');
    expect(systems[1]).not.toContain('draft rules');

    const v2 = await publishAgent(owner.id, agent.id, owner.id);
    expect(v2.ok && v2.versioning.liveNumber).toBe(2);
    expect(((await getAgentRow(owner.id, agent.id)) as AgentRow).instructions).toBe('draft rules');
    expect((await publishAgent(owner.id, agent.id, owner.id)).ok).toBe(false);

    const versions = await listVersions(owner.id, agent.id);
    expect(versions.map((v) => v.number)).toEqual([2, 1]);
    const restored = await restoreVersion(owner.id, agent.id, versions[1].id, owner.id);
    expect(restored.ok && restored.versioning.liveNumber).toBe(3);
    expect(((await getAgentRow(owner.id, agent.id)) as AgentRow).instructions).toBe('v0 rules');

    const kinds = (await listChanges(owner.id, agent.id)).map((c) => c.kind);
    expect(kinds).toContain('restore');
    expect(kinds).toContain('publish');
    expect(kinds).toContain('save');
    expect(kinds).toContain('create');
  });

  it('descartar el borrador vuelve a lo publicado', async () => {
    const { owner, agent } = await setupAgent('ver-discard', { instructions: 'live' });
    await publishAgent(owner.id, agent.id, owner.id);
    await updateAgent(owner.id, agent.id, { instructions: 'oops' }, owner.id);
    const res = await discardDraft(owner.id, agent.id, owner.id);
    expect(res.ok && res.agent.instructions).toBe('live');
    expect(res.ok && res.versioning.hasDraft).toBe(false);
  });
});

describe('conocimiento: archivos, pares y sitemaps', () => {
  it('lee el texto de un PDF generado (sin comprimir y con FlateDecode + ToUnicode)', () => {
    const plain = buildPdf({ title: 'Price list', lines: [{ text: 'Shipping to Brazil takes 5 business days.' }] });
    expect(pdfToText(plain)).toContain('Shipping to Brazil takes 5 business days.');

    const cmap = '/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0048> <0002> <0069> endbfchar endcmap';
    const content = deflateSync(Buffer.from('BT /F1 12 Tf 72 700 Td <00010002> Tj ET', 'latin1'));
    const cm = Buffer.from(cmap, 'latin1');
    const parts = [
      '%PDF-1.7\n',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n',
    ];
    const buf = Buffer.concat([
      Buffer.from(parts.join(''), 'latin1'),
      Buffer.from(`4 0 obj << /Length ${content.length} /Filter /FlateDecode >> stream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >> endobj\n', 'latin1'),
      Buffer.from(`6 0 obj << /Length ${cm.length} >> stream\n`, 'latin1'),
      cm,
      Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF', 'latin1'),
    ]);
    expect(() => pdfToText(buf)).toThrow('pdf_no_text'); // "Hi" son 2 letras: no alcanza
    expect(contentStreamText('BT /F1 12 Tf <00010002> Tj ET', new Map([['F1', parseToUnicode(cmap)]]))).toBe('Hi ');
    expect(contentStreamText('BT (Hello) Tj T* [(Wor) -250 (ld)] TJ ET')).toBe('Hello\nWor ld ');
  });

  it('CSV como conocimiento y como pares de pregunta y respuesta', async () => {
    expect(csvToKnowledgeText('plan,price\nPro,$20\nTeam,$50')).toBe('plan: Pro; price: $20\nplan: Team; price: $50');
    expect(parseQaCsv('pregunta,respuesta,variantes\n¿Envían a Brasil?,Sí en 5 días,Mandan a Brasil|Shipping Brasil')).toEqual([
      { question: '¿Envían a Brasil?', answer: 'Sí en 5 días', variants: ['Mandan a Brasil', 'Shipping Brasil'] },
    ]);
    expect(parseQaCsv('Q1,A1\nQ2,A2,V2')).toHaveLength(2);
    await expect(extractFileText('x.exe', new Uint8Array([1]))).rejects.toThrow('unsupported_file');
  });

  it('el agente encuentra archivos y pares, y cita la fuente', async () => {
    const { owner, agent } = await setupAgent('kn-own', { tools: { enabled: ['search_knowledge'], ...TOOLS } });
    await addKnowledgeFile(agent, { name: 'policies.txt', bytes: new TextEncoder().encode('Refunds are accepted within 30 days of purchase.') }, owner.id);
    await createQa(agent, { question: 'Do you ship to Brazil?', variants: ['Shipping Brazil'], answer: 'Yes, in 5 business days.' }, owner.id);
    expect((await importQaCsv(agent, 'question,answer\nDo you ship to Brazil?,dup\nOpening hours?,9 to 18', owner.id))).toEqual({ added: 1, skipped: 1 });
    setAiModelOverride(
      scriptedModel([{ tool: 'search_knowledge', input: { query: 'refunds days' } }, { text: 'You have 30 days to ask for a refund [1].' }]),
    );
    const res = await sendAgentMessage({ agent, channel: 'playground', text: 'How long for refunds?', createdBy: owner.id });
    const out = res.result.toolCalls[0].output as { results: Array<{ ref: number; kind: string; title: string }> };
    expect(out.results[0]).toMatchObject({ ref: 1, kind: 'file', title: 'policies.txt' });
    expect(res.result.text).toBe('You have 30 days to ask for a refund [1].\n\nSources:\n[1] policies.txt');
  });

  it('citas: links, numeración propia y sin citar pares', () => {
    const c = new Map([
      [1, { title: 'Pricing', url: 'https://x.test/pricing', kind: 'url' }],
      [2, { title: 'Q', url: null, kind: 'qa' }],
      [3, { title: 'Help', url: null, kind: 'doc' }],
    ]);
    expect(applyCitations('A [3]. B [1]. C [2].', c, { enabled: true, visitorText: 'hola, cuánto sale' })).toBe(
      'A [1]. B [2]. C.\n\nFuentes:\n[1] Help\n[2] Pricing: https://x.test/pricing',
    );
    expect(applyCitations('A [1].', c, { enabled: false })).toBe('A.');
    expect(applyCitations('A [9].', c, { enabled: true })).toBe('A.');
  });

  it('sitemaps e índices', () => {
    const xml = '<urlset><url><loc>https://a.test/help/1</loc></url><url><loc>https://a.test/blog?x=1&amp;y=2</loc></url></urlset>';
    expect(parseSitemap(xml).urls).toEqual(['https://a.test/help/1', 'https://a.test/blog?x=1&y=2']);
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>').sitemaps).toEqual(['https://a.test/s1.xml']);
  });

  it('las preguntas que no encontraron nada quedan como sugerencias', async () => {
    const { owner, agent } = await setupAgent('kn-sug', { tools: { enabled: ['search_knowledge'], ...TOOLS }, publicHandle: `s-${crypto.randomUUID().slice(0, 8)}` });
    setAiModelOverride(scriptedModel([{ tool: 'search_knowledge', input: { query: 'warranty' } }, { text: 'I do not know.' }]));
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'q'.repeat(20), text: 'What is the warranty on the X200?' });
    const list = await listSuggestions(owner.id, agent.id);
    expect(list[0]).toMatchObject({ question: 'What is the warranty on the X200?', count: 1 });
  });
});

describe('privacidad, bloqueos y reglas', () => {
  it('tapa emails, teléfonos, tarjetas válidas y documentos', () => {
    expect(redactPii('Soy ana@acme.com, mi tel +54 9 11 5555-1234 y DNI 30.123.456')).toBe('Soy [email], mi tel [phone] y DNI [id]');
    expect(redactPii('card 4242 4242 4242 4242 and order 1234567890123')).toBe('card [card] and order 1234567890123');
    expect(redactPii('Pedido 123')).toBe('Pedido 123');
    expect(redactPii('Turno el 2026-10-27 a las 14:30')).toBe('Turno el 2026-10-27 a las 14:30');
  });

  it('redacta mensajes, herramientas e identidad de una conversación', async () => {
    const { owner, agent } = await setupAgent('pii');
    setAiModelOverride(scriptedModel([{ text: 'Thanks ana@acme.com' }]));
    const res = await sendAgentMessage({ agent, channel: 'playground', text: 'I am ana@acme.com', createdBy: owner.id });
    await redactConversation({ id: res.conversation.id, title: res.conversation.title, chat_conversation_id: null });
    const msgs = (await getDb().prepare('SELECT content FROM agent_messages WHERE conversation_id = ?').all(res.conversation.id)) as Array<{ content: string }>;
    expect(msgs.map((m) => m.content)).toEqual(['I am [email]', 'Thanks [email]']);
  });

  it('vuelve a redactar cuando la conversación se retoma y cubre memoria y puntaje', async () => {
    const { owner, agent } = await setupAgent('pii-again', {
      publicHandle: `pa-${crypto.randomUUID().slice(0, 8)}`,
      settings: { channelInstructions: { chat: '', public: '', api: '' }, citations: true, visitorContext: false, memory: false, redactPii: true, blockedCountries: [], blockedWords: [], scorecard: [], aiScoring: false },
    });
    setAiModelOverride(scriptedModel([{ text: 'ok' }]));
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    const first = await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'r'.repeat(20), text: 'soy ana@acme.com' });
    const id = first.conversation.id;
    await getDb().prepare('INSERT INTO agent_memories (id, agent_id, user_id, visitor_ref, fact, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), agent.id, owner.id, 'k', 'Email is ana@acme.com', id, new Date().toISOString());
    await getDb().prepare("UPDATE agent_conversations SET score = ? WHERE id = ?").run(JSON.stringify({ csat: 4, summary: 'Ana (ana@acme.com) asked', topic: 'x', criteria: [] }), id);
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await getDb().prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(old, id);
    const { redactIdleConversations } = await import('@/lib/agents-privacy');
    expect(await redactIdleConversations()).toBeGreaterThanOrEqual(1);
    // Se retoma: un mensaje nuevo con otro email.
    await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'r'.repeat(20), conversationId: id, text: 'y también bo@acme.com' });
    // (Simula el paso del tiempo: la redacción anterior fue hace 3 h y el último mensaje hace 90 min.)
    await getDb()
      .prepare('UPDATE agent_conversations SET updated_at = ?, redacted_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 90 * 60_000).toISOString(), new Date(Date.now() - 3 * 3_600_000).toISOString(), id);
    expect(await redactIdleConversations()).toBeGreaterThanOrEqual(1);
    const dump = JSON.stringify([
      await getDb().prepare('SELECT content FROM agent_messages WHERE conversation_id = ?').all(id),
      await getDb().prepare('SELECT fact FROM agent_memories WHERE conversation_id = ?').all(id),
      await getDb().prepare('SELECT score FROM agent_conversations WHERE id = ?').get(id),
    ]);
    expect(dump).not.toContain('@acme.com');
    expect(JSON.parse(((await getDb().prepare('SELECT score FROM agent_conversations WHERE id = ?').get(id)) as { score: string }).score).csat).toBe(4);
  });

  it('las palabras de spam cortan antes del modelo', async () => {
    const { owner, agent } = await setupAgent('spam', {
      settings: { channelInstructions: { chat: '', public: '', api: '' }, citations: true, visitorContext: false, memory: false, redactPii: false, blockedCountries: [], blockedWords: ['casino'], scorecard: [], aiScoring: false },
    });
    const model = scriptedModel([{ text: 'nope' }]);
    setAiModelOverride(model);
    const res = await sendAgentMessage({ agent, channel: 'playground', text: 'Best CASINO bonus', createdBy: owner.id });
    expect(res.result.status).toBe('blocked');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('chequeos fijos de reglas que chocan', async () => {
    const { agent } = await setupAgent('rules', {
      instructions: 'Always explain pricing step by step.',
      guardrails: { avoidTopics: ['pricing'], maxReplyChars: 300 },
      handoff: { onRequest: true, onUnsure: true, keywords: ['pricing'], message: '' },
    });
    const codes = staticRuleIssues(toAgentDto(agent)).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['avoid_in_instructions', 'keyword_is_avoided', 'long_answers_short_limit']));
  });
});

describe('exportar, memoria y MCP', () => {
  it('CSV con una fila por mensaje y celdas seguras', async () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const { owner, agent } = await setupAgent('exp', { publicHandle: `e-${crypto.randomUUID().slice(0, 8)}` });
    setAiModelOverride(scriptedModel([{ text: 'Hello!' }]));
    await sendAgentMessage({ agent: (await getAgentRow(owner.id, agent.id)) as AgentRow, channel: 'public', visitorKey: 'e'.repeat(20), text: 'Hi' });
    const csv = await exportConversationsCsv(owner.id, agent.id);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('conversation_id');
    expect(lines.slice(1).map((l) => l.split(',').slice(-2).join(','))).toEqual(['visitor,Hi', 'agent,Hello!']);
  });

  it('la memoria se ata a una identidad que el visitante no puede inventar', () => {
    expect(memoryRefFor('public', { visitorKey: 'abc' })).toMatch(/^key:/);
    expect(memoryRefFor('chat', {})).toBeNull();
    expect(memoryRefFor('api', { identity: { email: 'A@x.com', name: null } })).toBe(memoryRefFor('chat', { identity: { email: 'a@x.com', name: null } }));
  });

  it('cliente MCP: lee JSON y SSE y conecta con el token cifrado', async () => {
    expect(readJsonRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', 'text/event-stream', 2)).toEqual({ result: { ok: 1 }, error: undefined });
    expect(mcpToolKey('Mi Tienda!', 'get.order')).toBe('mcp_mi_tienda_get_order');
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const calls: Array<{ method: string; auth: string | null }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id?: number; method: string };
      const headers = new Headers(init.headers);
      calls.push({ method: body.method, auth: headers.get('authorization') });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result =
        body.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {} }
          : body.method === 'tools/call'
            ? {
                // Un servidor que hace eco del token, entero y sin el esquema, en el texto y en el JSON.
                content: [{ type: 'text', text: 'auth was Bearer secret-token-123 (secret-token-123)' }],
                structuredContent: { headers: { authorization: 'Bearer secret-token-123' }, raw: ['secret-token-123'], total: 42 },
              }
            : { tools: [{ name: 'lookup_order', description: 'Find an order', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: true } }] };
      return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' } });
    });
    const { owner, agent } = await setupAgent('mcp');
    const servers = await addMcpServer(agent, { name: 'Store', url: 'https://mcp.store.test/mcp', headerValue: 'Bearer secret-token-123' }, owner.id);
    expect(servers[0]).toMatchObject({ name: 'Store', hasAuth: true, allowed: ['lookup_order'] });
    expect(JSON.stringify(servers)).not.toContain('secret-token-123');
    expect(calls.map((c) => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(calls.every((c) => c.auth === 'Bearer secret-token-123')).toBe(true);
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    expect(row.mcp_servers).not.toContain('secret-token-123');
    expect(listMcpServers(row)[0].tools[0].readOnly).toBe(true);

    // El eco del token no llega al modelo ni al registro de herramientas.
    await updateAgent(owner.id, agent.id, { tools: { enabled: ['mcp_call'], ...TOOLS } }, owner.id);
    setAiModelOverride(scriptedModel([{ tool: 'mcp_store_lookup_order', input: { id: '1' } }, { text: 'done' }]));
    const res = await sendAgentMessage({ agent: (await getAgentRow(owner.id, agent.id)) as AgentRow, channel: 'playground', text: 'order 1', createdBy: owner.id });
    expect(JSON.stringify(res.result.toolCalls[0].output)).not.toContain('secret-token-123');
    expect((res.result.toolCalls[0].output as { structured: { total: number } }).structured.total).toBe(42);
    const stored = (await getDb().prepare('SELECT output FROM agent_tool_calls WHERE conversation_id = ?').all(res.conversation.id)) as Array<{ output: string }>;
    expect(stored.map((r) => r.output).join(' ')).not.toContain('secret-token-123');
  });
});
