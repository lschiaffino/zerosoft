import { NextRequest } from 'next/server';
import { getAnalytics, getVideoRow } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { csvCell, fmtClock } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vistas, espectadores únicos, % visto, quién vio y desde dónde. ?format=csv lo baja como planilla. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    const data = await getAnalytics(s.actor, id);
    if (req.nextUrl.searchParams.get('format') !== 'csv') {
      // Trae la ubicación de cada espectador: nunca en una caché compartida.
      const res = recJson(data);
      res.headers.set('cache-control', 'private, no-store');
      return res;
    }
    const v = await getVideoRow(s.actor, id);
    const head = [
      'viewer',
      'signed_in',
      'views',
      'watched',
      'percent_watched',
      'cta_clicks',
      'first_view_utc',
      'last_view_utc',
      'email',
      'country',
      'region',
      'city',
      'device',
      'browser',
      'os',
      'source',
    ];
    const lines = [head.join(',')].concat(
      data.viewers.map((r) =>
        [
          r.name || `Viewer ${r.viewerNo}`,
          r.signedIn ? 'yes' : 'no',
          r.views,
          fmtClock(r.watchedSec),
          r.pct,
          r.ctaClicks,
          r.firstAt,
          r.lastAt,
          r.email,
          r.country,
          r.region,
          r.city,
          r.device,
          r.browser,
          r.os,
          r.referrer || 'direct',
        ]
          .map(csvCell)
          .join(','),
      ),
    );
    const name = (v?.title || 'video').replace(/[^\w -]+/g, '').trim().slice(0, 60) || 'video';
    return new Response(`${lines.join('\n')}\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}-viewers.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return recFail(err);
  }
}
