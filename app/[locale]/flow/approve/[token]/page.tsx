import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getApprovalView } from '@/lib/flow-waits';
import ApprovalActions from '@/components/flow/ApprovalActions';
import '@/styles/flow-approval.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ decision?: string | string[] }>;
};

export async function generateMetadata(props: Props) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'flow' });
  return {
    title: t('approvalPage.title'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  };
}

/**
 * Pedido de aprobación de un flow (link del email o de Slack): se lee y se
 * aprueba o rechaza sin login, con un comentario opcional. Abrir la página no
 * decide nada (los escáneres de links abren los links de los emails).
 */
export default async function FlowApprovalPage(props: Props) {
  const { locale, token } = await props.params;
  const { decision } = await props.searchParams;
  setRequestLocale(locale);
  const view = await getApprovalView(token);
  if (!view) notFound();
  const t = await getTranslations({ locale, namespace: 'flow' });
  const format = await getFormatter({ locale });
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '');
  return (
    <main className="fa">
      <div className="fa-card">
        <p className="fa-eyebrow">{t('approvalPage.eyebrow', { flow: view.flowName })}</p>
        <h1 className="fa-title">{view.subject || t('approvalPage.title')}</h1>
        {view.message && <p className="fa-message">{view.message}</p>}
        {view.state === 'pending' ? (
          <ApprovalActions
            token={token}
            initial={decision === 'reject' ? 'reject' : decision === 'approve' ? 'approve' : null}
            expires={view.expiresAt ? t('approvalPage.expires', { time: when(view.expiresAt) }) : null}
          />
        ) : (
          <div className="fa-state" role="status">
            <p className={`fa-state-title is-${view.state}`}>{t(`approvalPage.state.${view.state}`)}</p>
            {view.decidedAt && (
              <p className="ui-help">
                {view.timedOut ? t('approvalPage.decidedAuto', { time: when(view.decidedAt) }) : t('approvalPage.decidedAt', { time: when(view.decidedAt) })}
              </p>
            )}
            {view.comment && <p className="fa-message">{view.comment}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
