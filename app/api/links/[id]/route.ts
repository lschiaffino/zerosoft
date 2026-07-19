import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { getUserLink, hashPassword, toLinkDto } from '@/lib/links';
import { isValidSlug } from '@/lib/reserved';
import { isValidUrl, normalizeUrl } from '@/lib/utils';
import { todayClicksForLink } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const link = await getUserLink(user.id, params.id);
  if (!link) return notFound();
  return NextResponse.json({ ...toLinkDto(link), todayClicks: await todayClicksForLink(link.id) });
}

const patchSchema = z.object({
  url: z.string().min(1).optional(),
  title: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().max(40)).max(5).optional(),
  expiresAt: z.string().nullable().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
  archived: z.boolean().optional(),
  password: z.string().max(100).optional(), // '' clears, string sets
  slug: z.string().max(32).optional(),
  redirectType: z.union([z.literal(301), z.literal(302)]).optional(),
  ogTitle: z.string().max(200).nullable().optional(),
  ogDescription: z.string().max(500).nullable().optional(),
  ogImage: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const link = await getUserLink(user.id, params.id);
  if (!link) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const p = parsed.data;

  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  if (p.url !== undefined) {
    const normalized = normalizeUrl(p.url);
    if (!isValidUrl(normalized)) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    sets.push('url = ?');
    args.push(normalized);
  }
  if (p.title !== undefined) {
    sets.push('title = ?');
    args.push(p.title?.trim() || null);
  }
  if (p.tags !== undefined) {
    sets.push('tags = ?');
    args.push(JSON.stringify(p.tags.map((t) => t.trim()).filter(Boolean).slice(0, 5)));
  }
  if (p.expiresAt !== undefined) {
    if (p.expiresAt === null) {
      sets.push('expires_at = ?');
      args.push(null);
    } else {
      const d = new Date(p.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
      }
      sets.push('expires_at = ?');
      args.push(d.toISOString());
    }
  }
  if (p.maxClicks !== undefined) {
    sets.push('max_clicks = ?');
    args.push(p.maxClicks);
  }
  if (p.archived !== undefined) {
    sets.push('archived = ?');
    args.push(p.archived ? 1 : 0);
  }
  if (p.password !== undefined) {
    sets.push('password_hash = ?');
    args.push(p.password === '' ? null : hashPassword(p.password));
  }
  if (p.slug !== undefined && p.slug !== link.slug) {
    const slug = p.slug.trim();
    if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
    const taken = await getDb().prepare('SELECT 1 AS x FROM links WHERE slug = ? AND id != ?').get(slug, link.id);
    if (taken) return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
    sets.push('slug = ?');
    args.push(slug);
  }
  if (p.redirectType !== undefined) {
    sets.push('redirect_type = ?');
    args.push(p.redirectType === 301 ? 301 : 302);
  }
  if (p.ogTitle !== undefined) {
    sets.push('og_title = ?');
    args.push(p.ogTitle?.trim() || null);
  }
  if (p.ogDescription !== undefined) {
    sets.push('og_description = ?');
    args.push(p.ogDescription?.trim() || null);
  }
  if (p.ogImage !== undefined) {
    sets.push('og_image = ?');
    args.push(p.ogImage?.trim() || null);
  }

  if (sets.length > 0) {
    sets.push(`updated_at = datetime('now')`);
    await getDb()
      .prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, link.id);
  }

  const updated = (await getUserLink(user.id, params.id))!;
  return NextResponse.json(toLinkDto(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const link = await getUserLink(user.id, params.id);
  if (!link) return notFound();
  await getDb().prepare('DELETE FROM links WHERE id = ?').run(link.id);
  return new NextResponse(null, { status: 204 });
}
