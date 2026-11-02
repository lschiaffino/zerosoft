import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { listSavedReports, reportCsv, runReport, saveReport, type ReportConfig } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: reportes guardados. POST { config, format? } corre uno; con { name } lo guarda. Solo HR. */
export async function GET() {
  return withPeople(async (ctx) => pjson({ reports: await listSavedReports(ctx) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    const config = (b.config ?? {}) as ReportConfig;
    if (typeof b.name === 'string') return pjson({ report: await saveReport(ctx, b.name, config, typeof b.id === 'string' ? b.id : undefined) }, 201);
    if (b.format === 'csv') {
      return new Response(await reportCsv(ctx, config), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="people-report.csv"', 'cache-control': 'no-store' } });
    }
    return pjson(await runReport(ctx, config));
  });
}
