import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDb } from '@/lib/db';
import { sessionScope } from '@/lib/crm-visibility';
import { canAccessTrackProject, getProject, listProjectMetas } from '@/lib/track-data';
import { createCustomerRequest, listCustomerRequests, listCustomers } from '@/lib/track-customers';
import { domainError } from '@/lib/track-triage-http';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clientes con pedidos (GET /api/track/customers) o los pedidos de uno
 * (?companyId= | ?contactId= | ?domain= | ?name=), solo de proyectos visibles.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const teamId = user.team?.id ?? null;
  const by = {
    companyId: sp.get('companyId') || undefined,
    contactId: sp.get('contactId') || undefined,
    domain: sp.get('domain') || undefined,
    name: sp.get('name') || undefined,
  };
  if (by.companyId || by.contactId || by.domain || by.name) {
    const rows = await listCustomerRequests(user.id, by, async (pid) => {
      const p = await getProject(pid);
      return Boolean(p && (await canAccessTrackProject(p, teamId, user.id)));
    });
    return NextResponse.json({ rows });
  }
  const projects = await listProjectMetas(teamId, user.id);
  return NextResponse.json({ rows: await listCustomers(user.id, projects.map((p) => p.id)) });
}

const postSchema = z.object({
  /** Identificador (ZER-12) o id del issue. */
  issue: z.string().trim().min(1).max(80),
  companyId: z.string().trim().min(1).max(64).optional(),
  contactId: z.string().trim().min(1).max(64).optional(),
  body: z.string().max(5000).optional(),
  important: z.boolean().optional(),
});

/** Desde el CRM: enlaza la empresa o el contacto a un issue (por su ID) como pedido. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const b = parsed.data;
  if (!b.companyId && !b.contactId) return trackError(400, 'missing_customer');
  const teamId = user.team?.id ?? null;
  const scopeSql = teamId ? 'p.team_id = ?' : '(p.team_id IS NULL AND p.owner_id = ?)';
  const rows = (await getDb()
    .prepare(
      `SELECT i.id FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${scopeSql} AND (i.id = ? OR UPPER(i.identifier) = ?) LIMIT 2`,
    )
    .all(teamId ?? user.id, b.issue, b.issue.toUpperCase())) as Array<{ id: string }>;
  if (rows.length !== 1) return trackError(404, 'issue_not_found');
  try {
    const row = await createCustomerRequest(
      user.id,
      rows[0].id,
      { companyId: b.companyId ?? null, contactId: b.contactId ?? null, body: b.body, important: b.important, source: 'crm' },
      realUserId(user),
      await sessionScope(user),
    );
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return domainError(err);
  }
}
