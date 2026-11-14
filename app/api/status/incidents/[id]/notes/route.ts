import { NextResponse } from 'next/server';
import { agentAuthError } from '@/lib/status/agent-auth';
import { addIncidentNote } from '@/lib/status/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/status/incidents/{id}/notes { by: 'watcher' | 'claude', text, public?: boolean }
 * Agrega una nota a la línea de tiempo. Interna por defecto; con public: true
 * sale en la página (sin URLs, hosts, IPs ni números largos: lib/status/redact.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = agentAuthError(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { by?: unknown; text?: unknown; public?: unknown } | null;
  if (!body || (body.by !== 'watcher' && body.by !== 'claude')) return NextResponse.json({ error: 'invalid_by' }, { status: 400 });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) return NextResponse.json({ error: 'invalid_text' }, { status: 400 });
  if (body.public !== undefined && typeof body.public !== 'boolean') return NextResponse.json({ error: 'invalid_public' }, { status: 400 });
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    const note = await addIncidentNote({ incidentId: id, by: body.by, text, public: body.public === true });
    if (!note) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ note }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
