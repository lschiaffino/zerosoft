import { NextRequest } from 'next/server';
import { z } from 'zod';
import { actOnSheet, listSheets } from '@/lib/time/approvals';
import { reportEntries } from '@/lib/time/core';
import { parseBody, tFail, timeActor, timeLimit, tJson } from '@/lib/time/http';
import { addDays, isIsoDate, MAX_SHEET_NOTE, SHEET_ACTIONS, TimeError, weekStart, type SheetAction } from '@/lib/time/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['submitted', 'approved', 'returned'] as const;

/**
 * GET ?status=submitted|approved|returned: semanas enviadas. Quien administra ve
 * las de todo el workspace; un miembro, solo las suyas.
 * GET ?person=<id>&week=YYYY-MM-DD: las entradas de esa semana de esa persona
 * (quien administra, cualquiera del workspace; un miembro, solo las suyas).
 */
export async function GET(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    const sp = req.nextUrl.searchParams;
    const week = sp.get('week');
    if (week !== null) {
      if (!isIsoDate(week)) throw new TimeError('invalid_input', 400);
      const from = weekStart(week);
      // reportEntries ya limita a un miembro a sus propias horas.
      const personId = sp.get('person') || a.actor.person;
      if (!a.actor.admin && personId !== a.actor.person) throw new TimeError('forbidden', 403);
      return tJson({ entries: await reportEntries(a.actor, { from, to: addDays(from, 6), personId }) });
    }
    const raw = sp.get('status');
    const status = (STATUSES as readonly string[]).includes(raw ?? '') ? (raw as (typeof STATUSES)[number]) : undefined;
    return tJson({ sheets: await listSheets(a.actor, { status }) });
  } catch (err) {
    return tFail(err);
  }
}

const schema = z.object({
  action: z.enum(SHEET_ACTIONS as unknown as [SheetAction, ...SheetAction[]]),
  week: z.string().max(10),
  personId: z.string().min(1).max(80).optional(),
  note: z.string().max(MAX_SHEET_NOTE).optional(),
});

/**
 * POST { action, week, personId?, note? }: la persona envía (`submit`) o retira
 * (`withdraw`) su semana; quien administra aprueba (`approve`), devuelve con una
 * nota (`return`) o reabre una aprobada (`reopen`).
 */
export async function POST(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const limited = await timeLimit(req, 'sheet', 300, 3600, a.actor.person);
  if (limited) return limited;
  try {
    return tJson({ sheet: await actOnSheet(a.actor, await parseBody(req, schema)) });
  } catch (err) {
    return tFail(err);
  }
}
