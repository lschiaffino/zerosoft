import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { DocsBlock } from '@/lib/docs-types';
import {
  dropBeside,
  flattenContainers,
  makeColumnList,
  normalizeColumns,
  normalizeStructure,
  resizeRatios,
  scopeBaseIndent,
  visualIndent,
} from '@/lib/docs-columns';
import { cleanExternalUrl, embedFor, pastedUrl } from '@/lib/docs-embeds';
import { dateMentionHtml, dateSuggestions, parseDay, parseTime, remindersInHtml } from '@/lib/docs-dates';
import { parseLinkMeta, unfurlLink } from '@/lib/docs-unfurl';
import { sanitizeBlocks, sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { createDocPage, getDocPage, updateDocPage } from '@/lib/docs';
import { getSyncedBlock, hydrateSyncedBlocks } from '@/lib/docs-synced';
import { fireDocReminders, pageReminders } from '@/lib/docs-reminders';
import { reminderContext } from '@/lib/docs-schema';
import { addDocFavorite, listDocFavorites, moveInOrder, removeDocFavorite, reorderDocFavorites } from '@/lib/docs-favorites';
import { addRowFromTemplate, defaultDatabase, removeRowTemplate, saveRowAsTemplate } from '@/lib/docs-database';
import { fileKindFor, fileKindForRequest, iconImageUrl, isDocsStoragePathname, pageImageBlock } from '@/lib/docs-files';
import { parseRange } from '@/lib/upload-serve';
import { getDocTemplates } from '@/lib/docs-templates';
import { withInlineMath } from '@/lib/docs-math';
import { makeUser } from './helpers';

let n = 0;
const id = () => `id${++n}`;
const p = (content: string, indent?: number): DocsBlock => ({ id: id(), type: 'paragraph', content, ...(indent ? { indent } : {}) });

describe('Docs D1: columnas', () => {
  it('soltar un bloque al costado de otro arma una fila de dos columnas', () => {
    const blocks = [p('A'), p('B'), p('C')];
    const out = dropBeside(blocks, 2, 0, 'right', id)!;
    expect(out.map((b) => [b.type, b.content, b.indent ?? 0])).toEqual([
      ['columns', '', 0],
      ['column', '', 1],
      ['paragraph', 'A', 2],
      ['column', '', 1],
      ['paragraph', 'C', 2],
      ['paragraph', 'B', 0],
    ]);
    // A la izquierda queda primero lo soltado.
    const left = dropBeside(blocks, 2, 0, 'left', id)!;
    expect(left.filter((b) => b.type === 'paragraph').map((b) => b.content)).toEqual(['C', 'A', 'B']);
  });

  it('al costado de un bloque que ya está en columnas suma una columna (hasta 5)', () => {
    let blocks = [...makeColumnList(2, 0, id), p('X')];
    const inFirst = blocks.findIndex((b, i) => i > 1 && b.type === 'paragraph');
    blocks = dropBeside(blocks, blocks.length - 1, inFirst, 'right', id)!;
    expect(blocks.filter((b) => b.type === 'column')).toHaveLength(3);
    expect(blocks.filter((b) => b.type === 'column').every((c) => c.ratio === 1)).toBe(true);
    for (let k = 0; k < 2; k++) {
      blocks = [...blocks, p(`Y${k}`)];
      blocks = dropBeside(blocks, blocks.length - 1, 2, 'right', id)!;
    }
    expect(blocks.filter((b) => b.type === 'column')).toHaveLength(5);
    const full = [...blocks, p('Z')];
    expect(dropBeside(full, full.length - 1, 2, 'right', id)).toBeNull();
  });

  it('una columna vacía se va y una fila de una sola columna se deshace', () => {
    const blocks = makeColumnList(2, 0, id);
    // Saco el párrafo de la segunda columna.
    const withoutSecond = blocks.filter((_, i) => i !== 4);
    const out = normalizeColumns(withoutSecond, id);
    expect(out.map((b) => [b.type, b.indent ?? 0])).toEqual([['paragraph', 0]]);
    // Lo suelto adentro de la fila entra a la columna anterior.
    const loose = [...makeColumnList(2, 0, id), p('suelto', 1)];
    const fixed = normalizeColumns(loose, id);
    expect(fixed[fixed.length - 1]).toMatchObject({ content: 'suelto', indent: 2 });
    expect(normalizeColumns(fixed, id)).toBe(fixed);
  });

  it('niveles visuales y base del contenedor; sincronizado sin hijos recibe un párrafo', () => {
    const blocks = [...makeColumnList(2, 0, id)];
    expect(scopeBaseIndent(blocks, 2)).toBe(2);
    expect(visualIndent(blocks, 2)).toBe(0);
    const synced = normalizeStructure([{ id: id(), type: 'synced', content: '', synced_id: 'abcdefgh1' }], id);
    expect(synced.map((b) => [b.type, b.indent ?? 0])).toEqual([
      ['synced', 0],
      ['paragraph', 1],
    ]);
  });

  it('el separador reparte el ancho y deja al menos 10%', () => {
    expect(resizeRatios([1, 1], 0, 100, 400)).toEqual([1.5, 0.5]);
    expect(resizeRatios([1, 1], 0, 10_000, 400)).toEqual([1.8, 0.2]);
  });

  it('exportar saca los contenedores: el contenido queda en orden y sin sangría', () => {
    const blocks = [...makeColumnList(2, 0, id)];
    blocks[2] = { ...blocks[2], content: 'Izquierda' };
    blocks[4] = { ...blocks[4], content: 'Derecha' };
    expect(flattenContainers(blocks).map((b) => [b.content, b.indent ?? 0])).toEqual([
      ['Izquierda', 0],
      ['Derecha', 0],
    ]);
    expect(blocksToMarkdown(blocks)).toBe('Izquierda\n\nDerecha\n');
  });
});

describe('Docs D1: embeds y bookmarks', () => {
  it('arma el iframe de cada proveedor desde el link', () => {
    expect(embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
    expect(embedFor('https://youtu.be/dQw4w9WgXcQ')?.provider).toBe('youtube');
    expect(embedFor('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871');
    expect(embedFor('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.src).toContain('loom.com/embed/');
    expect(embedFor('https://www.figma.com/design/abc123/Thing?node-id=1-2')?.src).toContain('figma.com/embed?embed_host=zerosoft&url=');
    expect(embedFor('https://www.google.com/maps/place/Buenos+Aires')?.src).toContain('output=embed');
    expect(embedFor('https://docs.google.com/document/d/1AbC_def/edit')?.src).toBe('https://docs.google.com/document/d/1AbC_def/preview');
    expect(embedFor('https://codepen.io/team/pen/abcDEF')?.src).toBe('https://codepen.io/team/embed/abcDEF?default-tab=result');
    expect(embedFor('https://x.com/user/status/1234567890123')?.src).toContain('platform.twitter.com/embed/Tweet.html?id=1234567890123');
    const gist = embedFor('https://gist.github.com/octocat/6cad326836d38bd3a7ae');
    expect(gist?.srcdoc).toContain('https://gist.github.com/octocat/6cad326836d38bd3a7ae.js');
    // El gist corre aislado: sin allow-same-origin.
    expect(gist?.sandbox).not.toContain('allow-same-origin');
    expect(embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')?.height).toBe(152);
    expect(embedFor('https://example.com/page')).toBeNull();
    expect(embedFor('javascript:alert(1)')).toBeNull();
  });

  it('links pegados: uno solo y http(s), sin credenciales', () => {
    expect(pastedUrl('  https://figma.com/file/x  ')).toBe('https://figma.com/file/x');
    expect(pastedUrl('mirá https://x.com')).toBeNull();
    expect(cleanExternalUrl('https://user:pw@example.com')).toBeNull();
    expect(cleanExternalUrl('ftp://example.com')).toBeNull();
  });

  it('lee título, descripción, imagen e ícono del HTML (relativos a absolutos)', () => {
    const meta = parseLinkMeta(
      `<html><head><title>Fallback</title><meta property="og:title" content="Hola &amp; chau"><meta name="description" content="Desc"><meta property="og:image" content="/img.png"><link rel="icon" href="/fav.ico"></head></html>`,
      'https://example.com/a/b',
    );
    expect(meta).toEqual({
      url: 'https://example.com/a/b',
      title: 'Hola & chau',
      description: 'Desc',
      image: 'https://example.com/img.png',
      site: 'example.com',
      favicon: 'https://example.com/fav.ico',
    });
  });

  it('el modo falso no sale a internet', async () => {
    process.env.DOCS_UNFURL_FAKE = '1';
    const out = await unfurlLink('https://acme.test/x');
    delete process.env.DOCS_UNFURL_FAKE;
    expect(out?.title).toBe('acme.test page');
  });

  it('el servidor sanea link, alto y ancho según el tipo de bloque', () => {
    const [bm, emb, img, col] = sanitizeBlocks([
      { id: 'a', type: 'bookmark', content: '', link: { url: 'javascript:alert(1)' } },
      { id: 'b', type: 'embed', content: '', link: { url: 'https://youtu.be/abc', title: '<b>x</b>', image: 'http://insecure/x.png' }, height: 99999, width: 300 },
      { id: 'c', type: 'image', content: '', width: 5, align: 'right', caption: '<script>x</script><strong>ok</strong>', link: { url: 'https://x.com' } },
      { id: 'd', type: 'column', content: '', ratio: -1 },
    ]);
    expect(bm.link).toBeUndefined();
    expect(emb.link).toEqual({ url: 'https://youtu.be/abc', title: 'x' });
    expect(emb.height).toBe(2000);
    expect(emb.width).toBe(100);
    expect(img).toMatchObject({ width: 10, align: 'right', caption: '<strong>ok</strong>' });
    expect(img.link).toBeUndefined();
    expect(col.ratio).toBeUndefined();
  });
});

describe('Docs D1: fechas y recordatorios', () => {
  const now = new Date(2026, 9, 24, 10, 0); // sábado 24/10/2026

  it('entiende hoy, mañana, días de la semana, fechas y horas', () => {
    expect(parseDay('hoy', now)).toBe('2026-10-24');
    expect(parseDay('mañana', now)).toBe('2026-10-25');
    expect(parseDay('amanhã', now)).toBe('2026-10-25');
    expect(parseDay('friday', now)).toBe('2026-10-30');
    expect(parseDay('3/11', now, 'es')).toBe('2026-11-03');
    expect(parseDay('11/3', now, 'en')).toBe('2026-11-03');
    expect(parseDay('nov 3', now)).toBe('2026-11-03');
    expect(parseDay('3 de noviembre 2027', now)).toBe('2027-11-03');
    expect(parseDay('31/2', now, 'es')).toBeNull();
    expect(parseTime('9am')).toBe('09:00');
    expect(parseTime('9:30pm')).toBe('21:30');
    expect(parseTime('25:00')).toBeNull();
  });

  it('el popover de @ ofrece fechas y recordatorios', () => {
    expect(dateSuggestions('', now).map((d) => d.key)).toEqual(['today', 'tomorrow', 'remind']);
    expect(dateSuggestions('recordar mañana 15:00', now, 'es')).toEqual([{ key: 'remind', date: '2026-10-25', time: '15:00', remind: true }]);
    expect(dateSuggestions('mañ', now)[0]).toMatchObject({ date: '2026-10-25', remind: false });
    expect(dateSuggestions('juan', now)).toEqual([]);
  });

  it('el HTML de la mención sobrevive al saneado del servidor y se leen los recordatorios', () => {
    const html = dateMentionHtml({ date: '2026-10-25', time: '09:00', remindAt: '2026-10-25T12:00:00.000Z', rid: 'r1234567', label: 'Oct 25, 2026 9:00' });
    expect(sanitizeDocsHtml(`hola ${html}`)).toBe(`hola ${html}`);
    expect(sanitizeDocsHtml('<span data-date="nope" onclick="x">a</span>')).toBe('<span>a</span>');
    expect(remindersInHtml(html)).toEqual([{ rid: 'r1234567', remindAt: '2026-10-25T12:00:00.000Z', date: '2026-10-25', label: 'Oct 25, 2026 9:00' }]);
  });

  it('al guardar la página se crean, mueven y borran los recordatorios; el cron avisa una sola vez', async () => {
    const owner = await makeUser('rem');
    const page = await createDocPage(owner.id, { title: 'Con recordatorio' });
    const mention = (at: string) => dateMentionHtml({ date: '2026-10-25', remindAt: at, rid: 'rid-abcdef12', label: 'Oct 25' });
    await updateDocPage(owner.id, page.id, { content: [p(`Llamar ${mention('2026-10-25T12:00:00.000Z')}`)] }, { actorId: owner.id, locale: 'es', timezone: 'America/Argentina/Buenos_Aires' });
    const rows = async () => (await getDb().prepare('SELECT rid, remind_at, sent_at, locale FROM docs_reminders WHERE page_id = ?').all(page.id)) as Array<{ rid: string; remind_at: string; sent_at: string | null; locale: string }>;
    expect(await rows()).toEqual([{ rid: 'rid-abcdef12', remind_at: '2026-10-25T12:00:00.000Z', sent_at: null, locale: 'es' }]);

    // Dos corridas a la vez: avisa una sola.
    const due = new Date('2026-10-25T12:01:00.000Z');
    const [a, b] = await Promise.all([fireDocReminders({ now: due }), fireDocReminders({ now: due })]);
    expect(a + b).toBe(1);
    const notes = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'docs_reminder'").all(owner.id)) as Array<{ title: string }>;
    expect(notes).toEqual([{ title: 'Recordatorio: Con recordatorio' }]);
    // La campana dice cuándo, en el idioma y la zona de quien lo puso (12:00 UTC = 09:00 en Buenos Aires).
    const bodies = (await getDb().prepare("SELECT body FROM notifications WHERE user_id = ? AND type = 'docs_reminder'").all(owner.id)) as Array<{ body: string }>;
    expect(bodies[0].body).toMatch(/domingo/);
    expect(bodies[0].body).toMatch(/09:00/);
    expect(await fireDocReminders({ now: due })).toBe(0);

    // Movido: vuelve a quedar pendiente. Borrado de la página: se va.
    await updateDocPage(owner.id, page.id, { content: [p(`Llamar ${mention('2026-10-26T12:00:00.000Z')}`)] }, { actorId: owner.id });
    expect((await rows())[0]).toMatchObject({ remind_at: '2026-10-26T12:00:00.000Z', sent_at: null });
    await updateDocPage(owner.id, page.id, { content: [p('Sin fecha')] }, { actorId: owner.id });
    expect(await rows()).toEqual([]);
    expect(pageReminders([p(mention('2026-10-26T12:00:00.000Z'))])).toHaveLength(1);
  });

  it('el editor manda idioma y zona con el contenido (y nada inválido)', () => {
    expect(reminderContext({ content: [] }, 'es', 'America/Argentina/Buenos_Aires')).toEqual({
      locale: 'es',
      timezone: 'America/Argentina/Buenos_Aires',
    });
    expect(reminderContext({ title: 'x' } as { content?: unknown }, 'es', 'UTC')).toEqual({});
    expect(reminderContext({ content: [] }, 'fr', 'Marte/Olympus')).toEqual({});
  });

  it('un recordatorio movido toma el idioma y la zona del guardado nuevo', async () => {
    const owner = await makeUser('rem2');
    const page = await createDocPage(owner.id, { title: 'Mover' });
    const mention = (at: string) => dateMentionHtml({ date: '2026-10-25', remindAt: at, rid: 'rid-moved123', label: 'Oct 25' });
    await updateDocPage(owner.id, page.id, { content: [p(mention('2026-10-25T12:00:00.000Z'))] }, { actorId: owner.id });
    const row = async () =>
      (await getDb().prepare('SELECT locale, timezone FROM docs_reminders WHERE page_id = ?').get(page.id)) as { locale: string; timezone: string };
    expect(await row()).toEqual({ locale: 'en', timezone: 'UTC' });
    await updateDocPage(owner.id, page.id, { content: [p(mention('2026-10-26T12:00:00.000Z'))] }, { actorId: owner.id, locale: 'pt', timezone: 'America/Sao_Paulo' });
    expect(await row()).toEqual({ locale: 'pt', timezone: 'America/Sao_Paulo' });
  });
});

describe('Docs D1: bloques sincronizados', () => {
  it('editar el contenido en una página lo actualiza en las otras del workspace', async () => {
    const owner = await makeUser('syn');
    const syncedId = crypto.randomUUID();
    const a = await createDocPage(owner.id, { title: 'A' });
    const b = await createDocPage(owner.id, { title: 'B' });
    const block = (text: string, syncedAt?: string): DocsBlock[] => [
      { id: id(), type: 'synced', content: '', synced_id: syncedId, ...(syncedAt ? { synced_at: syncedAt } : {}) },
      p(text, 1),
    ];
    await updateDocPage(owner.id, a.id, { content: block('Primera versión') }, { actorId: owner.id });
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toBe('Primera versión');
    // B pega el mismo bloque (la copia que trajo) y después lo edita.
    await updateDocPage(owner.id, b.id, { content: block('Primera versión') }, { actorId: owner.id });
    // El editor devuelve la versión que vio (synced_at); sin ella no se pisa nada.
    const seenB = (await hydrateSyncedBlocks(owner.id, (await getDocPage(owner.id, b.id))!.content)).find((x) => x.type === 'synced')!.synced_at;
    await updateDocPage(owner.id, b.id, { content: block('Sin versión') }, { actorId: owner.id });
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toBe('Primera versión');
    await updateDocPage(owner.id, b.id, { content: block('Editada en B', seenB) }, { actorId: owner.id });
    const pageA = (await getDocPage(owner.id, a.id))!;
    const hydrated = await hydrateSyncedBlocks(owner.id, pageA.content);
    expect(hydrated.map((x) => [x.type, x.content, x.indent ?? 0])).toEqual([
      ['synced', '', 0],
      ['paragraph', 'Editada en B', 1],
    ]);
    // A guarda otra cosa sin tocar el sincronizado (trae su copia vieja): no pisa lo de B.
    await updateDocPage(owner.id, a.id, { content: [...pageA.content, p('Otro párrafo')] }, { actorId: owner.id });
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toBe('Editada en B');
  });

  it('un id de otro workspace no se lee: el bloque queda como una copia propia', async () => {
    const one = await makeUser('sy1');
    const two = await makeUser('sy2');
    const syncedId = crypto.randomUUID();
    const pa = await createDocPage(one.id, { title: 'Ajeno' });
    await updateDocPage(one.id, pa.id, { content: [{ id: id(), type: 'synced', content: '', synced_id: syncedId }, p('Secreto', 1)] }, { actorId: one.id });
    expect(await getSyncedBlock(two.id, syncedId)).toBeNull();
    const pb = await createDocPage(two.id, { title: 'Mío' });
    const saved = await updateDocPage(two.id, pb.id, { content: [{ id: id(), type: 'synced', content: '', synced_id: syncedId }, p('Lo mío', 1)] }, { actorId: two.id });
    expect(saved!.content[0].synced_id).not.toBe(syncedId);
    expect((await getSyncedBlock(one.id, syncedId))?.[0]?.content).toBe('Secreto');
  });
});

describe('Docs D1: favoritos', () => {
  it('agrega, ordena y quita; solo páginas del workspace y fuera de la papelera', async () => {
    const owner = await makeUser('fav');
    const x = await createDocPage(owner.id, { title: 'X' });
    const y = await createDocPage(owner.id, { title: 'Y' });
    await addDocFavorite(owner.id, owner.id, x.id);
    await addDocFavorite(owner.id, owner.id, y.id);
    await addDocFavorite(owner.id, owner.id, x.id);
    expect((await listDocFavorites(owner.id, owner.id)).map((f) => f.title)).toEqual(['X', 'Y']);
    await reorderDocFavorites(owner.id, owner.id, [y.id, x.id]);
    expect((await listDocFavorites(owner.id, owner.id)).map((f) => f.title)).toEqual(['Y', 'X']);
    await updateDocPage(owner.id, y.id, { archived: true });
    expect((await listDocFavorites(owner.id, owner.id)).map((f) => f.title)).toEqual(['X']);
    await removeDocFavorite(owner.id, x.id);
    expect(await listDocFavorites(owner.id, owner.id)).toEqual([]);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });
});

describe('Docs D1: plantillas', () => {
  it('la galería trae varias plantillas por sección, en los tres idiomas, con bloques válidos', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const list = getDocTemplates(locale);
      expect(list.length).toBeGreaterThanOrEqual(15);
      expect(new Set(list.map((t) => t.category))).toEqual(new Set(['basic', 'personal', 'work', 'product', 'engineering']));
      for (const t of list) {
        const blocks = t.makeBlocks();
        expect(blocks.length).toBeGreaterThan(0);
        // Lo que guarda el servidor (saneado y con columnas válidas) no pierde bloques.
        expect(normalizeStructure(sanitizeBlocks(blocks), id).length).toBe(blocks.length);
      }
    }
    const project = getDocTemplates('es').find((t) => t.key === 'project')!;
    const a = project.makeBlocks().find((b) => b.type === 'database')!;
    const b = project.makeBlocks().find((b) => b.type === 'database')!;
    expect(a.db!.properties[0].id).not.toBe(b.db!.properties[0].id);
  });

  it('una fila guardada como plantilla crea filas nuevas con sus valores y su cuerpo', () => {
    let db = defaultDatabase();
    const row = db.rows[0];
    const statusId = db.properties[1].id;
    const done = db.properties[1].options![2].id;
    db = { ...db, rows: [{ ...row, values: { [db.properties[0].id]: 'Bug', [statusId]: done }, body: [p('Pasos')] }] };
    db = saveRowAsTemplate(db, row.id, 'Bug');
    expect(db.templates).toHaveLength(1);
    const res = addRowFromTemplate(db, db.templates![0].id, {}, '2026-10-24T00:00:00.000Z', id)!;
    expect(res.db.rows).toHaveLength(2);
    expect(res.row.values[statusId]).toBe(done);
    expect(res.row.body?.[0].content).toBe('Pasos');
    expect(res.row.body?.[0].id).not.toBe(db.rows[0].body![0].id);
    expect(removeRowTemplate(res.db, db.templates![0].id).templates).toBeUndefined();
    // El servidor conserva las plantillas saneadas.
    const [saved] = sanitizeBlocks([{ id: 'db', type: 'database', content: '', db }]);
    expect(saved.db?.templates?.[0]).toMatchObject({ name: 'Bug', values: { [statusId]: done } });
  });
});

describe('Docs D1: archivos', () => {
  it('cada tipo de archivo va a su bloque; "/imagen" con un PDF queda PDF', () => {
    expect(fileKindFor('video/mp4')).toBe('video');
    expect(fileKindFor('audio/mpeg')).toBe('audio');
    expect(fileKindFor('application/pdf')).toBe('pdf');
    expect(fileKindFor('application/zip')).toBe('file');
    expect(fileKindForRequest('image', 'application/pdf')).toBe('pdf');
    expect(fileKindForRequest('file', 'image/png')).toBe('file');
  });

  it('subida directa a Blob: solo nombres del editor; ícono y portada subidos', () => {
    expect(isDocsStoragePathname(`docs/${crypto.randomUUID()}-informe.pdf`)).toBe(true);
    expect(isDocsStoragePathname('docs/../../etc/passwd')).toBe(false);
    expect(iconImageUrl('img:/uploads/docs/abc-x.png')).toBe('/uploads/docs/abc-x.png');
    expect(iconImageUrl('img:https://evil.example/x.png')).toBeNull();
    expect(pageImageBlock('/uploads/docs/abc-cover.webp', 'cover')).toMatchObject({ mime: 'image/webp' });
    expect(pageImageBlock('https://images.unsplash.com/x', 'cover')).toBeNull();
  });

  it('rangos de bytes para video y audio', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual([0, 99]);
    expect(parseRange('bytes=900-', 1000)).toEqual([900, 999]);
    expect(parseRange('bytes=-100', 1000)).toEqual([900, 999]);
    expect(parseRange('bytes=2000-', 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});

describe('Docs D1: ecuaciones', () => {
  it('la ecuación en línea sobrevive al saneado y se dibuja en lectura', () => {
    const html = 'Área <span data-tex="\\pi r^2">\\pi r^2</span>';
    expect(sanitizeDocsHtml(html)).toBe(html);
    expect(withInlineMath(html)).toContain('class="katex"');
    const [eq] = sanitizeBlocks([{ id: 'e', type: 'equation', content: 'a &lt; b<script>x</script>' }]);
    expect(eq.content).toBe('a &lt; bx');
    expect(blocksToMarkdown([{ id: 'e', type: 'equation', content: 'a &lt; b' }])).toBe('$$\na < b\n$$\n');
  });
});

describe('Docs: búsqueda del menú /', () => {
  it('tolera espacios y el orden de las palabras', async () => {
    const { commandMatches } = await import('@/lib/docs-blocks');
    const kw = ['columns', 'column', '3', 'layout', 'columnas', 'colunas'];
    expect(commandMatches('3 columns', kw, '3 col')).toBe(true);
    expect(commandMatches('3 columns', kw, 'col 3')).toBe(true);
    expect(commandMatches('3 columns', kw, '3 ')).toBe(true);
    expect(commandMatches('To-do list', [], 'todo')).toBe(true);
    expect(commandMatches('3 columns', kw, '3 col zzz')).toBe(false);
  });
});
