/**
 * Herramientas del asistente, por app. Todas llaman a las funciones de lib/*
 * que usan las rutas de cada app, con el workspace y la persona de la sesión
 * y los mismos filtros de visibilidad (CRM por dueño, Track por proyecto,
 * Cal por host, Flow y Robots por persona…). Ver lib/assistant/registry.ts
 * para el filtro por rol y app.
 */
import { z } from 'zod';
import type { SessionUser } from '../session';
import { getDb } from '../db';
import { appFromPath, ensureWorkspace, listTeamPeople, userCanUseApp } from '../workspace';
import { canManage } from '../teams-http';
import { getMemberRole, removeMember } from '../teams';
import { inviteMany } from '../workspace-invites';
import { createContact, createDeal, createPipeline, createStage, deleteContact, listPipelinesWithStages, listTasks, searchAll } from '../crm';
import { canSeeEntity, scopeAnd, sessionScope } from '../crm-visibility';
import { listImportJobs as listCrmImportJobs } from '../crm-import-jobs';
import { listWorkspaceImportJobs } from '../import-jobs';
import { listDeliveries, listWebhooks } from '../webhooks';
import { listFlows } from '../flow';
import { searchRuns } from '../flow-monitor';
import { runViewer } from '../flow-http';
import { listRobotRuns, listRobots } from '../robots';
import { robotViewer } from '../robots-http';
import { getMailboxSync } from '../crm-email-sync';
import { canAccessTrackProject, createIssue, getProject, listProjects } from '../track-data';
import { getAccessiblePlan, listPlans, updatePlan } from '../track-plans';
import { issueCreateSchema } from '../track-schema';
import { searchPages, createPage } from '../docs-platform';
import { createNote, listNotes, noteOwner } from '../notes';
import { listEventTypes, listUserBookings } from '../calendar';
import { viewerScope } from '../calendar-access';
import { createLink, listLinks, toLinkDto } from '../links';
import { viewerOf } from '../link-folders';
import { listChatConversations, listChatWidgets } from '../chat-data';
import { listMyChannels, talkActor } from '../talk';
import { listSessions, voiceOwner } from '../voice';
import { listChats } from '../groups';
import { groupsViewer } from '../groups-access';
import { listAgents } from '../agents';
import { listBoards } from '../boards';
import { boardViewer } from '../board-access';
import { searchApps } from '../app-search';
import { listProjects as listAnalyticsProjects, type ProjectRow } from '../analytics/projects';
import { runFunnel, runInsight, runTrends, runWeb, QueryError } from '../analytics/query';
import { listFlags, listInsights } from '../analytics/records';
import { rateLimit } from '../rate-limit';
import { maskUrl } from './redact';
import { canUseTool, readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

// ---------- Utilidades ----------

function pick<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (row as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Entre varios por nombre: exacto primero, después el que lo contiene. */
function byName<T>(rows: T[], name: string, get: (r: T) => string): T | undefined {
  const n = norm(name);
  return rows.find((r) => norm(get(r)) === n) ?? rows.find((r) => norm(get(r)).includes(n));
}

async function crmScope(ctx: ToolCtx) {
  return sessionScope(ctx.user);
}

function teamOf(user: SessionUser) {
  return user.team?.id ?? null;
}

const contactName = (c: { first_name: string; last_name: string; email: string }) => `${c.first_name} ${c.last_name}`.trim() || c.email || 'Unnamed';

// ---------- Plataforma ----------

const platform: AssistantTool[] = [
  readTool({
    name: 'search_workspace',
    app: null,
    description: 'Search across every app the person can use (records, pages, issues, flows, robots, boards, bookings, channels…). Returns names, the app and a link.',
    input: z.object({ query: z.string().trim().min(1).max(200) }),
    run: async (ctx, { query }) => {
      const items = await searchApps(ctx.user, query, 5, ctx.locale);
      const out: Array<{ group: string; name: string; meta: string | null; href: string }> = items.map((i) => ({ group: i.group, name: i.label, meta: i.meta, href: i.href }));
      if (userCanUseApp(ctx.user, 'crm')) {
        const res = await searchAll(ctx.workspaceId, query, await crmScope(ctx));
        for (const c of res.contacts) out.push({ group: 'contacts', name: contactName(c), meta: c.email, href: `/app/crm/contacts/${c.id}` });
        for (const c of res.companies) out.push({ group: 'companies', name: c.name, meta: c.domain, href: `/app/crm/companies/${c.id}` });
        for (const d of res.deals) out.push({ group: 'deals', name: d.name, meta: `${d.amount} ${d.currency}`, href: `/app/crm/deals/${d.id}` });
      }
      if (userCanUseApp(ctx.user, 'docs')) {
        for (const h of await searchPages(ctx.user, query, 5).catch(() => [])) out.push({ group: 'docs', name: h.page.title || 'Untitled', meta: '', href: `/app/docs/${h.page.id}` });
      }
      // Igual que /api/search: nada de una app que la persona no tiene.
      return { results: out.filter((i) => { const app = appFromPath(i.href); return !app || userCanUseApp(ctx.user, app); }).slice(0, 30) };
    },
  }),
  readTool({
    name: 'list_members',
    app: null,
    description: 'List the people in this workspace with their role and the apps each one can use.',
    input: z.object({}),
    run: async (ctx) => {
      const team = ctx.user.workspace ?? (await ensureWorkspace(ctx.workspaceId));
      const people = await listTeamPeople(team);
      return { members: people.map((p) => ({ name: p.name, email: p.email, role: p.role, apps: p.apps, title: p.title })) };
    },
  }),
  writeTool({
    name: 'propose_invite_member',
    app: null,
    admin: true,
    description: 'Prepare an invitation to the workspace by email, with role (member, admin or guest) and the apps the person can use ("*" for all). The person confirms before it is sent.',
    input: z.object({
      email: z.string().trim().email().max(200),
      role: z.enum(['member', 'admin', 'guest']).default('member'),
      apps: z.array(z.string()).max(20).optional().describe('App keys: crm, docs, track, talk, voice, cal, flow, robots, agents, link, notes, board, chat, groups, rec, analytics. Omit for all apps.'),
    }),
    prepare: async (ctx, { email, role, apps }) => {
      if (role === 'admin' && ctx.user.role !== 'owner') return { error: 'only_owner_invites_admins' };
      const valid = (apps ?? []).map((a) => a.toLowerCase()).filter((a) => /^[a-z]+$/.test(a));
      const list = !apps?.length || valid.includes('*') ? '*' : valid;
      return {
        summary: `Invite ${email} as ${role}`,
        details: [
          { label: 'Email', after: email },
          { label: 'Role', after: role },
          { label: 'Apps', after: list === '*' ? 'All apps' : list.join(', ') },
        ],
        input: { email, role, apps: list },
      };
    },
    execute: async (ctx, input) => {
      const team = ctx.user.workspace ?? (await ensureWorkspace(ctx.workspaceId));
      if (input.role === 'admin' && ctx.user.role !== 'owner') return { ok: false, error: 'only_owner_invites_admins' };
      // El mismo tope que POST /api/teams/invites.
      const limit = await rateLimit(`teams:invite:${ctx.personId}`, 30, 3600);
      if (!limit.ok) return { ok: false, error: 'rate_limited' };
      const real = ctx.user.actingUser ?? ctx.user;
      const base = (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const { results } = await inviteMany({
        team,
        inviter: { id: ctx.personId, name: real.name, email: real.email },
        emails: [String(input.email)],
        role: input.role,
        apps: input.apps,
        locale: ctx.locale,
        base,
      });
      const r = results[0];
      if (!r || r.status === 'invalid' || r.status === 'limited') return { ok: false, error: r?.status ?? 'invalid' };
      if (r.status === 'member') return { ok: true, message: `${input.email} is already in the workspace.`, href: '/app/settings/members' };
      return { ok: true, message: `Invitation for ${input.email}: ${r.status}.`, href: '/app/settings/members' };
    },
  }),
  writeTool({
    name: 'propose_remove_member',
    app: null,
    admin: true,
    destructive: true,
    description: 'Prepare removing a person from the workspace (by email). Destructive: the person types the email to confirm.',
    input: z.object({ email: z.string().trim().email().max(200) }),
    prepare: async (ctx, { email }) => {
      const team = ctx.user.workspace ?? (await ensureWorkspace(ctx.workspaceId));
      const person = (await listTeamPeople(team, { includeGuests: true })).find((p) => p.email.toLowerCase() === email.toLowerCase());
      if (!person) return { error: 'member_not_found' };
      if (person.role === 'owner') return { error: 'cannot_remove_owner' };
      if (person.user_id === ctx.personId) return { error: 'use_leave_in_settings' };
      if (!canManage(ctx.user.role, person.role)) return { error: 'forbidden' };
      return {
        summary: `Remove ${person.name ?? person.email} from the workspace`,
        details: [{ label: 'Person', before: `${person.email} (${person.role})`, after: 'Removed' }],
        confirmText: person.email,
        input: { email: person.email, userId: person.user_id },
      };
    },
    execute: async (ctx, input) => {
      const team = ctx.user.workspace ?? (await ensureWorkspace(ctx.workspaceId));
      const role = await getMemberRole(team.id, String(input.userId));
      if (!role) return { ok: false, error: 'member_not_found' };
      if (role === 'owner' || !canManage(ctx.user.role, role)) return { ok: false, error: 'forbidden' };
      // El mismo tope que DELETE /api/teams/members/<id>.
      const limit = await rateLimit(`teams:remove:${ctx.personId}`, 60, 3600);
      if (!limit.ok) return { ok: false, error: 'rate_limited' };
      await removeMember(team.id, String(input.userId));
      return { ok: true, message: `${input.email} was removed.`, href: '/app/settings/members' };
    },
  }),
  readTool({
    name: 'list_import_jobs',
    app: null,
    description: 'Recent imports (CRM from HubSpot/Pipedrive, Track, Cal and Docs imports) with status, counts and errors. Use to diagnose a failed or stuck import.',
    input: z.object({}),
    run: async (ctx) => {
      const jobs: Array<Record<string, unknown>> = [];
      const generic = await listWorkspaceImportJobs(ctx.workspaceId, 10, ctx.isAdmin ? null : ctx.personId).catch(() => []);
      for (const j of generic) jobs.push({ kind: `${j.app} import`, ...pick(j, ['id', 'source', 'status', 'stage', 'total', 'processed', 'error', 'created_at', 'finished_at']) });
      if (ctx.isAdmin && userCanUseApp(ctx.user, 'crm')) {
        for (const j of await listCrmImportJobs(ctx.workspaceId, 5).catch(() => [])) {
          jobs.push({ kind: 'crm import', ...pick(j, ['id', 'provider', 'status', 'phase', 'counts', 'errorCount', 'failure', 'createdAt', 'finishedAt']), errors: j.errors.slice(0, 5) });
        }
      }
      return { jobs, href: '/app/settings/import' };
    },
  }),
  readTool({
    name: 'list_webhooks',
    app: null,
    admin: true,
    allApps: true,
    description: 'Workspace webhooks with their events and last delivery. Use first when the person asks why a webhook did not fire.',
    input: z.object({}),
    run: async (ctx) => ({
      // La URL de un webhook suele ser el secreto (Slack, Zapier): solo el host.
      webhooks: (await listWebhooks(ctx.workspaceId)).map((w) => ({ ...pick(w, ['id', 'events', 'active', 'lastDelivery', 'createdAt']), host: maskUrl(w.url) })),
    }),
  }),
  readTool({
    name: 'webhook_deliveries',
    app: null,
    admin: true,
    allApps: true,
    description: 'Recent deliveries of one webhook (status, HTTP code, error, attempts, next retry). Diagnoses why a webhook failed or did not fire.',
    input: z.object({ webhookId: z.string().min(1).max(64), onlyFailed: z.boolean().optional() }),
    run: async (ctx, { webhookId, onlyFailed }) => {
      const rows = await listDeliveries(ctx.workspaceId, webhookId, 30, ctx.personId);
      if (!rows) return { error: 'webhook_not_found' };
      return {
        deliveries: rows
          .filter((d) => !onlyFailed || d.status === 'failed')
          .slice(0, 20)
          .map((d) => pick(d, ['event', 'status', 'attempts', 'responseCode', 'error', 'durationMs', 'nextAttemptAt', 'createdAt', 'deliveredAt'])),
        href: '/app/settings/api',
      };
    },
  }),
  readTool({
    name: 'integration_health',
    app: null,
    description: "The person's connected accounts (Gmail, Google Calendar, Outlook, iCloud) with last sync and token expiry, plus the CRM mailbox sync status and its last error. Never returns tokens.",
    input: z.object({}),
    run: async (ctx) => {
      const rows = (await getDb()
        .prepare('SELECT provider, email, scope, expires_at, last_sync_at, updated_at FROM integrations WHERE user_id = ? ORDER BY provider')
        .all(ctx.personId)) as Array<{ provider: string; email: string | null; scope: string | null; expires_at: string | number | null; last_sync_at: string | null; updated_at: string | null }>;
      const sync = userCanUseApp(ctx.user, 'crm') ? await getMailboxSync(ctx.workspaceId, ctx.personId).catch(() => null) : null;
      return {
        integrations: rows.map((r) => ({ provider: r.provider, account: r.email, lastSync: r.last_sync_at, tokenExpires: r.expires_at, updated: r.updated_at })),
        crmMailboxSync: sync ? pick(sync, ['status', 'error', 'last_sync_at', 'last_full_sync_at']) : null,
        href: '/app/settings/connections',
      };
    },
  }),
  readTool({
    name: 'email_status',
    app: null,
    description: 'Delivery status of emails the workspace sent: workspace invitations (sent, failed, skipped) and, with CRM, recent sequence enrollments that stopped with an error.',
    input: z.object({}),
    run: async (ctx) => {
      const team = ctx.user.workspace ?? (await ensureWorkspace(ctx.workspaceId));
      const invites = ctx.isAdmin
        ? ((await getDb()
            .prepare('SELECT email, role, email_status, sent_at, send_count, created_at FROM team_invites WHERE team_id = ? ORDER BY created_at DESC LIMIT 20')
            .all(team.id)
            .catch(() => [])) as Array<Record<string, unknown>>)
        : [];
      const sequences = userCanUseApp(ctx.user, 'crm')
        ? ((await getDb()
            .prepare(
              `SELECT e.status, e.exit_reason, e.updated_at, s.name AS sequence FROM crm_sequence_enrollments e LEFT JOIN crm_sequences s ON s.id = e.sequence_id
               WHERE e.user_id = ? AND e.exit_reason IS NOT NULL AND e.exit_reason != '' ORDER BY e.updated_at DESC LIMIT 20`,
            )
            .all(ctx.workspaceId)
            .catch(() => [])) as Array<Record<string, unknown>>)
        : [];
      return { invitations: invites, sequenceExits: sequences };
    },
  }),
];

// ---------- CRM ----------

const crm: AssistantTool[] = [
  readTool({
    name: 'crm_search',
    app: 'crm',
    description: 'Search CRM contacts, companies and deals by name, email or domain. Returns ids for other CRM tools.',
    input: z.object({ query: z.string().trim().min(1).max(200) }),
    run: async (ctx, { query }) => {
      const res = await searchAll(ctx.workspaceId, query, await crmScope(ctx));
      return {
        contacts: res.contacts.map((c) => ({ id: c.id, name: contactName(c), email: c.email, href: `/app/crm/contacts/${c.id}` })),
        companies: res.companies.map((c) => ({ id: c.id, name: c.name, domain: c.domain, href: `/app/crm/companies/${c.id}` })),
        deals: res.deals.map((d) => ({ id: d.id, name: d.name, amount: d.amount, currency: d.currency, href: `/app/crm/deals/${d.id}` })),
      };
    },
  }),
  readTool({
    name: 'crm_list_deals',
    app: 'crm',
    description: 'List CRM deals with filters (open only by default). For "deals closing this month" pass closeFrom and closeTo (YYYY-MM-DD).',
    input: z.object({
      stage: z.string().max(100).optional(),
      pipeline: z.string().max(100).optional(),
      closeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      closeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      mine: z.boolean().optional(),
      includeClosed: z.boolean().optional(),
      sort: z.enum(['amount', 'close_date', 'recent']).optional(),
    }),
    run: async (ctx, f) => {
      const where = ['d.user_id = ?'];
      const args: Array<string | number> = [ctx.workspaceId];
      if (!f.includeClosed) where.push('COALESCE(s.is_won, 0) = 0 AND COALESCE(s.is_lost, 0) = 0');
      if (f.stage) {
        where.push("s.name LIKE ? ESCAPE '\\'");
        args.push(like(f.stage));
      }
      if (f.pipeline) {
        where.push("p.name LIKE ? ESCAPE '\\'");
        args.push(like(f.pipeline));
      }
      if (f.closeFrom) {
        where.push('d.close_date IS NOT NULL AND substr(d.close_date, 1, 10) >= ?');
        args.push(f.closeFrom);
      }
      if (f.closeTo) {
        where.push('d.close_date IS NOT NULL AND substr(d.close_date, 1, 10) <= ?');
        args.push(f.closeTo);
      }
      if (f.mine) {
        where.push('d.owner_id = ?');
        args.push(ctx.personId);
      }
      const scope = scopeAnd('d', await crmScope(ctx));
      const order = f.sort === 'amount' ? 'd.amount DESC' : f.sort === 'close_date' ? 'd.close_date IS NULL, d.close_date ASC' : 'd.updated_at DESC';
      const rows = (await getDb()
        .prepare(
          `SELECT d.id, d.name, d.amount, d.currency, d.close_date, s.name AS stage, p.name AS pipeline
           FROM crm_deals d LEFT JOIN crm_stages s ON s.id = d.stage_id LEFT JOIN crm_pipelines p ON p.id = d.pipeline_id
           WHERE ${where.join(' AND ')}${scope.sql} ORDER BY ${order} LIMIT 25`,
        )
        .all(...args, ...scope.args)) as Array<{ id: string; name: string; amount: number; currency: string; close_date: string | null; stage: string | null; pipeline: string | null }>;
      return {
        total: rows.length,
        deals: rows.map((r) => ({ ...r, close_date: r.close_date?.slice(0, 10) ?? null, href: `/app/crm/deals/${r.id}` })),
      };
    },
  }),
  readTool({
    name: 'crm_pipelines',
    app: 'crm',
    description: 'CRM pipelines with their stages and the open deals in each stage (count and amount).',
    input: z.object({}),
    run: async (ctx) => {
      const pipelines = await listPipelinesWithStages(ctx.workspaceId);
      const scope = scopeAnd('d', await crmScope(ctx));
      const counts = (await getDb()
        .prepare(`SELECT d.stage_id, COUNT(*) AS n, COALESCE(SUM(d.amount), 0) AS amount FROM crm_deals d WHERE d.user_id = ?${scope.sql} GROUP BY d.stage_id`)
        .all(ctx.workspaceId, ...scope.args)) as Array<{ stage_id: string; n: number; amount: number }>;
      const by = new Map(counts.map((c) => [c.stage_id, c]));
      return {
        pipelines: pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, deals: Number(by.get(s.id)?.n ?? 0), amount: Number(by.get(s.id)?.amount ?? 0) })),
        })),
      };
    },
  }),
  readTool({
    name: 'crm_tasks',
    app: 'crm',
    description: 'CRM tasks: overdue, due today or upcoming.',
    input: z.object({ bucket: z.enum(['overdue', 'today', 'upcoming']), mine: z.boolean().optional() }),
    run: async (ctx, { bucket, mine }) => {
      const rows = await listTasks(ctx.workspaceId, { bucket, ownerScope: await crmScope(ctx), ownerId: mine ? ctx.personId : undefined });
      return { total: rows.length, tasks: rows.slice(0, 20).map((t) => ({ subject: t.subject, due: t.due_at?.slice(0, 10) ?? null, related: t.contact_name || t.company_name || t.deal_name || null })) };
    },
  }),
  writeTool({
    name: 'propose_crm_create_pipeline',
    app: 'crm',
    description: 'Prepare a new CRM deal pipeline with the given stages in order. The person confirms before it is created.',
    input: z.object({
      name: z.string().trim().min(1).max(100),
      stages: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    }),
    prepare: async (ctx, { name, stages }) => {
      const existing = await listPipelinesWithStages(ctx.workspaceId);
      if (existing.some((p) => norm(p.name) === norm(name))) return { error: 'pipeline_name_taken' };
      return {
        summary: `Create pipeline "${name}" with ${stages.length} stages`,
        details: [{ label: 'Pipeline', after: name }, ...stages.map((s, i) => ({ label: `Stage ${i + 1}`, after: s }))],
        input: { name, stages },
      };
    },
    execute: async (ctx, input) => {
      const stages = (input.stages as string[]) ?? [];
      const p = await createPipeline(ctx.workspaceId, String(input.name));
      // createPipeline arma etapas por defecto: se reemplazan por las pedidas si las hay.
      const db = getDb();
      const defaults = (await db.prepare('SELECT id FROM crm_stages WHERE pipeline_id = ?').all(p.id)) as Array<{ id: string }>;
      for (const s of stages) await createStage(ctx.workspaceId, p.id, { name: s });
      if (defaults.length && stages.length) {
        await db.prepare(`DELETE FROM crm_stages WHERE pipeline_id = ? AND id IN (${defaults.map(() => '?').join(',')})`).run(p.id, ...defaults.map((d) => d.id));
      }
      return { ok: true, message: `Pipeline "${p.name}" created with ${stages.length} stages.`, href: `/app/crm/deals?pipeline=${p.id}` };
    },
  }),
  writeTool({
    name: 'propose_crm_create_contact',
    app: 'crm',
    description: 'Prepare a new CRM contact.',
    input: z.object({
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
      email: z.string().trim().email().max(200).optional(),
      phone: z.string().trim().max(50).optional(),
      jobTitle: z.string().trim().max(100).optional(),
    }),
    prepare: async (_ctx, input) => {
      if (!input.firstName && !input.lastName && !input.email) return { error: 'name_or_email_required' };
      const label = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim() || input.email!;
      return {
        summary: `Create contact ${label}`,
        details: Object.entries(input).filter(([, v]) => v).map(([k, v]) => ({ label: k, after: String(v) })),
        input,
      };
    },
    execute: async (ctx, input) => {
      const c = await createContact(ctx.workspaceId, { ...(input as Record<string, string>), ownerId: ctx.personId });
      return { ok: true, message: `Contact ${contactName(c)} created.`, href: `/app/crm/contacts/${c.id}` };
    },
  }),
  writeTool({
    name: 'propose_crm_create_deal',
    app: 'crm',
    description: 'Prepare a new CRM deal. Pipeline and stage by name (defaults: first pipeline, first stage).',
    input: z.object({
      name: z.string().trim().min(1).max(200),
      amount: z.number().min(0).optional(),
      pipeline: z.string().max(100).optional(),
      stage: z.string().max(100).optional(),
      closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    prepare: async (ctx, input) => {
      const pipelines = await listPipelinesWithStages(ctx.workspaceId);
      const p = input.pipeline ? byName(pipelines, input.pipeline, (x) => x.name) : pipelines[0];
      if (!p) return { error: 'pipeline_not_found', hint: pipelines.map((x) => x.name) };
      const s = input.stage ? byName(p.stages, input.stage, (x) => x.name) : p.stages[0];
      if (!s) return { error: 'stage_not_found', hint: p.stages.map((x) => x.name) };
      return {
        summary: `Create deal "${input.name}" in ${p.name} / ${s.name}`,
        details: [
          { label: 'Deal', after: input.name },
          { label: 'Stage', after: `${p.name} / ${s.name}` },
          ...(input.amount != null ? [{ label: 'Amount', after: String(input.amount) }] : []),
          ...(input.closeDate ? [{ label: 'Close date', after: input.closeDate }] : []),
        ],
        input: { name: input.name, amount: input.amount, closeDate: input.closeDate, pipelineId: p.id, stageId: s.id },
      };
    },
    execute: async (ctx, input) => {
      const res = await createDeal(ctx.workspaceId, {
        name: String(input.name),
        amount: typeof input.amount === 'number' ? input.amount : undefined,
        closeDate: (input.closeDate as string | undefined) ?? null,
        pipelineId: String(input.pipelineId),
        stageId: String(input.stageId),
        ownerId: ctx.personId,
      });
      if (!res.ok) return { ok: false, error: res.reason };
      return { ok: true, message: `Deal "${res.deal.name}" created.`, href: `/app/crm/deals/${res.deal.id}` };
    },
  }),
  writeTool({
    name: 'propose_crm_delete_contact',
    app: 'crm',
    destructive: true,
    description: 'Prepare moving a CRM contact to the trash (restorable for 90 days). Destructive: the person types the contact name to confirm.',
    input: z.object({ contactId: z.string().min(1).max(64) }),
    prepare: async (ctx, { contactId }) => {
      if (!(await canSeeEntity(ctx.workspaceId, 'contact', contactId, await crmScope(ctx)))) return { error: 'contact_not_found' };
      const c = (await getDb().prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?').get(contactId, ctx.workspaceId)) as
        | { id: string; first_name: string; last_name: string; email: string }
        | undefined;
      if (!c) return { error: 'contact_not_found' };
      const label = contactName(c);
      return { summary: `Move contact ${label} to the trash`, details: [{ label: 'Contact', before: label, after: 'Trash' }], confirmText: label, input: { contactId } };
    },
    execute: async (ctx, input) => {
      const id = String(input.contactId);
      if (!(await canSeeEntity(ctx.workspaceId, 'contact', id, await crmScope(ctx)))) return { ok: false, error: 'contact_not_found' };
      const real = ctx.user.actingUser ?? ctx.user;
      const ok = await deleteContact(ctx.workspaceId, id, real.email);
      return ok ? { ok: true, message: 'Contact moved to the trash.', href: '/app/crm/trash' } : { ok: false, error: 'contact_not_found' };
    },
  }),
];

// ---------- Track ----------

async function trackPlan(ctx: ToolCtx, name: string) {
  const scope = { teamId: teamOf(ctx.user), ownerId: ctx.workspaceId };
  const plans = await listPlans(scope, { q: name });
  const hit = byName(plans, name, (p) => p.name) ?? (plans.length === 1 ? plans[0] : undefined);
  return { scope, plan: hit, candidates: plans.slice(0, 10).map((p) => p.name) };
}

const track: AssistantTool[] = [
  readTool({
    name: 'track_teams',
    app: 'track',
    description: 'Track teams (issue spaces with a key like WEB) with their open issue counts. Use the id to create issues.',
    input: z.object({}),
    run: async (ctx) => {
      const { rows } = await listProjects(teamOf(ctx.user), ctx.workspaceId);
      return { teams: rows.map((r) => pick(r, ['id', 'name', 'slug', 'status', 'open_count', 'issue_count'])) };
    },
  }),
  readTool({
    name: 'track_projects',
    app: 'track',
    description: 'Track projects (plans) with status, lead, progress, health and their update reminder cadence. Filter by name with query.',
    input: z.object({ query: z.string().max(100).optional() }),
    run: async (ctx, { query }) => {
      const plans = await listPlans({ teamId: teamOf(ctx.user), ownerId: ctx.workspaceId }, query ? { q: query } : {});
      return {
        projects: plans.slice(0, 25).map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          lead: p.lead_name,
          health: p.health,
          updateReminder: p.update_cadence === 'off' ? 'off' : `${p.update_cadence}, day ${p.update_day}`,
          lastUpdate: p.last_update_at,
          href: `/app/track/projects/${p.id}`,
        })),
      };
    },
  }),
  writeTool({
    name: 'propose_track_create_issue',
    app: 'track',
    description: 'Prepare a new Track issue in a team (team by name or key).',
    input: z.object({
      team: z.string().trim().min(1).max(100),
      title: z.string().trim().min(1).max(250),
      priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
    }),
    prepare: async (ctx, input) => {
      const { rows } = await listProjects(teamOf(ctx.user), ctx.workspaceId);
      const team = byName(rows, input.team, (r) => r.name) ?? rows.find((r) => norm(r.slug) === norm(input.team));
      if (!team) return { error: 'team_not_found', hint: rows.map((r) => r.name) };
      return {
        summary: `Create issue "${input.title}" in ${team.name}`,
        details: [
          { label: 'Team', after: team.name },
          { label: 'Title', after: input.title },
          ...(input.priority ? [{ label: 'Priority', after: input.priority }] : []),
        ],
        input: { projectId: team.id, title: input.title, priority: input.priority },
      };
    },
    execute: async (ctx, input) => {
      const project = await getProject(String(input.projectId));
      if (!project || !(await canAccessTrackProject(project, teamOf(ctx.user), ctx.workspaceId))) return { ok: false, error: 'team_not_found' };
      const payload = issueCreateSchema.parse({ title: input.title, ...(input.priority ? { priority: input.priority } : {}) });
      const issue = await createIssue(project.id, ctx.personId, payload, { source: 'app' });
      return { ok: true, message: `Issue ${issue.identifier} created.`, href: `/app/track/issue/${issue.identifier}` };
    },
  }),
  writeTool({
    name: 'propose_track_update_reminder',
    app: 'track',
    description: 'Prepare the update reminder of a Track project (plan): weekly, biweekly or off, and the weekday (1 = Monday … 7 = Sunday). The lead gets reminded to post a project update.',
    input: z.object({
      project: z.string().trim().min(1).max(200),
      cadence: z.enum(['weekly', 'biweekly', 'off']),
      weekday: z.number().int().min(1).max(7).optional(),
    }),
    prepare: async (ctx, input) => {
      const { plan, candidates } = await trackPlan(ctx, input.project);
      if (!plan) return { error: 'project_not_found', hint: candidates };
      const day = input.weekday ?? plan.update_day ?? 5;
      const details = [
        { label: 'Project', after: plan.name },
        { label: 'Cadence', before: plan.update_cadence, after: input.cadence },
        { label: 'Weekday', before: String(plan.update_day), after: String(day) },
      ];
      if (!plan.lead_id) details.push({ label: 'Note', after: 'The project has no lead: reminders start once it has one.' });
      return { summary: `Set ${input.cadence} update reminders on "${plan.name}"`, details, input: { planId: plan.id, cadence: input.cadence, weekday: day } };
    },
    execute: async (ctx, input) => {
      const scope = { teamId: teamOf(ctx.user), ownerId: ctx.workspaceId };
      const plan = await getAccessiblePlan(String(input.planId), scope);
      if (!plan) return { ok: false, error: 'project_not_found' };
      const res = await updatePlan(plan, scope, ctx.personId, {
        updateCadence: input.cadence as 'weekly' | 'biweekly' | 'off',
        updateDay: Number(input.weekday),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, message: `Update reminders on "${plan.name}": ${input.cadence}.`, href: `/app/track/projects/${plan.id}` };
    },
  }),
];

// ---------- Docs, Notes, Link ----------

const content: AssistantTool[] = [
  readTool({
    name: 'docs_search',
    app: 'docs',
    description: 'Search Docs pages by title and content.',
    input: z.object({ query: z.string().trim().min(1).max(200) }),
    run: async (ctx, { query }) => ({
      pages: (await searchPages(ctx.user, query, 10)).map((h) => ({ id: h.page.id, title: h.page.title, snippet: h.snippet, href: `/app/docs/${h.page.id}` })),
    }),
  }),
  writeTool({
    name: 'propose_docs_create_page',
    app: 'docs',
    description: 'Prepare a new Docs page with a title and optional Markdown content.',
    input: z.object({ title: z.string().trim().min(1).max(200), markdown: z.string().max(20000).optional() }),
    prepare: async (_ctx, input) => ({
      summary: `Create Docs page "${input.title}"`,
      details: [{ label: 'Title', after: input.title }, ...(input.markdown ? [{ label: 'Content', after: input.markdown }] : [])],
      input,
    }),
    execute: async (ctx, input) => {
      const page = await createPage(ctx.user, { title: String(input.title), markdown: (input.markdown as string | undefined) ?? undefined, locale: ctx.locale });
      return { ok: true, message: `Page "${page.title}" created.`, href: `/app/docs/${page.id}` };
    },
  }),
  readTool({
    name: 'notes_search',
    app: 'notes',
    description: "Search the person's notes.",
    input: z.object({ query: z.string().trim().max(200).optional() }),
    run: async (ctx, { query }) => ({
      notes: (await listNotes(noteOwner(ctx.user), { q: query || undefined, limit: 20 })).map((n) => ({ ...pick(n, ['id', 'title', 'updated_at']), href: `/app/notes?note=${n.id}` })),
    }),
  }),
  writeTool({
    name: 'propose_notes_create',
    app: 'notes',
    description: 'Prepare a new note with a title and plain text.',
    input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().max(10000).optional() }),
    prepare: async (_ctx, input) => ({
      summary: `Create note "${input.title}"`,
      details: [{ label: 'Title', after: input.title }, ...(input.text ? [{ label: 'Text', after: input.text }] : [])],
      input,
    }),
    execute: async (ctx, input) => {
      const paragraphs = String(input.text ?? '').split(/\n{2,}/).filter(Boolean);
      const note = await createNote(noteOwner(ctx.user), {
        title: String(input.title),
        content: paragraphs.map((p) => ({ id: crypto.randomUUID(), type: 'paragraph', content: p })) as never,
      });
      return { ok: true, message: `Note "${note.title}" created.`, href: `/app/notes?note=${note.id}` };
    },
  }),
  readTool({
    name: 'link_search',
    app: 'link',
    description: 'Search short links (by URL, slug or title) with click counts.',
    input: z.object({ query: z.string().trim().max(200).optional() }),
    run: async (ctx, { query }) => {
      const res = await listLinks(ctx.workspaceId, { q: query || undefined, viewer: viewerOf(ctx.user), pageSize: 20 });
      return {
        total: res.total,
        links: res.links.map((l) => {
          const dto = toLinkDto(l) as unknown as Record<string, unknown>;
          return { ...pick(dto, ['id', 'shortUrl', 'url', 'title', 'clicks', 'createdAt']), href: `/app/links/${dto.id}` };
        }),
      };
    },
  }),
  writeTool({
    name: 'propose_link_create',
    app: 'link',
    description: 'Prepare a new short link for a URL (optional custom slug and title).',
    input: z.object({ url: z.string().trim().url().max(2000), slug: z.string().trim().max(60).optional(), title: z.string().trim().max(200).optional() }),
    prepare: async (_ctx, input) => ({
      summary: `Create short link to ${input.url}`,
      details: [
        { label: 'URL', after: input.url },
        ...(input.slug ? [{ label: 'Slug', after: input.slug }] : []),
        ...(input.title ? [{ label: 'Title', after: input.title }] : []),
      ],
      input,
    }),
    execute: async (ctx, input) => {
      const res = await createLink(ctx.workspaceId, {
        url: String(input.url),
        slug: (input.slug as string | undefined) || undefined,
        title: (input.title as string | undefined) || undefined,
        createdBy: ctx.personId,
        viewer: viewerOf(ctx.user),
      } as Parameters<typeof createLink>[1]);
      if (!res.ok) return { ok: false, error: res.code };
      return { ok: true, message: `Link /${res.link.slug} created.`, href: `/app/links/${res.link.id}` };
    },
  }),
];

// ---------- Automatizaciones y diagnóstico ----------

const automate: AssistantTool[] = [
  readTool({
    name: 'flow_list',
    app: 'flow',
    description: 'Flows (automations) with their status and last run.',
    input: z.object({}),
    run: async (ctx) => ({
      flows: (await listFlows(ctx.workspaceId, ctx.personId)).map((f) => ({ ...pick(f, ['id', 'name', 'active', 'status', 'triggerType', 'lastRun', 'heldCount']), href: `/app/flow/${f.id}` })),
    }),
  }),
  readTool({
    name: 'flow_runs',
    app: 'flow',
    description: 'Recent Flow runs across all flows, with status and error. Use status "failed" to diagnose failures.',
    input: z.object({ status: z.enum(['failed', 'success', 'running', 'waiting', 'cancelled']).optional(), days: z.number().int().min(1).max(90).optional() }),
    run: async (ctx, { status, days }) => {
      const res = await searchRuns(ctx.workspaceId, runViewer(ctx.user), { status, days: days ?? 7, limit: 20 } as Parameters<typeof searchRuns>[2]);
      return { runs: res.runs.map((r) => ({ ...pick(r, ['id', 'flowName', 'status', 'error', 'triggerType', 'createdAt', 'durationMs']), href: '/app/flow/runs' })) };
    },
  }),
  readTool({
    name: 'robots_list',
    app: 'robots',
    description: 'Robots (browser automations) with their last run and runs in the last 7 days.',
    input: z.object({}),
    run: async (ctx) => ({ robots: (await listRobots(ctx.workspaceId)).map((r) => ({ ...pick(r, ['id', 'name', 'schedule', 'lastRun', 'runs7d']), href: `/app/robots/${r.id}` })) }),
  }),
  readTool({
    name: 'robot_runs',
    app: 'robots',
    description: 'Recent runs of one robot with status, error and warnings. Diagnoses a failing robot.',
    input: z.object({ robotId: z.string().min(1).max(64) }),
    run: async (ctx, { robotId }) => {
      const robots = await listRobots(ctx.workspaceId);
      if (!robots.some((r) => r.id === robotId)) return { error: 'robot_not_found' };
      const runs = await listRobotRuns(ctx.workspaceId, robotId, 15, robotViewer(ctx.user));
      return { runs: runs.map((r) => pick(r, ['id', 'status', 'trigger', 'error', 'warnings', 'failure', 'createdAt', 'finishedAt'])) };
    },
  }),
  readTool({
    name: 'agents_list',
    app: 'agents',
    description: 'AI agents of the workspace with their status.',
    input: z.object({}),
    run: async (ctx) => ({ agents: (await listAgents(ctx.workspaceId)).map((a) => ({ ...pick(a, ['id', 'name', 'status', 'model', 'updatedAt']), href: `/app/agents/${a.id}` })) }),
  }),
];

// ---------- Comunicación y agenda ----------

const comms: AssistantTool[] = [
  readTool({
    name: 'cal_event_types',
    app: 'cal',
    description: 'Cal event types (booking pages) with duration and whether they are active.',
    input: z.object({}),
    run: async (ctx) => ({
      eventTypes: (await listEventTypes(ctx.workspaceId)).map((e) => ({ ...pick(e, ['id', 'title', 'slug', 'duration', 'active']), href: `/app/calendar/event-types/${e.id}` })),
    }),
  }),
  readTool({
    name: 'cal_upcoming_bookings',
    app: 'cal',
    description: 'Upcoming confirmed Cal bookings (the person sees the ones they host unless admin).',
    input: z.object({ days: z.number().int().min(1).max(90).optional() }),
    run: async (ctx, { days }) => {
      const from = new Date();
      const to = new Date(Date.now() + (days ?? 14) * 86_400_000);
      const rows = await listUserBookings(ctx.workspaceId, { from, to, order: 'asc', status: 'confirmed', limit: 25, hostId: viewerScope(ctx.user) ?? undefined });
      return { bookings: rows.map((b) => pick(b, ['id', 'start_time', 'end_time', 'name', 'email', 'event_title', 'status'])) };
    },
  }),
  readTool({
    name: 'chat_conversations',
    app: 'chat',
    description: 'Recent Chat (website live chat) conversations, optionally only open ones.',
    input: z.object({ status: z.enum(['open', 'closed', 'snoozed']).optional() }),
    run: async (ctx, { status }) => {
      const widgets = await listChatWidgets(ctx.workspaceId, teamOf(ctx.user));
      if (!widgets.length) return { conversations: [], note: 'No chat widgets yet.' };
      const rows = await listChatConversations(widgets.map((w) => w.id), { status, limit: 20, teamId: teamOf(ctx.user) } as Parameters<typeof listChatConversations>[1]);
      return { conversations: rows.map((c) => ({ ...pick(c, ['id', 'status', 'visitor_name', 'visitor_email', 'last_message_at', 'subject']), href: `/app/chat/inbox?c=${c.id}` })) };
    },
  }),
  readTool({
    name: 'talk_channels',
    app: 'talk',
    description: 'Talk channels the person belongs to.',
    input: z.object({}),
    run: async (ctx) => ({ channels: (await listMyChannels(talkActor(ctx.user))).map((c) => ({ ...pick(c, ['id', 'name', 'kind', 'topic', 'unread']), href: `/app/talk/${c.id}` })) }),
  }),
  readTool({
    name: 'voice_meetings',
    app: 'voice',
    description: "The person's recent Voice meetings (recorded and transcribed).",
    input: z.object({ query: z.string().max(200).optional() }),
    run: async (ctx, { query }) => ({
      meetings: (await listSessions(voiceOwner(ctx.user), { kind: 'meeting', q: query || undefined, limit: 15 })).map((s) => ({ ...pick(s, ['id', 'title', 'created_at', 'duration_sec', 'status']), href: `/app/voice/meetings/${s.id}` })),
    }),
  }),
  readTool({
    name: 'groups_chats',
    app: 'groups',
    description: 'WhatsApp groups (Groups app) with their last activity.',
    input: z.object({ query: z.string().max(200).optional() }),
    run: async (ctx, { query }) => {
      const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
      const res = await listChats(ctx.workspaceId, ctx.personId, { q: query || undefined, limit: 20, viewer } as Parameters<typeof listChats>[2]);
      return { total: res.total, groups: res.rows.map((g) => ({ ...pick(g, ['id', 'name', 'lastMessageAt', 'unread', 'members']), href: `/app/groups/inbox/${g.id}` })) };
    },
  }),
  readTool({
    name: 'board_list',
    app: 'board',
    description: 'Whiteboards (Board app).',
    input: z.object({}),
    run: async (ctx) => ({ boards: (await listBoards(ctx.workspaceId, boardViewer(ctx.user))).slice(0, 30).map((b) => ({ ...pick(b, ['id', 'name', 'updated_at']), href: `/app/board/${b.id}` })) }),
  }),
];

// ---------- Analytics ----------

/** Proyecto por id o nombre (sin nada: el primero del workspace). */
async function analyticsProject(ctx: ToolCtx, project?: string): Promise<ProjectRow | null> {
  const all = await listAnalyticsProjects(ctx.workspaceId);
  if (!project) return all[0] ?? null;
  return all.find((p) => p.id === project) ?? byName(all, project, (p) => p.name) ?? null;
}

const projectArg = z.string().max(200).optional().describe('Project name or id. Omit for the first project of the workspace.');
const daysArg = z.number().int().min(1).max(365).optional();

/** Los errores de consulta vuelven como dato (el modelo se lo explica a la persona). */
async function safeQuery<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QueryError) return { error: err.code };
    throw err;
  }
}

const analytics: AssistantTool[] = [
  readTool({
    name: 'analytics_projects',
    app: 'analytics',
    description: 'Analytics (product analytics) projects of the workspace with their public key and settings.',
    input: z.object({}),
    run: async (ctx) => ({
      projects: (await listAnalyticsProjects(ctx.workspaceId)).map((p) => ({ id: p.id, name: p.name, publicKey: p.public_key, retentionDays: p.retention_days, href: `/app/analytics/settings?project=${p.id}` })),
    }),
  }),
  readTool({
    name: 'analytics_web_overview',
    app: 'analytics',
    description: 'Web analytics of a project: visitors, pageviews, sessions, bounce rate and top pages, referrers, countries and devices, compared with the previous period.',
    input: z.object({ project: projectArg, days: daysArg }),
    run: async (ctx, { project, days }) => {
      const p = await analyticsProject(ctx, project);
      if (!p) return { error: 'no_project' };
      const r = await runWeb(p, { kind: 'web', dateRange: { from: `-${days ?? 7}d` }, compare: true });
      return { project: p.name, stats: r.stats, pages: r.pages.slice(0, 5), referrers: r.referrers.slice(0, 5), countries: r.countries.slice(0, 5), devices: r.devices, href: '/app/analytics' };
    },
  }),
  readTool({
    name: 'analytics_trend',
    app: 'analytics',
    description: 'Count an event over time in an Analytics project (total or unique users), optionally broken down by an event property such as $browser or utm_source.',
    input: z.object({
      project: projectArg,
      event: z.string().trim().min(1).max(200).describe('Event name, such as $pageview or signed_up. Use * for any event.'),
      unique: z.boolean().optional().describe('Count unique users instead of events.'),
      days: daysArg,
      breakdown: z.string().max(200).optional(),
    }),
    run: async (ctx, { project, event, unique, days, breakdown }) => {
      const p = await analyticsProject(ctx, project);
      if (!p) return { error: 'no_project' };
      return safeQuery(async () => {
        const r = await runTrends(p, {
          kind: 'trends',
          series: [{ event, math: unique ? 'unique' : 'total', filters: [] }],
          interval: (days ?? 7) > 60 ? 'week' : 'day',
          dateRange: { from: `-${days ?? 7}d` },
          breakdown: breakdown ? { key: breakdown, type: 'event' } : null,
          compare: !breakdown,
          filters: [],
          display: 'line',
        });
        return {
          project: p.name,
          buckets: r.buckets,
          series: r.series.map((s) => ({ breakdown: s.breakdownValue, total: s.total, previousTotal: s.compareTotal ?? null, data: s.data })),
          href: '/app/analytics/insights/new',
        };
      });
    },
  }),
  readTool({
    name: 'analytics_funnel',
    app: 'analytics',
    description: 'Conversion funnel between events in an Analytics project (in order, within a conversion window).',
    input: z.object({ project: projectArg, steps: z.array(z.string().trim().min(1).max(200)).min(2).max(10), days: daysArg, windowDays: z.number().int().min(1).max(90).optional() }),
    run: async (ctx, { project, steps, days, windowDays }) => {
      const p = await analyticsProject(ctx, project);
      if (!p) return { error: 'no_project' };
      return safeQuery(async () => {
        const r = await runFunnel(p, {
          kind: 'funnel',
          steps: steps.map((event) => ({ event, filters: [] })),
          windowDays: windowDays ?? 14,
          dateRange: { from: `-${days ?? 30}d` },
          filters: [],
        });
        return { project: p.name, steps: r.steps.map((s) => pick(s, ['event', 'count', 'conversion', 'stepConversion', 'dropped', 'medianMs'])), truncated: r.truncated };
      });
    },
  }),
  readTool({
    name: 'analytics_insights',
    app: 'analytics',
    description: 'Saved Analytics insights of a project. With insightId (or a name), runs it and returns a summary of the result.',
    input: z.object({ project: projectArg, insight: z.string().max(200).optional().describe('Insight id or name to run.') }),
    run: async (ctx, { project, insight }) => {
      const p = await analyticsProject(ctx, project);
      if (!p) return { error: 'no_project' };
      const list = await listInsights(p.id);
      if (!insight) return { project: p.name, insights: list.slice(0, 50).map((i) => ({ id: i.id, name: i.name, kind: i.kind, href: `/app/analytics/insights/${i.id}` })) };
      const found = list.find((i) => i.id === insight) ?? byName(list, insight, (i) => i.name);
      if (!found) return { error: 'insight_not_found' };
      return safeQuery(async () => {
        const r = await runInsight(p, found.query);
        const summary =
          r.kind === 'trends'
            ? r.series.map((s) => ({ label: s.label, breakdown: s.breakdownValue, total: s.total }))
            : r.kind === 'funnel'
              ? r.steps.map((s) => pick(s, ['label', 'count', 'conversion']))
              : r.kind === 'retention'
                ? r.cohorts.map((c) => ({ start: c.start, size: c.size, values: c.values }))
                : r.kind === 'paths'
                  ? r.topPaths.slice(0, 10)
                  : { columns: r.columns, rows: r.rows.slice(0, 20) };
        return { name: found.name, kind: found.kind, result: summary, href: `/app/analytics/insights/${found.id}` };
      });
    },
  }),
  readTool({
    name: 'analytics_flags',
    app: 'analytics',
    description: 'Feature flags of an Analytics project with whether they are on, their rollout and variants.',
    input: z.object({ project: projectArg }),
    run: async (ctx, { project }) => {
      const p = await analyticsProject(ctx, project);
      if (!p) return { error: 'no_project' };
      return { project: p.name, flags: (await listFlags(p.id)).map((f) => ({ ...pick(f, ['key', 'name', 'active', 'rollout', 'variants']), conditions: f.conditions.length, href: `/app/analytics/flags/${f.id}` })) };
    },
  }),
];

export const ALL_TOOLS: AssistantTool[] = [...platform, ...crm, ...track, ...content, ...automate, ...comms, ...analytics];

/** Herramientas que la sesión puede usar (rol y apps del workspace activo). */
export function toolsFor(user: Pick<SessionUser, 'role' | 'apps'>): AssistantTool[] {
  return ALL_TOOLS.filter((t) => canUseTool(user, t));
}

/** Para la UI y los tests: nombre, app y tipo. */
export function toolSummary(user: Pick<SessionUser, 'role' | 'apps'>) {
  return toolsFor(user).map((t) => ({ name: t.name, app: t.app, kind: t.kind }));
}

