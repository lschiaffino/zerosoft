import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createNote,
  createNotebook,
  deleteNoteForever,
  getNote,
  getSharedNote,
  listNotes,
  restoreNoteVersion,
  setNoteShared,
  setNotesFtsOverride,
  trashNote,
  updateNote,
  type NoteOwner,
} from '@/lib/notes';
import { parseNoteQuery, parseQueryDate, tokenizeQuery } from '@/lib/notes-query';
import { XmlLimitError, decodeXmlEntities, findElement, parseXml, textContent } from '@/lib/xml-lite';
import { enexToNotes, enmlToBlocks, markdownToNote, parseEnex, parseEnexDate } from '@/lib/notes-import';
import { NOTE_MAX_VERSIONS, listNoteVersions, maybeAutoSnapshotNote } from '@/lib/notes-versions';
import { buildReminderEmail, fireNoteReminders, setNoteReminder, ReminderError } from '@/lib/notes-reminders';
import { pageLinkHtml } from '@/lib/docs-page-links';
import { reminderPresets, toLocalInputValue } from '@/components/notes/notes-ui';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

// Storage en memoria: nada de escribir en public/uploads durante los tests.
const storage = vi.hoisted(() => ({ files: new Map<string, Buffer>(), deleted: [] as string[] }));
vi.mock('@/lib/uploads', () => ({
  MAX_UPLOAD_SIZE: 10 * 1024 * 1024,
  UploadError: class UploadError extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
  saveUpload: async (_folder: string, filename: string, _mime: string, buf: Buffer) => {
    const url = `/uploads/docs/${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    storage.files.set(url, buf);
    return url;
  },
  deleteUploads: async (urls: string[]) => {
    storage.deleted.push(...urls);
  },
}));
vi.mock('@/lib/upload-serve', () => ({
  fileBlockResponse: async (block: { url: string; name?: string }) => {
    const buf = storage.files.get(block.url);
    return buf ? new Response(new Uint8Array(buf), { headers: { 'x-name': block.name ?? '' } }) : null;
  },
}));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string }) => {
    mail.sent.push(opts);
    return { ok: true };
  },
}));

const filesRoute = await import('@/app/api/notes/[id]/files/route');
const fileRoute = await import('@/app/api/notes/[id]/files/[blockId]/route');
const versionsRoute = await import('@/app/api/notes/[id]/versions/route');
const versionRoute = await import('@/app/api/notes/[id]/versions/[versionId]/route');
const restoreRoute = await import('@/app/api/notes/[id]/versions/[versionId]/restore/route');
const reminderRoute = await import('@/app/api/notes/[id]/reminder/route');
const exportRoute = await import('@/app/api/notes/[id]/export/route');
const importRoute = await import('@/app/api/notes/import/route');

function para(text: string): DocsBlock {
  return { id: crypto.randomUUID(), type: 'paragraph', content: text };
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

async function ownerPair() {
  const boss = await makeUser('boss');
  const mate = await makeUser('mate');
  const a: NoteOwner = { workspaceId: boss.id, personId: boss.id };
  const b: NoteOwner = { workspaceId: boss.id, personId: mate.id };
  return { boss, mate, a, b };
}

beforeEach(() => {
  session.user = null;
  setNotesFtsOverride(null);
  mail.sent.length = 0;
});

// ---------- Operadores de búsqueda ----------

describe('notes: operadores de búsqueda', () => {
  const now = new Date('2026-03-11T15:00:00Z'); // miércoles

  it('tokeniza respetando comillas y separa operadores de texto libre', () => {
    expect(tokenizeQuery('notebook:"Mis recetas" pan  "dos palabras"')).toEqual(['notebook:Mis recetas', 'pan', 'dos palabras']);
    const q = parseNoteQuery('tag:Viaje -tag:viejo tag:pro* notebook:"Trabajo" intitle:Factura todo:false café foo:bar', now);
    expect(q.tags).toEqual(['viaje', 'pro*']);
    expect(q.notTags).toEqual(['viejo']);
    expect(q.notebooks).toEqual(['Trabajo']);
    expect(q.intitle).toEqual(['factura']);
    expect(q.todo).toBe('unchecked');
    // Lo desconocido queda como texto libre.
    expect(q.terms).toEqual(['café', 'foo', 'bar']);
  });

  it('fechas absolutas y relativas', () => {
    expect(parseQueryDate('20260131', now)).toBe('2026-01-31T00:00:00.000Z');
    expect(parseQueryDate('2026-02-30', now)).toBeNull();
    expect(parseQueryDate('today', now)).toBe('2026-03-11T00:00:00.000Z');
    expect(parseQueryDate('day-1', now)).toBe('2026-03-10T00:00:00.000Z');
    expect(parseQueryDate('week', now)).toBe('2026-03-09T00:00:00.000Z');
    expect(parseQueryDate('month-2', now)).toBe('2026-01-01T00:00:00.000Z');
    expect(parseQueryDate('year', now)).toBe('2026-01-01T00:00:00.000Z');
    expect(parseQueryDate('ayer', now)).toBeNull();
    // created: con fecha inválida no filtra: queda como texto.
    expect(parseNoteQuery('created:nunca', now).createdFrom).toBeNull();
  });

  it('filtra por tag, libreta, título, fecha y tareas', async () => {
    const { a, b } = await ownerPair();
    setNotesFtsOverride(false);
    const work = await createNotebook(a, 'Trabajo');
    const n1 = await createNote(a, {
      title: 'Factura marzo',
      notebook_id: work.id,
      tags: ['viaje', 'proyecto'],
      content: [{ id: 't1', type: 'todo', content: 'pagar', checked: false }],
    });
    const n2 = await createNote(a, {
      title: 'Lista',
      tags: ['viejo'],
      content: [{ id: 't2', type: 'todo', content: 'hecho', checked: true }],
      created_at: '2020-01-01T00:00:00.000Z',
    });
    const n3 = await createNote(a, { title: 'Otra', content: [para('factura vieja')] });
    const ids = async (q: string) => (await listNotes(a, { q })).map((n) => n.id).sort();

    expect(await ids('tag:viaje')).toEqual([n1.id]);
    expect(await ids('tag:pro*')).toEqual([n1.id]);
    expect(await ids('-tag:viejo')).toEqual([n1.id, n3.id].sort());
    expect(await ids('notebook:trabajo')).toEqual([n1.id]);
    expect(await ids('-notebook:"Trabajo"')).toEqual([n2.id, n3.id].sort());
    expect(await ids('intitle:factura')).toEqual([n1.id]);
    expect(await ids('factura')).toEqual([n1.id, n3.id].sort());
    expect(await ids('todo:true')).toEqual([n2.id]);
    expect(await ids('todo:false')).toEqual([n1.id]);
    expect(await ids('todo:*')).toEqual([n1.id, n2.id].sort());
    expect(await ids('created:2025')).toEqual([]);
    expect(await ids('created:20250101')).toEqual([n1.id, n3.id].sort());
    // La libreta de otra persona con el mismo nombre no cuenta.
    await createNotebook(b, 'Trabajo');
    expect(await ids('notebook:trabajo')).toEqual([n1.id]);
  });
});

// ---------- XML seguro y ENEX ----------

describe('notes: XML seguro', () => {
  it('no resuelve entidades del DOCTYPE (sin XXE ni billion laughs)', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE r [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
  <!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">
]>
<r><x>&xxe;</x><y>&b;</y><z>&lt;ok&gt; &amp; &#65;&#x42; &nbsp;</z></r>`;
    const doc = parseXml(xml);
    const r = findElement(doc, 'r')!;
    expect(textContent(findElement(r, 'x'))).toBe('&xxe;');
    expect(textContent(findElement(r, 'y'))).toBe('&b;');
    expect(textContent(findElement(r, 'z'))).toBe('<ok> & AB  ');
  });

  it('CDATA sin decodificar, atributos y cierres que no coinciden', () => {
    const doc = parseXml('<a k="1 &amp; 2"><b><![CDATA[<en-note>x</en-note>]]></b><c>sin cerrar</a>');
    const a = findElement(doc, 'a')!;
    expect(a.attrs.k).toBe('1 & 2');
    expect(textContent(findElement(a, 'b'))).toBe('<en-note>x</en-note>');
    expect(textContent(findElement(a, 'c'))).toBe('sin cerrar');
    expect(decodeXmlEntities('&bogus; &#0; &')).toBe('&bogus; &#0; &');
  });

  it('corta por profundidad y tamaño', () => {
    expect(() => parseXml('<a>'.repeat(300))).toThrow(XmlLimitError);
    expect(() => parseXml('x'.repeat(20), { maxLength: 10 })).toThrow(XmlLimitError);
  });
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function enex(notes: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export export-date="20260101T000000Z" application="Evernote">${notes}</en-export>`;
}

const NOTE_XML = `<note>
  <title>Viaje a Rosario</title>
  <created>20240131T101500Z</created>
  <updated>20240201T080000Z</updated>
  <tag>Viajes</tag><tag>familia</tag>
  <note-attributes><source-url>https://example.com/plan</source-url></note-attributes>
  <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><h1>Plan</h1><div>Salir <b>temprano</b> &amp; <a href="https://maps.example">mapa</a></div>
<div><en-todo checked="true"/>Comprar pasajes</div><div><en-todo/>Reservar hotel</div>
<ul><li>Mate</li><li>Termo<ul><li>Agua</li></ul></li></ul>
<div style="-en-codeblock:true"><div>let a = 1;</div><div>a &lt; 2</div></div>
<hr/><table><tr><td>Día</td><td>Plan</td></tr><tr><td>1</td><td>Llegar</td></tr></table>
<div><en-media type="image/png" hash="HASH"/></div>
<div><script>alert(1)</script><a href="javascript:alert(1)">malo</a></div>
</en-note>]]></content>
  <resource><data encoding="base64">${PNG.toString('base64')}</data><mime>image/png</mime>
    <resource-attributes><file-name>foto.png</file-name></resource-attributes></resource>
  <resource><data encoding="base64">${Buffer.from('%PDF-1.4 hola').toString('base64')}</data><mime>application/pdf</mime>
    <resource-attributes><file-name>boleto.pdf</file-name></resource-attributes></resource>
</note>`;

describe('notes: importar ENEX y Markdown', () => {
  it('fechas ENEX', () => {
    expect(parseEnexDate('20240131T101500Z')).toBe('2024-01-31T10:15:00.000Z');
    expect(parseEnexDate('2024-01-31')).toBeNull();
  });

  it('ENEX → notas con bloques, adjuntos, tags, fechas y origen', async () => {
    const hash = (await import('crypto')).createHash('md5').update(PNG).digest('hex');
    const uploads: string[] = [];
    const notes = await enexToNotes(enex(NOTE_XML.replace('HASH', hash)), async (r) => {
      uploads.push(r.name);
      return { url: `/uploads/docs/${r.hash}-${r.name}`, name: r.name, size: r.data.length, mime: r.mime };
    });
    expect(uploads).toEqual(['foto.png', 'boleto.pdf']);
    expect(notes).toHaveLength(1);
    const n = notes[0];
    expect(n).toMatchObject({
      title: 'Viaje a Rosario',
      tags: ['Viajes', 'familia'],
      sourceUrl: 'https://example.com/plan',
      createdAt: '2024-01-31T10:15:00.000Z',
      updatedAt: '2024-02-01T08:00:00.000Z',
    });
    const types = n.blocks.map((b) => b.type);
    expect(types).toEqual([
      'heading',
      'paragraph',
      'todo',
      'todo',
      'bulleted_list_item',
      'bulleted_list_item',
      'bulleted_list_item',
      'code',
      'divider',
      'table',
      'image',
      'paragraph',
      'file',
    ]);
    expect(n.blocks[1].content).toBe(
      'Salir <strong>temprano</strong> &amp; <a href="https://maps.example" target="_blank" rel="noopener noreferrer">mapa</a>',
    );
    expect(n.blocks[2]).toMatchObject({ content: 'Comprar pasajes', checked: true });
    expect(n.blocks[3]).toMatchObject({ content: 'Reservar hotel', checked: false });
    expect(n.blocks[7].content).toBe('let a = 1;\na &lt; 2');
    expect(n.blocks[9].rows).toEqual([['Día', 'Plan'], ['1', 'Llegar']]);
    expect(n.blocks[10]).toMatchObject({ type: 'image', name: 'foto.png', mime: 'image/png' });
    // Sin scripts ni javascript: (el texto del <script> queda como texto inofensivo).
    expect(n.blocks[11].content).not.toContain('<script');
    expect(n.blocks[11].content).not.toContain('javascript');
    // El PDF no aparece en el texto: va al final.
    expect(n.blocks[12]).toMatchObject({ type: 'file', name: 'boleto.pdf' });
  });

  it('rechaza lo que no es ENEX y enmlToBlocks tolera ENML vacío', () => {
    expect(() => parseEnex('<html></html>')).toThrow();
    expect(() => parseEnex('no es xml')).toThrow();
    expect(enmlToBlocks({ name: 'en-note', attrs: {}, children: [] })).toEqual([]);
  });

  it('Markdown → nota (título, listas, tareas, citas, código, tabla)', () => {
    const md = `---
tags: x
---
# Receta

Mezclar **harina** y _agua_. ![foto](https://x.example/a.png)

## Pasos

- [x] Amasar
- [ ] Hornear
1. uno
   - anidado

> ojo con el horno

\`\`\`js
const a = 1 < 2;
\`\`\`

---

| a | b |
|---|---|
| 1 | 2 |

<script>alert(1)</script>
`;
    const n = markdownToNote(md, 'receta.md');
    expect(n.title).toBe('Receta');
    expect(n.blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'heading',
      'todo',
      'todo',
      'numbered_list_item',
      'bulleted_list_item',
      'quote',
      'code',
      'divider',
      'table',
    ]);
    expect(n.blocks[0].content).toContain('<strong>harina</strong>');
    expect(n.blocks[0].content).toContain('<a href="https://x.example/a.png"');
    expect(n.blocks[1]).toMatchObject({ level: 1, content: 'Pasos' });
    expect(n.blocks[2]).toMatchObject({ checked: true, content: 'Amasar' });
    expect(n.blocks[7]).toMatchObject({ content: 'const a = 1 &lt; 2;', language: 'js' });
    expect(n.blocks[9].rows).toEqual([['a', 'b'], ['1', '2']]);
    // El <script> (y su contenido) no llega.
    expect(JSON.stringify(n.blocks)).not.toContain('alert');
    // Sin "# Título": el nombre del archivo.
    expect(markdownToNote('hola', 'Mi nota.md').title).toBe('Mi nota');
  });

  it('la ruta importa .enex y .md, sube adjuntos y valida tipo y libreta', async () => {
    const { boss, a } = await ownerPair();
    session.user = { id: boss.id, email: boss.email };
    const hash = (await import('crypto')).createHash('md5').update(PNG).digest('hex');
    const form = new FormData();
    form.append('file', new File([enex(NOTE_XML.replace('HASH', hash))], 'export.enex'));
    form.append('file', new File(['# Desde md\n\ntexto'], 'nota.md'));
    form.append('file', new File(['x'], 'malo.exe'));
    const res = await importRoute.POST(req('http://x/api/notes/import', { method: 'POST', body: form }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(2);
    expect(data.errors).toEqual([{ file: 'malo.exe', code: 'unsupported_type' }]);
    const imported = await getNote(a, data.notes[0].id);
    expect(imported?.created_at).toBe('2024-01-31T10:15:00.000Z');
    expect(imported?.tags).toEqual(['viajes', 'familia']);
    const image = imported!.content.find((b) => b.type === 'image')!;
    expect(storage.files.has(image.url!)).toBe(true);

    const bad = new FormData();
    bad.append('file', new File(['# x'], 'x.md'));
    bad.append('notebook_id', 'nope');
    expect((await importRoute.POST(req('http://x/api/notes/import', { method: 'POST', body: bad }))).status).toBe(400);
  });
});

// ---------- Links [[ ]] y backlinks ----------

describe('notes: links entre notas', () => {
  it('resuelve títulos, lista backlinks y en público quedan como texto', async () => {
    const { a, b } = await ownerPair();
    const target = await createNote(a, { title: 'Destino', content: [para('hola')] });
    const source = await createNote(a, {
      title: 'Origen',
      content: [para(`ver ${pageLinkHtml(target.id, 'Viejo título')} y listo`)],
    });
    // El link guardado pasa el sanitizador (href canónico desde el id).
    const got = await getNote(a, source.id);
    expect(got!.content[0].content).toContain(`href="/app/notes?note=${target.id}"`);
    expect(got!.content[0].content).toContain('>Destino</a>');
    expect((await getNote(a, target.id))!.backlinks).toEqual([{ id: source.id, title: 'Origen' }]);
    // Otra persona no ve ni el backlink ni el título.
    const foreign = await createNote(b, { title: 'Ajena', content: [para(pageLinkHtml(target.id, 'x'))] });
    expect((await getNote(a, target.id))!.backlinks!.map((x) => x.id)).not.toContain(foreign.id);
    expect((await getNote(b, foreign.id))!.content[0].content).toBe('x');
    // En papelera no cuenta como backlink.
    await trashNote(a, source.id);
    expect((await getNote(a, target.id))!.backlinks).toEqual([]);
    // Link público: los links a otras notas (privadas) son texto.
    const shared = await createNote(a, { title: 'Pública', content: [para(pageLinkHtml(target.id, 'Destino'))] });
    const token = (await setNoteShared(a, shared.id, true)) as string;
    expect((await getSharedNote(token))!.content[0].content).toBe('Destino');
  });
});

// ---------- Versiones ----------

describe('notes: historial de versiones', () => {
  it('snapshot con ventana de tiempo, tope por nota y restaurar', async () => {
    const { boss, mate, a } = await ownerPair();
    const n = await createNote(a, { title: 'v0', content: [para('cero')] });
    await updateNote(a, n.id, { content: [para('uno')] });
    // Primera edición: guarda el estado anterior y el nuevo.
    let versions = await listNoteVersions(a, n.id);
    expect(versions).toHaveLength(2);
    // Dentro de la ventana no se agregan más.
    await updateNote(a, n.id, { content: [para('dos')] });
    expect(await listNoteVersions(a, n.id)).toHaveLength(2);
    // Pasada la ventana, sí.
    expect(await maybeAutoSnapshotNote(a, n.id, null, new Date(Date.now() + 6 * 60_000))).toBe(true);
    versions = await listNoteVersions(a, n.id);
    expect(versions).toHaveLength(3);

    // Tope: no pasa de NOTE_MAX_VERSIONS (en otra nota: estos snapshots tienen fechas futuras).
    const capped = await createNote(a, { title: 'tope' });
    for (let i = 0; i < NOTE_MAX_VERSIONS + 3; i++) {
      await maybeAutoSnapshotNote(a, capped.id, null, new Date(Date.now() + (10 + i * 6) * 60_000));
    }
    expect(await listNoteVersions(a, capped.id)).toHaveLength(NOTE_MAX_VERSIONS);

    // Rutas: listar, ver, restaurar (y otra persona no ve nada).
    session.user = { id: boss.id, email: boss.email };
    const ctx = { params: Promise.resolve({ id: n.id }) };
    const list = await (await versionsRoute.GET(req(`http://x/api/notes/${n.id}/versions`), ctx)).json();
    const oldest = list.rows[list.rows.length - 1];
    const vctx = { params: Promise.resolve({ id: n.id, versionId: oldest.id }) };
    const preview = await (await versionRoute.GET(req('http://x'), vctx)).json();
    expect(preview.content[0].content).toBeTruthy();
    const restored = await restoreRoute.POST(req('http://x', { method: 'POST' }), vctx);
    expect(restored.status).toBe(200);
    expect((await getNote(a, n.id))!.content[0].content).toBe(preview.content[0].content);
    // El estado de antes de restaurar quedó guardado.
    expect((await listNoteVersions(a, n.id)).some((v) => v.kind === 'restore')).toBe(true);

    session.user = { id: boss.id, email: boss.email, actingUser: { id: mate.id } };
    expect((await versionsRoute.GET(req('http://x'), ctx)).status).toBe(404);
    expect((await versionRoute.GET(req('http://x'), vctx)).status).toBe(404);
    expect((await restoreRoute.POST(req('http://x', { method: 'POST' }), vctx)).status).toBe(404);

    // En la papelera no se restaura.
    await trashNote(a, n.id);
    await expect(restoreNoteVersion(a, n.id, oldest.id)).rejects.toThrow('note_trashed');
  });
});

// ---------- Recordatorios ----------

describe('notes: recordatorios', () => {
  it('valida la fecha y la nota', async () => {
    const { a, b } = await ownerPair();
    const n = await createNote(a, { title: 'R' });
    await expect(setNoteReminder(a, n.id, { at: 'mañana' })).rejects.toBeInstanceOf(ReminderError);
    await expect(setNoteReminder(a, n.id, { at: '2000-01-01T00:00:00Z' })).rejects.toThrow('reminder_in_past');
    await expect(setNoteReminder(b, n.id, { at: new Date(Date.now() + 60_000).toISOString() })).rejects.toThrow('note_not_found');
  });

  it('avisa una sola vez (in-app y email) y no avisa notas en la papelera', async () => {
    const { boss, a } = await ownerPair();
    const n = await createNote(a, { title: 'Llamar a Ana', content: [para('tema: presupuesto')] });
    session.user = { id: boss.id, email: boss.email };
    const ctx = { params: Promise.resolve({ id: n.id }) };
    const at = new Date(Date.now() + 30 * 60_000);
    const put = await reminderRoute.PUT(
      req('http://x', { method: 'PUT', body: JSON.stringify({ at: at.toISOString(), timezone: 'America/Argentina/Buenos_Aires', locale: 'es' }) }),
      ctx,
    );
    expect(put.status).toBe(200);
    expect((await getNote(a, n.id))!.reminder).toEqual({ at: at.toISOString(), sent_at: null });

    // Antes de la hora no pasa nada.
    expect(await fireNoteReminders({ now: new Date() })).toBe(0);
    const later = new Date(at.getTime() + 1000);
    const [first, second] = await Promise.all([fireNoteReminders({ now: later }), fireNoteReminders({ now: later })]);
    expect(first + second).toBe(1);
    expect(mail.sent.filter((m) => m.to === boss.email)).toHaveLength(1);
    expect(mail.sent[0].subject).toBe('Recordatorio: Llamar a Ana');
    expect(mail.sent[0].text).toContain(`/es/app/notes?note=${n.id}`);
    const notif = (await getDb()
      .prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'note_reminder'")
      .all(boss.id)) as Array<{ title: string; href: string }>;
    expect(notif).toHaveLength(1);
    expect(notif[0]).toMatchObject({ title: 'Recordatorio: Llamar a Ana', href: `/app/notes?note=${n.id}` });
    expect((await getNote(a, n.id))!.reminder!.sent_at).toBeTruthy();

    // Moverlo lo deja pendiente otra vez; en la papelera no avisa.
    await setNoteReminder(a, n.id, { at: new Date(Date.now() + 60_000).toISOString() });
    await trashNote(a, n.id);
    expect(await fireNoteReminders({ now: new Date(Date.now() + 120_000) })).toBe(0);

    // DELETE lo saca.
    const del = await reminderRoute.DELETE(req('http://x', { method: 'DELETE' }), ctx);
    expect((await del.json()).reminder).toBeNull();
  });

  it('email con hora en la zona de la persona y escapado', () => {
    const mailOut = buildReminderEmail(
      {
        note_id: 'n1',
        person_id: 'p',
        remind_at: '2026-03-04T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        locale: 'pt',
        title: '<b>Reunião</b>',
        body_text: 'pauta',
        email: 'x@y.z',
      },
      'https://app.example/pt/app/notes?note=n1',
    );
    expect(mailOut.subject).toBe('Lembrete: <b>Reunião</b>');
    expect(mailOut.text).toContain('09:00');
    expect(mailOut.html).toContain('&lt;b&gt;Reunião&lt;/b&gt;');
  });

  it('atajos y valor del input en hora local', () => {
    const now = new Date(2026, 2, 11, 10, 20); // miércoles 10:20 local
    const presets = reminderPresets(now);
    expect(presets.map((p) => p.key)).toEqual(['laterToday', 'tomorrow', 'nextWeek']);
    expect(toLocalInputValue(presets[0].at)).toBe('2026-03-11T13:00');
    expect(toLocalInputValue(presets[1].at)).toBe('2026-03-12T09:00');
    expect(toLocalInputValue(presets[2].at)).toBe('2026-03-16T09:00');
    expect(reminderPresets(new Date(2026, 2, 11, 22, 0)).map((p) => p.key)).toEqual(['tomorrow', 'nextWeek']);
  });
});

// ---------- Adjuntos ----------

describe('notes: adjuntos', () => {
  it('sube solo la persona dueña, sirve al dueño o con el token y borra al eliminar', async () => {
    const { boss, mate, a } = await ownerPair();
    const n = await createNote(a, { title: 'Con foto' });
    const ctx = { params: Promise.resolve({ id: n.id }) };
    const upload = () => {
      const form = new FormData();
      form.append('file', new File([PNG], 'foto.png', { type: 'image/png' }));
      return filesRoute.POST(req('http://x', { method: 'POST', body: form }), ctx);
    };
    // Otra persona del team: 404.
    session.user = { id: boss.id, email: boss.email, actingUser: { id: mate.id } };
    expect((await upload()).status).toBe(404);

    session.user = { id: boss.id, email: boss.email };
    const res = await upload();
    expect(res.status).toBe(201);
    const up = await res.json();
    const block: DocsBlock = { id: 'img1', type: 'image', content: '', url: up.url, name: up.name, size: up.size, mime: up.mime };
    await updateNote(a, n.id, { content: [block, para('texto')] });
    expect((await getNote(a, n.id))!.content[0].url).toBe(up.url);

    const fctx = { params: Promise.resolve({ id: n.id, blockId: 'img1' }) };
    expect((await fileRoute.GET(req(`http://x/api/notes/${n.id}/files/img1`), fctx)).status).toBe(200);
    session.user = { id: boss.id, email: boss.email, actingUser: { id: mate.id } };
    expect((await fileRoute.GET(req(`http://x/api/notes/${n.id}/files/img1`), fctx)).status).toBe(404);
    // Anónimo con el token del link público.
    session.user = null;
    expect((await fileRoute.GET(req(`http://x/api/notes/${n.id}/files/img1?share=wrongtoken123`), fctx)).status).toBe(404);
    const token = (await setNoteShared(a, n.id, true)) as string;
    expect((await fileRoute.GET(req(`http://x/api/notes/${n.id}/files/img1?share=${token}`), fctx)).status).toBe(200);
    // En la vista pública no viaja la URL del storage.
    expect((await getSharedNote(token))!.content[0].url).toBe('');

    // Papelera: no se sube; borrado definitivo: se borra del storage.
    session.user = { id: boss.id, email: boss.email };
    await trashNote(a, n.id);
    expect((await upload()).status).toBe(409);
    await deleteNoteForever(a, n.id);
    expect(storage.deleted).toContain(up.url);
  });
});

// ---------- Export ----------

describe('notes: export a Markdown', () => {
  it('exporta título, contenido, links y tags', async () => {
    const { boss, a } = await ownerPair();
    const other = await createNote(a, { title: 'Otra' });
    const n = await createNote(a, {
      title: 'Exportable',
      tags: ['casa'],
      content: [para(`hola <strong>mundo</strong> ${pageLinkHtml(other.id, 'Otra')}`), { id: 'c', type: 'todo', content: 'x', checked: true }],
    });
    session.user = { id: boss.id, email: boss.email };
    const res = await exportRoute.GET(req(`http://x/api/notes/${n.id}/export`), { params: Promise.resolve({ id: n.id }) });
    expect(res.headers.get('content-disposition')).toContain('exportable.md');
    const md = await res.text();
    expect(md).toContain('# Exportable');
    expect(md).toContain(`hola **mundo** [Otra](http://x/app/notes?note=${other.id})`);
    expect(md).toContain('- [x] x');
    expect(md).toContain('#casa');
  });
});
