import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { addDomain, dnsInstructions, listDomains } from '@/lib/link-domains';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await listDomains(user.id);
  return NextResponse.json({ rows: rows.map((d) => ({ ...d, dns: dnsInstructions(d.hostname, d.verified === 1 ? null : d.verify_token) })) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // Cada alta pega en la API de Vercel y ocupa un lugar en el proyecto.
  const limited = await limitByIp(req, 'domain-add', 10, 3600);
  if (limited) return limited;
  const parsed = z.object({ hostname: z.string().trim().min(4).max(253) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_hostname' }, { status: 400 });
  const res = await addDomain(user.id, parsed.data.hostname);
  if (!res.ok) {
    const status =
      res.code === 'domain_taken' || res.code === 'too_many_pending' ? 409 : res.code === 'provider_error' ? 502 : 400;
    return NextResponse.json({ error: res.code }, { status });
  }
  return NextResponse.json({ ...res.domain, dns: dnsInstructions(res.domain.hostname, res.domain.verify_token) }, { status: 201 });
}
