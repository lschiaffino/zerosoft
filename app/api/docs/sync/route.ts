import { canWriteAccess } from '@/lib/docs-access';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { createSource, DocsSyncError } from '@/lib/docs-sync';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const createSchema = z.object({
  pageId: z.string().min(1).max(100),
  provider: z.enum(['github', 'jira', 'salesforce', 'crm']),
  config: z.record(z.unknown()).default({}),
  secret: z.record(z.unknown()).optional(),
  intervalMin: z.number().int().optional(),
});

/**
 * Base sincronizada nueva: valida el origen trayendo los datos por primera
 * vez y devuelve el bloque para que el editor lo inserte. Hace falta poder
 * editar la página.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const page = await getDocPageRow(parsed.data.pageId);
  const access = page ? await getDocAccess(page, user, { includePublished: false, includePublicLink: false }) : null;
  if (!page || !access) return notFound();
  if (!canWriteAccess(access)) return forbidden();
  if (page.locked === 1) return docsError(423, 'locked');
  const limited = await rateLimit(`docs-sync-create:${realUserId(user)}`, 10, 60);
  if (!limited.ok) return docsError(429, 'rate_limited');
  try {
    const res = await createSource({
      workspaceId: page.user_id,
      pageId: page.id,
      personId: realUserId(user),
      provider: parsed.data.provider,
      config: parsed.data.config,
      secret: parsed.data.secret,
      intervalMin: parsed.data.intervalMin,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    if (err instanceof DocsSyncError) return docsError(err.status, err.code);
    throw err;
  }
}
