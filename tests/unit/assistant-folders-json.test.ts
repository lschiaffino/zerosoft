import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { createAccount, upsertThread } from '@/lib/inbox/core';
import { importPart } from '@/lib/inbox/import';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { createFolder as createLineFolder, moveChatsToFolder } from '@/lib/groups-lines';
import { groupsViewer } from '@/lib/groups-access';
import { addMember } from '@/lib/teams';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { decideAction } from '@/lib/assistant/actions';
import { addMessage, createConversation, getAction } from '@/lib/assistant/store';
import {
  buildChatIndex,
  buildFoldersPlan,
  FoldersJsonError,
  matchChat,
  nameSimilarity,
  normalizeFoldersJson,
  parseLooseJson,
  phoneKeys,
  type ChatCandidate,
} from '@/lib/assistant/folders-json';
import { newChatJid } from '@/lib/assistant/tools-folders';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const paths = (raw: unknown) =>
  normalizeFoldersJson(raw)
    .folders.map((f) => `${f.path.join('/')}:${f.chats.map((c) => c.label).join(',')}`)
    .sort();

describe('carpetas desde JSON: normalizar', () => {
  it('árbol con subcarpetas (claves en inglés y en español)', () => {
    expect(
      paths([
        { name: 'Clientes', chats: ['Juan Pérez', '+54 9 11 5555-0001'], subfolders: [{ name: 'VIP', chats: [{ name: 'Ana', phone: '5491155550002' }] }] },
        { nombre: 'Proveedores', contactos: ['proveedor@acme.com'], subcarpetas: [] },
      ]),
    ).toEqual(['Clientes/VIP:Ana (+5491155550002)', 'Clientes:Juan Pérez,+54 9 11 5555-0001', 'Proveedores:proveedor@acme.com']);
  });

  it('mapa anidado y rutas "A/B" o "A > B"', () => {
    expect(paths({ Clientes: { VIP: ['Ana'], Otros: ['Beto'] }, 'Proveedores > Insumos': ['Carla'] })).toEqual([
      'Clientes/Otros:Beto',
      'Clientes/VIP:Ana',
      'Clientes:',
      'Proveedores/Insumos:Carla',
      'Proveedores:',
    ]);
  });

  it('lista plana con la ruta en cada carpeta', () => {
    expect(paths([{ folder: 'Clientes/VIP', chats: ['Ana'] }, { path: 'Clientes', chats: ['Beto'] }])).toEqual(['Clientes/VIP:Ana', 'Clientes:Beto']);
  });

  it('filas chat → carpeta (un chat en varias carpetas)', () => {
    expect(
      paths([
        { chat: 'Ana', folder: 'Clientes > VIP' },
        { name: 'Beto', phone: '1155550003', folders: ['Clientes', 'Amigos'] },
      ]),
    ).toEqual(['Amigos:Beto (+1155550003)', 'Clientes/VIP:Ana', 'Clientes:Beto (+1155550003)']);
  });

  it('carpetas con id y padre, y chats que las nombran por id o por ruta', () => {
    const data = {
      folders: [
        { id: 'f1', name: 'Clientes' },
        { id: 'f2', name: 'VIP', parentId: 'f1' },
      ],
      chats: [
        { name: 'Ana', jid: '5491155550002@c.us', folderId: 'f2' },
        { name: 'Beto', folder: 'Clientes' },
      ],
    };
    const n = normalizeFoldersJson(data);
    expect(n.shapes).toContain('ids');
    expect(paths(data)).toEqual(['Clientes/VIP:Ana (+5491155550002)', 'Clientes:Beto']);
    // El JID de @c.us queda como el de WhatsApp (@s.whatsapp.net) y con su teléfono.
    expect(n.folders.find((f) => f.path.length === 2)!.chats[0]).toMatchObject({ jid: '5491155550002@s.whatsapp.net', phone: '5491155550002' });
  });

  it('la exportación de inbox-zero (el mismo esquema que el importador)', () => {
    const n = normalizeFoldersJson({
      format: 'inbox-zero-export',
      version: 1,
      folders: [
        { id: 1, name: 'Trabajo', color: '#3b82f6', position: 0, parentId: null },
        { id: 2, name: 'Equipo', position: 1, parentId: 1 },
      ],
      chatFolders: [{ chatId: '5491177770000@c.us', folderId: 2 }],
      chats: [{ chatId: '5491177770000@c.us', name: 'Jefa' }],
    });
    expect(n.shapes).toEqual(['inbox-zero']);
    expect(n.folders.map((f) => f.path.join('/'))).toEqual(['Trabajo', 'Trabajo/Equipo']);
    expect(n.folders[0].color).toBe('#3b82f6');
    expect(n.folders[1].chats[0]).toMatchObject({ name: 'Jefa', jid: '5491177770000@s.whatsapp.net' });
  });

  it('envoltorios, cercas de código, comas finales y comentarios', () => {
    const text = 'Acá va:\n```json\n{ "data": { "folders": [ { "name": "Casa", "chats": ["Mamá",], }, ], } } // fin\n```';
    expect(paths(parseLooseJson(text))).toEqual(['Casa:Mamá']);
  });

  it('sin carpetas reconocibles: error para preguntar (no adivina)', () => {
    expect(() => normalizeFoldersJson({ foo: 1, bar: true })).toThrow(FoldersJsonError);
    expect(() => normalizeFoldersJson([1, 2, 3])).toThrow(FoldersJsonError);
    expect(parseLooseJson('hola, sin json')).toBeNull();
  });

  it('dedup: la misma carpeta con otra mayúscula o tilde y el mismo chat dos veces', () => {
    const n = normalizeFoldersJson([
      { name: 'Clientes', chats: ['Ana', 'ana'] },
      { name: 'clientes', chats: ['Beto'] },
    ]);
    expect(n.folders).toHaveLength(1);
    expect(n.folders[0].chats.map((c) => c.label)).toEqual(['Ana', 'Beto']);
  });

  it('filas envueltas en la raíz y datos del archivo que no son carpetas', () => {
    expect(paths({ version: 2, exportedAt: '2026-11-01', chats: [{ name: 'Ana', folder: 'Clientes/VIP' }, { phone: '+54 11 5555 0003', folders: ['Amigos'] }] })).toEqual([
      'Amigos:541155550003',
      'Clientes/VIP:Ana',
      'Clientes:',
    ]);
    // Un mapa con una fecha suelta: la fecha no es una carpeta.
    expect(paths({ exportedAt: '2026-11-01', Clientes: ['Ana'] })).toEqual(['Clientes:Ana']);
  });

  it('lo que no entiende queda contado como salteado', () => {
    const n = normalizeFoldersJson({ Clientes: ['Ana', null, { foo: 'bar' }] });
    expect(n.folders[0].chats.map((c) => c.label)).toEqual(['Ana']);
    expect(n.skipped.length).toBe(2);
  });
});

describe('carpetas desde JSON: buscar chats', () => {
  const chats: ChatCandidate[] = [
    { id: 't1', name: 'Juan Pérez', phone: '5491155550001', jid: '5491155550001@s.whatsapp.net', folderIds: [] },
    { id: 't2', name: 'José María', phone: '5511987654321', jid: '5511987654321@s.whatsapp.net', folderIds: [] },
    { id: 't3', name: 'Familia 🏠', jid: '120363000000000001@g.us', folderIds: [] },
    { id: 't4', name: 'Ana Gómez', email: 'ana@acme.com', folderIds: [] },
    { id: 't5', name: 'Ana Gómez', phone: '5215512345678', folderIds: [] },
    { id: 't6', name: 'Brasil viejo', phone: '551187654321', folderIds: [] },
  ];
  const idx = buildChatIndex(chats);
  const m = (ref: Parameters<typeof matchChat>[0]) => matchChat(ref, idx);

  it('teléfonos en cualquier formato (+54 9, 54 sin 9, 0 11 15, local)', () => {
    for (const phone of ['+54 9 11 5555-0001', '541155550001', '5411155555 0001'.replace(' ', ''), '1155550001', '005491155550001']) {
      expect(m({ label: phone, phone: phone.replace(/\D/g, '') }), phone).toMatchObject({ status: 'matched', id: 't1', by: 'phone' });
    }
    // México con y sin el 1; Brasil con y sin el 9.
    expect(m({ label: 'x', phone: '525512345678' })).toMatchObject({ status: 'matched', id: 't5' });
    expect(m({ label: 'x', phone: '551187654321' })).toMatchObject({ status: 'matched', id: 't6' });
    expect(m({ label: 'x', phone: '5511987654321' })).toMatchObject({ status: 'matched', id: 't2' });
    expect(phoneKeys('5511987654321')).toContain('~1187654321');
  });

  it('JID de persona (@c.us) y de grupo', () => {
    expect(m({ label: 'x', jid: '5491155550001@s.whatsapp.net' })).toMatchObject({ status: 'matched', id: 't1', by: 'jid' });
    expect(m({ label: 'x', jid: '120363000000000001@g.us' })).toMatchObject({ status: 'matched', id: 't3', by: 'jid' });
  });

  it('nombres sin tildes ni mayúsculas, con emoji y signos', () => {
    expect(m({ label: 'juan perez', name: 'juan perez' })).toMatchObject({ status: 'matched', id: 't1', by: 'name' });
    expect(m({ label: 'JOSE MARIA', name: 'JOSE MARIA' })).toMatchObject({ status: 'matched', id: 't2' });
    expect(m({ label: 'Familia', name: 'Familia' })).toMatchObject({ status: 'matched', id: 't3' });
  });

  it('dos con el mismo nombre: ambiguo, salvo por email o teléfono', () => {
    expect(m({ label: 'Ana Gómez', name: 'Ana Gómez' })).toMatchObject({ status: 'ambiguous' });
    expect(m({ label: 'Ana', name: 'Ana Gómez', email: 'ANA@acme.com' })).toMatchObject({ status: 'matched', id: 't4', by: 'email' });
  });

  it('sin coincidencia: los más parecidos', () => {
    const r = m({ label: 'Juan Peres', name: 'Juan Peres' });
    expect(r.status).toBe('unmatched');
    expect(r.status === 'unmatched' && r.closest.map((c) => c.name)).toEqual(['Juan Pérez']);
    expect(nameSimilarity('María José', 'Maria Jose')).toBe(1);
    expect(nameSimilarity('Pedro', 'Ana Gómez')).toBeLessThan(0.45);
  });
});

describe('carpetas desde JSON: plan', () => {
  const chats: ChatCandidate[] = [
    { id: 'c1', name: 'Ana', folderIds: ['old'] },
    { id: 'c2', name: 'Beto', folderIds: [] },
  ];
  const existing = [
    { id: 'old', name: 'Viejos', parentId: null },
    { id: 'cli', name: 'clientes', parentId: null },
  ];
  const normalized = normalizeFoldersJson({ Clientes: { VIP: ['Ana', 'Zoe'] }, Proveedores: ['Beto', 'Ana'] });

  it('Inbox: reusa por ruta, cuenta chats por carpeta y lista los no encontrados', () => {
    const plan = buildFoldersPlan({ target: 'inbox', normalized, existing, chats, removeFromOthers: false, maxDepth: 3, room: 10 });
    expect(plan.reused).toBe(1);
    expect(plan.toCreate).toBe(2);
    expect(plan.assign).toBe(3);
    expect(plan.unmatched.map((u) => u.chat)).toEqual(['Zoe']);
    expect(plan.removals).toEqual([]);
    const withRemoval = buildFoldersPlan({ target: 'inbox', normalized, existing, chats, removeFromOthers: true, maxDepth: 3, room: 10 });
    expect(withRemoval.removals).toEqual([{ chatId: 'c1', folderId: 'old' }]);
  });

  it('Lines: un chat en dos carpetas es un conflicto; en otra carpeta solo se mueve si se pidió', () => {
    const plan = buildFoldersPlan({ target: 'lines', normalized, existing, chats, removeFromOthers: false, maxDepth: 3, room: 10 });
    expect(plan.conflicts.map((c) => c.chat)).toEqual(['Ana']);
    expect(plan.assign).toBe(1);
    const single = normalizeFoldersJson({ Clientes: ['Ana'] });
    const kept = buildFoldersPlan({ target: 'lines', normalized: single, existing, chats, removeFromOthers: false, maxDepth: 3, room: 10 });
    expect(kept.moves).toHaveLength(1);
    expect(kept.assign).toBe(0);
    const moved = buildFoldersPlan({ target: 'lines', normalized: single, existing, chats, removeFromOthers: true, maxDepth: 3, room: 10 });
    expect(moved.assign).toBe(1);
  });

  it('demasiado hondas o sin lugar: no se crean y se dicen', () => {
    const deep = normalizeFoldersJson({ 'A/B/C/D/E': ['Ana'] });
    const plan = buildFoldersPlan({ target: 'inbox', normalized: deep, existing: [], chats, removeFromOthers: false, maxDepth: 3, room: 10 });
    expect(plan.tooDeep).toEqual(['A / B / C / D / E']);
    expect(plan.toCreate).toBe(4);
    const full = buildFoldersPlan({ target: 'inbox', normalized: deep, existing: [], chats, removeFromOthers: false, maxDepth: 3, room: 2 });
    expect(full.toCreate).toBe(2);
    expect(full.overLimit.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Con base: idempotencia, privacidad, falla parcial
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  setAssistantModelOverride(null);
  vi.unstubAllEnvs();
});

const owner = (u: { id: string }) => ({ ...u, role: 'owner', apps: '*' }) as unknown as SessionUser;

/** Un turno con el modelo de guion: pide el plan y devuelve la acción propuesta. */
async function planTurn(user: SessionUser, message: string, input: Record<string, unknown> = { target: 'inbox' }) {
  setAssistantModelOverride(scriptedModel([{ tool: 'propose_folders_from_json', input }, { text: 'Plan ready.' }]));
  const who = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
  const conv = await createConversation(who, 'carpetas');
  await addMessage(conv.id, 'user', message);
  const events: AssistantEvent[] = [];
  for await (const e of runAssistantTurn({ user, conversationId: conv.id, message, page: null, locale: 'es' })) events.push(e);
  const action = events.find((e): e is Extract<AssistantEvent, { type: 'action' }> => e.type === 'action')?.action ?? null;
  const result = events.find((e): e is Extract<AssistantEvent, { type: 'tool-result' }> => e.type === 'tool-result');
  return { action, result, who };
}

async function inboxWorld(label: string) {
  const u = await makeUser(label);
  const acc = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  const t = async (title: string, phone: string) => upsertThread(acc, { externalId: `${phone}@s.whatsapp.net`, kind: 'dm', title, handle: phone });
  const ana = await t('Ana Gómez', '5491155550101');
  const beto = await t('Beto Núñez', '5491155550102');
  const caro = await t('Caro', '5491155550103');
  return { u, acc, ana, beto, caro };
}

const folderRows = async (owner: string) =>
  (await getDb().prepare('SELECT id, name, parent_id FROM inbox_folders WHERE owner_id = ? ORDER BY name').all(owner)) as Array<{ id: string; name: string; parent_id: string | null }>;
const links = async (owner: string) =>
  ((await getDb().prepare('SELECT f.name, t.title FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id JOIN inbox_threads t ON t.id = tf.thread_id WHERE f.owner_id = ? ORDER BY f.name, t.title').all(owner)) as Array<{ name: string; title: string }>).map(
    (r) => `${r.name}:${r.title}`,
  );

describe('carpetas desde JSON en Inbox (con base)', () => {
  const json = JSON.stringify({ Clientes: { VIP: ['ana gomez', '+54 9 11 5555-0102'] }, Familia: ['Caro', 'Tío Desconocido'] });

  it('plan antes de escribir; confirmar crea y asigna; repetir no duplica nada', async () => {
    const w = await inboxWorld('fj-idem');
    const { action, result, who } = await planTurn(owner(w.u), `creá las carpetas: ${json}`);
    expect(action).not.toBeNull();
    // Nada escrito hasta confirmar.
    expect(await folderRows(w.u.id)).toEqual([]);
    expect(action!.summary).toBe('Crear 3 carpetas y poner 3 chats en Inbox');
    expect(action!.working).toBe('Creando 3 carpetas…');
    expect(action!.destructive).toBe(false);
    expect(action!.details.map((d) => d.label)).toEqual(expect.arrayContaining(['Carpetas nuevas (3)', 'No encontrados (1)']));
    // El modelo recibe el plan (sin ids) para explicarlo.
    expect(JSON.stringify(result?.output)).toContain('Tío Desconocido');
    expect(JSON.stringify(result?.output)).not.toContain(w.ana.id);

    const done = await decideAction({ user: owner(w.u), locale: 'es', id: action!.id, decision: 'confirm' });
    expect(done.action?.status).toBe('done');
    expect(await links(w.u.id)).toEqual(['Familia:Caro', 'VIP:Ana Gómez', 'VIP:Beto Núñez']);
    const vip = (await folderRows(w.u.id)).find((f) => f.name === 'VIP')!;
    expect((await folderRows(w.u.id)).find((f) => f.id === vip.parent_id)?.name).toBe('Clientes');

    // Otra vez el mismo JSON: no hay nada que hacer (sin tarjeta).
    const again = await planTurn(owner(w.u), json);
    expect(again.action).toBeNull();
    expect(JSON.stringify(again.result?.output)).toContain('nothing_to_do');
    expect(await folderRows(w.u.id)).toHaveLength(3);
    expect(await getAction(who, action!.id)).toMatchObject({ status: 'done' });
  });

  it('confirmar dos veces la misma acción no la corre dos veces; el importador y el asistente comparten carpetas', async () => {
    const w = await inboxWorld('fj-twice');
    const { action } = await planTurn(owner(w.u), JSON.stringify([{ name: 'Trabajo', chats: ['Ana Gómez'] }]));
    const [a, b] = await Promise.all([
      decideAction({ user: owner(w.u), locale: 'en', id: action!.id, decision: 'confirm' }),
      decideAction({ user: owner(w.u), locale: 'en', id: action!.id, decision: 'confirm' }),
    ]);
    expect([a, b].filter((r) => 'error' in r && r.error === 'not_pending')).toHaveLength(1);
    // El importador reusa "Trabajo" (misma ruta) en vez de crear otra.
    await importPart(w.u.id, { part: 'meta', format: 'inbox-zero-export', version: 1, folders: [{ id: 9, name: 'trabajo', color: '', icon: '', position: 0, parentId: null }], chatFolders: [], chats: [], scheduled: [], drafts: [], snoozes: [], notes: [] });
    expect((await folderRows(w.u.id)).map((f) => f.name)).toEqual(['Trabajo']);
  });

  it('privacidad: solo los chats de la persona real, nunca los del dueño del workspace', async () => {
    const w = await inboxWorld('fj-priv');
    const member = await makeUser('fj-member');
    const as = { ...w.u, actingUser: member, role: 'member', apps: '*' } as unknown as SessionUser;
    const { action, result } = await planTurn(as, JSON.stringify({ Clientes: ['Ana Gómez'] }));
    // El chat de Ana es del dueño: para el member no existe (la carpeta, en su propio Inbox, sí se puede crear).
    expect(action!.summary).toBe('Crear 1 carpeta en Inbox');
    expect(action!.details.find((d) => d.label === 'No encontrados (1)')?.after).toContain('Ana Gómez');
    expect(JSON.stringify(result?.output)).not.toContain(w.ana.id);
    await decideAction({ user: as, locale: 'es', id: action!.id, decision: 'confirm' });
    expect((await folderRows(member.id)).map((f) => f.name)).toEqual(['Clientes']);
    expect(await links(member.id)).toEqual([]);
    expect(await folderRows(w.u.id)).toEqual([]);
  });

  it('el JSON adjunto o pegado antes en la charla también sirve; un JSON sin carpetas pide aclarar', async () => {
    const w = await inboxWorld('fj-src');
    const user = owner(w.u);
    setAssistantModelOverride(scriptedModel([{ tool: 'propose_folders_from_json', input: { target: 'inbox' } }, { text: 'ok' }]));
    const who = { workspaceId: user.id, personId: user.id };
    const conv = await createConversation(who, 'x');
    await addMessage(conv.id, 'user', JSON.stringify({ Socios: ['Caro'] }));
    await addMessage(conv.id, 'assistant', '¿Querés que cree las carpetas?');
    await addMessage(conv.id, 'user', 'sí, crealas');
    const events: AssistantEvent[] = [];
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'sí, crealas', page: null, locale: 'en' })) events.push(e);
    expect(events.some((e) => e.type === 'action')).toBe(true);

    const bad = await planTurn(user, '{"a": 1, "b": [true]}');
    expect(bad.action).toBeNull();
    expect(JSON.stringify(bad.result?.output)).toContain('no_folders');
  });

  it('chats nuevos solo si se pidió; sacar de otras carpetas es destructivo y se confirma con el botón', async () => {
    const w = await inboxWorld('fj-new');
    const json2 = JSON.stringify({ Clientes: [{ name: 'Nuevo', jid: '5491166660000@c.us' }, 'Ana Gómez'] });
    const plain = await planTurn(owner(w.u), json2);
    expect(plain.action!.details.find((d) => d.label.startsWith('Chats nuevos'))).toBeUndefined();
    await decideAction({ user: owner(w.u), locale: 'es', id: plain.action!.id, decision: 'cancel' });
    const withNew = await planTurn(owner(w.u), json2, { target: 'inbox', createMissingChats: true });
    expect(withNew.action!.details.find((d) => d.label.startsWith('Chats nuevos'))?.after).toContain('Nuevo');
    await decideAction({ user: owner(w.u), locale: 'es', id: withNew.action!.id, decision: 'confirm' });
    expect(await links(w.u.id)).toEqual(['Clientes:Ana Gómez', 'Clientes:Nuevo']);

    const move = await planTurn(owner(w.u), JSON.stringify({ Otros: ['Ana Gómez'] }), { target: 'inbox', removeFromOtherFolders: true });
    expect(move.action!.destructive).toBe(true);
    expect(move.action!.confirmText).toBeNull();
    const r = await decideAction({ user: owner(w.u), locale: 'es', id: move.action!.id, decision: 'confirm' });
    expect(r.action?.status).toBe('done');
    expect(await links(w.u.id)).toEqual(['Clientes:Nuevo', 'Otros:Ana Gómez']);
  });

  it('falla parcial: lo que se pudo queda, el mensaje dice qué faltó y repetir completa', async () => {
    const w = await inboxWorld('fj-partial');
    const { action } = await planTurn(owner(w.u), JSON.stringify({ Uno: ['Ana Gómez'], Dos: ['Caro'] }));
    // Entre el plan y la confirmación alguien borra el chat de Caro: esa carpeta queda vacía y no rompe la otra.
    await getDb().prepare('DELETE FROM inbox_threads WHERE id = ?').run(w.caro.id);
    const r = await decideAction({ user: owner(w.u), locale: 'en', id: action!.id, decision: 'confirm' });
    expect(r.action?.status).toBe('done');
    expect(await links(w.u.id)).toEqual(['Uno:Ana Gómez']);
    // Simulamos una falla real al asignar: la tabla de asignaciones no acepta escrituras por un momento.
    const { action: a2 } = await planTurn(owner(w.u), JSON.stringify({ Tres: ['Beto Núñez'] }));
    await getDb().exec('CREATE TRIGGER fj_block BEFORE INSERT ON inbox_thread_folders BEGIN SELECT RAISE(ABORT, \'blocked\'); END;');
    try {
      const r2 = await decideAction({ user: owner(w.u), locale: 'en', id: a2!.id, decision: 'confirm' });
      expect(r2.action?.result).toMatchObject({ ok: true, partial: true });
      expect(r2.action?.result?.message).toMatch(/Could not finish: Tres .*try again/);
    } finally {
      await getDb().exec('DROP TRIGGER fj_block');
    }
    // Reintento: el mismo JSON, solo lo que falta (la carpeta ya existe, el chat se suma).
    const retry = await planTurn(owner(w.u), JSON.stringify({ Tres: ['Beto Núñez'] }));
    expect(retry.action!.summary).toBe('Poner 1 chat en carpetas de Inbox');
    await decideAction({ user: owner(w.u), locale: 'en', id: retry.action!.id, decision: 'confirm' });
    expect(await links(w.u.id)).toEqual(['Tres:Beto Núñez', 'Uno:Ana Gómez']);
  });
});

describe('carpetas desde JSON en Lines (con base)', () => {
  async function linesWorld(label: string) {
    const ws = await makeUser(`${label}-ws`);
    const n = await createNumber(ws.id, ws.id, { provider: 'fake', name: 'Ventas' });
    await connectNumber(ws.id, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    const line = (await getNumberRowById(n.id))!;
    const msg = (phone: string, name: string) => ({ type: 'message' as const, chatId: `${phone}@c.us`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `m-${phone}`, body: 'hola' });
    await ingestEvents(line, [msg('5491100000201', 'Cliente Uno'), msg('5491100000202', 'Cliente Dos')]);
    const chats = (await listChats(ws.id, ws.id)).rows;
    return { ws, line, uno: chats.find((c) => c.name === 'Cliente Uno')!, dos: chats.find((c) => c.name === 'Cliente Dos')! };
  }

  it('crea carpetas compartidas, mueve solo los que no tienen carpeta y repetir no duplica', async () => {
    const w = await linesWorld('fj-lines');
    const user = owner(w.ws);
    const old = await createLineFolder(w.ws.id, w.ws.id, { name: 'Viejos' });
    await moveChatsToFolder(w.ws.id, await groupsViewer(w.ws.id, w.ws.id, 'owner'), [w.dos.id], old.id);
    const json = JSON.stringify({ Clientes: { Activos: ['+54 9 11 0000-0201', 'Cliente Dos'] } });
    const { action } = await planTurn(user, json, { target: 'lines' });
    expect(action!.details.some((d) => d.label.startsWith('Ya están en otra carpeta (1)'))).toBe(true);
    await decideAction({ user, locale: 'es', id: action!.id, decision: 'confirm' });
    const folder = (await getDb().prepare('SELECT c.name AS chat, f.name AS folder FROM groups_chats c LEFT JOIN groups_folders f ON f.id = c.folder_id WHERE c.user_id = ? ORDER BY c.name').all(w.ws.id)) as Array<{ chat: string; folder: string }>;
    expect(folder).toEqual([
      { chat: 'Cliente Dos', folder: 'Viejos' },
      { chat: 'Cliente Uno', folder: 'Activos' },
    ]);
    const again = await planTurn(user, json, { target: 'lines' });
    expect(again.action).toBeNull();
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_folders WHERE user_id = ?').get(w.ws.id)) as { n: number }).n).toBe(3);
    // Crear chats en Lines: todavía no (lo dice, no falla en silencio).
    const notYet = await planTurn(user, JSON.stringify({ Clientes: ['Alguien Nuevo'] }), { target: 'lines', createMissingChats: true });
    expect(JSON.stringify(notYet.result?.output)).toContain('not available yet');
  });

  it('un member sin acceso a la línea no ve sus chats en el plan', async () => {
    const w = await linesWorld('fj-lines-priv');
    const { createTeam } = await import('@/lib/teams');
    const team = (await createTeam(w.ws.id, 'WS')).id;
    const outsider = await makeUser('fj-outsider');
    await addMember(team, outsider.id, 'member');
    const { setLineAccess } = await import('@/lib/groups-lines');
    await setLineAccess(w.ws.id, w.line.id, { visibility: 'restricted', personIds: [] });
    const as = { ...w.ws, actingUser: outsider, role: 'member', apps: '*' } as unknown as SessionUser;
    const { action, result } = await planTurn(as, JSON.stringify({ Clientes: ['Cliente Uno'] }), { target: 'lines' });
    // La carpeta se puede crear (las carpetas son del workspace), pero el chat no aparece.
    expect(action!.details.find((d) => d.label.startsWith('No encontrados'))?.after).toContain('Cliente Uno');
    expect(JSON.stringify(result?.output)).not.toContain(w.uno.id);
  });
});

describe('carpetas desde JSON: volumen', () => {
  it('20.000 chats y 2.000 no encontrados arman el plan rápido', () => {
    const chats: ChatCandidate[] = Array.from({ length: 20_000 }, (_, i) => ({ id: `t${i}`, name: `Contacto ${i}`, phone: `5491100${String(i).padStart(6, '0')}`, folderIds: [] }));
    const json = { Clientes: [...Array.from({ length: 3000 }, (_, i) => `+54 9 11 00${String(i).padStart(6, '0')}`), ...Array.from({ length: 2000 }, (_, i) => `Nadie ${i}`)] };
    const t0 = Date.now();
    const plan = buildFoldersPlan({ target: 'inbox', normalized: normalizeFoldersJson(json), existing: [], chats, removeFromOthers: false, maxDepth: 3, room: 10 });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(plan.assign).toBe(3000);
    expect(plan.unmatched).toHaveLength(2000);
  });
});

describe('carpetas desde JSON: chats nuevos', () => {
  it('solo con código de país; en Argentina con el 9 de los celulares', () => {
    expect(newChatJid('+54 11 5555 0001')).toBe('5491155550001@s.whatsapp.net');
    expect(newChatJid('+54 9 11 5555 0001')).toBe('5491155550001@s.whatsapp.net');
    expect(newChatJid('+1 415 555 1234')).toBe('14155551234@s.whatsapp.net');
    expect(newChatJid('11 5555 0001')).toBeNull();
    expect(newChatJid(undefined)).toBeNull();
  });
});
