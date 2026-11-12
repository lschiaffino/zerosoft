import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { groupsViewer } from '@/lib/groups-access';
import { createSavedList, getSavedList, listQuery, savedListChatIds } from '@/lib/groups-org';
import { createTicket } from '@/lib/groups-tickets';
import {
  ME,
  NONE,
  PROP_SET,
  PROP_UNSET,
  activeTabs,
  applyTab,
  countFilters,
  filtersToValues,
  isEmptyFilters,
  linesFiltersFromParam,
  linesFiltersSql,
  parseLinesFilters,
  serializeLinesFilters,
  valuesToFilters,
  type LinesFilters,
} from '@/lib/groups-filters';
import {
  bestField,
  chipText,
  cleanDateValue,
  cleanValues,
  countActive,
  fieldCount,
  filterChips,
  matchFields,
  matchOptions,
  resolveDateRange,
  type ChipStrings,
  type FilterField,
} from '@/lib/filter-panel';
import { makeUser } from './helpers';

/**
 * Los filtros de la bandeja de Lines (lib/groups-filters.ts) y el modelo del
 * panel (lib/filter-panel.ts): formato anterior y nuevo, ida y vuelta, cuentas,
 * chips, y el SQL contra la base (O dentro de un campo, Y entre campos), sin
 * cambiar lo que cada persona puede ver.
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

describe('formato: lo guardado antes y lo nuevo', () => {
  it('una lista con el formato anterior se lee igual', () => {
    expect(parseLinesFilters({ filter: 'unanswered', kind: 'group', labelIds: ['l1', 'l1', 'l2'], assignee: 'u9', numberId: 'n1', q: '  factura ' })).toEqual({
      q: 'factura',
      kinds: ['group'],
      lines: ['n1'],
      assignees: ['u9'],
      labels: ['l1', 'l2'],
      waiting: 'yes',
    });
    expect(parseLinesFilters({ filter: 'mine' })).toEqual({ assignees: [ME] });
    expect(parseLinesFilters({ filter: 'unassigned' })).toEqual({ assignees: [NONE] });
    expect(parseLinesFilters({ filter: 'closed' })).toEqual({ status: ['closed'] });
    expect(parseLinesFilters({ filter: 'unread' })).toEqual({ unread: 'yes' });
    expect(parseLinesFilters({ filter: 'flagged' })).toEqual({ flagged: 'yes' });
    expect(parseLinesFilters({ filter: 'all', junk: 1 })).toEqual({});
    // Lo que quedaba en la pestaña del navegador: etiqueta y equipo sueltos.
    expect(parseLinesFilters({ filter: 'all', label: 'l1', team: 't1', hubspot: 'linked' })).toEqual({ teams: ['t1'], labels: ['l1'], hubspot: 'linked' });
    // Propiedades: un valor, "tiene valor" y lo inválido afuera.
    expect(
      parseLinesFilters({
        props: [
          { key: 'plan', op: 'is', value: 'Pro' },
          { key: 'owner', op: 'set' },
          { key: 'Bad Key', op: 'is', value: 'x' },
          { key: 'empty', op: 'is', value: '' },
        ],
      }),
    ).toEqual({ props: [{ key: 'plan', op: 'is', value: 'Pro' }, { key: 'owner', op: 'set' }] });
  });

  it('el formato nuevo queda canónico y sin basura', () => {
    const f = parseLinesFilters({
      status: ['closed', 'open', 'wat'],
      kinds: ['dm', 'group'],
      assignees: [ME, 'u1', 'u1', 7],
      labels: [NONE, 'l1'],
      unread: 'no',
      pinned: 'maybe',
      lastMessage: { preset: 'last7' },
      created: { from: '2026-03-10', to: '2026-03-01' },
      props: [{ key: 'tier', op: 'any', values: ['Gold', 'Gold', 'Silver'], orEmpty: true }, { key: 'tier', op: 'set' }],
      hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['starter'] }, { name: 'bad name!', op: 'is', value: 'x' }],
    });
    expect(f).toEqual({
      status: ['open', 'closed'],
      assignees: [ME, 'u1'],
      labels: [NONE, 'l1'],
      unread: 'no',
      lastMessage: { preset: 'last7' },
      created: { from: '2026-03-01', to: '2026-03-10' },
      props: [{ key: 'tier', op: 'any', values: ['Gold', 'Silver'], orEmpty: true }],
      hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['starter'] }],
    });
    // Solo abiertos, o los dos tipos de chat, es no filtrar.
    expect(parseLinesFilters({ status: ['open'], kinds: ['group', 'dm'] })).toEqual({});
    expect(parseLinesFilters(null)).toEqual({});
    expect(parseLinesFilters('x')).toEqual({});
    expect(parseLinesFilters([1, 2])).toEqual({});
  });

  it('serializar y volver a leer da lo mismo; algo roto es "sin filtros"', () => {
    const f: LinesFilters = { assignees: ['u1', NONE], labels: ['l1'], lastMessage: { preset: 'thisMonth' }, ticket: 'yes', props: [{ key: 'plan', op: 'any', values: ['A', 'B'] }] };
    const raw = serializeLinesFilters(f);
    expect(linesFiltersFromParam(raw)).toEqual(parseLinesFilters(f));
    expect(serializeLinesFilters(linesFiltersFromParam(raw))).toBe(raw);
    // El orden de las claves al escribir no cambia el resultado.
    expect(serializeLinesFilters({ ticket: 'yes', labels: ['l1'], assignees: ['u1', NONE], props: f.props, lastMessage: f.lastMessage })).toBe(raw);
    expect(serializeLinesFilters({})).toBe('');
    expect(linesFiltersFromParam('{not json')).toEqual({});
    expect(linesFiltersFromParam(null)).toEqual({});
  });

  it('cuenta los campos con algo puesto (la búsqueda no cuenta)', () => {
    expect(isEmptyFilters({})).toBe(true);
    expect(isEmptyFilters({ q: 'hola' })).toBe(true);
    expect(isEmptyFilters({ status: ['open'] })).toBe(true);
    expect(countFilters({ q: 'hola', assignees: ['u1', 'u2'], labels: ['l1'], unread: 'yes' })).toBe(3);
    expect(countFilters({ props: [{ key: 'a', op: 'set' }, { key: 'b', op: 'is', value: 'x' }], pinned: 'no' })).toBe(3);
  });
});

describe('pestañas: atajos de un campo', () => {
  it('marcadas según los filtros, vengan de la pestaña o del panel', () => {
    expect(activeTabs({})).toEqual(['all']);
    expect(activeTabs({ labels: ['l1'] })).toEqual(['all']);
    expect(activeTabs({ unread: 'yes', waiting: 'yes' })).toEqual(['unread', 'unanswered']);
    expect(activeTabs({ assignees: [ME] })).toEqual(['mine']);
    // Varias personas elegidas en el panel no es "Míos".
    expect(activeTabs({ assignees: [ME, 'u2'] })).toEqual(['all']);
    expect(activeTabs({ status: ['open', 'closed'] })).toEqual(['all']);
    expect(activeTabs({ status: ['closed'], kinds: ['group'] })).toEqual(['groups', 'closed']);
  });

  it('elegir una pestaña cambia su atajo y deja el resto', () => {
    const base: LinesFilters = { labels: ['l1'], lastMessage: { preset: 'today' }, assignees: ['u1', 'u2'] };
    expect(applyTab(base, 'unread')).toEqual({ assignees: ['u1', 'u2'], labels: ['l1'], unread: 'yes', lastMessage: { preset: 'today' } });
    // Pasar de una pestaña a otra saca la anterior.
    expect(applyTab(applyTab(base, 'unread'), 'closed')).toEqual({ status: ['closed'], assignees: ['u1', 'u2'], labels: ['l1'], lastMessage: { preset: 'today' } });
    // "Míos" es el campo "Asignado a": reemplaza a las personas elegidas.
    expect(applyTab(base, 'mine')).toEqual({ assignees: [ME], labels: ['l1'], lastMessage: { preset: 'today' } });
    expect(applyTab({ unread: 'yes', waiting: 'yes', labels: ['l1'] }, 'all')).toEqual({ labels: ['l1'] });
    // "Todos" no toca lo que no es de una pestaña.
    expect(applyTab(base, 'all')).toEqual(parseLinesFilters(base));
  });
});

describe('panel: filtros ↔ valores por campo', () => {
  const kinds = { tier: 'multi', note: 'text' } as const;

  it('ida y vuelta', () => {
    const f = parseLinesFilters({
      status: ['open', 'closed'],
      kinds: ['dm'],
      lines: ['n1', 'n2'],
      assignees: [ME, NONE],
      teams: ['t1'],
      labels: [NONE, 'l1'],
      unread: 'yes',
      muted: 'no',
      ticket: 'yes',
      hubspot: 'unlinked',
      lastMessage: { preset: 'last30' },
      created: { from: '2026-01-01' },
      props: [{ key: 'tier', op: 'any', values: ['Gold', 'Silver'], orEmpty: true }, { key: 'note', op: 'is', value: 'vip' }],
      hsProps: [{ name: 'city', op: 'is', value: 'Lima' }],
    });
    const v = filtersToValues(f, kinds);
    expect(v.assignee).toEqual([ME, NONE]);
    expect(v.hubspot).toBe('no');
    expect(v['prop:tier']).toEqual([PROP_UNSET, 'Gold', 'Silver']);
    expect(v['prop:note']).toEqual({ mode: 'is', value: 'vip' });
    expect(valuesToFilters(v)).toEqual(f);
    expect(valuesToFilters(v, 'hola').q).toBe('hola');
  });

  it('propiedades: opciones especiales', () => {
    expect(valuesToFilters({ 'prop:tier': [PROP_SET, 'Gold'] }).props).toEqual([{ key: 'tier', op: 'set' }]);
    expect(valuesToFilters({ 'prop:tier': [PROP_UNSET] }).props).toEqual([{ key: 'tier', op: 'unset' }]);
    expect(valuesToFilters({ 'prop:tier': ['Gold'] }).props).toEqual([{ key: 'tier', op: 'is', value: 'Gold' }]);
    // "Tiene valor" y "sin valor" juntos es cualquier chat.
    expect(valuesToFilters({ 'prop:tier': [PROP_SET, PROP_UNSET] })).toEqual({});
    expect(valuesToFilters({ 'prop:note': { mode: 'unset' } }).props).toEqual([{ key: 'note', op: 'unset' }]);
    // Un texto vacío todavía no filtra.
    expect(valuesToFilters({ 'prop:note': { mode: 'is', value: '  ' } })).toEqual({});
    expect(filtersToValues({ props: [{ key: 'tier', op: 'set' }] }, kinds)['prop:tier']).toEqual([PROP_SET]);
    expect(filtersToValues({ props: [{ key: 'gone', op: 'set' }] }, kinds)['prop:gone']).toEqual({ mode: 'set' });
  });
});

describe('modelo del panel', () => {
  const fields: FilterField[] = [
    { id: 'assignee', type: 'multi', category: 'a', label: 'Assigned to', keywords: 'owner', options: [{ id: 'u1', label: 'Ana Ruiz', hint: 'ana@example.test' }, { id: 'u2', label: 'Luis Peña' }, { id: 'u3', label: 'Zoé' }] },
    { id: 'unread', type: 'bool', category: 's', label: 'Unread' },
    { id: 'last', type: 'date', category: 'd', label: 'Last message' },
    { id: 'note', type: 'text', category: 'p', label: 'Note' },
    { id: 'hs', type: 'custom', category: 'p', label: 'HubSpot', count: (v) => (Array.isArray(v) ? v.length : 0), summary: (v) => `${(v as unknown[]).length} conditions` },
  ];
  const s: ChipStrings = {
    yes: 'Yes',
    no: 'No',
    presets: { today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', thisWeek: 'This week', thisMonth: 'This month', lastMonth: 'Last month' },
    from: (d) => `from ${d}`,
    until: (d) => `until ${d}`,
    range: (a, b) => `${a} to ${b}`,
    more: (n) => `+${n}`,
    unavailable: (n) => `${n} unavailable`,
    hasValue: 'Has a value',
    noValue: 'No value',
    day: (d) => d,
  };

  it('cuenta, limpia y arma los chips', () => {
    const values = { assignee: ['u1', 'u2'], unread: 'yes', last: { preset: 'last7' }, note: { mode: 'is', value: '' }, hs: [], other: ['x'] };
    expect(fieldCount(fields[0], values.assignee)).toBe(2);
    expect(countActive(fields, values)).toBe(3);
    expect(cleanValues(fields, values)).toEqual({ assignee: ['u1', 'u2'], unread: 'yes', last: { preset: 'last7' } });
    expect(filterChips(fields, values, s)).toEqual([
      { id: 'assignee', label: 'Assigned to', text: 'Ana Ruiz, Luis Peña' },
      { id: 'unread', label: 'Unread', text: 'Yes' },
      { id: 'last', label: 'Last message', text: 'Last 7 days' },
    ]);
    // Más de dos nombres se resumen; lo que ya no existe (o no se ve) va sin nombre.
    expect(chipText(fields[0], ['u1', 'u2', 'u3'], s)).toBe('Ana Ruiz, Luis Peña, +1');
    expect(chipText(fields[0], ['u1', 'gone-1', 'gone-2'], s)).toBe('Ana Ruiz, 2 unavailable');
    expect(chipText(fields[2], { from: '2026-03-01', to: '2026-03-10' }, s)).toBe('2026-03-01 to 2026-03-10');
    expect(chipText(fields[2], { from: '2026-03-01', to: '2026-03-01' }, s)).toBe('2026-03-01');
    expect(chipText(fields[2], { to: '2026-03-10' }, s)).toBe('until 2026-03-10');
    expect(chipText(fields[3], { mode: 'unset' }, s)).toBe('No value');
    expect(chipText(fields[4], [1, 2], s)).toBe('2 conditions');
    expect(chipText(fields[1], undefined, s)).toBe('');
  });

  it('busca campos y opciones sin importar acentos', () => {
    const cats = [{ id: 'a', label: 'Assignment' }, { id: 's', label: 'Status' }, { id: 'd', label: 'Dates' }, { id: 'p', label: 'Properties' }];
    expect(matchFields(fields, cats, 'OWNER').map((f) => f.id)).toEqual(['assignee']);
    expect(matchFields(fields, cats, 'propert').map((f) => f.id)).toEqual(['note', 'hs']);
    expect(matchFields(fields, cats, 'zzz')).toEqual([]);
    // Al abrir con Enter gana el campo que se llama así, no el primero de una categoría que coincide.
    expect(bestField(matchFields(fields, cats, 'p'), 'hub')?.id).toBe('hs');
    expect(bestField(matchFields(fields, cats, 'propert'), 'propert')?.id).toBe('note');
    expect(bestField([], 'x')).toBeUndefined();
    const opts = (fields[0] as Extract<FilterField, { type: 'multi' }>).options;
    expect(matchOptions(opts, 'pena').map((o) => o.id)).toEqual(['u2']);
    expect(matchOptions(opts, 'zoe').map((o) => o.id)).toEqual(['u3']);
    expect(matchOptions(opts, 'example.test').map((o) => o.id)).toEqual(['u1']);
  });

  it('períodos: el día empieza a la medianoche de quien mira', () => {
    // Miércoles 11 de noviembre de 2026, 01:30 UTC. En UTC-3 todavía es martes 10 a las 22:30.
    const now = new Date('2026-11-11T01:30:00.000Z');
    expect(resolveDateRange({ preset: 'today' }, now, 0)).toEqual({ from: '2026-11-11T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' });
    expect(resolveDateRange({ preset: 'today' }, now, -180)).toEqual({ from: '2026-11-10T03:00:00.000Z', to: '2026-11-11T03:00:00.000Z' });
    expect(resolveDateRange({ preset: 'yesterday' }, now, -180)).toEqual({ from: '2026-11-09T03:00:00.000Z', to: '2026-11-10T03:00:00.000Z' });
    expect(resolveDateRange({ preset: 'last7' }, now, 0)).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' });
    expect(resolveDateRange({ preset: 'last30' }, now, 0).from).toBe('2026-10-13T00:00:00.000Z');
    // La semana empieza el lunes.
    expect(resolveDateRange({ preset: 'thisWeek' }, now, 0).from).toBe('2026-11-09T00:00:00.000Z');
    expect(resolveDateRange({ preset: 'thisWeek' }, new Date('2026-11-15T12:00:00.000Z'), 0).from).toBe('2026-11-09T00:00:00.000Z');
    expect(resolveDateRange({ preset: 'thisMonth' }, now, 0).from).toBe('2026-11-01T00:00:00.000Z');
    expect(resolveDateRange({ preset: 'lastMonth' }, now, 0)).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' });
    expect(resolveDateRange({ preset: 'lastMonth' }, new Date('2026-01-15T12:00:00.000Z'), 0)).toEqual({ from: '2025-12-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });
    // Rango a mano: los dos días incluidos; un extremo solo deja el otro abierto.
    expect(resolveDateRange({ from: '2026-03-01', to: '2026-03-10' }, now, 120)).toEqual({ from: '2026-02-28T22:00:00.000Z', to: '2026-03-10T22:00:00.000Z' });
    expect(resolveDateRange({ from: '2026-03-01' }, now, 0)).toEqual({ from: '2026-03-01T00:00:00.000Z' });
    expect(resolveDateRange(undefined, now, 0)).toEqual({});
    expect(cleanDateValue({ from: '2026-02-30' })).toBeUndefined();
    expect(cleanDateValue({ preset: 'nope' })).toBeUndefined();
  });
});

describe('SQL', () => {
  it('O dentro de un campo, Y entre campos; los valores van como parámetros', () => {
    const now = new Date('2026-11-11T12:00:00.000Z');
    const sql = linesFiltersSql(
      { assignees: [ME, NONE, 'u2'], labels: [NONE, 'l1', 'l2'], unread: 'yes', kinds: ['group'], lines: ['n1', 'n2'], muted: 'no', props: [{ key: 'tier', op: 'any', values: ['Gold', 'Silver'], orEmpty: true }] },
      { me: 'u1', now },
    );
    expect(sql.where).toEqual([
      "c.status = 'open'",
      'c.kind = ?',
      'c.number_id IN (?,?)',
      '(c.assigned_to IS NULL OR c.assigned_to IN (?,?))',
      '(NOT EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id) OR EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id IN (?,?)))',
      'c.unread_count > 0',
      '(c.muted_until IS NULL OR c.muted_until <= ?)',
      '(json_extract(c.properties, ?) IS NULL OR EXISTS (SELECT 1 FROM json_each(c.properties, ?) je WHERE CAST(je.value AS TEXT) IN (?,?)))',
    ]);
    expect(sql.args).toEqual(['group', 'n1', 'n2', 'u1', 'u2', 'l1', 'l2', now.toISOString(), '$."tier"', '$."tier"', 'Gold', 'Silver']);
    // Cada ? tiene su valor.
    expect(sql.where.join(' ').split('?').length - 1).toBe(sql.args.length);
    // Nada de lo que escribe la persona termina dentro del SQL.
    const evil = linesFiltersSql({ assignees: ["x' OR 1=1 --"], lines: ['"; DROP TABLE groups_chats; --'], props: [{ key: 'tier', op: 'is', value: "'); --" }] }, { me: 'u1', now });
    expect(evil.where.join(' ')).not.toMatch(/DROP|OR 1=1|--/);
  });

  it('estado: sin filtro son los abiertos; los dos a la vez no filtran', () => {
    const ctx = { me: 'u1' };
    expect(linesFiltersSql({}, ctx).where).toEqual(["c.status = 'open'"]);
    expect(linesFiltersSql({ status: ['closed'] }, ctx).where).toEqual(["c.status = 'closed'"]);
    expect(linesFiltersSql({ status: ['open', 'closed'] }, ctx).where).toEqual([]);
  });

  it('último mensaje: el rango va sobre la expresión del índice de la lista', () => {
    const sql = linesFiltersSql({ lastMessage: { preset: 'today' }, created: { from: '2026-01-01' } }, { me: 'u1', now: new Date('2026-11-11T12:00:00.000Z'), tzOffsetMin: -180 });
    expect(sql.where).toEqual([
      "c.status = 'open'",
      'c.last_message_at IS NOT NULL',
      'COALESCE(c.last_message_at, c.created_at) >= ?',
      'COALESCE(c.last_message_at, c.created_at) < ?',
      'c.created_at >= ?',
    ]);
    expect(sql.args).toEqual(['2026-11-11T03:00:00.000Z', '2026-11-12T03:00:00.000Z', '2026-01-01T03:00:00.000Z']);
  });
});

// ======================================================================
// Contra la base: lo que devuelve la bandeja
// ======================================================================

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (fake) fake.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

const msg = (chatId: string, id: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5490000000001',
  senderName: 'Cliente de prueba',
  providerMessageId: id,
  body: 'hola',
});

async function chatId(ws: string, providerId: string) {
  return ((await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND provider_chat_id = ?').get(ws, providerId)) as { id: string }).id;
}

async function world(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const luis = await makeUser(`${label}-luis`);
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, ana.id, 'member');
  await addMember(team.id, luis.id, 'member');
  const main = await line(owner.id, 'Ventas');
  const other = await line(owner.id, 'Soporte');
  await ingestEvents(main, [msg('5490000000011@c.us', `${label}-1`), msg('5490000000012@c.us', `${label}-2`), msg('120363000000000021@g.us', `${label}-3`), msg('5490000000013@c.us', `${label}-4`)]);
  await ingestEvents(other, [msg('5490000000014@c.us', `${label}-5`)]);
  const a = await chatId(owner.id, '5490000000011@c.us');
  const b = await chatId(owner.id, '5490000000012@c.us');
  const g = await chatId(owner.id, '120363000000000021@g.us');
  const d = await chatId(owner.id, '5490000000013@c.us');
  const s = await chatId(owner.id, '5490000000014@c.us');
  const vip = await createLabel(owner.id, { name: 'VIP', color: 'green' });
  const late = await createLabel(owner.id, { name: 'Moroso', color: 'red' });
  // a: Ana, VIP. b: Luis, Moroso. g (grupo): sin asignar, VIP y Moroso. d: Ana, sin etiqueta. s (otra línea): Luis, sin etiqueta.
  await updateChat(owner.id, a, { assignedTo: ana.id, labelIds: [vip.id] });
  await updateChat(owner.id, b, { assignedTo: luis.id, labelIds: [late.id] });
  await updateChat(owner.id, g, { labelIds: [vip.id, late.id] });
  await updateChat(owner.id, d, { assignedTo: ana.id });
  await updateChat(owner.id, s, { assignedTo: luis.id });
  const list = async (f: LinesFilters, me = owner.id, extra: Parameters<typeof listChats>[2] = {}) =>
    (await listChats(owner.id, me, { ...listQuery(f), limit: 100, ...extra })).rows.map((r) => r.id).sort();
  const ids = (...x: string[]) => [...x].sort();
  return { owner, ana, luis, main, other, a, b, g, d, s, vip, late, list, ids };
}

describe('la bandeja con filtros', () => {
  it('varias opciones de un campo se suman; los campos se cruzan', async () => {
    const w = await world('gf-or');
    expect(await w.list({})).toEqual(w.ids(w.a, w.b, w.g, w.d, w.s));
    // Dos personas: los de una o de la otra.
    expect(await w.list({ assignees: [w.ana.id, w.luis.id] })).toEqual(w.ids(w.a, w.b, w.d, w.s));
    expect(await w.list({ assignees: [w.ana.id, NONE] })).toEqual(w.ids(w.a, w.d, w.g));
    // "me" es quien mira.
    expect(await w.list({ assignees: [ME] }, w.luis.id)).toEqual(w.ids(w.b, w.s));
    // Etiquetas: alguna de las elegidas, o ninguna.
    expect(await w.list({ labels: [w.vip.id] })).toEqual(w.ids(w.a, w.g));
    expect(await w.list({ labels: [w.vip.id, w.late.id] })).toEqual(w.ids(w.a, w.b, w.g));
    expect(await w.list({ labels: [NONE] })).toEqual(w.ids(w.d, w.s));
    expect(await w.list({ labels: [NONE, w.late.id] })).toEqual(w.ids(w.b, w.g, w.d, w.s));
    // Entre campos se cruza: (Ana o Luis) Y VIP.
    expect(await w.list({ assignees: [w.ana.id, w.luis.id], labels: [w.vip.id] })).toEqual(w.ids(w.a));
    // Línea y tipo de chat.
    expect(await w.list({ lines: [w.other.id] })).toEqual(w.ids(w.s));
    expect(await w.list({ lines: [w.main.id, w.other.id], kinds: ['group'] })).toEqual(w.ids(w.g));
    expect(await w.list({ kinds: ['dm'], labels: [w.vip.id, w.late.id] })).toEqual(w.ids(w.a, w.b));
  });

  it('sí o no: no leídos, fijados, silenciados, estado, ticket abierto', async () => {
    const w = await world('gf-tri');
    await updateChat(w.owner.id, w.a, { read: true });
    await updateChat(w.owner.id, w.b, { pinned: true, muted: true });
    await updateChat(w.owner.id, w.d, { status: 'closed' });
    await createTicket(w.owner.id, w.owner.id, { chatId: w.g, title: 'Factura duplicada' });
    expect(await w.list({ unread: 'no' })).toEqual(w.ids(w.a));
    expect(await w.list({ unread: 'yes' })).toEqual(w.ids(w.b, w.g, w.s));
    expect(await w.list({ pinned: 'yes' })).toEqual(w.ids(w.b));
    expect(await w.list({ pinned: 'no', muted: 'no' })).toEqual(w.ids(w.a, w.g, w.s));
    expect(await w.list({ muted: 'yes' })).toEqual(w.ids(w.b));
    expect(await w.list({ status: ['closed'] })).toEqual(w.ids(w.d));
    expect(await w.list({ status: ['open', 'closed'] })).toEqual(w.ids(w.a, w.b, w.g, w.d, w.s));
    expect(await w.list({ ticket: 'yes' })).toEqual(w.ids(w.g));
    expect(await w.list({ ticket: 'no', kinds: ['group'] })).toEqual([]);
    expect(await w.list({ agent: 'yes' })).toEqual([]);
    expect(await w.list({ crm: 'no', lines: [w.other.id] })).toEqual(w.ids(w.s));
    // Por cursor (como pide la bandeja), los fijados van adelante y el filtro vale igual.
    const paged = await listChats(w.owner.id, w.owner.id, { ...listQuery({ pinned: 'yes' }), cursor: '', count: false, limit: 60 });
    expect(paged.rows.map((r) => r.id)).toEqual([w.b]);
    expect(paged.pinned).toBe(1);
    const unpinned = await listChats(w.owner.id, w.owner.id, { ...listQuery({ pinned: 'no' }), cursor: '', count: false, limit: 60 });
    expect(unpinned.rows.map((r) => r.id).sort()).toEqual(w.ids(w.a, w.g, w.s));
  });

  it('fechas: último mensaje y desde cuándo está en Lines', async () => {
    const w = await world('gf-date');
    const db = getDb();
    const now = Date.now();
    const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
    await db.prepare('UPDATE groups_chats SET last_message_at = ?, created_at = ? WHERE id = ?').run(iso(3), iso(40), w.a);
    await db.prepare('UPDATE groups_chats SET last_message_at = ?, created_at = ? WHERE id = ?').run(iso(20), iso(45), w.b);
    await db.prepare('UPDATE groups_chats SET last_message_at = NULL, created_at = ? WHERE id = ?').run(iso(2), w.g);
    expect(await w.list({ lastMessage: { preset: 'last7' } })).toEqual(w.ids(w.a, w.d, w.s));
    expect(await w.list({ lastMessage: { preset: 'last30' } })).toEqual(w.ids(w.a, w.b, w.d, w.s));
    // Un chat sin mensajes no entra por "último mensaje", aunque sea nuevo.
    expect(await w.list({ lastMessage: { preset: 'last7' }, kinds: ['group'] })).toEqual([]);
    expect(await w.list({ created: { preset: 'last7' } })).toEqual(w.ids(w.g, w.d, w.s));
    const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);
    expect(await w.list({ created: { from: day(50), to: day(30) } })).toEqual(w.ids(w.a, w.b));
    expect(await w.list({ created: { to: day(30) }, assignees: [w.ana.id] })).toEqual(w.ids(w.a));
  });

  it('propiedades: un valor, varios, con o sin valor', async () => {
    const w = await world('gf-prop');
    const db = getDb();
    await db.prepare('UPDATE groups_chats SET properties = ? WHERE id = ?').run(JSON.stringify({ tier: 'Gold' }), w.a);
    await db.prepare('UPDATE groups_chats SET properties = ? WHERE id = ?').run(JSON.stringify({ tier: ['Silver', 'Bronze'] }), w.b);
    await db.prepare('UPDATE groups_chats SET properties = ? WHERE id = ?').run(JSON.stringify({ tier: 'Bronze' }), w.g);
    expect(await w.list({ props: [{ key: 'tier', op: 'is', value: 'Gold' }] })).toEqual(w.ids(w.a));
    expect(await w.list({ props: [{ key: 'tier', op: 'any', values: ['Gold', 'Silver'] }] })).toEqual(w.ids(w.a, w.b));
    expect(await w.list({ props: [{ key: 'tier', op: 'any', values: ['Gold', 'Silver'], orEmpty: true }] })).toEqual(w.ids(w.a, w.b, w.d, w.s));
    expect(await w.list({ props: [{ key: 'tier', op: 'set' }] })).toEqual(w.ids(w.a, w.b, w.g));
    expect(await w.list({ props: [{ key: 'tier', op: 'unset' }] })).toEqual(w.ids(w.d, w.s));
  });

  it('una lista guardada con el formato anterior sigue dando los mismos chats', async () => {
    const w = await world('gf-old');
    // Tal como quedaba en la base antes del panel de filtros.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb()
      .prepare('INSERT INTO groups_saved_lists (id, user_id, owner_id, shared, name, filters, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)')
      .run(id, w.owner.id, w.owner.id, 'VIP de Ana', JSON.stringify({ filter: 'unread', labelIds: [w.vip.id], assignee: w.ana.id, kind: 'dm' }), now, now);
    const list = (await getSavedList(w.owner.id, w.owner.id, id))!;
    expect(list.filters).toEqual({ kinds: ['dm'], assignees: [w.ana.id], labels: [w.vip.id], unread: 'yes' });
    expect(await w.list(list.filters)).toEqual(w.ids(w.a));
    expect((await savedListChatIds(w.owner.id, w.owner.id, id, await groupsViewer(w.owner.id, w.owner.id, 'owner'))).map((c) => c.id)).toEqual([w.a]);
    // "Míos" guardado antes: cada persona ve los suyos.
    const mine = await createSavedList(w.owner.id, w.owner.id, { name: 'Míos', shared: true, filters: { filter: 'mine' } });
    expect(mine.filters).toEqual({ assignees: [ME] });
    expect(await w.list(mine.filters, w.luis.id)).toEqual(w.ids(w.b, w.s));
    // Lo nuevo se guarda y se vuelve a leer igual.
    const fresh = await createSavedList(w.owner.id, w.owner.id, { name: 'Dos personas', filters: { assignees: [w.ana.id, w.luis.id], labels: [NONE], lastMessage: { preset: 'last7' }, junk: true } });
    expect(fresh.filters).toEqual({ assignees: [w.ana.id, w.luis.id], labels: [NONE], lastMessage: { preset: 'last7' } });
    expect(await w.list(fresh.filters)).toEqual(w.ids(w.d, w.s));
  });

  it('los filtros no dejan ver chats de una línea que la persona no ve', async () => {
    const w = await world('gf-priv');
    // "Soporte" pasa a ser solo de Ana: Luis no la ve, aunque tenga un chat asignado ahí.
    await setLineAccess(w.owner.id, w.other.id, { ownerId: w.ana.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const luis = await groupsViewer(w.owner.id, w.luis.id, 'member');
    const ana = await groupsViewer(w.owner.id, w.ana.id, 'member');
    const asLuis = (f: LinesFilters) => w.list(f, w.luis.id, { viewer: luis });
    expect(await asLuis({})).toEqual(w.ids(w.a, w.b, w.g, w.d));
    // Ni pidiendo esa línea, ni por persona, ni por "sin etiqueta", ni con los dos estados.
    expect(await asLuis({ lines: [w.other.id] })).toEqual([]);
    expect(await asLuis({ lines: [w.main.id, w.other.id] })).toEqual(w.ids(w.a, w.b, w.g, w.d));
    expect(await asLuis({ assignees: [ME] })).toEqual(w.ids(w.b));
    expect(await asLuis({ assignees: [w.luis.id, NONE] })).toEqual(w.ids(w.b, w.g));
    expect(await asLuis({ labels: [NONE] })).toEqual(w.ids(w.d));
    expect(await asLuis({ status: ['open', 'closed'], unread: 'yes' })).toEqual(w.ids(w.a, w.b, w.g, w.d));
    expect(await w.list({ lines: [w.other.id] }, w.ana.id, { viewer: ana })).toEqual(w.ids(w.s));
    // Lo mismo por una lista compartida que apunta a esa línea.
    const list = await createSavedList(w.owner.id, w.owner.id, { name: 'Soporte', shared: true, filters: { lines: [w.other.id] } });
    expect(await savedListChatIds(w.owner.id, w.luis.id, list.id, luis)).toEqual([]);
    expect((await savedListChatIds(w.owner.id, w.ana.id, list.id, ana)).map((c) => c.id)).toEqual([w.s]);
  });
});
