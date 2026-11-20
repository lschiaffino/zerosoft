/**
 * Quién ve qué (docs/security/privacy-audit-2026-11.md): dos personas del
 * mismo equipo. Lo privado de una (notas, bandeja de Inbox, sesiones de Fleet,
 * diseños privados) no aparece para la otra en la búsqueda global (Cmd+K) ni
 * en las herramientas del asistente; lo propio sí.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createNote } from '@/lib/notes';
import { addMessage, createAccount, upsertThread } from '@/lib/inbox/core';
import { toolCtx, type ReadTool } from '@/lib/assistant/registry';
import { toolsFor } from '@/lib/assistant/tools';
import type { SessionUser } from '@/lib/session';
import { asMember, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const searchRoute = await import('@/app/api/search/route');

beforeEach(() => {
  session.user = null;
});

/** Lo privado de `friend` (y una nota de `member`), todo con la misma palabra para buscar. */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const word = `privword${crypto.randomUUID().slice(0, 8)}`;
  const ws = w.owner.id;
  const ts = new Date().toISOString();
  const db = getDb();
  const mine = await createNote({ workspaceId: ws, personId: w.member.id }, { title: `Mine ${word}` });
  const theirs = await createNote({ workspaceId: ws, personId: w.friend.id }, { title: `Theirs ${word}` });
  const account = await createAccount(w.friend.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await db.prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const thread = await upsertThread({ ...account, status: 'connected' }, { externalId: '30@s.whatsapp.net', kind: 'dm', title: `Chat ${word}` });
  await addMessage(thread, { externalId: `m-${label}`, fromMe: false, body: `Body ${word}` });
  const fleetId = crypto.randomUUID();
  await db
    .prepare('INSERT INTO fleet_sessions (id, workspace_id, person_id, session_key, title, started_at, last_event_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fleetId, ws, w.friend.id, fleetId, `Fleet ${word}`, ts, ts, ts);
  const designId = crypto.randomUUID();
  await db
    .prepare("INSERT INTO design_designs (id, workspace_id, created_by, name, width, height, doc, search_text, workspace_access, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 100, '{}', ?, 'none', ?, ?)")
    .run(designId, ws, w.friend.id, `Design ${word}`, word, ts, ts);
  return { w, word, mine, hiddenIds: [theirs.id, thread.id, fleetId, designId] };
}

describe('quién ve qué entre dos personas del mismo equipo', () => {
  it('Cmd+K: la propia nota sí; lo privado de la otra persona no', async () => {
    const { w, word, mine, hiddenIds } = await setup('wsw-search');
    session.user = asMember(w.owner, w.member);
    const res = await searchRoute.GET(new NextRequest(`http://x/api/search?q=${word}`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: Array<{ id: string; group: string }> };
    expect(data.items.map((i) => i.id)).toContain(mine.id);
    for (const id of hiddenIds) expect(data.items.map((i) => i.id)).not.toContain(id);
    expect(JSON.stringify(data)).not.toContain(`Theirs ${word}`);
    expect(JSON.stringify(data)).not.toContain(`Chat ${word}`);
  });

  it('asistente: notes_search devuelve solo las notas de quien pregunta', async () => {
    const { w, word, mine, hiddenIds } = await setup('wsw-assistant');
    const member = asMember(w.owner, w.member);
    const tool = toolsFor(member).find((t) => t.name === 'notes_search') as ReadTool;
    const out = JSON.stringify(await tool.run(toolCtx(member, 'en'), { query: word }));
    expect(out).toContain(mine.id);
    for (const id of hiddenIds) expect(out).not.toContain(id);
  });
});
