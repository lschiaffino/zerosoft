import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { searchAll, searchTasks } from '@/lib/crm';
import { searchDocPagesContent } from '@/lib/docs';
import { listLinks, toLinkDto } from '@/lib/links';
import { searchNotesForPalette } from '@/lib/notes';
import { searchApps } from '@/lib/app-search';
import { searchRuns } from '@/lib/crm-ai-agents';
import { searchLeads } from '@/lib/crm-leads';
import { listObjects, searchRecords } from '@/lib/crm-objects';
import { searchCustomReports } from '@/lib/crm-custom-reports';
import { searchMedia } from '@/lib/crm-media';
import { searchPlanning } from '@/lib/track-planning-search';

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

  const scope = await sessionScope(user);
  const [crm, links, docs, tasks, notes, apps, aiRuns, leads, records, objects, reports, media, planning] = await Promise.all([
    searchAll(user.id, q, scope),
    listLinks(user.id, { q, pageSize: 8, archived: 'all' }),
    // Docs: título y texto de los bloques (el fragmento va como meta).
    searchDocPagesContent(user.id, q, 10),
    searchTasks(user.id, q, scope),
    // Notas: solo las de la persona logueada (son privadas aunque el workspace sea compartido).
    searchNotesForPalette(user, q),
    // Pizarras, Track, Cal, widgets, Flow, Agents y Robots: por nombre.
    searchApps(user, q, undefined, req.nextUrl.searchParams.get('locale') ?? 'en'),
    // Corridas de los agentes de IA del CRM, por nombre.
    searchRuns(user.id, q),
    // CRM: leads (nombre, contacto, empresa) y registros de objetos propios (propiedad primaria).
    searchLeads(user.id, q, scope, 8),
    searchRecords(user.id, q, scope, 8),
    listObjects(user.id),
    // Reportes propios del CRM, por nombre.
    searchCustomReports(user.id, q),
    // CRM: documentos con seguimiento y videos 1:1, por nombre.
    searchMedia(user.id, q).catch(() => []),
    // Track: plans, initiatives y dashboards por nombre.
    searchPlanning({ teamId: user.team?.id ?? null, ownerId: user.id }, user.actingUser?.id ?? user.id, q).catch(() => []),
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

  for (const l of leads) {
    items.push({
      id: l.id,
      group: 'leads',
      label: l.name,
      meta: [l.stage_name, l.contact_name ?? l.company_name].filter(Boolean).join(' · '),
      href: `/app/crm/leads/${l.id}`,
    });
  }

  // Los objetos propios mismos (por nombre), para ir directo a su lista.
  const ql = q.toLowerCase();
  for (const o of objects.filter((x) => x.plural.toLowerCase().includes(ql) || x.singular.toLowerCase().includes(ql)).slice(0, 5)) {
    items.push({ id: o.id, group: 'records', label: o.plural, meta: '', href: `/app/crm/objects/${o.slug}` });
  }

  for (const r of records) {
    items.push({
      id: r.id,
      group: 'records',
      label: r.name,
      meta: r.singular,
      href: `/app/crm/objects/${r.slug}/${r.id}`,
    });
  }

  for (const m of media) {
    items.push({
      id: m.id,
      group: m.kind === 'document' ? 'crmDocuments' : 'crmVideos',
      label: m.label,
      meta: '',
      href: m.kind === 'document' ? `/app/crm/documents/${m.id}` : `/app/crm/videos/${m.id}`,
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
      id: p.row_id ? `${p.id}:${p.row_id}` : p.id,
      group: 'docs',
      label: p.title || 'Untitled',
      meta: p.snippet ?? '',
      // Fila de una base: abre la fila como página.
      href: p.row_id ? `/app/docs/${p.id}?row=${encodeURIComponent(p.row_id)}` : `/app/docs/${p.id}`,
    });
  }

  for (const n of notes) {
    items.push({
      id: n.id,
      group: 'notes',
      label: n.title || n.snippet || 'Untitled note',
      meta: n.title ? n.snippet : '',
      href: `/app/notes?note=${encodeURIComponent(n.id)}`,
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

  for (const r of aiRuns) {
    items.push({ id: r.id, group: 'crmAgentRuns', label: r.name, meta: '', href: `/app/crm/agents/${r.id}` });
  }

  items.push(...apps);
  items.push(...planning);

  for (const r of reports) {
    items.push({ id: r.id, group: 'reports', label: r.name, meta: '', href: `/app/crm/reports/custom/${r.id}` });
  }

  return NextResponse.json<SearchResponse>({ q, items });
}
