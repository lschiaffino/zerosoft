import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { linkShortUrl, parseTags, type LinkWithDomain } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Exporta TODOS los links del workspace (sin hostages): ?format=csv (links) o
 * ?format=json (links + cada click con referrer/país/dispositivo).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const format = req.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'csv';

  const links = (await getDb()
    .prepare(
      `SELECT l.*, d.hostname AS domain_hostname FROM links l
       LEFT JOIN link_domains d ON d.id = l.domain_id
       WHERE l.user_id = ? ORDER BY l.created_at ASC`,
    )
    .all(user.id)) as LinkWithDomain[];
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const header = ['short_url', 'slug', 'domain', 'url', 'title', 'tags', 'clicks', 'archived', 'expires_at', 'max_clicks', 'created_at'];
    const lines = [header.join(',')];
    for (const l of links) {
      lines.push(
        [
          linkShortUrl(l),
          l.slug,
          l.domain_hostname ?? '',
          l.url,
          l.title ?? '',
          parseTags(l.tags).join('|'),
          l.clicks,
          l.archived ? 'yes' : 'no',
          l.expires_at ?? '',
          l.max_clicks ?? '',
          l.created_at,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return new NextResponse(lines.join('\n') + '\n', {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="zerosoft-links-${stamp}.csv"`,
      },
    });
  }

  const clicks = (await getDb()
    .prepare(
      `SELECT c.link_id, c.ts, c.referrer, c.country, c.device, c.browser, c.os FROM clicks c
       JOIN links l ON l.id = c.link_id WHERE l.user_id = ? ORDER BY c.ts ASC`,
    )
    .all(user.id)) as Array<{ link_id: string } & Record<string, unknown>>;
  const byLink = new Map<string, Array<Record<string, unknown>>>();
  for (const { link_id, ...rest } of clicks) {
    if (!byLink.has(link_id)) byLink.set(link_id, []);
    byLink.get(link_id)!.push(rest);
  }
  const body = {
    exportedAt: new Date().toISOString(),
    links: links.map((l) => ({
      id: l.id,
      shortUrl: linkShortUrl(l),
      slug: l.slug,
      domain: l.domain_hostname ?? null,
      url: l.url,
      title: l.title,
      tags: parseTags(l.tags),
      archived: l.archived === 1,
      expiresAt: l.expires_at,
      maxClicks: l.max_clicks,
      createdAt: l.created_at,
      clickCount: l.clicks,
      clicks: byLink.get(l.id) ?? [],
    })),
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="zerosoft-links-${stamp}.json"`,
    },
  });
}
