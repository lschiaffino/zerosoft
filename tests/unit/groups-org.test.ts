import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createTeam, addMember } from '@/lib/teams';
import { inviteCodeFrom, type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeGroupState, fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import {
  connectNumber,
  createLabel,
  createNumber,
  createPropertyDef,
  getChat,
  getNumberRowById,
  ingestEvents,
  isTreePath,
  listChats,
  listMembers,
  listMessages,
  parseTreeText,
  updateChat,
  updatePropertyDef,
  updateSettings,
  type PropertyFilter,
} from '@/lib/groups';
import { looksLikeQuestion, normalizeSettings, parseEmails } from '@/lib/groups-rules';
import {
  createFromTemplate,
  createSavedList,
  createTemplate,
  deleteSavedList,
  joinGroup,
  leaveGroup,
  listSavedLists,
  listQuery,
  parseTemplateCsv,
  renderTemplate,
  savedListChatIds,
  templateVariables,
  updateGroupSettings,
  updateSavedList,
} from '@/lib/groups-org';
import { createTicket, listTickets, markBreachedTickets, updateTicket } from '@/lib/groups-tickets';
import { createGroupTask, fireTaskReminders, listGroupTasks, updateGroupTask } from '@/lib/groups-tasks';
import { flagInbound } from '@/lib/groups-flag';
import { searchApps } from '@/lib/app-search';
import { makeUser } from './helpers';

const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (o: { to: string; subject: string; text: string }) => {
    mail.sent.push(o);
    return { ok: true, provider: 'test' };
  },
}));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('VERCEL_OIDC_TOKEN', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('GROUPS_AI_FAKE', '');
  resetFakeProvider();
  mail.sent.length = 0;
});

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, method: String(init.method ?? 'GET'), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(handler(url, init) ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

const inbound = (chatId: string, id: string, body: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
  ...extra,
});

async function chatOf(ws: string, providerId: string) {
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND provider_chat_id = ?').get(ws, providerId)) as { id: string };
  return r.id;
}

// ======================================================================
// Proveedores
// ======================================================================

describe('ajustes de grupo, entrar y salir en los gateways', () => {
  const cfg = { baseUrl: 'https://gw.example.com', apiKey: 'k', session: 'acme' };
  const gid = '120363000000000001@g.us';

  it('WAHA: solo admins escriben o editan, foto, entrar y salir', async () => {
    const { f, calls } = mockFetch((url) => (url.endsWith('/groups/join') ? { id: '120363999@g.us' } : {}));
    const p = wahaProvider(cfg, { fetch: f });
    await p.updateGroupSettings(gid, { announce: true, locked: false });
    await p.setGroupPicture(gid, { url: 'https://cdn.example.com/a.png', mimetype: 'image/png' });
    await p.setGroupPicture(gid, null);
    expect(await p.joinGroup('AbCdEf123')).toEqual({ id: '120363999@g.us' });
    await p.leaveGroup(gid);
    const g = encodeURIComponent(gid);
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://gw.example.com', '')}`)).toEqual([
      `PUT /api/acme/groups/${g}/settings/security/info-admin-only`,
      `PUT /api/acme/groups/${g}/settings/security/messages-admin-only`,
      `PUT /api/acme/groups/${g}/picture`,
      `DELETE /api/acme/groups/${g}/picture`,
      'POST /api/acme/groups/join',
      `POST /api/acme/groups/${g}/leave`,
    ]);
    expect(calls[0].body).toEqual({ adminsOnly: false });
    expect(calls[1].body).toEqual({ adminsOnly: true });
    expect(calls[2].body).toEqual({ file: { url: 'https://cdn.example.com/a.png', mimetype: 'image/png' } });
    expect(calls[4].body).toEqual({ code: 'AbCdEf123' });
    await expect(p.updateGroupSettings(gid, { ephemeral: 86_400 })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('Evolution: updateSetting, mensajes temporales, foto, acceptInviteCode y leaveGroup', async () => {
    const { f, calls } = mockFetch((url) => (url.includes('acceptInviteCode') ? { accepted: true, groupJid: '120363777@g.us' } : {}));
    const p = evolutionProvider(cfg, { fetch: f });
    await p.updateGroupSettings(gid, { announce: true, locked: true, ephemeral: 604_800 });
    await p.setGroupPicture(gid, { url: 'https://cdn.example.com/a.png', mimetype: 'image/png' });
    expect(await p.joinGroup('AbCdEf123')).toEqual({ id: '120363777@g.us' });
    await p.leaveGroup(gid);
    const q = `?groupJid=${encodeURIComponent(gid)}`;
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://gw.example.com', '')}`)).toEqual([
      `POST /group/updateSetting/acme${q}`,
      `POST /group/updateSetting/acme${q}`,
      `POST /group/toggleEphemeral/acme${q}`,
      `POST /group/updateGroupPicture/acme${q}`,
      'GET /group/acceptInviteCode/acme?inviteCode=AbCdEf123',
      `DELETE /group/leaveGroup/acme${q}`,
    ]);
    expect(calls.slice(0, 4).map((c) => c.body)).toEqual([{ action: 'announcement' }, { action: 'locked' }, { expiration: 604_800 }, { image: 'https://cdn.example.com/a.png' }]);
  });

  it('el código sale del link de invitación', () => {
    expect(inviteCodeFrom('https://chat.whatsapp.com/AbCdEf123?x=1')).toBe('AbCdEf123');
    expect(inviteCodeFrom('chat.whatsapp.com/invite/XyZ987654')).toBe('XyZ987654');
    expect(inviteCodeFrom('AbCdEf123')).toBe('AbCdEf123');
    expect(inviteCodeFrom('https://example.com/nope nope')).toBe('');
  });
});

describe('ajustes del grupo, entrar y salir (de punta a punta con el falso)', () => {
  it('cambia los ajustes en WhatsApp y en la ficha; temporales solo con un valor válido', async () => {
    const { user, row } = await setup('g2-settings');
    const gid = '120363000000000001@g.us';
    await ingestEvents(row, [inbound(gid, 'S-1', 'hola')]);
    const chatId = await chatOf(user.id, gid);
    const chat = await updateGroupSettings(user.id, chatId, { announce: true, locked: true, ephemeral: 86_400, picture: { url: '/uploads/chat/x.png', mimetype: 'image/png' } }, 'https://app.example.com');
    expect(chat).toMatchObject({ announce: true, locked: true, ephemeral: 86_400, pictureUrl: '/uploads/chat/x.png' });
    const g = fakeGroupState(row.id, gid)!;
    expect(g).toMatchObject({ announce: true, locked: true, ephemeral: 86_400 });
    // El gateway recibe una URL absoluta que puede bajar.
    expect(g.picture).toBe('https://app.example.com/uploads/chat/x.png');
    await expect(updateGroupSettings(user.id, chatId, { ephemeral: 5 })).rejects.toMatchObject({ code: 'invalid_ephemeral' });
    await expect(updateGroupSettings(user.id, chatId, { picture: { url: 'javascript:alert(1)', mimetype: 'image/png' } })).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('entra por link y sale: el chat queda como historial, cerrado y sin miembros', async () => {
    const { user, row } = await setup('g2-join');
    await expect(joinGroup(user.id, row.id, 'nope')).rejects.toMatchObject({ code: 'invalid_invite' });
    await expect(joinGroup(user.id, row.id, 'https://chat.whatsapp.com/badCode123')).rejects.toMatchObject({ code: 'invite_invalid' });
    const chat = await joinGroup(user.id, row.id, 'https://chat.whatsapp.com/JoinMe12345');
    expect(chat).toMatchObject({ kind: 'group', name: 'Invited JoinMe', status: 'open', leftAt: null });
    expect((await listMembers(user.id, chat.id)).map((m) => m.phone).sort()).toEqual(['15550000001', '15550009000']);
    const left = await leaveGroup(user.id, chat.id);
    expect(left).toMatchObject({ status: 'closed', memberCount: 0 });
    expect(left.leftAt).toBeTruthy();
    await expect(leaveGroup(user.id, chat.id)).rejects.toMatchObject({ code: 'group_left' });
    // Volver a entrar con el mismo link lo reabre.
    const again = await joinGroup(user.id, row.id, 'JoinMe12345');
    expect(again.id).toBe(chat.id);
    expect(again).toMatchObject({ status: 'open', leftAt: null });
  });
});

// ======================================================================
// Plantillas
// ======================================================================

describe('plantillas de grupo', () => {
  it('variables: las propias se piden, las de fecha se completan solas', () => {
    expect(templateVariables('{{company}} · Soporte', 'Hola {{ company }} y {{plan}}, hoy {{date}}')).toEqual(['company', 'plan']);
    expect(renderTemplate('{{company}} · {{month}}', { company: 'Acme' }, new Date('2026-10-24T12:00:00Z'))).toBe('Acme · 2026-10');
    expect(renderTemplate('Hola {{name}}  equipo', {})).toBe('Hola equipo');
  });

  it('crea el grupo con miembros y admins fijos, etiquetas, ajustes y bienvenida; CSV por variables', async () => {
    const { user, row } = await setup('g2-template');
    const label = await createLabel(user.id, { name: 'Onboarding', color: 'blue' });
    const tpl = await createTemplate(user.id, user.id, {
      name: 'Onboarding',
      groupName: '{{company}} · Soporte',
      description: 'Grupo de {{company}}',
      members: ['+1 555 000 1001', '+15550001002'],
      admins: ['+15550001003'],
      labelIds: [label.id, 'not-mine'],
      welcome: 'Hola {{company}}, este es su grupo.',
      settings: { announce: true, ephemeral: 86_400 },
    });
    expect(tpl.members).toEqual(['15550001001', '15550001002', '15550001003']);
    expect(tpl.labelIds).toEqual([label.id]);
    expect(tpl.variables).toEqual(['company']);
    const [res] = await createFromTemplate(user.id, user.id, row.id, tpl.id, [{ vars: { company: 'Acme' }, phones: ['+15550001004'] }]);
    expect(res).toMatchObject({ ok: true, name: 'Acme · Soporte' });
    const chat = (await getChat(user.id, res.chatId!))!;
    expect(chat).toMatchObject({ description: 'Grupo de Acme', announce: true, ephemeral: 86_400 });
    expect(chat.labels.map((l) => l.name)).toEqual(['Onboarding']);
    const members = await listMembers(user.id, chat.id);
    expect(members.find((m) => m.phone === '15550001003')?.role).toBe('admin');
    expect(members.map((m) => m.phone)).toContain('15550001004');
    expect(fakeSent(row.id).map((s) => s.text)).toContain('Hola Acme, este es su grupo.');

    const csv = parseTemplateCsv(
      [
        ['company', 'participants'],
        ['Globex', '+15550002001 +15550002002'],
        ['', ''],
        ['Initech', 'bad'],
      ],
      tpl,
    );
    expect(csv.rows.map((r) => r.vars.company)).toEqual(['Globex', 'Initech']);
    expect(csv.errors).toEqual([{ line: 4, error: 'invalid_phone:bad' }]);
    expect(parseTemplateCsv([['name'], ['x']], tpl).errors[0].error).toBe('missing_columns:company');
    // Variable vacía: la fila no se crea ("· Soporte"), ni por CSV ni de a uno.
    const blank = parseTemplateCsv([['company', 'participants'], [' ', '+15550002003']], tpl);
    expect(blank.rows).toHaveLength(0);
    expect(blank.errors).toEqual([{ line: 2, error: 'missing_variables:company' }]);
    await expect(createFromTemplate(user.id, user.id, row.id, tpl.id, [{ vars: { company: '' } }])).rejects.toMatchObject({ code: 'missing_variables' });
  });
});

// ======================================================================
// Propiedades propias
// ======================================================================

describe('propiedades propias', () => {
  it('desplegable dependiente desde texto con sangría, hasta 3 niveles', () => {
    const tree = parseTreeText('Argentina\n  Buenos Aires\n    CABA\n      Palermo\n  Córdoba\nChile\n  Santiago');
    expect(tree).toEqual([
      { label: 'Argentina', children: [{ label: 'Buenos Aires', children: [{ label: 'CABA' }, { label: 'Palermo' }] }, { label: 'Córdoba' }] },
      { label: 'Chile', children: [{ label: 'Santiago' }] },
    ]);
    expect(isTreePath(tree, ['Argentina', 'Buenos Aires', 'CABA'])).toBe(true);
    expect(isTreePath(tree, ['Chile', 'CABA'])).toBe(false);
  });

  it('valida cada tipo y filtra la bandeja por valor, también dentro de multiselección y dependiente', async () => {
    const { user, row } = await setup('g2-props');
    await createPropertyDef(user.id, { label: 'Productos', type: 'multiselect', options: ['Link', 'CRM', 'Groups'] });
    const region = await createPropertyDef(user.id, { label: 'Región', type: 'cascade', tree: 'Argentina\n  Buenos Aires\nChile' });
    await createPropertyDef(user.id, { label: 'Contrato', type: 'file' });
    await createPropertyDef(user.id, { label: 'VIP', type: 'checkbox' });
    await createPropertyDef(user.id, { label: 'Sitio', type: 'url' });
    await expect(createPropertyDef(user.id, { label: 'Vacía', type: 'multiselect', options: [] })).rejects.toMatchObject({ code: 'missing_options' });
    await ingestEvents(row, [inbound('120363000000000001@g.us', 'P-1', 'hola'), inbound('120363000000000002@g.us', 'P-2', 'hola')]);
    const a = await chatOf(user.id, '120363000000000001@g.us');
    const b = await chatOf(user.id, '120363000000000002@g.us');
    const saved = await updateChat(user.id, a, {
      properties: { productos: ['CRM', 'Groups'], region: ['Argentina', 'Buenos Aires'], contrato: { url: '/uploads/chat/c.pdf', name: 'c.pdf' }, vip: true, sitio: 'https://acme.com' },
    });
    expect(saved.properties).toEqual({ productos: ['CRM', 'Groups'], region: ['Argentina', 'Buenos Aires'], contrato: { url: '/uploads/chat/c.pdf', name: 'c.pdf' }, vip: 'true', sitio: 'https://acme.com' });
    await updateChat(user.id, b, { properties: { productos: ['Link'], region: ['Chile'] } });
    await expect(updateChat(user.id, b, { properties: { productos: ['Otro'] } })).rejects.toMatchObject({ code: 'invalid_property:productos' });
    await expect(updateChat(user.id, b, { properties: { region: ['Chile', 'Buenos Aires'] } })).rejects.toMatchObject({ code: 'invalid_property:region' });
    await expect(updateChat(user.id, b, { properties: { contrato: { url: 'javascript:x', name: 'x' } } })).rejects.toMatchObject({ code: 'invalid_property:contrato' });
    await expect(updateChat(user.id, b, { properties: { sitio: 'acme' } })).rejects.toMatchObject({ code: 'invalid_property:sitio' });

    const ids = async (props: PropertyFilter[]) => (await listChats(user.id, user.id, { props })).rows.map((r) => r.id).sort();
    expect(await ids([{ key: 'productos', op: 'is', value: 'Groups' }])).toEqual([a]);
    expect(await ids([{ key: 'region', op: 'is', value: 'Argentina' }])).toEqual([a]);
    expect(await ids([{ key: 'region', op: 'is', value: 'Buenos Aires' }])).toEqual([a]);
    expect(await ids([{ key: 'vip', op: 'is', value: 'true' }])).toEqual([a]);
    expect(await ids([{ key: 'contrato', op: 'unset' }])).toEqual([b]);
    // Renombrar y cambiar las opciones no cambia la clave.
    const renamed = await updatePropertyDef(user.id, region.id, { label: 'Zona', tree: 'Argentina\nChile\nUruguay' });
    expect(renamed).toMatchObject({ key: 'region', label: 'Zona' });
    expect(renamed.tree?.map((n) => n.label)).toEqual(['Argentina', 'Chile', 'Uruguay']);
  });
});

// ======================================================================
// Listas guardadas
// ======================================================================

describe('listas guardadas', () => {
  it('compartidas o personales, permisos al editar y su audiencia de chats', async () => {
    const { user, row } = await setup('g2-lists');
    const mate = await makeUser('g2-lists-mate');
    const team = await createTeam(user.id, 'Soporte');
    await addMember(team.id, mate.id, 'member');
    const label = await createLabel(user.id, { name: 'Pro', color: 'green' });
    await ingestEvents(row, [inbound('120363000000000001@g.us', 'L-1', 'hola'), inbound('5491155550000@c.us', 'L-2', 'hola')]);
    const grp = await chatOf(user.id, '120363000000000001@g.us');
    await updateChat(user.id, grp, { labelIds: [label.id], assignedTo: mate.id });

    const mine = await createSavedList(user.id, user.id, { name: 'Mis grupos', filters: { kind: 'group', filter: 'all', junk: 1 } });
    expect(mine.filters).toEqual({ kind: 'group' });
    const shared = await createSavedList(user.id, user.id, { name: 'Pro de Mate', shared: true, filters: { labelIds: [label.id], assignee: mate.id, filter: 'unanswered' } });
    // La otra persona ve solo la compartida.
    expect((await listSavedLists(user.id, mate.id)).map((l) => l.name)).toEqual(['Pro de Mate']);
    expect((await listSavedLists(user.id, user.id, { counts: true })).map((l) => [l.name, l.count])).toEqual([
      ['Mis grupos', 1],
      ['Pro de Mate', 1],
    ]);
    expect((await listChats(user.id, mate.id, listQuery(shared.filters))).rows.map((r) => r.id)).toEqual([grp]);
    expect((await savedListChatIds(user.id, user.id, mine.id)).map((c) => c.id)).toEqual([grp]);
    // Quien no la creó no la edita (salvo un admin); la personal ajena no existe para él.
    await expect(updateSavedList(user.id, mate.id, shared.id, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateSavedList(user.id, mate.id, mine.id, { name: 'X' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await updateSavedList(user.id, mate.id, shared.id, { name: 'Pro (equipo)' }, true)).name).toBe('Pro (equipo)');
    expect((await searchApps({ id: user.id, actingUser: { id: mate.id } }, 'equipo')).filter((i) => i.group === 'groupsLists').map((i) => i.href)).toEqual([
      `/app/groups/inbox?list=${shared.id}`,
    ]);
    expect(await deleteSavedList(user.id, user.id, mine.id)).toBe(true);
    expect((await listSavedLists(user.id, user.id)).map((l) => l.id)).toEqual([shared.id]);
  });
});

// ======================================================================
// Sin responder con AI
// ======================================================================

describe('marcado de preguntas sin responder', () => {
  it('modo preguntas: un "gracias" no deja esperando, una pregunta sí; la AI deja su consumo', async () => {
    vi.stubEnv('GROUPS_AI_FAKE', '1');
    const { user, row } = await setup('g2-flag');
    await updateSettings(user.id, { flagMode: 'questions', flagRules: 'Los saludos no cuentan.' });
    const gid = '120363000000000001@g.us';
    await ingestEvents(row, [inbound(gid, 'Q-1', '¡Gracias, genial!')]);
    const chatId = await chatOf(user.id, gid);
    expect((await getChat(user.id, chatId))!.awaitingSince).toBeNull();
    await ingestEvents(row, [inbound(gid, 'Q-2', '¿Me pasan la factura de octubre?')]);
    const chat = (await getChat(user.id, chatId))!;
    expect(chat.awaitingSince).toBeTruthy();
    const msgs = await listMessages(user.id, chatId);
    expect(msgs.map((m) => m.needsReply)).toEqual([false, true]);
    const usage = (await getDb().prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND feature = 'groups_flag'").get(user.id)) as { c: number };
    expect(Number(usage.c)).toBe(2);
  });

  it('sin AI cuenta todo mensaje (mejor marcar de más); una respuesta en el medio no se pisa', async () => {
    const { user, row } = await setup('g2-flag-off');
    await updateSettings(user.id, { flagMode: 'questions' });
    const gid = '120363000000000002@g.us';
    await ingestEvents(row, [inbound(gid, 'Q-3', 'gracias')]);
    const chatId = await chatOf(user.id, gid);
    expect((await getChat(user.id, chatId))!.awaitingSince).toBeTruthy();
    const msg = (await listMessages(user.id, chatId))[0];
    expect(msg.needsReply).toBeNull();
    // Llegó una respuesta después del mensaje: la clasificación tardía no vuelve a marcar.
    await ingestEvents(row, [{ ...inbound(gid, 'Q-4', 'listo'), fromMe: true }]);
    expect(await flagInbound(user.id, chatId, { id: msg.id, body: msg.body, created_at: msg.createdAt })).toBe(true);
    expect((await getChat(user.id, chatId))!.awaitingSince).toBeNull();
  });

  it('crear un ticket desde el mensaje lo saca de sin responder (ajustable)', async () => {
    const { user, row } = await setup('g2-unflag');
    const gid = '120363000000000001@g.us';
    await ingestEvents(row, [inbound(gid, 'U-1', 'no anda el export')]);
    const chatId = await chatOf(user.id, gid);
    const msg = (await listMessages(user.id, chatId))[0];
    await createTicket(user.id, user.id, { chatId, messageId: msg.id });
    expect((await getChat(user.id, chatId))!.awaitingSince).toBeNull();
    await updateSettings(user.id, { unflagOnTicket: false });
    await ingestEvents(row, [inbound(gid, 'U-2', 'y tampoco el import')]);
    const msg2 = (await listMessages(user.id, chatId)).find((m) => m.body === 'y tampoco el import')!;
    await createTicket(user.id, user.id, { chatId, messageId: msg2.id });
    expect((await getChat(user.id, chatId))!.awaitingSince).toBeTruthy();
  });

  it('regla de respaldo para preguntas y ajustes nuevos con valores por defecto', () => {
    expect(looksLikeQuestion('¿Me ayudan?')).toBe(true);
    expect(looksLikeQuestion('cómo exporto los contactos')).toBe(true);
    expect(looksLikeQuestion('Necesito la factura')).toBe(true);
    expect(looksLikeQuestion('Gracias!')).toBe(false);
    expect(looksLikeQuestion('ok')).toBe(false);
    const s = normalizeSettings({ flagMode: 'nope', slaEmailExtra: ['A@x.com', 'bad', 'a@x.com'], locale: 'fr' });
    expect(s).toMatchObject({ flagMode: 'time', unflagOnTicket: true, slaEmail: false, slaEmailAssignee: true, slaEmailExtra: ['a@x.com'], locale: 'en' });
    expect(parseEmails('a@x.com, b@y.org; nope')).toEqual(['a@x.com', 'b@y.org']);
  });
});

// ======================================================================
// Tickets: campos propios y email del SLA
// ======================================================================

describe('campos propios de tickets', () => {
  it('se completan, filtran y son obligatorios para resolver', async () => {
    const { user, row } = await setup('g2-fields');
    await createPropertyDef(user.id, { label: 'Área', type: 'select', options: ['Billing', 'Producto'], scope: 'ticket', required: true });
    await createPropertyDef(user.id, { label: 'Pedido', type: 'text', scope: 'ticket' });
    await ingestEvents(row, [inbound('5491155550003@c.us', 'TF-1', 'hola')]);
    const chatId = await chatOf(user.id, '5491155550003@c.us');
    const { ticket } = await createTicket(user.id, user.id, { chatId, title: 'Factura', fields: { pedido: 'A-1' } });
    expect(ticket.fields).toEqual({ pedido: 'A-1' });
    await expect(updateTicket(user.id, ticket.id, { status: 'resolved' })).rejects.toMatchObject({ code: 'missing_fields:area' });
    await expect(updateTicket(user.id, ticket.id, { fields: { area: 'Otra' } })).rejects.toMatchObject({ code: 'invalid_property:area' });
    const done = await updateTicket(user.id, ticket.id, { status: 'resolved', fields: { area: 'Billing', pedido: 'A-1' } });
    expect(done).toMatchObject({ status: 'resolved', fields: { area: 'Billing', pedido: 'A-1' } });
    await createTicket(user.id, user.id, { chatId, title: 'Otro' });
    const billing = await listTickets(user.id, { status: 'all', fields: [{ key: 'area', op: 'is', value: 'Billing' }] });
    expect(billing.map((t) => t.title)).toEqual(['Factura']);
    expect((await listTickets(user.id, { status: 'all', fields: [{ key: 'area', op: 'unset' }] })).map((t) => t.title)).toEqual(['Otro']);
  });
});

describe('email cuando vence el SLA', () => {
  it('avisa una sola vez a la persona asignada, los admins y los extra', async () => {
    const { user, row } = await setup('g2-sla');
    const admin = await makeUser('g2-sla-admin');
    const team = await createTeam(user.id, 'Equipo');
    await addMember(team.id, admin.id, 'admin');
    await updateSettings(user.id, { slaEmail: true, slaEmailAssignee: true, slaEmailAdmins: true, slaEmailExtra: ['oncall@acme.com', admin.email], locale: 'es' });
    await ingestEvents(row, [inbound('5491155550004@c.us', 'SLA-1', 'urgente')]);
    const chatId = await chatOf(user.id, '5491155550004@c.us');
    const { ticket } = await createTicket(user.id, user.id, { chatId, title: 'Caído', priority: 'urgent', assigneeId: user.id });
    const later = new Date(Date.now() + 2 * 3600_000);
    await Promise.all([markBreachedTickets(later), markBreachedTickets(later)]);
    const mine = mail.sent.filter((m) => m.subject.includes(`#${ticket.number} Caído`));
    expect(mine.map((m) => m.to).sort()).toEqual([admin.email, 'oncall@acme.com', user.email].sort());
    expect(mine[0].subject).toBe(`SLA vencido: #${ticket.number} Caído`);
    expect(mine[0].text).toContain('primera respuesta');
    await markBreachedTickets(later);
    expect(mail.sent.filter((m) => m.subject.includes(`#${ticket.number} Caído`))).toHaveLength(3);
    const notes = (await getDb().prepare("SELECT user_id FROM notifications WHERE type = 'groups_sla' AND source_id = ?").all(ticket.id)) as Array<{ user_id: string }>;
    expect(notes.map((n) => n.user_id).sort()).toEqual([admin.id, user.id].sort());
  });

  it('apagado no manda nada', async () => {
    const { user, row } = await setup('g2-sla-off');
    await ingestEvents(row, [inbound('5491155550005@c.us', 'SLA-2', 'hola')]);
    const chatId = await chatOf(user.id, '5491155550005@c.us');
    const { ticket } = await createTicket(user.id, user.id, { chatId, title: 'Sin aviso', priority: 'urgent', assigneeId: user.id });
    await markBreachedTickets(new Date(Date.now() + 2 * 3600_000));
    expect(mail.sent.filter((m) => m.subject.includes(`#${ticket.number} Sin aviso`))).toHaveLength(0);
  });
});

// ======================================================================
// Tareas y recordatorios
// ======================================================================

describe('tareas desde el chat', () => {
  it('la tarea vive en el CRM, avisa una vez a su hora y vuelve a avisar si se mueve', async () => {
    const { user, row } = await setup('g2-tasks');
    const company = { id: crypto.randomUUID() };
    await getDb().prepare('INSERT INTO crm_companies (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(company.id, user.id, 'Acme', new Date().toISOString(), new Date().toISOString());
    await ingestEvents(row, [inbound('120363000000000001@g.us', 'T-1', 'Mandame la propuesta el lunes')]);
    const chatId = await chatOf(user.id, '120363000000000001@g.us');
    await updateChat(user.id, chatId, { crmCompanyId: company.id });
    const msg = (await listMessages(user.id, chatId))[0];
    const now = new Date();
    const due = new Date(now.getTime() + 30 * 60_000).toISOString();
    await expect(createGroupTask(user.id, user.id, { chatId, title: 'x', dueAt: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'date_in_past' });
    const task = await createGroupTask(user.id, user.id, { chatId, messageId: msg.id, dueAt: due, locale: 'es', timezone: 'America/Argentina/Buenos_Aires' });
    expect(task).toMatchObject({ title: 'Mandame la propuesta el lunes', chatId, messageId: msg.id, done: false, ownerId: user.id });
    const activity = (await getDb().prepare('SELECT type, subject, company_id, owner_id FROM crm_activities WHERE id = ?').get(task.activityId)) as Record<string, string>;
    expect(activity).toMatchObject({ type: 'task', subject: 'Mandame la propuesta el lunes', company_id: company.id, owner_id: user.id });

    expect(await fireTaskReminders({ now })).toBe(0);
    const at = new Date(now.getTime() + 31 * 60_000);
    const [a, b] = await Promise.all([fireTaskReminders({ now: at }), fireTaskReminders({ now: at })]);
    expect(a + b).toBe(1);
    expect(mail.sent.filter((m) => m.subject === 'Recordatorio: Mandame la propuesta el lunes')).toHaveLength(1);
    const notes = (await getDb().prepare("SELECT title, href FROM notifications WHERE type = 'groups_reminder' AND source_id = ?").all(task.id)) as Array<{ title: string; href: string }>;
    expect(notes).toEqual([{ title: 'Recordatorio: Mandame la propuesta el lunes', href: `/app/groups/inbox/${chatId}` }]);
    expect(await fireTaskReminders({ now: at })).toBe(0);

    // Moverla a otra hora vuelve a avisar; hecha, no.
    const later = new Date(now.getTime() + 2 * 3600_000).toISOString();
    await updateGroupTask(user.id, task.id, { dueAt: later });
    expect(await fireTaskReminders({ now: new Date(now.getTime() + 3 * 3600_000) })).toBe(1);
    await updateGroupTask(user.id, task.id, { dueAt: new Date(now.getTime() + 4 * 3600_000).toISOString(), done: true });
    expect(await fireTaskReminders({ now: new Date(now.getTime() + 5 * 3600_000) })).toBe(0);
    expect(await listGroupTasks(user.id, user.id, { status: 'open' })).toHaveLength(0);
    expect((await listGroupTasks(user.id, user.id, { status: 'done', chatId })).map((t) => t.id)).toEqual([task.id]);
  });
});

describe('QA int-4: tareas en el formato del CRM y gente del workspace', () => {
  it('la tarea guarda due_at como el CRM y el formateador lee los dos formatos', async () => {
    const { parseDbUtc } = await import('@/lib/utils');
    const { listTasks } = await import('@/lib/crm');
    const { user, row } = await setup('int4-due');
    await ingestEvents(row, [inbound('120363000000000441@g.us', 'D-1', 'Llamame mañana')]);
    const chatId = await chatOf(user.id, '120363000000000441@g.us');
    const due = new Date(Date.now() + 3 * 86_400_000);
    due.setUTCSeconds(0, 0);
    const task = await createGroupTask(user.id, user.id, { chatId, title: 'Llamar', dueAt: due.toISOString() });
    const raw = (await getDb().prepare('SELECT due_at FROM crm_activities WHERE id = ?').get(task.activityId)) as { due_at: string };
    expect(raw.due_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(task.dueAt).toBe(due.toISOString());
    const upcoming = await listTasks(user.id, { bucket: 'upcoming' });
    const crmTask = upcoming.find((t) => t.id === task.activityId)!;
    expect(parseDbUtc(crmTask.due_at!).getTime()).toBe(due.getTime());
    // Filas viejas con ISO completo tampoco rompen (antes quedaba '…ZZ' → Invalid time value).
    expect(parseDbUtc(due.toISOString()).getTime()).toBe(due.getTime());
    expect(() => new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(parseDbUtc(due.toISOString()))).not.toThrow();
  });

  it('el dueño con equipo y sin team activo ve y asigna a sus compañeros', async () => {
    const { listPeople } = await import('@/lib/groups');
    const { workspacePeople } = await import('@/lib/groups-inbox');
    const owner = await makeUser('int4-owner');
    const mate = await makeUser('int4-mate');
    const team = await createTeam(owner.id, 'Soporte');
    await addMember(team.id, mate.id);
    await getDb().prepare('UPDATE users SET active_team_id = NULL WHERE id = ?').run(owner.id);
    const people = await listPeople(owner.id);
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([owner.id, mate.id]));
    expect((await workspacePeople(owner.id)).map((p) => p.id)).toEqual(people.map((p) => p.id));
  });
});

describe('QA int-4: remitente de los avisos y vista previa', () => {
  it('los emails de Groups salen con el remitente general, no el de Calendar', async () => {
    const { appSender } = await import('@/lib/email');
    vi.stubEnv('EMAIL_FROM', 'calendar@zerosoft.ai');
    expect(appSender()).toBe('zerosoft <notifications@zerosoft.ai>');
    vi.stubEnv('EMAIL_FROM', 'zerosoft <hola@acme.com>');
    expect(appSender()).toBe('zerosoft <hola@acme.com>');
  });

  it('editar o borrar el último mensaje actualiza la vista previa del chat', async () => {
    const { refreshChatPreview } = await import('@/lib/groups');
    const { user, row } = await setup('int4-preview');
    await ingestEvents(row, [inbound('5491155557777@c.us', 'PV-1', 'Hola, ¿precio?')]);
    const chatId = await chatOf(user.id, '5491155557777@c.us');
    const msg = (await listMessages(user.id, chatId))[0];
    await getDb().prepare('UPDATE groups_messages SET body = ? WHERE id = ?').run('Hola, ¿precio final?', msg.id);
    await refreshChatPreview(msg.id);
    expect((await getChat(user.id, chatId))!.lastMessagePreview).toBe('Hola, ¿precio final?');
    await getDb().prepare('UPDATE groups_messages SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), msg.id);
    await refreshChatPreview(msg.id);
    expect((await getChat(user.id, chatId))!.lastMessagePreview).toBe('[deleted]');
  });
});
