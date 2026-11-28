import { NextResponse } from 'next/server';
import { PERISKOPE_KINDS, importPeriskope, type PeriskopeKind } from '@/lib/groups-periskope';
import { importPeriskopeApi, periskopeFetcher } from '@/lib/groups-periskope-api';
import { cancelHistory, getHistoryStatus, historyClients, kickHistory, queueHistory, resumeHistory } from '@/lib/groups-periskope-history';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Importar desde Periskope (admins): { kind: 'chats' | 'contacts' | 'labels' | 'quick_replies', csv, preview? }.
 * Con preview no escribe y devuelve lo que haría. Ver lib/groups-periskope.ts.
 * Por API: { source: 'api', key, preview? } trae chats, contactos, tickets y
 * notas con la clave de la API de Periskope (no se guarda). Ver
 * lib/groups-periskope-api.ts.
 * Historial de mensajes: { source: 'history', action: 'start' | 'continue' | 'resume' | 'cancel', key?, includeMedia? }
 * (trabajo en segundo plano, retomable; ver lib/groups-periskope-history.ts) y GET para su estado.
 */
export async function GET() {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ history: await getHistoryStatus(s.ws) });
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  if (b.source === 'history') {
    try {
      const action = str(b.action, 12);
      if (action === 'start') {
        const key = typeof b.key === 'string' ? b.key.trim() : '';
        if (!key || key.length > 2000) return groupsError(400, 'periskope_auth');
        // La clave primero: un 401 corta antes de dejar nada en cola.
        await (await historyClients(s.ws, key)).get('/phones/all');
        const status = await queueHistory(s.ws, key, { includeMedia: b.includeMedia !== false });
        await kickHistory(s.ws);
        return NextResponse.json({ history: status });
      }
      if (action === 'cancel') return NextResponse.json({ history: await cancelHistory(s.ws) });
      if (action === 'resume') {
        const status = await resumeHistory(s.ws);
        await kickHistory(s.ws);
        return NextResponse.json({ history: status });
      }
      if (action === 'continue') {
        // La pantalla abierta empuja una tanda por vez (si el cron ya tiene la fila, no pasa nada).
        await kickHistory(s.ws);
        return NextResponse.json({ history: await getHistoryStatus(s.ws) });
      }
      return groupsError(400, 'invalid_action');
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  if (b.source === 'api') {
    const key = typeof b.key === 'string' ? b.key.trim() : '';
    if (!key || key.length > 2000) return groupsError(400, 'periskope_auth');
    try {
      const get = process.env.GROUPS_PERISKOPE_FAKE === '1' ? (await import('@/lib/groups-periskope-fake')).fakePeriskope(s.ws, key) : periskopeFetcher(key);
      return NextResponse.json(await importPeriskopeApi(s.ws, s.me, get, { dryRun: b.preview === true }));
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  const kind = str(b.kind, 20) as PeriskopeKind;
  if (!(PERISKOPE_KINDS as readonly string[]).includes(kind)) return groupsError(400, 'invalid_kind');
  const csv = typeof b.csv === 'string' ? b.csv : '';
  if (!csv.trim()) return groupsError(400, 'empty_file');
  try {
    return NextResponse.json(await importPeriskope(s.ws, s.me, kind, csv, { dryRun: b.preview === true }));
  } catch (err) {
    return handleGroupsError(err);
  }
}
