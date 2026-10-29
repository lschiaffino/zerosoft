import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { aiKnowledgeFilterSql, hiddenTeamspaceIds, teamspaceFilterSql } from '@/lib/docs-access';
import { listKnowledgeUrls, listSecretHeaders, listWorkspaceWidgets, toAgentDto } from '@/lib/agents';
import { listTestCases } from '@/lib/agents-tests';
import { canEditAgent, canEditAgents, visibleAgentRow } from '@/lib/agents-http';
import { agentsAiEnabled } from '@/lib/agents-ai';
import { withDraft } from '@/lib/agents-draft';
import { versioningMeta } from '@/lib/agents-versions';
import { listKnowledgeFiles, listQa, sitemapStatus } from '@/lib/agents-knowledge';
import { listMcpServers } from '@/lib/agents-mcp';
import AgentEditor from '@/components/agents/AgentEditor';
import { agentCodeAvailable } from '@/lib/agents-code';

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
  const row = await visibleAgentRow(user, id);
  if (!row) notFound();
  // El editor trabaja sobre el borrador (con versiones) o lo guardado.
  const agent = toAgentDto(withDraft(row));
  // Editar este agente (admins y editores del agente); secretos, MCP y conexiones, solo admins.
  const canEdit = canEditAgent(user, row);
  const isAdmin = canEditAgents(user);
  const db = getDb();
  const [urls, widgets, docsPages, eventTypes, projects, flows, robots, tests] = await Promise.all([
    listKnowledgeUrls(id),
    listWorkspaceWidgets(user.id),
    // Para elegir como conocimiento: sin las de teamspaces cerrados o privados sin permiso de IA,
    // ni las que quien edita no puede ver. `restricted`: de un teamspace cerrado o privado.
    hiddenTeamspaceIds(user.id, user.actingUser?.id ?? user.id).then((hidden) => {
      const ts = teamspaceFilterSql(hidden, 'p.teamspace_id');
      return db
        .prepare(
          `SELECT p.id, p.title, p.is_public, CASE WHEN t.access IN ('closed', 'private') AND t.is_default = 0 THEN 1 ELSE 0 END AS restricted
           FROM docs_pages p LEFT JOIN docs_teamspaces t ON t.id = p.teamspace_id
           WHERE p.user_id = ? AND p.archived = 0${aiKnowledgeFilterSql('p.teamspace_id')}${ts.sql} ORDER BY p.title COLLATE NOCASE LIMIT 300`,
        )
        .all(user.id, ...ts.args) as Promise<Array<{ id: string; title: string; is_public: number; restricted: number }>>;
    }),
    db
      .prepare('SELECT id, title, duration_min FROM calendar_event_types WHERE user_id = ? AND active = 1 ORDER BY title')
      .all(user.id) as Promise<Array<{ id: string; title: string; duration_min: number }>>,
    db
      .prepare("SELECT id, name FROM track_projects WHERE owner_id = ? AND status = 'active' ORDER BY name")
      .all(user.id) as Promise<Array<{ id: string; name: string }>>,
    db.prepare('SELECT id, name FROM flow_flows WHERE user_id = ? ORDER BY name').all(user.id) as Promise<
      Array<{ id: string; name: string }>
    >,
    db.prepare('SELECT id, name FROM robots WHERE user_id = ? ORDER BY name').all(user.id) as Promise<
      Array<{ id: string; name: string }>
    >,
    listTestCases(user.id, id),
  ]);
  const [versioning, files, qa, sitemaps] = await Promise.all([versioningMeta(row), listKnowledgeFiles(id), listQa(id), sitemapStatus(id)]);
  // Páginas del agente que quien edita no ve (teamspaces cerrados o privados): no se listan, pero se avisa.
  const visibleIds = new Set(docsPages.map((p) => p.id));
  const hiddenDocsPages = agent.tools.docsPageIds.some((pid) => !visibleIds.has(pid));
  return (
    <AgentEditor
      key={agent.id}
      hiddenDocsPages={hiddenDocsPages}
      agent={agent}
      urls={urls}
      widgets={widgets}
      docsPages={docsPages.map((p) => ({ id: p.id, title: p.title, isPublic: p.is_public === 1, restricted: Number(p.restricted) === 1 }))}
      eventTypes={eventTypes.map((e) => ({ id: e.id, title: e.title, durationMin: e.duration_min }))}
      projects={projects}
      flows={flows}
      robots={robots}
      canEdit={canEdit}
      secretHeaders={isAdmin ? listSecretHeaders(row) : []}
      tests={tests}
      versioning={versioning}
      files={files}
      qa={qa}
      sitemaps={sitemaps}
      mcpServers={isAdmin ? listMcpServers(row) : []}
      isAdmin={isAdmin}
      codeAvailable={agentCodeAvailable()}
      aiEnabled={await agentsAiEnabled()}
      origin={await requestOrigin()}
      initialTab={search.tab}
      initialConversationId={search.c ?? null}
    />
  );
}
