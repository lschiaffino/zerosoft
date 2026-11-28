import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import type { BiViewer } from '@/lib/bi/access';
import { diffSnapshots, MAX_REVISIONS, type QuestionSnapshot } from '@/lib/bi/revisions';
import { BiStoreError, createQuestion, deleteQuestion, getQuestion, listQuestionRevisions, revertQuestion, updateQuestion } from '@/lib/bi/store';

const WS = 'bih-owner';
const MEMBER = 'bih-member';
const OTHER = 'bih-other';
const owner: BiViewer = { workspaceId: WS, personId: WS, role: 'owner', apps: '*' };
const member: BiViewer = { workspaceId: WS, personId: MEMBER, role: 'member', apps: ['analytics'] };
const stranger: BiViewer = { workspaceId: OTHER, personId: OTHER, role: 'owner', apps: '*' };

const sql = (text: string) => ({ kind: 'sql' as const, sql: text, params: [] });

beforeAll(async () => {
  await upsertUser({ id: WS, email: `${WS}@test.local`, name: 'Owner Name' });
  await upsertUser({ id: MEMBER, email: `${MEMBER}@test.local`, name: 'Member Name' });
  await upsertUser({ id: OTHER, email: `${OTHER}@test.local`, name: OTHER });
  const db = getDb();
  await db.prepare("INSERT OR IGNORE INTO teams (id, name, owner_id) VALUES ('bih-team', 'BIH', ?)").run(WS);
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role, apps) VALUES ('bih-team', ?, 'member', '[\"analytics\"]')").run(MEMBER);
});

describe('qué cambió', () => {
  const base: QuestionSnapshot = { name: 'A', description: '', source: 'zerosoft', collectionId: null, query: sql('SELECT 1 AS n FROM contacts'), viz: { type: 'auto' } };
  it('lista los campos distintos en orden fijo', () => {
    expect(diffSnapshots(base, base)).toEqual([]);
    expect(diffSnapshots(base, { ...base, viz: { type: 'bar' }, name: 'B' })).toEqual(['name', 'viz']);
    expect(diffSnapshots(base, { ...base, collectionId: 'c1', query: sql('SELECT 2 AS n FROM contacts') })).toEqual(['collection', 'query']);
  });
});

describe('historial de versiones de una pregunta', () => {
  it('crear, editar, guardar sin cambios y volver a una versión vieja', async () => {
    const q = await createQuestion(owner, { name: 'Contactos', query: sql('SELECT COUNT(*) AS n FROM contacts') });
    let revs = await listQuestionRevisions(owner, q.id);
    expect(revs.map((r) => r.kind)).toEqual(['create']);
    expect(revs[0].authorName).toBe('Owner Name');
    expect(revs[0].current).toBe(true);

    await updateQuestion(owner, q.id, { name: 'Contactos por mes', viz: { type: 'line' } });
    // Guardar lo mismo no suma versión.
    await updateQuestion(owner, q.id, { name: 'Contactos por mes' });
    await updateQuestion(owner, q.id, { query: sql('SELECT COUNT(*) AS total FROM contacts') });
    revs = await listQuestionRevisions(owner, q.id);
    expect(revs.map((r) => [r.kind, r.changes])).toEqual([
      ['edit', ['query']],
      ['edit', ['name', 'viz']],
      ['create', []],
    ]);
    expect(revs.map((r) => r.current)).toEqual([true, false, false]);

    const first = revs[2];
    const back = await revertQuestion(owner, q.id, first.id);
    expect(back.name).toBe('Contactos');
    expect(back.viz.type).toBe('auto');
    expect(back.query).toEqual(sql('SELECT COUNT(*) AS n FROM contacts'));
    revs = await listQuestionRevisions(owner, q.id);
    expect(revs[0].kind).toBe('revert');
    expect(revs[0].changes).toEqual(['name', 'query', 'viz']);
    expect(revs).toHaveLength(4);
  });

  it('una pregunta de antes del historial arranca con su versión anterior', async () => {
    const q = await createQuestion(owner, { name: 'Vieja', query: sql('SELECT 1 AS n FROM contacts') });
    // Como si se hubiera guardado antes de esta función.
    await getDb().prepare("DELETE FROM bi_revisions WHERE item_id = ?").run(q.id);
    await updateQuestion(owner, q.id, { name: 'Nueva' });
    const revs = await listQuestionRevisions(owner, q.id);
    expect(revs.map((r) => r.kind)).toEqual(['edit', 'baseline']);
    const restored = await revertQuestion(owner, q.id, revs[1].id);
    expect(restored.name).toBe('Vieja');
  });

  it('permisos: un miembro ve el historial pero no restaura lo de otro; otro workspace no lo ve', async () => {
    const q = await createQuestion(owner, { name: 'Del owner', query: sql('SELECT 1 AS n FROM contacts') });
    await updateQuestion(owner, q.id, { name: 'Del owner 2' });
    const revs = await listQuestionRevisions(member, q.id);
    expect(revs).toHaveLength(2);
    await expect(revertQuestion(member, q.id, revs[1].id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listQuestionRevisions(stranger, q.id)).rejects.toBeInstanceOf(BiStoreError);
    await expect(revertQuestion(stranger, q.id, revs[1].id)).rejects.toMatchObject({ code: 'not_found' });
    // Una versión de otra pregunta no sirve.
    const other = await createQuestion(owner, { name: 'Otra', query: sql('SELECT 2 AS n FROM contacts') });
    await expect(revertQuestion(owner, other.id, revs[1].id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('tope de versiones y borrado', async () => {
    const q = await createQuestion(owner, { name: 'v0', query: sql('SELECT 1 AS n FROM contacts') });
    for (let i = 1; i <= MAX_REVISIONS + 5; i++) await updateQuestion(owner, q.id, { name: `v${i}` });
    const revs = await listQuestionRevisions(owner, q.id);
    expect(revs).toHaveLength(MAX_REVISIONS);
    expect((await getQuestion(owner, q.id))?.name).toBe(`v${MAX_REVISIONS + 5}`);
    await deleteQuestion(owner, q.id);
    const left = await getDb().prepare('SELECT COUNT(*) AS n FROM bi_revisions WHERE item_id = ?').get(q.id);
    expect(Number((left as { n: number }).n)).toBe(0);
  });
});
