import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { listApprovals } from '@/lib/crm-approvals';
import { dealScopeSql, sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { listMembers } from '@/lib/teams';
import { formatMoney } from '@/lib/crm-money';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ApprovalRowActions from '@/components/crm/ApprovalRowActions';
import { parseDbUtc } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const VIEWS = ['mine', 'requested', 'all'] as const;
type View = (typeof VIEWS)[number];

/**
 * Pedidos de aprobación de etapa: los que esperan mi decisión, los que pedí
 * y todos (con lo resuelto). Aprobar y rechazar desde la fila.
 */
export default async function ApprovalsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const view: View = (VIEWS as readonly string[]).includes(String(sp.view)) ? (sp.view as View) : 'mine';
  const me = realUserId(user);
  const scope = await sessionScope(user);
  const [rows, members] = await Promise.all([
    listApprovals(user.id, {
      ...(view === 'mine' ? { approverId: me, status: 'pending' as const } : {}),
      ...(view === 'requested' ? { requestedBy: me } : {}),
      limit: 200,
    }),
    workspaceTeamId(user) ? listMembers(workspaceTeamId(user)!) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  // Visibilidad por owner: solo los deals que la persona ve.
  let visible = rows;
  if (scope) {
    const ds = dealScopeSql('d.id', scope);
    const ids = rows.length
      ? ((await getDb()
          .prepare(`SELECT d.id FROM crm_deals d WHERE d.user_id = ? AND d.id IN (${rows.map(() => '?').join(',')})${ds.sql ? ` AND ${ds.sql}` : ''}`)
          .all(user.id, ...rows.map((r) => r.deal_id), ...ds.args)) as Array<{ id: string }>)
      : [];
    const ok = new Set(ids.map((r) => r.id));
    visible = rows.filter((r) => ok.has(r.deal_id));
  }
  const name = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(iso));

  return (
    <div className="app-page ui-page">
      <PageHeader back={{ href: '/app/crm/deals', label: t('record.back.deals') }} title={t('approvals.title')} description={t('approvals.sub')} />
      <nav className="ui-tabs" aria-label={t('approvals.title')}>
        {VIEWS.map((v) => (
          <Link key={v} href={v === 'mine' ? '/app/crm/approvals' : `/app/crm/approvals?view=${v}`} className="ui-tab" aria-current={view === v ? 'page' : undefined}>
            {t(`approvals.views.${v}`)}
          </Link>
        ))}
      </nav>
      {visible.length === 0 ? (
        <EmptyState
          title={t(`approvals.empty.${view}`)}
          body={t('approvals.emptyBody')}
          action={{ label: t('approvals.setup'), href: '/app/crm/settings?tab=sales#approvals' }}
        />
      ) : (
        <div className="table-wrap">
          <table className="table crm-stack">
            <caption className="sr-only">{t('approvals.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('approvals.col.deal')}</th>
                <th scope="col">{t('approvals.col.stage')}</th>
                <th scope="col" className="num">
                  {t('approvals.col.amount')}
                </th>
                <th scope="col">{t('approvals.col.requestedBy')}</th>
                <th scope="col">{t('approvals.col.status')}</th>
                <th scope="col">
                  <span className="sr-only">{t('approvals.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} data-testid="approval-row">
                  <td className="crm-stack-main">
                    <Link href={`/app/crm/deals/${a.deal_id}`} className="cell-link">
                      {a.deal_name}
                    </Link>
                    {a.note && <span className="muted appr-row-note">“{a.note}”</span>}
                  </td>
                  <td data-label={t('approvals.col.stage')}>
                    {a.from_stage_name ? `${a.from_stage_name} → ` : ''}
                    {a.stage_name}
                  </td>
                  <td className="num" data-label={t('approvals.col.amount')}>
                    {formatMoney(a.deal_amount, a.deal_currency, locale)}
                  </td>
                  <td data-label={t('approvals.col.requestedBy')}>
                    {name.get(a.requested_by ?? '') ?? ''}
                    <span className="muted appr-row-note">{fmt(a.created_at)}</span>
                  </td>
                  <td data-label={t('approvals.col.status')}>
                    <span className="badge">{t(`approvals.statusShort.${a.status}`)}</span>
                    {a.decided_by && <span className="muted appr-row-note">{name.get(a.decided_by) ?? ''}</span>}
                  </td>
                  <td>{a.status === 'pending' && <ApprovalRowActions id={a.id} canDecide={a.approvers.includes(me)} canCancel={a.requested_by === me} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
