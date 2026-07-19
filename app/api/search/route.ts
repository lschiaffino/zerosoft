import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { searchAll, searchTasks } from '@/lib/crm';
import { searchDocPages } from '@/lib/docs';
import { listLinks, toLinkDto } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface SearchResultItem {
  id: string;
  group: string;
  label: string;
  meta: string;
  href: string;
}

export interface SearchResponse {
  q: string;
  items: SearchResultItem[];
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json<SearchResponse>({ q, items: [] });

  const [crm, links, docs, tasks] = await Promise.all([
    searchAll(user.id, q),
    listLinks(user.id, { q, pageSize: 8, archived: 'all' }),
    searchDocPages(user.id, q),
    searchTasks(user.id, q),
  ]);

  const items: SearchResultItem[] = [];

  for (const c of crm.contacts) {
    items.push({
      id: c.id,
      group: 'contacts',
      label: `${c.first_name} ${c.last_name}`.trim() || c.email,
      meta: c.email,
      href: `/app/crm/contacts/${c.id}`,
    });
  }

  for (const c of crm.companies) {
    items.push({
      id: c.id,
      group: 'companies',
      label: c.name,
      meta: c.domain ?? '',
      href: `/app/crm/companies/${c.id}`,
    });
  }

  for (const d of crm.deals) {
    items.push({
      id: d.id,
      group: 'deals',
      label: d.name,
      meta: `${d.currency} ${d.amount}`,
      href: `/app/crm/deals/${d.id}`,
    });
  }

  for (const l of links.links) {
    const dto = toLinkDto(l);
    items.push({
      id: dto.id,
      group: 'links',
      label: dto.title || dto.slug,
      meta: `${dto.short_url} → ${dto.url}`,
      href: `/app/links/${dto.id}`,
    });
  }

  for (const p of docs) {
    items.push({
      id: p.id,
      group: 'docs',
      label: p.title,
      meta: '',
      href: `/app/docs/${p.id}`,
    });
  }

  for (const t of tasks) {
    const related = t.contact_name || t.company_name || t.deal_name || '';
    items.push({
      id: t.id,
      group: 'tasks',
      label: t.subject || 'Untitled task',
      meta: related,
      href: `/app/crm/tasks/${t.id}`,
    });
  }

  return NextResponse.json<SearchResponse>({ q, items });
}
