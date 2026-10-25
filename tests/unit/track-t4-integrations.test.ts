import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createTeam } from '@/lib/teams';
import { createIssue, createProject, getIssue, listIssueComments, listStatuses, updateIssue } from '@/lib/track-data';
import {
  checksStateFrom,
  handleGithubAppWebhook,
  parseNonClosingIdentifiers,
  parseSkippedIdentifiers,
  plannedStatus,
  prEventKind,
  saveGithubConfig,
  saveGithubInstallation,
  saveGithubRules,
  signGithubPayload,
} from '@/lib/track-github';
import {
  handleSlackCommand,
  handleSlackEvent,
  handleSlackInteraction,
  saveChannelSub,
  saveSlackConnection,
  signSlackBody,
  slackOnTrackEvent,
  verifySlackSignature,
} from '@/lib/track-slack';
import { handleSentryWebhook, parseSupportUrl, signSentryBody, supportOnTrackEvent } from '@/lib/track-support';
import { listIntegrationEvents, processOutbox, saveIntegration, upsertExternalRef } from '@/lib/track-integrations';
import { setProjectVisibility } from '@/lib/track-access';
import { makeUser } from './helpers';

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => null,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: () => true,
}));

beforeAll(() => {
  process.env.SLACK_FAKE = '1';
  process.env.TRACK_SUPPORT_FAKE = '1';
});

async function workspace() {
  const owner = await makeUser('own');
  const team = await createTeam(owner.id, 'Acme');
  const project = await createProject(owner.id, team.id, { name: 'Web', slug: `w${crypto.randomUUID().slice(0, 5)}` });
  return { owner, team, project, key: project.slug.toUpperCase() };
}

describe('Track T4: GitHub', () => {
  it('palabras que no cierran, skip y momentos del PR', () => {
    expect(parseNonClosingIdentifiers('Part of WEB-1 and ref WEB-2, WEB-3', ['WEB'])).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    expect(parseSkippedIdentifiers('skip WEB-9 please', ['WEB'])).toEqual(['WEB-9']);
    expect(prEventKind('opened', { draft: true })).toBe('pr_draft');
    expect(prEventKind('ready_for_review', {})).toBe('pr_opened');
    expect(prEventKind('review_requested', {})).toBe('pr_review');
    expect(prEventKind('closed', { merged: true })).toBe('pr_merged');
    expect(checksStateFrom('check_suite', { check_suite: { head_sha: 'a', status: 'completed', conclusion: 'failure' } })).toEqual({ sha: 'a', state: 'failure' });
    expect(checksStateFrom('status', { sha: 'b', state: 'pending' })).toEqual({ sha: 'b', state: 'pending' });
    const statuses = [
      { id: 'todo', category: 'todo' as const },
      { id: 'prog', category: 'in_progress' as const },
      { id: 'rev', category: 'in_progress' as const },
      { id: 'done', category: 'done' as const },
    ];
    const rules = { projectId: 'p', onDraft: null, onOpen: 'prog', onReview: 'rev', onMerge: 'done', syncRepo: null };
    expect(plannedStatus({ statusId: 'todo', category: 'todo' }, 'pr_opened', rules, statuses)).toBe('prog');
    expect(plannedStatus({ statusId: 'prog', category: 'in_progress' }, 'pr_review', rules, statuses)).toBe('rev');
    expect(plannedStatus({ statusId: 'done', category: 'done' }, 'pr_opened', rules, statuses)).toBeNull();
    expect(plannedStatus({ statusId: 'todo', category: 'todo' }, 'pr_draft', rules, statuses)).toBeNull();
  });

  it('App: reglas por proyecto, ref sin cierre, reviews, checks y GitHub Issues', async () => {
    const w = await workspace();
    const secret = 'app-secret';
    await saveGithubConfig(w.team.id, w.owner.id, { repos: ['acme/web'], onPrOpen: 'in_progress', onPrMerge: 'done' });
    await saveGithubInstallation(w.team.id, w.owner.id, 777, 'acme');
    const statuses = await listStatuses(w.project.id);
    const review = statuses.find((s) => s.category === 'in_progress')!;
    const done = statuses.find((s) => s.category === 'done')!;
    expect(await saveGithubRules(w.project.id, { onDraft: null, onOpen: null, onReview: review.id, onMerge: done.id, syncRepo: 'acme/web' })).toBe('ok');
    expect(await saveGithubRules(w.project.id, { onDraft: 'nope', onOpen: null, onReview: null, onMerge: null, syncRepo: null })).toBe('invalid_status');

    const a = await createIssue(w.project.id, w.owner.id, { title: 'A' }, { source: 'app' });
    const b = await createIssue(w.project.id, w.owner.id, { title: 'B' }, { source: 'app' });
    const send = (event: string, payload: Record<string, unknown>) => {
      const raw = JSON.stringify({ installation: { id: 777 }, repository: { full_name: 'acme/web' }, ...payload });
      return handleGithubAppWebhook(secret, event, raw, signGithubPayload(secret, raw));
    };
    // Firma mal: 401.
    expect((await handleGithubAppWebhook(secret, 'ping', '{}', 'sha256=00')).status).toBe(401);

    const pr = (action: string, extra: Record<string, unknown> = {}) => ({
      action,
      pull_request: {
        number: 5,
        html_url: 'https://github.com/acme/web/pull/5',
        title: `${a.identifier} checkout`,
        body: `ref ${b.identifier}`,
        head: { ref: 'feat', sha: 'abc' },
        user: { login: 'ana' },
        author_association: 'MEMBER',
        ...extra,
      },
      requested_reviewer: { login: 'bob' },
    });
    // Abrir no mueve (onOpen null en la regla del proyecto).
    expect((await send('pull_request', pr('opened'))).status).toBe(200);
    expect((await getIssue(a.id))?.status_category).not.toBe('in_progress');
    // Pedir review: mueve al status elegido.
    await send('pull_request', pr('review_requested'));
    expect((await getIssue(a.id))?.status_id).toBe(review.id);
    // B se vinculó con "ref": no se mueve y el vínculo queda sin cierre.
    const linkB = (await getDb().prepare("SELECT closes FROM track_issue_links WHERE issue_id = ? AND kind = 'pr'").get(b.id)) as { closes: number };
    expect(linkB.closes).toBe(0);
    // Review aprobada y checks.
    await send('pull_request_review', { action: 'submitted', review: { state: 'approved', user: { login: 'bob' } }, pull_request: { number: 5 } });
    await send('check_suite', { action: 'completed', check_suite: { head_sha: 'abc', status: 'completed', conclusion: 'success' } });
    const linkA = (await getDb().prepare("SELECT reviews, checks FROM track_issue_links WHERE issue_id = ? AND kind = 'pr'").get(a.id)) as { reviews: string; checks: string };
    expect(JSON.parse(linkA.reviews)).toEqual({ bob: 'approved' });
    expect(linkA.checks).toBe('success');
    // Merge: Done (regla del proyecto). B sigue igual.
    await send('pull_request', pr('closed', { merged: true, state: 'closed' }));
    expect((await getIssue(a.id))?.status_id).toBe(done.id);
    expect((await getIssue(b.id))?.status_category).not.toBe('done');

    // GitHub Issues: nuevo → issue en Track; comentario; cerrado → done.
    const opened = await send('issues', { action: 'opened', issue: { number: 31, title: 'Crash on login', body: 'stack', html_url: 'https://github.com/acme/web/issues/31', user: { login: 'eve' } } });
    expect(opened.status).toBe(201);
    const synced = await getIssue(String(opened.body.issueId));
    expect(synced?.title).toBe('Crash on login');
    expect(synced?.source).toBe('github');
    await send('issue_comment', { action: 'created', issue: { number: 31 }, comment: { id: 1, body: 'same here', user: { login: 'zed', type: 'User' } } });
    expect((await listIssueComments(synced!.id)).map((c) => c.body)).toEqual(['zed (GitHub): same here']);
    await send('issues', { action: 'closed', issue: { number: 31, state_reason: 'completed', user: { login: 'eve' } } });
    expect((await getIssue(synced!.id))?.status_category).toBe('done');
    // Desinstalar la App la desata del workspace.
    await send('installation', { action: 'deleted' });
    const row = (await getDb().prepare('SELECT installation_id FROM track_github WHERE workspace_id = ?').get(w.team.id)) as { installation_id: number | null };
    expect(row.installation_id).toBeNull();
  });
});

describe('Track T4: Slack', () => {
  const secret = 'fake-signing-secret';
  const now = Math.floor(Date.now() / 1000);

  it('verifica la firma y rechaza timestamps viejos', () => {
    const body = 'token=x&text=hola';
    expect(verifySlackSignature(secret, body, String(now), signSlackBody(secret, body, now))).toBe(true);
    expect(verifySlackSignature(secret, body, String(now - 600), signSlackBody(secret, body, now - 600))).toBe(false);
    expect(verifySlackSignature(secret, `${body}x`, String(now), signSlackBody(secret, body, now))).toBe(false);
  });

  it('/track, atajo de mensaje con hilo sincronizado, avisos a canal y unfurl', async () => {
    const w = await workspace();
    const teamId = `T${crypto.randomUUID().slice(0, 6)}`;
    await saveSlackConnection(w.team.id, { teamId, teamName: 'Acme', botToken: 'xoxb-1', botUserId: 'UB', installedBy: w.owner.id });
    // El email que devuelve users.info (fake) es el del dueño.
    process.env.SLACK_FAKE_EMAIL = w.owner.email;

    const cmd = await handleSlackCommand(new URLSearchParams({ team_id: teamId, user_id: 'U1', text: 'Login fails on Safari' }));
    expect(cmd.response_type).toBe('ephemeral');
    expect(cmd.text).toMatch(/Login fails on Safari/);
    const created = (await getDb().prepare("SELECT id, source FROM track_issues WHERE project_id = ? AND title = 'Login fails on Safari'").get(w.project.id)) as { id: string; source: string };
    expect(created.source).toBe('slack');

    // Alguien que no está en el workspace.
    process.env.SLACK_FAKE_EMAIL = 'nobody@else.test';
    expect((await handleSlackCommand(new URLSearchParams({ team_id: teamId, user_id: 'U2', text: 'x' }))).text).toMatch(/not a member/);
    process.env.SLACK_FAKE_EMAIL = w.owner.email;

    // Envío del modal (atajo de mensaje) → issue con el hilo vinculado.
    const sub = await handleSlackInteraction({
      type: 'view_submission',
      team: { id: teamId },
      user: { id: 'U1' },
      view: {
        callback_id: 'track_create_issue_modal',
        private_metadata: JSON.stringify({ channel: 'C9', ts: '1700.0001', permalink: 'https://fake.slack.com/p1' }),
        state: { values: { project: { value: { selected_option: { value: w.project.id } } }, title: { value: { value: 'From thread' } }, description: { value: { value: 'ctx' } } } },
      },
    });
    expect(sub).toEqual({ response_action: 'clear' });
    const threadIssue = (await getDb().prepare("SELECT id FROM track_issues WHERE title = 'From thread' AND project_id = ?").get(w.project.id)) as { id: string };
    const ref = await getDb().prepare("SELECT external_id FROM track_external_refs WHERE issue_id = ? AND provider = 'slack_thread'").get(threadIssue.id);
    expect(ref).toEqual({ external_id: 'C9:1700.0001' });

    // Respuesta en el hilo → comentario; los mensajes de bots no.
    await handleSlackEvent({ type: 'event_callback', team_id: teamId, event: { type: 'message', channel: 'C9', thread_ts: '1700.0001', ts: '1700.0002', user: 'U1', text: 'Me pasa también' } });
    await handleSlackEvent({ type: 'event_callback', team_id: teamId, event: { type: 'message', channel: 'C9', thread_ts: '1700.0001', ts: '1700.0003', bot_id: 'B1', text: 'eco' } });
    expect((await listIssueComments(threadIssue.id)).map((c) => c.body)).toEqual(['Me pasa también']);

    // Aviso a canal al cambiar de status, y el hilo se entera al completar.
    await saveChannelSub(w.team.id, { projectId: w.project.id, channelId: 'C_ENG', channelName: 'eng', events: ['status_changed', 'issue_done'] });
    const before = (await getIssue(threadIssue.id))!;
    const done = (await listStatuses(w.project.id)).find((s) => s.category === 'done')!;
    const after = (await updateIssue(threadIssue.id, { statusId: done.id }, w.owner.id))!;
    const queued = await slackOnTrackEvent(w.team.id, { type: 'issue.updated', before, after, changes: ['statusId'] }, { via: 'app' }, after, w.project);
    expect(queued).toBe(3);
    // Un comentario que vino de Slack no vuelve al hilo.
    const echo = await slackOnTrackEvent(w.team.id, { type: 'comment.created', issueId: after.id, commentId: 'x', actorId: w.owner.id, body: 'hi' }, { via: 'slack' }, after, w.project);
    expect(echo).toBe(0);
    await getDb().prepare("UPDATE track_integration_outbox SET created_at = datetime('now', '-5 minutes') WHERE workspace_id = ?").run(w.team.id);
    await processOutbox();
    const log = await listIntegrationEvents(w.team.id, 'slack', 50);
    expect(log.some((e) => e.direction === 'out' && e.summary.includes('C_ENG'))).toBe(true);
    expect(log.some((e) => e.direction === 'out' && e.summary.includes('thread 1700.0001'))).toBe(true);

    // Unfurl: sí para el proyecto abierto, nunca para uno privado.
    const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
    await handleSlackEvent({ type: 'event_callback', team_id: teamId, event: { type: 'link_shared', channel: 'C1', message_ts: '1.1', links: [{ url: `${base}/app/track/issues/${created.id}` }] } });
    expect((await listIntegrationEvents(w.team.id, 'slack', 50)).some((e) => e.kind === 'chat.unfurl')).toBe(true);
    await setProjectVisibility(w.project.id, 'private', w.owner.id);
    const before2 = (await listIntegrationEvents(w.team.id, 'slack', 100)).filter((e) => e.kind === 'chat.unfurl').length;
    await handleSlackEvent({ type: 'event_callback', team_id: teamId, event: { type: 'link_shared', channel: 'C1', message_ts: '1.2', links: [{ url: `${base}/app/track/issues/${created.id}` }] } });
    expect((await listIntegrationEvents(w.team.id, 'slack', 100)).filter((e) => e.kind === 'chat.unfurl').length).toBe(before2);
  });
});

describe('Track T4: Sentry, Zendesk, Intercom y Figma', () => {
  it('reconoce links de soporte y de Figma', () => {
    expect(parseSupportUrl('https://acme.sentry.io/issues/123/?project=1')).toMatchObject({ provider: 'sentry', externalId: '123', meta: { org: 'acme' } });
    expect(parseSupportUrl('https://acme.zendesk.com/agent/tickets/88')).toMatchObject({ provider: 'zendesk', externalId: '88' });
    expect(parseSupportUrl('https://app.intercom.com/a/inbox/abc/inbox/shared/all/conversation/215')).toMatchObject({ provider: 'intercom', externalId: '215' });
    expect(parseSupportUrl('https://www.figma.com/design/AbC123/Checkout?node-id=1-2')).toMatchObject({ provider: 'figma', externalId: 'AbC123:1-2' });
    expect(parseSupportUrl('http://acme.zendesk.com/agent/tickets/88')).toBeNull();
    expect(parseSupportUrl('https://evil.com/issues/1')).toBeNull();
  });

  it('webhook de Sentry crea el issue una vez y completar lo resuelve; Zendesk recibe la nota', async () => {
    const w = await workspace();
    const row = await saveIntegration(w.team.id, 'sentry', { config: { projectId: w.project.id, orgSlug: 'acme' }, secret: 'sentry-secret', token: 'tok', createdBy: w.owner.id });
    const raw = JSON.stringify({ action: 'created', data: { issue: { id: '9001', title: 'TypeError: x is undefined', culprit: 'app.js', level: 'error', shortId: 'WEB-1A', web_url: 'https://acme.sentry.io/issues/9001/' } } });
    expect((await handleSentryWebhook(row.id, 'issue', raw, 'bad')).status).toBe(401);
    const res = await handleSentryWebhook(row.id, 'issue', raw, signSentryBody('sentry-secret', raw));
    expect(res.status).toBe(201);
    const issue = (await getIssue(String(res.body.issueId)))!;
    expect(issue.title).toBe('TypeError: x is undefined');
    expect(issue.priority).toBe('high');
    expect(issue.source).toBe('sentry');
    // Reenvío: no duplica.
    expect((await handleSentryWebhook(row.id, 'issue', raw, signSentryBody('sentry-secret', raw))).body.duplicate).toBe(true);

    await saveIntegration(w.team.id, 'zendesk', { config: { subdomain: 'acme', email: 'a@acme.co' }, token: 'zd', createdBy: w.owner.id });
    await upsertExternalRef({ issueId: issue.id, workspaceId: w.team.id, provider: 'zendesk', externalId: '88', url: 'https://acme.zendesk.com/agent/tickets/88' });
    const done = (await listStatuses(w.project.id)).find((s) => s.category === 'done')!;
    const after = (await updateIssue(issue.id, { statusId: done.id }, w.owner.id))!;
    expect(await supportOnTrackEvent(w.team.id, { type: 'issue.updated', before: issue, after, changes: ['statusId'] }, { via: 'app' }, after)).toBe(2);
    await getDb().prepare("UPDATE track_integration_outbox SET created_at = datetime('now', '-5 minutes') WHERE workspace_id = ?").run(w.team.id);
    await processOutbox();
    const ref = (await getDb().prepare("SELECT state FROM track_external_refs WHERE issue_id = ? AND provider = 'sentry'").get(issue.id)) as { state: string };
    expect(ref.state).toBe('resolved');
    const zd = await listIntegrationEvents(w.team.id, 'zendesk', 10);
    expect(zd[0]?.summary).toMatch(/Ticket 88: The Track issue .* was completed/);
  });
});
