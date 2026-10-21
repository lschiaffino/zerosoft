import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActivity,
  createContact,
  createCustomField,
  deleteActivity,
  deleteContact,
  listContacts,
  parseCustom,
} from '@/lib/crm';
import { bulkSetProperty } from '@/lib/crm-bulk';
import {
  coerceCustomFieldValue,
  customFieldHref,
  fieldCurrency,
  filterTypeFor,
  formatCustomFieldValue,
  typedCustomValues,
} from '@/lib/crm-custom-fields';
import { customBuilderFields, customCells } from '@/components/crm/customFieldViews';
import { customBulkFields } from '@/components/crm/bulkFields';
import { readCustomFields } from '@/components/crm/formPayload';
import { createRecordFile, deleteRecordFile, listActivityFiles, listRecordFiles, withActivityFiles } from '@/lib/crm-files';
import { listTrash, purgeTrash, restoreTrash, snapshotFileUrls } from '@/lib/crm-trash';
import { createTaskFile } from '@/lib/crm';
import {
  findMentions,
  mentionQueryAt,
  mentionSegments,
  mentionSuggestions,
  newMentions,
  type Mentionable,
} from '@/lib/crm-mentions';
import { activityHref, notifyActivityMentions } from '@/lib/crm-mention-notify';
import { listNotifications } from '@/lib/notifications';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('CRM: tipos nuevos de custom field', () => {
  const multi = { type: 'multiselect' as const, options: '["Ventas","Soporte","API"]' };

  it('normaliza cada tipo', () => {
    expect(coerceCustomFieldValue(multi, ['API', 'Ventas'])).toEqual(['Ventas', 'API']);
    expect(coerceCustomFieldValue(multi, 'Soporte, API')).toEqual(['Soporte', 'API']);
    expect(coerceCustomFieldValue(multi, ['Otra'])).toBeUndefined();
    expect(coerceCustomFieldValue(multi, [])).toBeNull();
    expect(coerceCustomFieldValue({ type: 'url', options: '[]' }, 'acme.com')).toBe('https://acme.com');
    expect(coerceCustomFieldValue({ type: 'url', options: '[]' }, 'javascript:alert(1)')).toBeUndefined();
    expect(coerceCustomFieldValue({ type: 'phone', options: '[]' }, '+1 (555) 010-2030')).toBe('+1 (555) 010-2030');
    expect(coerceCustomFieldValue({ type: 'phone', options: '[]' }, 'call me')).toBeUndefined();
    expect(coerceCustomFieldValue({ type: 'currency', options: '["EUR"]' }, '12.5')).toBe(12.5);
    expect(coerceCustomFieldValue({ type: 'user', options: '[]' }, 'u1', new Set(['u1']))).toBe('u1');
    expect(coerceCustomFieldValue({ type: 'user', options: '[]' }, 'u2', new Set(['u1']))).toBeUndefined();
  });

  it('formato, links y tipo de filtro', () => {
    const ctx = { locale: 'en', yes: 'Yes', no: 'No', users: new Map([['u1', 'Ana']]) };
    expect(formatCustomFieldValue({ type: 'currency', options: '["EUR"]' }, 1234.5, ctx)).toBe('€1,234.50');
    expect(formatCustomFieldValue(multi, ['Ventas', 'API'], ctx)).toBe('Ventas, API');
    expect(formatCustomFieldValue({ type: 'user', options: '[]' }, 'u1', ctx)).toBe('Ana');
    expect(fieldCurrency({ options: '["xx"]' })).toBe('USD');
    expect(customFieldHref({ type: 'phone' }, '+1 (555) 010')).toBe('tel:+1555010');
    expect(customFieldHref({ type: 'url' }, 'https://acme.com')).toBe('https://acme.com');
    expect(filterTypeFor('currency')).toBe('number');
    expect(filterTypeFor('user')).toBe('select');
    expect(filterTypeFor('multiselect')).toBe('multiselect');
    expect(filterTypeFor('phone')).toBe('text');
    expect(typedCustomValues([{ name: 'n', type: 'number', options: '[]' }], { n: '3', other: 'x', bad: 1 })).toEqual({
      n: 3,
      other: 'x',
      bad: 1,
    });
  });

  it('constructor de filtros, celdas, edición en masa y formularios', () => {
    const defs = [
      { id: '1', user_id: 'w', entity: 'contacts', name: 'topics', label: 'Temas', type: 'multiselect' as const, options: multi.options, position: 0 },
      { id: '2', user_id: 'w', entity: 'contacts', name: 'csm', label: 'CSM', type: 'user' as const, options: '[]', position: 1 },
      { id: '3', user_id: 'w', entity: 'contacts', name: 'site', label: 'Sitio', type: 'url' as const, options: '[]', position: 2 },
    ];
    const owners = [{ value: 'u1', label: 'Ana' }];
    const builder = customBuilderFields(defs, { yes: 'Y', no: 'N' }, owners);
    expect(builder.map((f) => f.type)).toEqual(['select', 'select', 'text']);
    expect(builder[1].options).toEqual(owners);
    const cells = customCells(defs, { topics: ['API'], csm: 'u1', site: 'https://a.co' }, {
      locale: 'en',
      yes: 'Y',
      no: 'N',
      users: new Map([['u1', 'Ana']]),
    });
    expect(cells).toEqual({
      'custom:topics': { text: 'API' },
      'custom:csm': { text: 'Ana' },
      'custom:site': { text: 'https://a.co', href: 'https://a.co' },
    });
    expect(customBulkFields(defs, { yes: 'Y', no: 'N' }, owners).map((f) => f.type)).toEqual(['multiselect', 'select', 'text']);
    const fd = new FormData();
    fd.append('custom.topics', 'API');
    fd.append('custom.topics', 'Ventas');
    fd.append('custom.site', 'acme.com');
    expect(
      readCustomFields(fd, [
        { name: 'topics', label: 'Temas', type: 'multiselect', options: ['Ventas', 'Soporte', 'API'] },
        { name: 'site', label: 'Sitio', type: 'url', options: [] },
      ]),
    ).toEqual({ topics: ['Ventas', 'API'], site: 'https://acme.com' });
  });

  it('se guardan, se filtran y se editan en masa', async () => {
    const u = await makeUser('cf-new');
    for (const [name, type, options] of [
      ['topics', 'multiselect', ['Ventas', 'Soporte', 'API']],
      ['budget', 'currency', ['EUR']],
      ['site', 'url', []],
      ['mobile', 'phone', []],
      ['csm', 'user', []],
    ] as const) {
      const f = await createCustomField(u.id, { entity: 'contacts', name, label: name, type, options: [...options] });
      expect(f.type).toBe(type);
    }
    const a = await createContact(u.id, { firstName: 'A', custom: { topics: ['Ventas', 'API'], budget: 900 } });
    const b = await createContact(u.id, { firstName: 'B', custom: { topics: ['Soporte'], budget: 100 } });
    const customTypes = { topics: 'multiselect' as const, budget: 'number' as const };
    const has = await listContacts(u.id, { filters: [{ f: 'custom:topics', o: 'is', v: 'API' }], customTypes });
    expect(has.rows.map((r) => r.id)).toEqual([a.id]);
    const hasNot = await listContacts(u.id, { filters: [{ f: 'custom:topics', o: 'isnot', v: 'API' }], customTypes });
    expect(hasNot.rows.map((r) => r.id)).toEqual([b.id]);
    const rich = await listContacts(u.id, { filters: [{ f: 'custom:budget', o: 'gt', v: '500' }], customTypes });
    expect(rich.rows.map((r) => r.id)).toEqual([a.id]);

    expect(await bulkSetProperty(u.id, 'contact', [a.id, b.id], 'custom:topics', ['API', 'Soporte'])).toEqual({
      ok: true,
      count: 2,
      failed: 0,
      blocked: 0,
    });
    expect(await bulkSetProperty(u.id, 'contact', [a.id], 'custom:topics', ['Nope'])).toEqual({ ok: false, code: 'invalid_input' });
    expect(await bulkSetProperty(u.id, 'contact', [a.id], 'custom:site', 'acme.com')).toMatchObject({ ok: true, count: 1 });
    const row = (await getDb().prepare('SELECT custom FROM crm_contacts WHERE id = ?').get(a.id)) as { custom: string };
    expect(parseCustom(row.custom)).toMatchObject({ topics: ['Soporte', 'API'], site: 'https://acme.com', budget: 900 });
  });
});

describe('CRM: archivos en notas y registros', () => {
  it('adjuntos de registros y de notas viajan con la papelera y se borran al purgar', async () => {
    const u = await makeUser('files');
    const c = await createContact(u.id, { firstName: 'Fi', lastName: 'Les' });
    const f = await createRecordFile(u.id, 'contact', c.id, {
      filename: 'contrato.pdf',
      contentType: 'application/pdf',
      size: 10,
      url: 'https://blob.test/contrato.pdf',
    });
    expect((await listRecordFiles(u.id, 'contact', c.id)).map((x) => x.id)).toEqual([f.id]);
    expect(await listRecordFiles(u.id, 'company', c.id)).toEqual([]);

    const note = await createActivity(u.id, { type: 'note', subject: 'Nota', contactId: c.id });
    const nf = await createTaskFile(note.id, { filename: 'foto.png', contentType: 'image/png', size: 5, url: '/uploads/tasks/x-foto.png' });
    expect((await listActivityFiles([note.id])).get(note.id)?.map((x) => x.id)).toEqual([nf.id]);
    const items = await withActivityFiles([{ id: note.id }, { id: 'thread', external: true }]);
    expect(items[0].files?.[0].filename).toBe('foto.png');
    expect(items[1].files).toBeUndefined();

    expect(await deleteContact(u.id, c.id, 'x@test')).toBe(true);
    expect(await getDb().prepare('SELECT 1 FROM crm_record_files WHERE id = ?').get(f.id)).toBeUndefined();
    const [entry] = await listTrash(u.id, { entity: 'contact' });
    const snap = (await getDb().prepare('SELECT snapshot FROM crm_trash WHERE id = ?').get(entry.id)) as { snapshot: string };
    expect(snapshotFileUrls(snap.snapshot).sort()).toEqual(['/uploads/tasks/x-foto.png', 'https://blob.test/contrato.pdf']);

    expect((await restoreTrash(u.id, entry.id)).ok).toBe(true);
    expect((await listRecordFiles(u.id, 'contact', c.id)).map((x) => x.id)).toEqual([f.id]);
    expect((await listActivityFiles([note.id])).get(note.id)).toHaveLength(1);

    // Una nota suelta en la papelera: su adjunto se va al purgar.
    expect(await deleteActivity(u.id, note.id)).toBe(true);
    const [noteEntry] = await listTrash(u.id, { entity: 'activity' });
    expect(await purgeTrash(u.id, [noteEntry.id])).toBe(1);
    expect(await getDb().prepare('SELECT 1 FROM crm_task_files WHERE id = ?').get(nf.id)).toBeUndefined();

    expect(await deleteRecordFile(u.id, 'contact', c.id, 'nope')).toBe(false);
    expect(await deleteRecordFile(u.id, 'contact', c.id, f.id)).toBe(true);
    expect(await listRecordFiles(u.id, 'contact', c.id)).toEqual([]);
  });
});

describe('CRM: @menciones', () => {
  const people: Mentionable[] = [
    { id: 'ana', name: 'Ana', email: 'ana@x.com' },
    { id: 'anam', name: 'Ana María', email: 'am@x.com' },
    { id: 'beto', name: 'Beto Paz', email: 'beto@x.com' },
  ];

  it('reconoce nombres (el más largo), emails y no confunde emails escritos', () => {
    expect(findMentions('Hola @Ana María y @beto paz, mirá esto', people)).toEqual(['anam', 'beto']);
    expect(findMentions('@ana, @am@x.com', people)).toEqual(['ana', 'anam']);
    expect(findMentions('escribile a juan@ana.com', people)).toEqual([]);
    expect(findMentions('@Anabel', people)).toEqual([]);
    expect(newMentions('@Ana', '@Ana y @Beto Paz', people)).toEqual(['beto']);
    expect(mentionSegments('Ok @Ana!', people)).toEqual([
      { text: 'Ok ' },
      { text: '@Ana', mention: true, id: 'ana' },
      { text: '!' },
    ]);
  });

  it('autocompletado', () => {
    expect(mentionQueryAt('hola @an', 8)).toEqual({ query: 'an', start: 5 });
    expect(mentionQueryAt('mail a@b', 8)).toBeNull();
    expect(mentionQueryAt('hola', 4)).toBeNull();
    expect(mentionSuggestions('be', people).map((p) => p.id)).toEqual(['beto']);
    expect(mentionSuggestions('ma', people).map((p) => p.id)).toEqual(['anam']);
  });

  it('avisa in-app y por email a los mencionados (no al autor, solo lo nuevo al editar)', async () => {
    const owner = await makeUser('m-owner');
    const mate = await makeUser('m-mate');
    const team: Mentionable[] = [
      { id: owner.id, name: 'Olga Owner', email: owner.email },
      { id: mate.id, name: 'Mate Uno', email: mate.email },
    ];
    const c = await createContact(owner.id, { firstName: 'Cli', lastName: 'Ente' });
    const note = await createActivity(owner.id, {
      type: 'note',
      subject: 'Llamada',
      body: '@Mate Uno revisá esto. @Olga Owner',
      contactId: c.id,
    });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const sent = await notifyActivityMentions({
      activity: note,
      actor: { id: owner.id, name: 'Olga Owner', email: owner.email },
      people: team,
      locale: 'es',
    });
    expect(sent).toEqual([mate.id]);
    const notes = await listNotifications(mate.id);
    expect(notes[0]).toMatchObject({ type: 'mention', href: `/app/crm/contacts/${c.id}`, source_type: 'crm_activity' });
    expect(notes[0].title).toContain('Olga Owner te mencionó en una nota');
    expect(logs.join('\n')).toContain(`to=${mate.email}`);
    expect(await listNotifications(owner.id)).toHaveLength(0);

    // Editar sin sumar menciones nuevas no vuelve a avisar.
    const again = await notifyActivityMentions({
      activity: { ...note, body: `${note.body} (editado)` },
      actor: { id: owner.id, name: 'Olga Owner', email: owner.email },
      people: team,
      before: `${note.subject}\n${note.body}`,
    });
    expect(again).toEqual([]);
    // Llamadas y reuniones no avisan.
    expect(
      await notifyActivityMentions({ activity: { ...note, type: 'call' }, actor: { id: owner.id, name: null, email: owner.email }, people: team }),
    ).toEqual([]);
    expect(activityHref({ ...note, type: 'task' })).toBe(`/app/crm/tasks/${note.id}`);
  });

  it('no avisa a quien no puede ver el registro', async () => {
    const { setMemberVisibility } = await import('@/lib/crm-visibility');
    const owner = await makeUser('m-vis-owner');
    const mate = await makeUser('m-vis-mate');
    const team = [
      { id: owner.id, name: 'Vera Owner', email: owner.email, role: 'owner' as const },
      { id: mate.id, name: 'Memo Dos', email: mate.email, role: 'member' as const },
    ];
    await setMemberVisibility(owner.id, 'mine');
    const c = await createContact(owner.id, { firstName: 'Priv', lastName: 'Ado' });
    const note = await createActivity(owner.id, { type: 'note', subject: 'Nota', body: '@Memo Dos mirá', contactId: c.id });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const actor = { id: owner.id, name: 'Vera Owner', email: owner.email };
    expect(await notifyActivityMentions({ activity: note, actor, people: team, workspaceId: owner.id })).toEqual([]);
    expect(await listNotifications(mate.id)).toHaveLength(0);
    await setMemberVisibility(owner.id, 'all');
    expect(await notifyActivityMentions({ activity: note, actor, people: team, workspaceId: owner.id })).toEqual([mate.id]);
  });
});
