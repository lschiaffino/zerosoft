import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { acceptGuestInvite } from '@/lib/docs-guests';
import { getDocPageRow } from '@/lib/docs';
import { logDocsAudit } from '@/lib/docs-audit';

export const dynamic = 'force-dynamic';

/**
 * Link de invitación de un invitado externo: con la sesión del email
 * invitado (entrando o creando la cuenta) se vuelve acceso a esa página.
 */
export default async function DocsInvitePage(props: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/app/docs/invite/${encodeURIComponent(token)}`);
  const me = user.actingUser ?? user;
  const res = await acceptGuestInvite(token, me);
  if (res.ok) {
    const page = await getDocPageRow(res.pageId);
    await logDocsAudit({ workspaceId: res.workspaceId, actor: me, action: 'guest.accepted', page: page ? { id: page.id, title: page.title } : null, detail: res.email });
    redirect(`/${locale}/app/docs/${res.pageId}`);
  }
  const t = await getTranslations({ locale, namespace: 'docs.guests' });
  return (
    <main className="docs-invite-page">
      <div className="docs-invite-card" role="alert">
        <h1 className="docs-invite-title">{t(`fail.${res.reason}Title`)}</h1>
        <p className="ui-help">{t(`fail.${res.reason}`, { email: res.email ?? '', me: me.email })}</p>
        <Link href="/app/docs" className="btn btn-secondary btn-sm">
          {t('backToDocs')}
        </Link>
      </div>
    </main>
  );
}
