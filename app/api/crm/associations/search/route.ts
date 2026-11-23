import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { crmError, unauthorized } from '@/lib/crm-http';
import { ASSOC_SEARCH_TYPES, searchAssociable, type AssocSearchType } from '@/lib/crm-assoc-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?type=contact|company|deal&q=…&exclude=id,id → hasta 20 registros que
 * la persona ve para asociar (el selector "+ Agregar" de la ficha).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as AssocSearchType;
  if (!ASSOC_SEARCH_TYPES.includes(type)) return crmError(400, 'invalid_input');
  const q = sp.get('q') ?? '';
  if (q.length > 200) return crmError(400, 'invalid_input');
  const exclude = (sp.get('exclude') ?? '').split(',').map((x) => x.trim()).filter((x) => x && x.length <= 64);
  const hits = await searchAssociable(user.id, type, q, await sessionScope(user), exclude);
  return NextResponse.json({ results: hits });
}
