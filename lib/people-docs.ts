/**
 * People: documentos. Por persona (contratos, documentos de identidad) en la
 * carpeta privada 'people' (nunca servida en /uploads: solo por la ruta de
 * People, que chequea el acceso) y políticas generales, con acuse de lectura
 * ("leí la política"). Las políticas y el manual pueden ser páginas de Docs.
 * Sign no está en main: no hay pedido de firma electrónica.
 */
import { localized } from './notification-copy';
import { getDb } from './db';
import { deleteUploads, saveUpload, UploadError } from './uploads';
import { canSeeDocument, isSelf } from './people-access';
import { audit, getEmployeeRow, newId, nowIso, PeopleError, requireHr, type PeopleCtx } from './people';
import { notifyPeople } from './people-effects';

const db = () => getDb();

export const DOC_KINDS = ['contract', 'id', 'policy', 'tax', 'other'] as const;
export const MAX_DOC_BYTES = 15 * 1024 * 1024;

export interface PeopleDocument {
  id: string;
  employeeId: string | null;
  title: string;
  kind: (typeof DOC_KINDS)[number];
  fileName: string;
  mime: string;
  size: number;
  docsPageId: string | null;
  visibility: 'hr' | 'employee';
  requiresAck: boolean;
  /** La persona que mira ya dio el acuse. */
  acked: boolean;
  /** HR: cuántas personas dieron el acuse (políticas generales) o si la persona lo dio. */
  ackCount: number | null;
  createdAt: string;
  url: string | null;
}

/** Firmas de archivo aceptadas: PDF, imágenes y documentos de Office (ZIP) o texto. */
export function sniffDocument(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return { mime: 'image/webp', ext: 'webp' };
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  return null;
}

function toDoc(ctx: PeopleCtx, r: Record<string, unknown>, acked: Set<string>, counts: Map<string, number>): PeopleDocument {
  const id = String(r.id);
  return {
    id,
    employeeId: (r.employee_id as string | null) ?? null,
    title: String(r.title),
    kind: (DOC_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as PeopleDocument['kind']) : 'other',
    fileName: String(r.file_name),
    mime: String(r.mime),
    size: Number(r.size),
    docsPageId: (r.docs_page_id as string | null) ?? null,
    visibility: r.visibility === 'employee' ? 'employee' : 'hr',
    requiresAck: Number(r.requires_ack) === 1,
    acked: acked.has(id),
    ackCount: ctx.viewer.hr ? counts.get(id) ?? 0 : null,
    createdAt: String(r.created_at),
    url: r.url ? `/api/people/documents/${id}` : null,
  };
}

/** Documentos de una ficha (o las políticas generales con employeeId null) que quien mira puede ver. */
export async function listDocuments(ctx: PeopleCtx, employeeId: string | null): Promise<PeopleDocument[]> {
  const rows = (await db()
    .prepare(`SELECT * FROM people_documents WHERE workspace_id = ? AND ${employeeId ? 'employee_id = ?' : 'employee_id IS NULL'} ORDER BY created_at DESC`)
    .all(...(employeeId ? [ctx.ws, employeeId] : [ctx.ws]))) as Array<Record<string, unknown>>;
  const visible = rows.filter((r) => canSeeDocument(ctx.viewer, { employeeId: (r.employee_id as string | null) ?? null, visibility: r.visibility === 'employee' ? 'employee' : 'hr' }));
  if (employeeId && visible.length && !isSelf(ctx.viewer, employeeId)) await audit(ctx, 'view', 'documents', employeeId);
  const me = ctx.viewer.employeeId;
  const acked = new Set(
    me ? ((await db().prepare('SELECT document_id FROM people_doc_acks WHERE employee_id = ?').all(me)) as Array<{ document_id: string }>).map((a) => a.document_id) : [],
  );
  const counts = new Map<string, number>();
  if (ctx.viewer.hr && visible.length) {
    const rowsCount = (await db()
      .prepare(`SELECT document_id, COUNT(*) AS n FROM people_doc_acks WHERE document_id IN (${visible.map(() => '?').join(',')}) GROUP BY document_id`)
      .all(...visible.map((v) => String(v.id)))) as Array<{ document_id: string; n: number }>;
    for (const c of rowsCount) counts.set(c.document_id, Number(c.n));
  }
  return visible.map((r) => toDoc(ctx, r, acked, counts));
}

export async function uploadDocument(
  ctx: PeopleCtx,
  employeeId: string | null,
  file: { name: string; buffer: Buffer },
  meta: { title?: string; kind?: string; visibility?: string; requiresAck?: boolean },
): Promise<PeopleDocument> {
  requireHr(ctx);
  if (employeeId && !(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  if (!file.buffer.length) throw new PeopleError('file_required');
  if (file.buffer.length > MAX_DOC_BYTES) throw new PeopleError('file_too_large', 413);
  // El tipo sale de los bytes, no del nombre ni de lo que mandó el navegador.
  const kind = sniffDocument(new Uint8Array(file.buffer.subarray(0, 16)));
  if (!kind) throw new PeopleError('file_type', 415);
  let url: string;
  try {
    url = await saveUpload('people', `document.${kind.ext}`, kind.mime, file.buffer);
  } catch (err) {
    if (err instanceof UploadError) throw new PeopleError(err.code, err.status);
    throw err;
  }
  return insertDocument(ctx, employeeId, { ...meta, url, fileName: file.name.slice(0, 200) || `document.${kind.ext}`, mime: kind.mime, size: file.buffer.length });
}

/** Política o manual que vive en Docs (link a la página, sin archivo). */
export async function linkDocsPage(ctx: PeopleCtx, input: { title?: string; docsPageId?: string; requiresAck?: boolean; employeeId?: string | null }): Promise<PeopleDocument> {
  requireHr(ctx);
  const pageId = String(input.docsPageId ?? '').trim();
  const page = (await db().prepare('SELECT id, title FROM docs_pages WHERE id = ? AND user_id = ?').get(pageId, ctx.ws)) as { id: string; title: string } | undefined;
  if (!page) throw new PeopleError('invalid_page');
  return insertDocument(ctx, input.employeeId ?? null, { title: input.title || page.title || 'Policy', kind: 'policy', visibility: 'employee', requiresAck: input.requiresAck !== false, docsPageId: page.id });
}

async function insertDocument(
  ctx: PeopleCtx,
  employeeId: string | null,
  d: { title?: string; kind?: string; visibility?: string; requiresAck?: boolean; url?: string; fileName?: string; mime?: string; size?: number; docsPageId?: string },
): Promise<PeopleDocument> {
  const id = newId('doc');
  const title = String(d.title ?? '').trim().slice(0, 200) || d.fileName || 'Document';
  const visibility = d.visibility === 'employee' || !employeeId ? 'employee' : 'hr';
  await db()
    .prepare(
      `INSERT INTO people_documents (id, workspace_id, employee_id, title, kind, url, file_name, mime, size, docs_page_id, visibility, requires_ack, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.ws,
      employeeId,
      title,
      (DOC_KINDS as readonly string[]).includes(String(d.kind)) ? String(d.kind) : 'other',
      d.url ?? '',
      d.fileName ?? '',
      d.mime ?? '',
      d.size ?? 0,
      d.docsPageId ?? null,
      visibility,
      d.requiresAck ? 1 : 0,
      ctx.personId,
      nowIso(),
    );
  if (employeeId) await audit(ctx, 'change', 'documents', employeeId);
  // Aviso a la persona (o a todos, si es una política) cuando lo puede ver.
  if (visibility === 'employee') {
    const targets = employeeId
      ? [(await getEmployeeRow(ctx.ws, employeeId))?.user_id]
      : ((await db().prepare("SELECT user_id FROM people_employees WHERE workspace_id = ? AND status != 'terminated' AND user_id IS NOT NULL").all(ctx.ws)) as Array<{ user_id: string }>).map((r) => r.user_id);
    await notifyPeople(
      targets.filter((u) => u !== ctx.personId),
      { title: localized(d.requiresAck ? 'peopleDocRead' : 'peopleDocNew', { title }), href: employeeId ? `/app/people/${employeeId}?tab=documents` : '/app/people/welcome', sourceId: id },
    );
  }
  const counts = new Map<string, number>();
  const r = (await db().prepare('SELECT * FROM people_documents WHERE id = ?').get(id)) as Record<string, unknown>;
  return toDoc(ctx, r, new Set(), counts);
}

export async function getDocumentFile(ctx: PeopleCtx, id: string): Promise<{ url: string; name: string; mime: string } | null> {
  const r = (await db().prepare('SELECT * FROM people_documents WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as Record<string, string | null> | undefined;
  if (!r || !r.url) return null;
  if (!canSeeDocument(ctx.viewer, { employeeId: r.employee_id ?? null, visibility: r.visibility === 'employee' ? 'employee' : 'hr' })) return null;
  if (r.employee_id && !isSelf(ctx.viewer, r.employee_id)) await audit(ctx, 'view', `document:${r.kind}`, r.employee_id);
  return { url: r.url, name: r.file_name || 'document', mime: r.mime || 'application/octet-stream' };
}

export async function deleteDocument(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  const r = (await db().prepare('SELECT employee_id, url FROM people_documents WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as { employee_id: string | null; url: string } | undefined;
  if (!r) return false;
  await db().prepare('DELETE FROM people_documents WHERE id = ?').run(id);
  if (r.url) await deleteUploads([r.url]).catch((err: unknown) => console.error('[people] delete file', err instanceof Error ? err.message : 'error'));
  if (r.employee_id) await audit(ctx, 'change', 'documents', r.employee_id);
  return true;
}

/** "Leí la política": la persona da el acuse de un documento que puede ver. */
export async function acknowledge(ctx: PeopleCtx, id: string): Promise<void> {
  const me = ctx.viewer.employeeId;
  if (!me) throw new PeopleError('no_profile', 409);
  const r = (await db().prepare('SELECT * FROM people_documents WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as Record<string, string | null> | undefined;
  if (!r) throw new PeopleError('not_found', 404);
  const doc = { employeeId: r.employee_id ?? null, visibility: (r.visibility === 'employee' ? 'employee' : 'hr') as 'hr' | 'employee' };
  if (doc.employeeId ? doc.employeeId !== me || doc.visibility !== 'employee' : !canSeeDocument(ctx.viewer, doc)) throw new PeopleError('forbidden', 403);
  await db().prepare('INSERT OR IGNORE INTO people_doc_acks (document_id, employee_id, acked_at) VALUES (?, ?, ?)').run(id, me, nowIso());
}

/** Documentos que esperan el acuse de quien mira (bienvenida e inicio). */
export async function pendingAcks(ctx: PeopleCtx): Promise<PeopleDocument[]> {
  const me = ctx.viewer.employeeId;
  if (!me) return [];
  const all = [...(await listDocuments(ctx, null)), ...(await listDocuments({ ...ctx, viewer: { ...ctx.viewer, hr: false } }, me))];
  return all.filter((d) => d.requiresAck && !d.acked);
}

/** Crea el manual del empleado en Docs (una página del workspace) y lo deja como política con acuse. */
export async function createHandbook(ctx: PeopleCtx, locale = 'en'): Promise<{ pageId: string; url: string }> {
  requireHr(ctx);
  const { docsActorFor } = await import('./docs-platform-access');
  const { createPage } = await import('./docs-platform');
  const actor = await docsActorFor(ctx.ws, ctx.personId);
  if (!actor) throw new PeopleError('forbidden', 403);
  const md = {
    en: '# Employee handbook\n\n## Who we are\n\n## How we work\n\n## Time off\n\nRequest time off in People. Your manager approves it and your calendar shows you as out.\n\n## Code of conduct\n',
    es: '# Manual del empleado\n\n## Quiénes somos\n\n## Cómo trabajamos\n\n## Licencias\n\nPedí tus días en People. Tu manager los aprueba y tu calendario te muestra fuera.\n\n## Código de conducta\n',
    pt: '# Manual do colaborador\n\n## Quem somos\n\n## Como trabalhamos\n\n## Folgas\n\nPeça suas folgas no People. Seu gestor aprova e sua agenda mostra que você está fora.\n\n## Código de conduta\n',
  }[locale === 'es' || locale === 'pt' ? locale : 'en'];
  const page = await createPage(actor, { title: locale === 'es' ? 'Manual del empleado' : locale === 'pt' ? 'Manual do colaborador' : 'Employee handbook', markdown: md, parentId: null });
  await db().prepare('UPDATE people_settings SET handbook_page_id = ?, updated_at = ? WHERE workspace_id = ?').run(page.id, nowIso(), ctx.ws);
  await linkDocsPage(ctx, { docsPageId: page.id, title: page.title, requiresAck: true });
  return { pageId: page.id, url: `/app/docs/${page.id}` };
}
