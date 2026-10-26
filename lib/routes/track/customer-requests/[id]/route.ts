import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issueAccess, domainError } from '@/lib/track-triage-http';
import { deleteCustomerRequest, getRequest, updateCustomerRequest } from '@/lib/track-customers';
import { sessionScope } from '@/lib/crm-visibility';
import { invalidBody, notFound } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  important: z.boolean().optional(),
  body: z.string().max(5000).optional(),
  companyId: z.string().trim().min(1).max(64).nullable().optional(),
  contactId: z.string().trim().min(1).max(64).nullable().optional(),
  customerName: z.string().trim().max(200).optional(),
});

async function load(id: string) {
  const r = await getRequest(id);
  if (!r) return { res: notFound() } as const;
  const a = await issueAccess(r.issueId);
  if (!a.ok) return { res: a.res } as const;
  if (r.workspaceId !== a.user.id) return { res: notFound() } as const;
  return { r, a } as const;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const l = await load((await props.params).id);
  if ('res' in l) return l.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await updateCustomerRequest(l.r.id, l.a.user.id, parsed.data, await sessionScope(l.a.user)));
  } catch (err) {
    return domainError(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const l = await load((await props.params).id);
  if ('res' in l) return l.res;
  await deleteCustomerRequest(l.r.id, l.a.user.id);
  return NextResponse.json({ ok: true });
}
