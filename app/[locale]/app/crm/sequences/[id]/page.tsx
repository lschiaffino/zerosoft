import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getSequence, listEnrollments, sequenceStepStats } from '@/lib/crm-sequences';
import { canManageOwned, listEmailTemplates, parseDbDate } from '@/lib/crm-email';
import SequenceEditor from '@/components/crm/SequenceEditor';

export const dynamic = 'force-dynamic';

export default async function SequenceDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const seq = await getSequence(user.id, id);
  if (!seq) notFound();

  const [templates, stats, enrollments] = await Promise.all([
    listEmailTemplates(user.id, 'template'),
    sequenceStepStats(user.id, id),
    listEnrollments(user.id, { sequenceId: id, limit: 500 }),
  ]);
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: seq.sequence.timezone,
  });

  return (
    <div className="app-page">
      <Link href="/app/crm/sequences" className="mono back-link">
        {t('sequences.back')}
      </Link>
      <SequenceEditor
        sequence={{
          id: seq.sequence.id,
          name: seq.sequence.name,
          timezone: seq.sequence.timezone,
          windowStart: seq.sequence.window_start,
          windowEnd: seq.sequence.window_end,
          businessDays: seq.sequence.business_days === 1,
        }}
        steps={seq.steps.map((s) => ({
          id: s.id,
          type: s.type,
          waitDays: s.wait_days,
          templateId: s.template_id,
          subject: s.subject,
          body: s.body,
          newThread: s.new_thread === 1,
        }))}
        templates={templates.map((x) => ({ id: x.id, name: x.name }))}
        stats={Object.fromEntries(stats.map((s) => [s.stepId, s]))}
        enrollments={enrollments.map((e) => {
          const next = parseDbDate(e.next_run_at);
          return {
            id: e.id,
            contactId: e.contact_id,
            contactName: e.contact_name || e.contact_email,
            status: e.status,
            exitReason: e.exit_reason,
            step: Math.min(e.current_step + 1, e.step_count),
            stepCount: e.step_count,
            nextRun: next ? fmt.format(next) : null,
          };
        })}
        canEdit={canManageOwned({ isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) }, seq.sequence.created_by)}
      />
    </div>
  );
}
