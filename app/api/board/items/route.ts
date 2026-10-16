import { NextResponse } from 'next/server';
import { limitByIp, rateLimit } from '@/lib/rate-limit';
import { createIdea, findSimilarItems, ideaSchema, listBoardItems, parseBoardSort } from '@/lib/board';
import { getBoardPerson, localeFromRequest } from '@/lib/board-session';
import { itemRef } from '@/lib/roadmap-constants';

export const dynamic = 'force-dynamic';

/**
 * GET: ítems públicos del board (q, product, status, sort, limit) o, con
 * ?similar=<texto>, los parecidos a lo que se está escribiendo.
 */
export async function GET(req: Request) {
  const limited = await limitByIp(req, 'board-search', 120, 60);
  if (limited) return limited;
  const url = new URL(req.url);
  const person = await getBoardPerson();
  const similar = url.searchParams.get('similar');
  if (similar !== null) {
    const items = await findSimilarItems(similar.slice(0, 300), person?.id ?? null, 5);
    return NextResponse.json({ items: items.map(withRef) });
  }
  const items = await listBoardItems({
    q: url.searchParams.get('q'),
    product: url.searchParams.get('product'),
    status: url.searchParams.get('status'),
    sort: parseBoardSort(url.searchParams.get('sort')),
    limit: Number(url.searchParams.get('limit') ?? 50) || 50,
    userId: person?.id ?? null,
  });
  return NextResponse.json({ items: items.map(withRef), signedIn: Boolean(person) });
}

function withRef<T extends { id: string; title: string }>(item: T): T & { ref: string } {
  return { ...item, ref: itemRef(item.id, item.title) };
}

/**
 * Proponer una idea: requiere sesión, rate limit por IP y por persona,
 * honeypot. Queda pública en 'idea' (moderación posterior).
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'board-idea', 10, 3600);
  if (limited) return limited;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = ideaSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // Honeypot: al bot le respondemos OK sin guardar.
  if (parsed.data.website && parsed.data.website.trim() !== '') return NextResponse.json({ ok: true });

  const perUser =
    process.env.RATE_LIMIT_DISABLED === 'true' ? { ok: true } : await rateLimit(`board-idea-user:${person.id}`, 5, 3600);
  if (!perUser.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const item = await createIdea({
    userId: person.id,
    title: parsed.data.title,
    description: parsed.data.description,
    product: parsed.data.product,
    locale: localeFromRequest(req, raw?.locale),
  });
  return NextResponse.json({ item: withRef(item) }, { status: 201 });
}
