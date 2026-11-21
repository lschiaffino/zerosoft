import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { requestFilter } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { requestLocale } from '@/lib/request-locale';
import { exportRows, type ExportEntity } from '@/lib/crm';
import { crmError, unauthorized, forbidden } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES: readonly ExportEntity[] = ['contacts', 'companies', 'deals', 'activities'];

const COLUMNS: Record<ExportEntity, string[]> = {
  contacts: [
    'id', 'user_id', 'owner_id', 'owner_email', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'website',
    'city', 'country', 'lifecycle_stage', 'lead_status', 'source', 'company_id', 'custom',
    'created_at', 'updated_at',
  ],
  companies: [
    'id', 'user_id', 'owner_id', 'owner_email', 'name', 'domain', 'industry', 'employees', 'phone', 'website', 'city',
    'country', 'lifecycle_stage', 'custom', 'created_at', 'updated_at',
  ],
  deals: [
    'id', 'user_id', 'owner_id', 'owner_email', 'pipeline_id', 'stage_id', 'name', 'amount', 'currency', 'close_date',
    'priority', 'source', 'description', 'lost_reason', 'position', 'closed_at', 'custom',
    'created_at', 'updated_at',
  ],
  activities: [
    'id', 'user_id', 'owner_id', 'owner_email', 'type', 'subject', 'body', 'due_at', 'done', 'done_at', 'direction',
    'outcome', 'duration_min', 'contact_id', 'company_id', 'deal_id', 'created_at', 'updated_at',
  ],
};

/** RFC 4180: comillas dobles escapadas; quotea si tiene coma, comilla o salto. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();

  const sp = req.nextUrl.searchParams;
  const entity = sp.get('entity') as ExportEntity | null;
  const format = sp.get('format') ?? 'csv';
  if (!entity || !ENTITIES.includes(entity)) return crmError(400, 'invalid_input');
  if (format !== 'csv' && format !== 'json') return crmError(400, 'invalid_input');

  // `filters`: el filtro avanzado del listado (contactos, empresas y deals). Uno inválido es 400, no un export completo.
  const filter =
    entity === 'activities'
      ? {}
      : await requestFilter(sp, entity, { viewer: sessionFieldViewer(user), viewerId: realUserId(user), timeZone: await getUserTimeZone() });
  if ('error' in filter) return crmError(400, 'invalid_filter');
  const rows = await exportRows(
    user.id,
    entity,
    await sessionScope(user),
    filter.filters ? { model: filter.filters, customTypes: filter.customTypes, env: filter.filterEnv } : undefined,
    // Tareas de chats de Lines que quien exporta no ve: sin su texto.
    await sessionChatReader(user, requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'))),
  );
  const date = new Date().toISOString().slice(0, 10);
  const filename = `crm-${entity}-${date}.${format}`;

  if (format === 'json') {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const cols = COLUMNS[entity];
  const lines = [cols.join(',')];
  for (const row of rows) {
    const r = row as unknown as Record<string, unknown>;
    lines.push(cols.map((c) => csvCell(r[c])).join(','));
  }
  return new NextResponse(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
