import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createDocPage,
  createDocShare,
  getDocAccess,
  getDocPage,
  getDocPageRow,
  listSharedWithMe,
  updateDocPage,
  updateDocShareRole,
} from '@/lib/docs';
import {
  AUTO_INTERVAL_MS,
  MAX_VERSIONS,
  getDocVersion,
  listDocVersions,
  maybeAutoSnapshot,
  restoreDocVersion,
  saveDocVersion,
} from '@/lib/docs-versions';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const para = (text: string) => [{ id: crypto.randomUUID(), type: 'paragraph' as const, content: text }];

describe('Docs: compartir', () => {
  it('sin share no hay acceso; is_public (IA) no da lectura; publicada sí', async () => {
    const owner = await makeUser('own');
    const other = await makeUser('oth');
    const page = await createDocPage(owner.id, { title: 'Privada' });
    const row = async () => (await getDocPageRow(page.id))!;
    expect(await getDocAccess(await row(), { id: owner.id })).toBe('owner');
    expect(await getDocAccess(await row(), { id: other.id })).toBeNull();
    await updateDocPage(owner.id, page.id, { is_public: true });
    expect(await getDocAccess(await row(), { id: other.id })).toBeNull();
    await updateDocPage(owner.id, page.id, { published: true });
    expect(await getDocAccess(await row(), { id: other.id })).toBe('view');
  });

  it('share por persona: ver / editar, y aparece en "Compartidas conmigo"', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Plan Q3' });
    const share = await createDocShare(owner.id, page.id, 'user', guest.id, 'view');
    expect(share?.role).toBe('view');
    const row = (await getDocPageRow(page.id))!;
    expect(await getDocAccess(row, { id: guest.id })).toBe('view');
    // Re-compartir con el mismo destino actualiza el rol en vez de duplicar.
    const again = await createDocShare(owner.id, page.id, 'user', guest.id, 'edit');
    expect(again?.id).toBe(share?.id);
    expect(await getDocAccess(row, { id: guest.id })).toBe('edit');
    await updateDocShareRole(owner.id, page.id, share!.id, 'view');
    expect(await getDocAccess(row, { id: guest.id })).toBe('view');

    const shared = await listSharedWithMe(guest.id, guest.id);
    expect(shared.map((p) => p.id)).toEqual([page.id]);
    expect(shared[0].role).toBe('view');
    // El dueño no la ve como "compartida" en su propio workspace.
    expect(await listSharedWithMe(owner.id, owner.id)).toEqual([]);
  });

  it('solo el dueño puede compartir', async () => {
    const owner = await makeUser('own');
    const intruder = await makeUser('int');
    const page = await createDocPage(owner.id, { title: 'X' });
    expect(await createDocShare(intruder.id, page.id, 'user', intruder.id, 'edit')).toBeNull();
    expect(await getDocAccess((await getDocPageRow(page.id))!, { id: intruder.id })).toBeNull();
  });

  it('share por team: los miembros acceden con el rol del share', async () => {
    const owner = await makeUser('own');
    const teamOwner = await makeUser('tow');
    const member = await makeUser('mem');
    const team = await createTeam(teamOwner.id, 'Diseño');
    await addMember(team.id, member.id, 'member');
    const page = await createDocPage(owner.id, { title: 'Brief' });
    await createDocShare(owner.id, page.id, 'team', team.id, 'edit');
    const row = (await getDocPageRow(page.id))!;
    expect(await getDocAccess(row, { id: member.id })).toBe('edit');
    expect((await listSharedWithMe(member.id, member.id)).map((p) => p.id)).toContain(page.id);
  });

  it('un archivado o borrado deja de listarse', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Temporal' });
    await createDocShare(owner.id, page.id, 'user', guest.id);
    await updateDocPage(owner.id, page.id, { archived: true });
    expect(await listSharedWithMe(guest.id, guest.id)).toEqual([]);
  });
});

describe('Docs: versiones', () => {
  it('snapshot automático con throttle y estado original en la primera edición', async () => {
    const owner = await makeUser('ver');
    const page = await createDocPage(owner.id, { title: 'V', content: para('uno') });
    const before = (await getDocPageRow(page.id))!;
    await updateDocPage(owner.id, page.id, { content: para('dos') });
    const t0 = new Date();
    expect(await maybeAutoSnapshot(owner.id, page.id, owner.id, before, t0)).toBe(true);
    let versions = await listDocVersions(owner.id, page.id);
    // Estado original (sin autor) + estado nuevo.
    expect(versions).toHaveLength(2);
    expect(versions[0].author_id).toBe(owner.id);
    expect(versions[1].author_id).toBeNull();

    await updateDocPage(owner.id, page.id, { content: para('tres') });
    expect(await maybeAutoSnapshot(owner.id, page.id, owner.id, null, new Date(t0.getTime() + 60_000))).toBe(false);
    expect(await maybeAutoSnapshot(owner.id, page.id, owner.id, null, new Date(t0.getTime() + AUTO_INTERVAL_MS + 1000))).toBe(true);
    versions = await listDocVersions(owner.id, page.id);
    expect(versions).toHaveLength(3);
  });

  it('restaurar guarda el estado actual y vuelve al contenido de la versión', async () => {
    const owner = await makeUser('ver');
    const page = await createDocPage(owner.id, { title: 'Original', content: para('primera') });
    const v1 = await saveDocVersion(owner.id, page.id, owner.id, 'manual');
    await updateDocPage(owner.id, page.id, { title: 'Cambiado', content: para('segunda') });
    expect(await restoreDocVersion(owner.id, page.id, v1!, owner.id)).toBe(true);
    const restored = await getDocPage(owner.id, page.id);
    expect(restored?.title).toBe('Original');
    expect(restored?.content[0].content).toBe('primera');
    const versions = await listDocVersions(owner.id, page.id);
    expect(versions[0].kind).toBe('restore');
    const before = await getDocVersion(owner.id, page.id, versions[0].id);
    expect(before?.content[0].content).toBe('segunda');
  });

  it('las versiones son del workspace dueño (otro workspace no las ve ni restaura)', async () => {
    const owner = await makeUser('ver');
    const other = await makeUser('oth');
    const page = await createDocPage(owner.id, { title: 'P', content: para('x') });
    const v = await saveDocVersion(owner.id, page.id, owner.id);
    expect(await listDocVersions(other.id, page.id)).toEqual([]);
    expect(await getDocVersion(other.id, page.id, v!)).toBeNull();
    expect(await restoreDocVersion(other.id, page.id, v!, other.id)).toBe(false);
    expect(await saveDocVersion(other.id, page.id, other.id)).toBeNull();
  });

  it(`conserva como mucho ${MAX_VERSIONS} versiones por página`, async () => {
    const owner = await makeUser('cap');
    const page = await createDocPage(owner.id, { title: 'Cap' });
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await saveDocVersion(owner.id, page.id, owner.id);
    const row = (await getDb().prepare('SELECT COUNT(*) AS c FROM docs_versions WHERE page_id = ?').get(page.id)) as { c: number };
    expect(row.c).toBe(MAX_VERSIONS);
  });
});

describe('Docs: export Markdown', () => {
  it('convierte bloques y marcas en línea', () => {
    const md = blocksToMarkdown(
      [
        { id: '1', type: 'heading', level: 1, content: 'Intro' },
        { id: '2', type: 'paragraph', content: 'Hola <strong>mundo</strong> y <a href="https://x.com" target="_blank" rel="noopener noreferrer">link</a> &amp; más' },
        { id: '3', type: 'bulleted_list_item', content: 'uno' },
        { id: '4', type: 'bulleted_list_item', content: 'dos' },
        { id: '5', type: 'numbered_list_item', content: 'a' },
        { id: '6', type: 'numbered_list_item', content: 'b' },
        { id: '7', type: 'todo', content: 'tarea', checked: true },
        { id: '8', type: 'code', language: 'js', content: 'const a = 1 &lt; 2;' },
        { id: '9', type: 'quote', content: 'cita' },
        { id: '10', type: 'divider', content: '' },
        { id: '11', type: 'table', content: '', rows: [['A', 'B'], ['1', '2|3']] },
      ],
      'Título',
    );
    expect(md).toBe(
      [
        '# Título',
        '## Intro',
        'Hola **mundo** y [link](https://x.com) & más',
        '- uno\n- dos',
        '1. a\n2. b',
        '- [x] tarea',
        '```js\nconst a = 1 < 2;\n```',
        '> cita',
        '---',
        '| A | B |\n| --- | --- |\n| 1 | 2\\|3 |',
      ].join('\n\n') + '\n',
    );
  });
});
