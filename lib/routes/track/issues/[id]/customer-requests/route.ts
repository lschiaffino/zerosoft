import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issueAccess, domainError } from '@/lib/track-triage-http';
import { createCustomerRequest, listIssueRequests } from '@/lib/track-customers';
import { sessionScope } from '@/lib/crm-visibility';
import { invalidBody } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({
  companyId: z.string().trim().min(1).max(64).nullish(),
  contactId: z.string().trim().min(1).max(64).nullish(),
  customerName: z.string().trim().max(200).optional(),
  customerEmail: z.string().trim().max(200).optional(),
  important: z.boolean().optional(),
  body: z.string().max(5000).optional(),
  source: z.enum(['manual', 'crm', 'chat', 'groups', 'email', 'form', 'api']).optional(),
  sourceUrl: z.string().trim().max(1000).optional(),
});

/** Pedidos de clientes del issue (sección Customers). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  return NextResponse.json({ rows: await listIssueRequests(a.issue.id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const row = await createCustomerRequest(a.user.id, a.issue.id, parsed.data, a.actorId, await sessionScope(a.user));
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return domainError(err);
  }
}
