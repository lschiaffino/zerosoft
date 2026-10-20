import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getAgentRow, listKnowledgeUrls, listSecretHeaders, listWorkspaceWidgets, toAgentDto } from '@/lib/agents';
import { listTestCases } from '@/lib/agents-tests';
import { canEditAgents } from '@/lib/agents-http';
import { aiEnabled } from '@/lib/ai';
import AgentEditor from '@/components/agents/AgentEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Agents' };

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return (process.env.NEXT_PUBLIC_SITE_URL || 'https://zerosoft.ai').replace(/\/$/, '');
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function AgentEditorPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string; c?: string }>;
}) {
  const { locale, id } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(locale);
  const row = await getAgentRow(user.id, id);
  if (!row) notFound();
  const agent = toAgentDto(row);
  const canEdit = canEditAgents(user);
  const db = getDb();
  const [urls, widgets, docsPages, eventTypes, projects, flows, tests] = await Promise.all([
    listKnowledgeUrls(id),
    listWorkspaceWidgets(user.id),
    db
      .prepare('SELECT id, title, is_public FROM docs_pages WHERE user_id = ? AND archived = 0 ORDER BY title COLLATE NOCASE LIMIT 300')
      .all(user.id) as Promise<Array<{ id: string; title: string; is_public: number }>>,
    db
      .prepare('SELECT id, title, duration_min FROM calendar_event_types WHERE user_id = ? AND active = 1 ORDER BY title')
      .all(user.id) as Promise<Array<{ id: string; title: string; duration_min: number }>>,
    db
      .prepare("SELECT id, name FROM track_projects WHERE owner_id = ? AND status = 'active' ORDER BY name")
      .all(user.id) as Promise<Array<{ id: string; name: string }>>,
    db.prepare('SELECT id, name FROM flow_flows WHERE user_id = ? ORDER BY name').all(user.id) as Promise<
      Array<{ id: string; name: string }>
    >,
    listTestCases(user.id, id),
  ]);
  return (
    <AgentEditor
      key={agent.id}
      agent={agent}
      urls={urls}
      widgets={widgets}
      docsPages={docsPages.map((p) => ({ id: p.id, title: p.title, isPublic: p.is_public === 1 }))}
      eventTypes={eventTypes.map((e) => ({ id: e.id, title: e.title, durationMin: e.duration_min }))}
      projects={projects}
      flows={flows}
      canEdit={canEdit}
      secretHeaders={canEdit ? listSecretHeaders(row) : []}
      tests={tests}
      aiEnabled={aiEnabled()}
      origin={await requestOrigin()}
      initialTab={search.tab}
      initialConversationId={search.c ?? null}
    />
  );
}
