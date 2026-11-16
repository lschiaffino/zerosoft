import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getCurrency, reportEntries } from '@/lib/time/core';
import { tFail, timeActor, tJson } from '@/lib/time/http';
import { REPORT_GROUPS, entriesCsv, summarize, type ReportGroup } from '@/lib/time/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?from&to (YYYY-MM-DD), ?group=project|client|task|person, filtros
 * ?projectId ?clientId ?personId (este último solo para quien administra) y
 * ?format=csv&locale= para bajar el detalle. Un miembro ve solo sus horas.
 */
export async function GET(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  try {
    const entries = await reportEntries(a.actor, {
      from: sp.get('from') ?? '',
      to: sp.get('to') ?? '',
      projectId: sp.get('projectId') || undefined,
      clientId: sp.get('clientId') || undefined,
      personId: sp.get('personId') || undefined,
    });
    if (sp.get('format') === 'csv') {
      const locale = ['en', 'es', 'pt'].includes(sp.get('locale') ?? '') ? sp.get('locale')! : 'en';
      const t = await getTranslations({ locale, namespace: 'time.csv' });
      const csv = entriesCsv(
        entries,
        { date: t('date'), person: t('person'), client: t('client'), project: t('project'), task: t('task'), notes: t('notes'), hours: t('hours'), billable: t('billable'), amount: t('amount') },
        t('yes'),
        t('no'),
      );
      return new NextResponse(`﻿${csv}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="time-${sp.get('from')}-${sp.get('to')}.csv"`,
          'cache-control': 'private, no-store',
        },
      });
    }
    const group = (REPORT_GROUPS as readonly string[]).includes(sp.get('group') ?? '') ? (sp.get('group') as ReportGroup) : 'project';
    return tJson({ ...summarize(entries, group), group, currency: await getCurrency(a.actor.ws), count: entries.length });
  } catch (err) {
    return tFail(err);
  }
}
