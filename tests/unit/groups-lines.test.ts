import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, createPropertyDef, disconnectNumber, getNumberRowById, ingestEvents, listChats, listLabels, listMessages, listQuickReplies, sendMessage, updateChat, updateNumber } from '@/lib/groups';
import { autoAssignChat, createRule, createTeam as createGroupsTeam, listRules, setAvailability } from '@/lib/groups-inbox';
import { canSeeChat, chatAccessSql, groupsViewer, setLabelAccess, updatePlatformSettings, viewerFrom } from '@/lib/groups-access';
import { assignmentHistory, chatLines, listLines, peopleWithLine, resolveReplyChat, setLineAccess, siblingChats, teamOverview } from '@/lib/groups-lines';
import { availableFor, lineColor, pickReplyLine, type ReplyLine } from '@/lib/groups-lines-shared';
import { importPeriskope, labelColorFrom, mapHeader, splitList } from '@/lib/groups-periskope';
import { listAudit } from '@/lib/groups-audit';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function addLine(ws: string, name: string, phone: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  // El falso queda conectado al pedir el estado; acá se marca directo.
  await getDb().prepare("UPDATE groups_numbers SET phone = ?, status = 'connected' WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

async function setup(label: string) {
  const user = await makeUser(label);
  const a = await addLine(user.id, 'Ventas', '5491100000001');
  const b = await addLine(user.id, 'Soporte', '5491100000002');
  return { user, a, b };
}

/** Persona del workspace con rol member. */
async function addTeammate(ownerId: string, label: string, role: 'member' | 'admin' = 'member') {
  const mate = await makeUser(label);
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  const teamId = team?.id ?? crypto.randomUUID();
  if (!team) await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', ownerId);
  await db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, mate.id, role);
  return mate;
}

const inbound = (chatId: string, id: string, body: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? 'Clientes' : undefined,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
  ...extra,
});

describe('vistas por línea (funciones puras)', () => {
  it('color fijo por id y el elegido si es válido', () => {
    expect(lineColor({ id: 'x' })).toBe(lineColor({ id: 'x' }));
    expect(lineColor({ id: 'x', color: '#123456' })).toBe('#123456');
    expect(lineColor({ id: 'x', color: 'rojo' })).toMatch(/^#/);
  });

  it('disponibilidad de una regla', () => {
    expect(availableFor('online', undefined)).toBe(true);
    expect(availableFor('online', 'away')).toBe(false);
    expect(availableFor('online_away', 'away')).toBe(true);
    expect(availableFor('online_away', 'offline')).toBe(false);
    expect(availableFor('any', 'offline')).toBe(true);
  });

  it('elige la línea guardada, si no la del chat, si no la primera que envía', () => {
    const l = (numberId: string, canSend: boolean, isDefault = false): ReplyLine => ({ chatId: numberId, numberId, name: numberId, phone: '', color: '#000000', status: 'connected', canSend, isDefault });
    expect(pickReplyLine([l('a', true, true), l('b', true)], 'b')?.numberId).toBe('b');
    expect(pickReplyLine([l('a', true, true), l('b', true)], 'z')?.numberId).toBe('a');
    expect(pickReplyLine([l('a', false, true), l('b', true)])?.numberId).toBe('b');
  });

  it('un viewer member con acceso por línea y sin líneas no ve nada', () => {
    const v = viewerFrom('w', 'm', 'member', { labelAccess: false, maskRoles: [], lineAccess: true, teamAccess: false, reassignOnOffline: false });
    expect(v).toMatchObject({ restricted: true, lineIds: [] });
    expect(chatAccessSql(v)?.sql).toContain('0');
    const admin = viewerFrom('w', 'a', 'admin', { labelAccess: true, maskRoles: [], lineAccess: true, teamAccess: true, reassignOnOffline: false });
    expect(admin.restricted).toBe(false);
    expect(chatAccessSql(admin)).toBeNull();
  });
});

describe('acceso por línea y por equipo', () => {
  it('un miembro nunca ve la línea de otro equipo, ni asignado ni con etiqueta', async () => {
    const { user, a, b } = await setup('ln-access');
    const ventas = await addTeammate(user.id, 'ln-ventas');
    const soporte = await addTeammate(user.id, 'ln-soporte');
    const teamV = await createGroupsTeam(user.id, { name: 'Ventas', memberIds: [ventas.id] });
    await ingestEvents(a, [inbound('5491100000101@c.us', 'LA-1', 'hola ventas')]);
    await ingestEvents(b, [inbound('5491100000102@c.us', 'LB-1', 'hola soporte')]);
    const all = (await listChats(user.id, user.id)).rows;
    const chatA = all.find((c) => c.numberId === a.id)!;
    const chatB = all.find((c) => c.numberId === b.id)!;

    // Línea A para el equipo Ventas, línea B para la persona de soporte.
    await setLineAccess(user.id, user.id, a.id, { teamIds: [teamV.id] });
    await setLineAccess(user.id, user.id, b.id, { personIds: [soporte.id] });
    // Sin el ajuste: todos ven todo.
    expect((await listChats(user.id, ventas.id, { viewer: await groupsViewer(user.id, ventas.id, 'member') })).rows).toHaveLength(2);
    await updatePlatformSettings(user.id, { lineAccess: true });

    const vV = await groupsViewer(user.id, ventas.id, 'member');
    expect((await listChats(user.id, ventas.id, { viewer: vV })).rows.map((c) => c.id)).toEqual([chatA.id]);
    expect(await canSeeChat(vV, chatB.id)).toBe(false);
    // Etiqueta con acceso por etiqueta: el corte de línea manda igual.
    const vip = await createLabel(user.id, { name: 'VIP' });
    await updateChat(user.id, chatB.id, { labelIds: [vip.id] });
    await setLabelAccess(user.id, vip.id, [ventas.id]);
    await updatePlatformSettings(user.id, { labelAccess: true });
    expect(await canSeeChat(await groupsViewer(user.id, ventas.id, 'member'), chatB.id)).toBe(false);
    // Asignarle un chat de una línea que no ve: no se puede.
    await expect(updateChat(user.id, chatB.id, { assignedTo: ventas.id })).rejects.toThrow('assignee_no_line_access');
    expect([...((await peopleWithLine(user.id, b.id)) ?? [])].sort()).toEqual([user.id, soporte.id].sort());

    const vS = await groupsViewer(user.id, soporte.id, 'member');
    expect(await canSeeChat(vS, chatA.id)).toBe(false);
    // El admin y el dueño ven todo.
    expect((await listChats(user.id, user.id, { viewer: await groupsViewer(user.id, user.id, 'owner') })).rows).toHaveLength(2);
    // Las líneas que lista un miembro son solo las suyas.
    expect((await listLines(user.id, vV)).map((l) => l.id)).toEqual([a.id]);
    // Auditoría del cambio de acceso.
    expect((await listAudit(user.id, { action: 'line_access' })).length).toBeGreaterThanOrEqual(2);
  });

  it('acceso por equipo: ve lo asignado a su equipo y lo suyo', async () => {
    const { user, a } = await setup('ln-team');
    const m = await addTeammate(user.id, 'ln-team-m');
    const team = await createGroupsTeam(user.id, { name: 'Cuentas', memberIds: [m.id] });
    await ingestEvents(a, [inbound('5491100000201@c.us', 'T-1', 'uno'), inbound('5491100000202@c.us', 'T-2', 'dos')]);
    const rows = (await listChats(user.id, user.id)).rows;
    await updateChat(user.id, rows[0].id, { assignedTeamId: team.id });
    await updatePlatformSettings(user.id, { teamAccess: true });
    const v = await groupsViewer(user.id, m.id, 'member');
    expect((await listChats(user.id, m.id, { viewer: v })).rows.map((c) => c.id)).toEqual([rows[0].id]);
    const people = await teamOverview(user.id);
    expect(people.find((p) => p.id === m.id)).toMatchObject({ role: 'member', teamIds: [team.id], lineIds: 'all' });
    expect(people.find((p) => p.id === user.id)?.role).toBe('owner');
  });
});

describe('el mismo chat en dos líneas', () => {
  it('se lista una vez, el hilo junta sin repetidos y se responde desde la línea elegida', async () => {
    const { user, a, b } = await setup('ln-merge');
    const g = '120363000000001@g.us';
    await ingestEvents(a, [inbound(g, 'G-1', 'hola a todos')]);
    // El mismo mensaje llega por la otra línea (mismo id de WhatsApp) y uno más solo por B.
    await ingestEvents(b, [inbound(g, 'G-1', 'hola a todos'), inbound(g, 'G-2', 'segundo')]);
    const { rows, total } = await listChats(user.id, user.id);
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].lines?.map((l) => l.numberId).sort()).toEqual([a.id, b.id].sort());
    expect(rows[0].unread).toBe(3);
    // Sin juntar: una fila por línea.
    expect((await listChats(user.id, user.id, { merge: false })).rows).toHaveLength(2);
    // Filtro por línea.
    expect((await listChats(user.id, user.id, { numberId: a.id })).rows[0].numberId).toBe(a.id);

    const open = rows[0].id;
    const sibs = (await siblingChats(user.id, null, open)).map((c) => c.id);
    const thread = await listMessages(user.id, open, { chatIds: sibs });
    expect(thread.filter((m) => m.direction === 'in').map((m) => m.body)).toEqual(['hola a todos', 'segundo']);

    const lines = await chatLines(user.id, null, open);
    expect(lines.map((l) => l.numberId).sort()).toEqual([a.id, b.id].sort());
    expect(lines.find((l) => l.isDefault)?.chatId).toBe(open);
    const other = lines.find((l) => !l.isDefault)!;
    const target = await resolveReplyChat(user.id, null, open, other.numberId);
    expect(target).toBe(other.chatId);
    const sent = await sendMessage(user.id, user.id, target, { body: 'respondo desde la otra' });
    expect(sent.chatId).toBe(other.chatId);
    expect(fakeSent(other.numberId).some((s) => s.text === 'respondo desde la otra')).toBe(true);
    expect(fakeSent(lines.find((l) => l.isDefault)!.numberId).some((s) => s.text === 'respondo desde la otra')).toBe(false);
    // Leer el chat lee las dos líneas.
    await updateChat(user.id, open, { read: true });
    expect((await listChats(user.id, user.id)).rows[0].unread).toBe(0);
  });

  it('un 1:1 se puede responder desde otra línea (crea el chat en esa línea); un grupo no', async () => {
    const { user, a, b } = await setup('ln-dm');
    await ingestEvents(a, [inbound('5491100000301@c.us', 'D-1', 'hola')]);
    await ingestEvents(a, [inbound('120363000000002@g.us', 'D-2', 'grupo')]);
    const rows = (await listChats(user.id, user.id)).rows;
    const dm = rows.find((c) => c.kind === 'dm')!;
    const group = rows.find((c) => c.kind === 'group')!;
    const lines = await chatLines(user.id, null, dm.id);
    expect(lines.find((l) => l.numberId === b.id)).toMatchObject({ chatId: '', canSend: true });
    const created = await resolveReplyChat(user.id, null, dm.id, b.id);
    expect(created).not.toBe(dm.id);
    expect((await listChats(user.id, user.id)).rows.filter((c) => c.kind === 'dm')).toHaveLength(1);
    await expect(resolveReplyChat(user.id, null, group.id, b.id)).rejects.toThrow('line_not_in_chat');
    // Una línea desconectada no responde.
    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(b.id);
    await expect(resolveReplyChat(user.id, null, dm.id, b.id)).rejects.toThrow('line_disconnected');
  });

  it('quién mandó cada saliente y lo mandado desde el teléfono', async () => {
    const { user, a } = await setup('ln-sender');
    await ingestEvents(a, [inbound('5491100000401@c.us', 'S-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await sendMessage(user.id, user.id, chat.id, { body: 'desde groups' });
    await ingestEvents(a, [inbound('5491100000401@c.us', 'S-2', 'desde el celu', { fromMe: true })]);
    const msgs = await listMessages(user.id, chat.id);
    const mine = msgs.find((m) => m.body === 'desde groups')!;
    expect(mine).toMatchObject({ authorId: user.id, fromPhone: false, numberId: a.id });
    expect(mine.authorName).toBeTruthy();
    expect(msgs.find((m) => m.body === 'desde el celu')).toMatchObject({ fromPhone: true, authorName: '' });
  });
});

describe('líneas: estado y color', () => {
  it('guarda el color y cuándo cambió el estado; avisa si se cae', async () => {
    const { user, a } = await setup('ln-health');
    await updateNumber(user.id, a.id, { color: '#27AE60' });
    await expect(updateNumber(user.id, a.id, { color: 'verde' })).rejects.toThrow('invalid_color');
    await ingestEvents(a, [inbound('5491100000501@c.us', 'H-1', 'hola')]);
    const [line] = (await listLines(user.id, null, { withAccess: true })).filter((l) => l.id === a.id);
    expect(line).toMatchObject({ color: '#27ae60', displayColor: '#27ae60', openChats: 1, access: { personIds: [], teamIds: [] } });
    expect(line.lastMessageAt).toBeTruthy();
    expect(line.statusAt).toBeTruthy();
    // Se cae: queda en la auditoría y el dueño recibe un aviso.
    await disconnectNumber(user.id, a.id);
    expect((await listAudit(user.id, { action: 'line_status' })).some((e) => (e.detail as { to?: string }).to === 'disconnected')).toBe(true);
    const n = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'groups_line'").get(user.id)) as { title: string } | undefined;
    expect(n?.title).toContain('Ventas');
  });
});

describe('asignación: disponibilidad, líneas, reasignar e historial', () => {
  it('online, ausente y desconectado; nunca a quien no ve la línea', async () => {
    const { user, a, b } = await setup('ln-rr');
    const eva = await addTeammate(user.id, 'ln-eva');
    const fede = await addTeammate(user.id, 'ln-fede');
    await createRule(user.id, { name: 'Todos', personIds: [eva.id, fede.id], availability: 'online_away' });
    expect((await listRules(user.id))[0].availability).toBe('online_away');
    await setAvailability(user.id, eva.id, 'away');
    await setAvailability(user.id, fede.id, 'offline');
    await ingestEvents(a, [inbound('5491100000601@c.us', 'R-1', 'uno')]);
    const c1 = (await listChats(user.id, user.id)).rows[0];
    expect(c1.assignedTo).toBe(eva.id);

    // Acceso por línea: la línea B es solo de Fede; Eva no la ve, así que espera a Fede.
    await setLineAccess(user.id, user.id, b.id, { personIds: [fede.id] });
    await setLineAccess(user.id, user.id, a.id, { personIds: [eva.id, fede.id] });
    await updatePlatformSettings(user.id, { lineAccess: true, reassignOnOffline: true });
    await ingestEvents(b, [inbound('5491100000602@c.us', 'R-2', 'dos')]);
    const c2 = (await listChats(user.id, user.id, { numberId: b.id })).rows[0];
    expect(c2.assignedTo).toBeNull();
    await setAvailability(user.id, fede.id, 'online');
    expect((await listChats(user.id, user.id, { numberId: b.id })).rows[0].assignedTo).toBe(fede.id);

    // Eva se desconecta: su chat sin responder vuelve a la rotación y va a Fede.
    await setAvailability(user.id, eva.id, 'offline');
    expect((await listChats(user.id, user.id, { numberId: a.id })).rows[0].assignedTo).toBe(fede.id);
    const history = await assignmentHistory(user.id, null, c1.id);
    expect(history.map((h) => h.event)).toEqual(['auto_assigned', 'reassigned', 'auto_assigned']);
    expect(history[1]).toMatchObject({ event: 'reassigned' });
    expect((await listAudit(user.id, { action: 'reassigned' })).length).toBe(1);
    expect((await listAudit(user.id, { action: 'availability' })).length).toBeGreaterThan(0);
    // Aviso en la app a quien recibe.
    const notes = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND source_type = 'groups_chat'").get(fede.id)) as { n: number };
    expect(Number(notes.n)).toBeGreaterThan(0);
    expect(await autoAssignChat(user.id, c1.id)).toBeNull();
  });
});

describe('importar desde Periskope', () => {
  it('lee encabezados con alias, colores y listas', () => {
    const { cols, extra } = mapHeader(['Chat ID', 'Chat Name', 'Chat Type', 'Org Phone', 'Labels', 'Assigned To', 'Plan'], ['chatId', 'chatName', 'chatType', 'orgPhone', 'labels', 'assignee']);
    expect(cols).toEqual({ chatId: 0, chatName: 1, chatType: 2, orgPhone: 3, labels: 4, assignee: 5 });
    expect(extra.map((e) => e.name)).toEqual(['Plan']);
    expect(splitList('VIP, Soporte;VIP | Ventas')).toEqual(['VIP', 'Soporte', 'Ventas']);
    expect(labelColorFrom('#eb5757')).toBe('red');
    expect(labelColorFrom('#2f80ed')).toBe('blue');
    expect(labelColorFrom('green')).toBe('green');
    expect(labelColorFrom('')).toBe('gray');
  });

  it('etiquetas, respuestas rápidas y chats (con vista previa que no escribe)', async () => {
    const { user, a } = await setup('ln-psk');
    const eva = await addTeammate(user.id, 'ln-psk-eva');
    const evaEmail = ((await getDb().prepare('SELECT email FROM users WHERE id = ?').get(eva.id)) as { email: string }).email;
    await createPropertyDef(user.id, { label: 'Plan', type: 'text' });

    const labelsCsv = 'Name,Color\nVIP,#eb5757\nSoporte,#2f80ed\n';
    const preview = await importPeriskope(user.id, user.id, 'labels', labelsCsv, { dryRun: true });
    expect(preview).toMatchObject({ applied: 2, created: { labels: 2 } });
    expect(await listLabels(user.id)).toHaveLength(0);
    await importPeriskope(user.id, user.id, 'labels', labelsCsv);
    expect((await listLabels(user.id)).map((l) => [l.name, l.color]).sort()).toEqual([['Soporte', 'blue'], ['VIP', 'red']]);

    const qr = await importPeriskope(user.id, user.id, 'quick_replies', 'Command,Message\n/hola,"Hola, ¿cómo estás?"\n/hola,repetida\n,sin comando\n');
    expect(qr.applied).toBe(1);
    expect(qr.issues.map((i) => i.reason)).toEqual(['exists', 'invalid_shortcut']);
    expect((await listQuickReplies(user.id))[0]).toMatchObject({ shortcut: 'hola', body: 'Hola, ¿cómo estás?' });

    await ingestEvents(a, [inbound('120363000000777@g.us', 'P-1', 'hola'), inbound('5491100000701@c.us', 'P-2', 'hola')]);
    const chatsCsv = [
      'Chat ID,Chat Name,Chat Type,Org Phone,Labels,Assigned To,Plan,Otra',
      `120363000000777@g.us,Clientes,group,+54 9 11 0000-0001,"VIP, Nueva",${evaEmail},Pro,x`,
      '5491100000701@c.us,Juan,user,5491100000001,Soporte,,Basic,',
      '999@g.us,No existe,group,,,,,',
      '5491100000701@c.us,Juan,user,5491199999999,,,,',
    ].join('\n');
    const res = await importPeriskope(user.id, user.id, 'chats', chatsCsv);
    expect(res.applied).toBe(2);
    expect(res.issues.map((i) => i.reason).sort()).toEqual(['chat_not_found', 'unknown_line']);
    expect(res.ignoredColumns).toEqual(['Otra']);
    const rows = (await listChats(user.id, user.id)).rows;
    const g = rows.find((c) => c.kind === 'group')!;
    expect(g.labels.map((l) => l.name).sort()).toEqual(['Nueva', 'VIP']);
    expect(g.assignedTo).toBe(eva.id);
    expect(g.properties).toMatchObject({ plan: 'Pro' });
    const dm = rows.find((c) => c.kind === 'dm')!;
    expect(dm.labels.map((l) => l.name)).toEqual(['Soporte']);
    expect((await listAudit(user.id, { action: 'imported' })).length).toBe(3);

    const contacts = await importPeriskope(user.id, user.id, 'contacts', 'Phone,Name,Labels\n+54 9 11 0000-0701,Juan,VIP\n123,Nadie,\n');
    expect(contacts.applied).toBe(1);
    expect((await listChats(user.id, user.id)).rows.find((c) => c.kind === 'dm')!.labels.map((l) => l.name).sort()).toEqual(['Soporte', 'VIP']);
    const missing = await importPeriskope(user.id, user.id, 'chats', 'Foo,Bar\n1,2\n');
    expect(missing.issues[0].reason).toBe('missing_column:chatId');
  });
});
