import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTeamById } from '@/lib/teams';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { saveUpload, UploadError } from '@/lib/uploads';
import { updateWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LOGO = 2 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** POST multipart { file }: sube el logo del workspace (PNG, JPG, WebP o GIF, hasta 2 MB). DELETE lo saca. */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const limit = await rateLimit(`teams:logo:${ctx.team.id}`, 20, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return teamsError('invalid_input');
  if (!TYPES.has(file.type)) return teamsError('file_type_not_allowed', 415);
  if (file.size > MAX_LOGO) return teamsError('file_too_large', 413);
  try {
    const url = await saveUpload('workspace', file.name || 'logo', file.type, Buffer.from(await file.arrayBuffer()));
    const err = await updateWorkspace(ctx.team.id, { logoUrl: url });
    if (err) return teamsError(err);
    return NextResponse.json({ logoUrl: (await getTeamById(ctx.team.id))?.logo_url ?? url });
  } catch (err) {
    if (err instanceof UploadError) return teamsError(err.code, err.status);
    throw err;
  }
}

export async function DELETE() {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  await updateWorkspace(ctx.team.id, { logoUrl: null });
  return NextResponse.json({ logoUrl: null });
}
