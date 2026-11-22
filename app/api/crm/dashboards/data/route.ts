import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { requestLocale } from '@/lib/request-locale';
import { getWidgetData, listReportOwners } from '@/lib/crm-dashboards';
import { dashboardDataRequestSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dataset de un widget: { type, pipelineId?, range? } → data computada. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardDataRequestSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const scope = await sessionScope(user);
  const owners = await listReportOwners(user, scope);
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const data = await getWidgetData(user.id, parsed.data, owners, scope, await sessionChatReader(user, locale), sessionFieldViewer(user));
  return NextResponse.json(data);
}
