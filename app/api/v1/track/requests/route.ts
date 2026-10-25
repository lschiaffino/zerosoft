import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { createIssue, getIssue, getIssueByIdentifier, getProject } from '@/lib/track-data';
import { createCustomerRequest, CustomerRequestError, listIssueRequests } from '@/lib/track-customers';
import { onIssueEnteredTriage } from '@/lib/track-triage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  projectId: z.string().trim().min(1).max(64),
  /** Issue existente (id o identificador ZER-12) al que sumar el pedido; si falta, se crea uno en triage. */
  issue: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(5000).default(''),
  customer: z.object({
    email: z.string().trim().max(200).optional(),
    name: z.string().trim().max(200).optional(),
    companyId: z.string().trim().max(64).optional(),
    contactId: z.string().trim().max(64).optional(),
  }),
  important: z.boolean().optional(),
  source: z.enum(['email', 'form', 'chat', 'groups', 'api', 'crm']).default('api'),
  sourceUrl: z.string().trim().max(1000).optional(),
});

/** GET /api/v1/track/requests?issue=<id|ZER-12>&projectId= — pedidos de clientes de un issue. */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'track:read');
  if ('res' in auth) return auth.res;
  const p = new URL(req.url).searchParams;
  const ref = p.get('issue') ?? '';
  const projectId = p.get('projectId') ?? '';
  let issue = ref ? await getIssue(ref) : undefined;
  if (!issue && ref && projectId) issue = await getIssueByIdentifier(projectId, ref.toUpperCase());
  const project = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !project || project.owner_id !== auth.user.id) return apiError(404, 'not_found', 'Issue not found.');
  return NextResponse.json({ data: await listIssueRequests(issue.id) });
}

/**
 * POST /api/v1/track/requests — pedido de un cliente (email entrante, formulario,
 * Flow, Zapier…). Sin `issue` crea un issue que entra a triage (con las reglas,
 * el responsable y el SLA del proyecto) y le adjunta el pedido con la cita.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'track:write');
  if ('res' in auth) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const b = parsed.data;
  const project = await getProject(b.projectId);
  if (!project || project.owner_id !== auth.user.id) return apiError(404, 'not_found', 'Project not found.');
  let issue = b.issue ? ((await getIssue(b.issue)) ?? (await getIssueByIdentifier(project.id, b.issue.toUpperCase()))) : undefined;
  if (b.issue && (!issue || issue.project_id !== project.id)) return apiError(404, 'not_found', 'Issue not found.');
  let created = false;
  if (!issue) {
    const title = b.title ?? b.body.split('\n')[0]?.slice(0, 120);
    if (!title) return apiError(400, 'invalid_input', 'title or body is required.');
    issue = await createIssue(project.id, auth.personId, { title, description: b.body ? [{ type: 'text', text: b.body }] : [] }, { source: 'api', deferTriage: true });
    created = true;
  }
  try {
    const request = await createCustomerRequest(
      auth.user.id,
      issue.id,
      {
        customerEmail: b.customer.email,
        customerName: b.customer.name,
        companyId: b.customer.companyId || null,
        contactId: b.customer.contactId || null,
        important: b.important,
        body: b.body,
        source: b.source,
        sourceUrl: b.sourceUrl,
      },
      auth.personId,
      await apiScope(auth),
    );
    if (created && issue.triage === 1) issue = await onIssueEnteredTriage(issue);
    return NextResponse.json({ data: { issue: { id: issue.id, identifier: issue.identifier, triage: issue.triage === 1 }, request } }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof CustomerRequestError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
