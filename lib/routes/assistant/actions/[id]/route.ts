import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { decideAction } from '@/lib/assistant/actions';
import { assistantUser, localeOf } from '@/lib/assistant/http';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { not_found: 404, not_pending: 409, forbidden: 403, confirm_text_mismatch: 400 };

/**
 * Confirmar o cancelar una acción del asistente. Es el único camino por el
 * que el asistente escribe: el clic de la persona, con su sesión de ahora.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const parsed = z
    .object({ decision: z.enum(['confirm', 'cancel']), typed: z.string().max(300).optional(), locale: z.string().max(5).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const res = await decideAction({ user, locale: localeOf(parsed.data.locale), id, decision: parsed.data.decision, typed: parsed.data.typed });
  if ('error' in res) return NextResponse.json(res, { status: STATUS[res.error] ?? 400 });
  return NextResponse.json(res);
}
