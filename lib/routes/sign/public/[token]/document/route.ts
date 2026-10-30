import { NextRequest } from 'next/server';
import { publicState } from '@/lib/sign/signing';
import { readSignFile } from '@/lib/sign/files';
import { publicResolve, type PublicCtx } from '@/lib/sign/public-http';
import { pdfResponse, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: el PDF a firmar, solo mientras le toca al destinatario y (con código
 * por email) con la sesión verificada. Es el original limpio: los valores de
 * otros firmantes no viajan.
 */
export async function GET(req: NextRequest, ctx: PublicCtx) {
  const p = await publicResolve(req, ctx, 'document', 60);
  if ('res' in p) return p.res;
  const state = publicState(p.r, p.sessionOk);
  if (state === 'otp') return sJson({ error: 'otp_required' }, 401);
  if (state !== 'ready' || !p.r.env.document_ref) return sJson({ error: `state_${state}` }, 409);
  const bytes = await readSignFile(p.r.env.document_ref);
  if (!bytes) return sJson({ error: 'file_unavailable' }, 404);
  return pdfResponse(bytes, p.r.env.document_name || 'document.pdf');
}
