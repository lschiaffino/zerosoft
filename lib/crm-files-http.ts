/**
 * CRM — rutas de adjuntos de contactos, empresas y deals
 * (/api/crm/<entidad>/[id]/files). Las tres comparten estos handlers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from './session';
import { sessionScope } from './crm-visibility';
import { crmError, guardRecord, notFound, unauthorized } from './crm-http';
import { getDb } from './db';
import {
  createRecordFile,
  deleteRecordFile,
  FileUploadError,
  listRecordFiles,
  storeUploadedFile,
  toView,
  type FileEntity,
} from './crm-files';

const TABLE: Record<FileEntity, string> = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' };

type Ctx = { params: Promise<{ id: string }> };

/** Usuario y registro visibles; si no, la respuesta de error. */
async function access(entity: FileEntity, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  const exists = await getDb().prepare(`SELECT 1 AS one FROM ${TABLE[entity]} WHERE id = ? AND user_id = ?`).get(id, user.id);
  if (!exists) return { res: notFound() } as const;
  const hidden = await guardRecord(user.id, entity, id, await sessionScope(user));
  if (hidden) return { res: hidden } as const;
  return { user, id } as const;
}

export function recordFilesHandlers(entity: FileEntity) {
  return {
    async GET(_req: NextRequest, ctx: Ctx) {
      const a = await access(entity, ctx);
      if ('res' in a) return a.res;
      return NextResponse.json({ rows: (await listRecordFiles(a.user.id, entity, a.id)).map(toView) });
    },

    async POST(req: NextRequest, ctx: Ctx) {
      const a = await access(entity, ctx);
      if ('res' in a) return a.res;
      try {
        const stored = await storeUploadedFile(await req.formData().catch(() => null));
        const row = await createRecordFile(a.user.id, entity, a.id, {
          ...stored,
          uploadedBy: realUserId(a.user),
        });
        return NextResponse.json(toView(row), { status: 201 });
      } catch (err) {
        if (err instanceof FileUploadError) return crmError(err.status, err.code);
        throw err;
      }
    },

    async DELETE(req: NextRequest, ctx: Ctx) {
      const a = await access(entity, ctx);
      if ('res' in a) return a.res;
      const fileId = req.nextUrl.searchParams.get('fileId');
      if (!fileId) return crmError(400, 'invalid_input');
      if (!(await deleteRecordFile(a.user.id, entity, a.id, fileId))) return notFound();
      return new NextResponse(null, { status: 204 });
    },
  };
}
