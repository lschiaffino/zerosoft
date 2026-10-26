import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteIntegration, getIntegrationRow, integrationConfig, integrationView, saveIntegration } from '@/lib/track-integrations';
import { disconnectSlack, updateSlackSettings } from '@/lib/track-slack';
import { recordAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ provider: string }> };

const secretInput = z.string().trim().min(8).max(500).optional();

const SCHEMAS = {
  sentry: z.object({
    projectId: z.string().trim().min(1).max(64),
    orgSlug: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/i),
    baseUrl: z.string().trim().url().max(200).optional().or(z.literal('')),
    autoResolve: z.boolean().default(true),
    /** Client secret de la integración interna (firma del webhook). */
    secret: secretInput,
    /** Token de la integración (para resolver issues en Sentry). */
    token: secretInput,
  }),
  zendesk: z.object({
    subdomain: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/i),
    email: z.string().trim().email().max(200),
    token: secretInput,
  }),
  intercom: z.object({
    adminId: z.string().trim().min(1).max(40).regex(/^\d+$/),
    token: secretInput,
  }),
  slack: z.object({
    defaultProjectId: z.string().trim().min(1).max(64).nullable().optional(),
    unfurl: z.boolean().optional(),
  }),
} as const;

type Provider = keyof typeof SCHEMAS;

function isProvider(p: string): p is Provider {
  return p in SCHEMAS;
}

/** Conectar o editar Sentry, Zendesk, Intercom (o los ajustes de Slack). Solo admins. */
export async function PUT(req: NextRequest, props: Props) {
  const { provider } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!isProvider(provider)) return trackError(404, 'not_found');
  const parsed = SCHEMAS[provider].safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  const actor = realUserId(user);
  const data = parsed.data as Record<string, unknown>;

  const projectId = typeof data.projectId === 'string' ? data.projectId : typeof data.defaultProjectId === 'string' ? data.defaultProjectId : null;
  if (projectId) {
    const project = await getProject(projectId);
    if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return trackError(400, 'invalid_project');
  }

  if (provider === 'slack') {
    await updateSlackSettings(ws, { defaultProjectId: data.defaultProjectId as string | null | undefined, unfurl: data.unfurl as boolean | undefined });
    await recordAudit({ workspaceId: ws, actorId: actor, action: 'integration.updated', entityType: 'integration', entityLabel: 'Slack' });
    return NextResponse.json({ ok: true });
  }

  const existing = await getIntegrationRow(ws, provider);
  const { secret, token, ...config } = data as { secret?: string; token?: string } & Record<string, unknown>;
  // Al conectar, el secreto del webhook de Sentry es obligatorio.
  if (provider === 'sentry' && !existing && !secret) return trackError(400, 'missing_secret');
  if (provider !== 'sentry' && !existing && !token) return trackError(400, 'missing_token');
  const row = await saveIntegration(ws, provider, {
    config: { ...(existing ? integrationConfig(existing) : {}), ...config },
    secret: secret ?? undefined,
    token: token ?? undefined,
    createdBy: actor,
  });
  await recordAudit({
    workspaceId: ws,
    actorId: actor,
    action: existing ? 'integration.updated' : 'integration.connected',
    entityType: 'integration',
    entityLabel: provider[0].toUpperCase() + provider.slice(1),
  });
  return NextResponse.json({ integration: integrationView(row) });
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { provider } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!isProvider(provider)) return trackError(404, 'not_found');
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  const removed = provider === 'slack' ? await disconnectSlack(ws) : await deleteIntegration(ws, provider);
  if (removed) {
    await recordAudit({
      workspaceId: ws,
      actorId: realUserId(user),
      action: 'integration.disconnected',
      entityType: 'integration',
      entityLabel: provider[0].toUpperCase() + provider.slice(1),
    });
  }
  return NextResponse.json({ ok: true });
}
