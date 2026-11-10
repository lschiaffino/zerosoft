import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkMp4Sig, mp4Plan, mp4SourceRow, sandboxDone } from '@/lib/rec-mp4';
import { serveRecFile } from '@/lib/rec-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Solo para la microVM que arma el MP4 de descarga (lib/rec-mp4.ts): baja el
 * video y avisa al terminar. Sin sesión: cada URL va firmada para un video, una
 * versión y un propósito, y vence (60 minutos la de bajar).
 */
function signed(req: NextRequest, purpose: 'source' | 'done'): { id: string; key: string } | null {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id') ?? '';
  const key = sp.get('key') ?? '';
  if (sp.get('purpose') !== purpose || !/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{24}$/.test(key)) return null;
  return checkMp4Sig(id, key, purpose, sp.get('exp'), sp.get('sig')) ? { id, key } : null;
}

export async function GET(req: NextRequest) {
  const s = signed(req, 'source');
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const v = await mp4SourceRow(s.id);
  const plan = v ? mp4Plan(v) : null;
  // Solo la versión firmada: si el video cambió (otro recorte), esta URL ya no sirve.
  if (!v || !plan || plan.key !== s.key) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return serveRecFile(req, plan.source, v.content_type);
}

const doneSchema = z.object({ url: z.string().max(2000).optional(), size: z.number().min(0).optional(), error: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const s = signed(req, 'done');
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = doneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await sandboxDone(s.id, s.key, parsed.data);
  return NextResponse.json({ ok: true });
}
