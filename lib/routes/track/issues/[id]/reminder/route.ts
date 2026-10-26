import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue } from '@/lib/track-data';
import { issueReminderSchema } from '@/lib/track-schema';
import { clearIssueReminder, getIssueReminder, IssueReminderError, setIssueReminder } from '@/lib/track-notify';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recordatorio de la persona para este issue (o null). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAccessibleIssue(id, user.team?.id ?? null, user.id))) return notFound();
  return NextResponse.json({ reminder: await getIssueReminder(id, realUserId(user)) });
}

/** Crea o mueve el recordatorio ({ remindAt: ISO }). */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAccessibleIssue(id, user.team?.id ?? null, user.id))) return notFound();
  const parsed = issueReminderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json({ reminder: await setIssueReminder(id, realUserId(user), parsed.data.remindAt) });
  } catch (err) {
    if (err instanceof IssueReminderError) return trackError(400, err.code);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAccessibleIssue(id, user.team?.id ?? null, user.id))) return notFound();
  await clearIssueReminder(id, realUserId(user));
  return NextResponse.json({ reminder: null });
}
