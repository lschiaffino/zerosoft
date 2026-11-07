import { NextResponse } from 'next/server';
import { PERISKOPE_KINDS, importPeriskope, type PeriskopeKind } from '@/lib/groups-periskope';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Importar desde Periskope (admins): { kind: 'chats' | 'contacts' | 'labels' | 'quick_replies', csv, preview? }.
 * Con preview no escribe y devuelve lo que haría. Ver lib/groups-periskope.ts.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const kind = str(b.kind, 20) as PeriskopeKind;
  if (!(PERISKOPE_KINDS as readonly string[]).includes(kind)) return groupsError(400, 'invalid_kind');
  const csv = str(b.csv, 5_000_000) ?? '';
  if (!csv.trim()) return groupsError(400, 'empty_file');
  try {
    return NextResponse.json(await importPeriskope(s.ws, s.me, kind, csv, { dryRun: b.preview === true }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
