import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createDocPage, updateDocPage } from '@/lib/docs';
import { createNote, listNotes } from '@/lib/notes';
import { createAgent, listAgentOptions } from '@/lib/agents';
import { elementsSignature, sceneSignature } from '@/lib/board-signature';
import { TZ_COOKIE_SCRIPT, tzAction } from '@/lib/tz-client';
import { SIDEBAR_COLLAPSED_SCRIPT, collapsedFrom, denseRoute, storageKey } from '@/lib/sidebar-collapsed';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const docsPagesRoute = await import('@/app/api/docs/pages/route');
const notesRoute = await import('@/app/api/notes/route');

describe('Board: firmas baratas de la escena', () => {
  const els = [
    { id: 'a', version: 3 },
    { id: 'b', version: 1 },
  ];

  it('cambia al editar, agregar o borrar un elemento', () => {
    const base = elementsSignature(els);
    expect(elementsSignature([{ ...els[0], version: 4 }, els[1]])).not.toBe(base);
    expect(elementsSignature([...els, { id: 'c', version: 1 }])).not.toBe(base);
    expect(elementsSignature([els[0]])).not.toBe(base);
  });

  it('no cambia si solo cambió el appState (misma lista y versiones)', () => {
    expect(elementsSignature(els.map((e) => ({ ...e })))).toBe(elementsSignature(els));
  });

  it('la firma de guardado suma fondo y archivos', () => {
    expect(sceneSignature(els, '#fff', 0)).not.toBe(sceneSignature(els, '#000', 0));
    expect(sceneSignature(els, '#fff', 0)).not.toBe(sceneSignature(els, '#fff', 1));
  });
});

describe('Cookie tz', () => {
  it('refresca solo las páginas que dependen de "hoy"; el resto avisa al sidebar', () => {
    expect(tzAction('UTC', 'UTC', true)).toBe('none');
    expect(tzAction('UTC', null, true)).toBe('none');
    expect(tzAction('UTC', 'America/New_York', true)).toBe('refresh');
    expect(tzAction('UTC', 'America/New_York', false)).toBe('notify');
  });

  it('el script inline escribe la cookie si falta o es otra, y no la toca si ya está', () => {
    const run = (cookie: string) => {
      const doc = { cookie };
      new Function('document', 'Intl', TZ_COOKIE_SCRIPT)(doc, {
        DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Argentina/Buenos_Aires' }) }),
      });
      return doc.cookie;
    };
    expect(run('')).toBe('tz=America%2FArgentina%2FBuenos_Aires; path=/; max-age=31536000; samesite=lax');
    expect(run('a=1; tz=UTC')).toContain('tz=America%2FArgentina%2FBuenos_Aires');
    expect(run('a=1; tz=America%2FArgentina%2FBuenos_Aires')).toBe('a=1; tz=America%2FArgentina%2FBuenos_Aires');
  });
});

describe('Sidebar colapsado antes del primer paint', () => {
  const run = (pathname: string, stored: Record<string, string>) => {
    const classes = new Set<string>();
    const document = { currentScript: { parentElement: { classList: { add: (c: string) => classes.add(c) } } } };
    const localStorage = { getItem: (k: string) => stored[k] ?? null };
    new Function('location', 'document', 'localStorage', SIDEBAR_COLLAPSED_SCRIPT)({ pathname }, document, localStorage);
    return classes.has('sidebar-collapsed');
  };

  it('sigue la misma regla que AppSidebar (Notes arranca colapsado)', () => {
    expect(run('/es/app/notes', {})).toBe(collapsedFrom(null, denseRoute('/app/notes')));
    expect(run('/es/app/notes', {})).toBe(true);
    expect(run('/es/app/crm', {})).toBe(false);
    expect(run('/es/app/notes', { [storageKey('notes')]: '0' })).toBe(false);
    expect(run('/en/app/docs', { [storageKey(null)]: '1' })).toBe(true);
  });
});

describe('Docs API: lista liviana y paginada', () => {
  it('devuelve resúmenes sin content y pagina con nextOffset', async () => {
    const u = await makeUser('docs-list');
    session.user = { id: u.id, email: u.email };
    for (let i = 0; i < 3; i++) {
      const p = await createDocPage(u.id, { title: `Página ${i}` });
      await updateDocPage(u.id, p.id, { content: [{ id: `b${i}`, type: 'paragraph', content: 'texto largo '.repeat(50) }] } as never);
    }
    const first = await (await docsPagesRoute.GET(new NextRequest('http://t/api/docs/pages?limit=2'))).json();
    expect(first.rows).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    expect(first.rows[0]).not.toHaveProperty('content');
    expect(Object.keys(first.rows[0]).sort()).toEqual(['icon', 'id', 'parent_id', 'position', 'teamspace_id', 'title', 'updated_at', 'verified']);
    const rest = await (await docsPagesRoute.GET(new NextRequest('http://t/api/docs/pages?limit=2&offset=2'))).json();
    const ids = [...first.rows, ...rest.rows].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rest.nextOffset).toBeNull();
  });
});

describe('Notes: lista sin bloques y paginada', () => {
  it('trae el snippet sin el contenido entero y pagina con offset', async () => {
    const u = await makeUser('notes-list');
    const owner = { workspaceId: u.id, personId: u.id };
    for (let i = 0; i < 3; i++) {
      await createNote(owner, {
        title: `Nota ${i}`,
        content: [{ id: `p${i}`, type: 'paragraph', content: `hola ${i} ${'x'.repeat(5000)}` }],
      } as never);
    }
    const all = await listNotes(owner, {});
    expect(all).toHaveLength(3);
    expect(all[0].snippet.length).toBeLessThanOrEqual(140);
    expect(all[0]).not.toHaveProperty('content');
    const page1 = await listNotes(owner, { limit: 2 });
    const page2 = await listNotes(owner, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect(new Set([...page1, ...page2].map((n) => n.id)).size).toBe(3);

    session.user = { id: u.id, email: u.email };
    const res = await (await notesRoute.GET(new NextRequest('http://t/api/notes?limit=2'))).json();
    expect(res.notes).toHaveLength(2);
    expect(res.nextOffset).toBe(2);
    const last = await (await notesRoute.GET(new NextRequest('http://t/api/notes?limit=2&offset=2'))).json();
    expect(last.notes).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
  });

  it('la búsqueda sigue armando el snippet alrededor del término (texto entero)', async () => {
    const u = await makeUser('notes-search');
    const owner = { workspaceId: u.id, personId: u.id };
    await createNote(owner, {
      title: 'Larga',
      content: [{ id: 'p', type: 'paragraph', content: `${'relleno '.repeat(400)}palabraclave final` }],
    } as never);
    const [hit] = await listNotes(owner, { q: 'palabraclave' });
    expect(hit.snippet).toContain('palabraclave');
  });
});

describe('Agents: opciones livianas e índices de las stats', () => {
  it('listAgentOptions trae id y nombre', async () => {
    const u = await makeUser('agent-opts');
    const a = await createAgent(u.id, u.id, { name: 'Selector' });
    expect(await listAgentOptions(u.id)).toEqual([{ id: a.id, name: 'Selector' }]);
  });

  it('las stats de 7 días y el feedback usan índices por workspace', async () => {
    const db = getDb();
    const plan = async (sql: string) =>
      ((await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('u', '2026-01-01')) as Array<{ detail: string }>)
        .map((r) => r.detail)
        .join(' | ');
    expect(
      await plan("SELECT agent_id, COUNT(*) FROM agent_conversations WHERE user_id = ? AND channel != 'playground' AND created_at >= ? GROUP BY agent_id"),
    ).toContain('idx_agent_conversations_user_created');
    const fb = ((await db.prepare('EXPLAIN QUERY PLAN SELECT agent_id, SUM(rating) FROM agent_feedback WHERE user_id = ? GROUP BY agent_id').all('u')) as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join(' | ');
    expect(fb).toContain('idx_agent_feedback_user_agent');
  });
});
