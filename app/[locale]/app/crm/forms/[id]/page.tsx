import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getForm, listSubmissions } from '@/lib/crm-forms';
import { listCustomFields, listLists } from '@/lib/crm';
import { listTags } from '@/lib/crm-tags';
import { listSequences } from '@/lib/crm-sequences';
import { listMembers } from '@/lib/teams';
import { sessionScope } from '@/lib/crm-visibility';
import { formatDate } from '@/lib/utils';
import FormBuilder from '@/components/crm/FormBuilder';
import FormSubmissions from '@/components/crm/FormSubmissions';
import CopyButton from '@/components/link/CopyButton';
import PageHeader from '@/components/ui/PageHeader';
import { FORM_TONE, badgeClass } from '@/lib/crm-ui-tones';

export const dynamic = 'force-dynamic';

const TABS = ['build', 'submissions', 'share'] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;

export default async function FormDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const form = await getForm(user.id, id);
  if (!form) notFound();
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'build';
  const canEdit = isWorkspaceAdmin(user) || form.created_by === realUserId(user);
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const key = form.slug ?? form.token;
  const hostedUrl = `${base}/${locale}/f/${key}`;

  let body: React.ReactNode;
  if (tab === 'build') {
    const [contactFields, companyFields, lists, tags, sequences] = await Promise.all([
      listCustomFields(user.id, 'contacts'),
      listCustomFields(user.id, 'companies'),
      listLists(user.id),
      listTags(user.id),
      listSequences(user.id),
    ]);
    const members = user.team?.id
      ? await listMembers(user.team.id)
      : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
    body = (
      <FormBuilder
        formId={form.id}
        initial={{ name: form.name, slug: form.slug ?? '', status: form.status, fields: form.fields, settings: form.settings }}
        canEdit={canEdit}
        hostedUrl={hostedUrl}
        contactCustomFields={contactFields.map((f) => ({ name: f.name, label: f.label }))}
        companyCustomFields={companyFields.map((f) => ({ name: f.name, label: f.label }))}
        owners={members.map((m) => ({ id: m.user_id, label: m.name ?? m.email }))}
        lists={lists.filter((l) => l.kind === 'static').map((l) => ({ id: l.id, label: l.name }))}
        tags={tags.map((x) => ({ id: x.id, label: x.name }))}
        sequences={sequences.filter((s) => !s.archived).map((s) => ({ id: s.id, label: s.name }))}
      />
    );
  } else if (tab === 'submissions') {
    const page = Math.max(Number(typeof sp.page === 'string' ? sp.page : '1') || 1, 1);
    const { rows, total } = await listSubmissions(user.id, form.id, {
      page,
      pageSize: PAGE_SIZE,
      ownerScope: await sessionScope(user),
    });
    body = (
      <FormSubmissions
        formId={form.id}
        fields={form.fields.map((f) => ({ id: f.id, label: f.label || f.id }))}
        rows={rows.map((r) => ({
          id: r.id,
          createdAt: formatDate(r.created_at, locale),
          contactId: r.contact_id,
          contactLabel: r.contact_name || r.contact_email || null,
          created: !!r.contact_created,
          data: safeJson(r.data),
          utm: safeJson(r.utm) as Record<string, string>,
          pageUrl: r.page_url,
        }))}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
      />
    );
  } else {
    const snippet = `<script src="${base}/api/crm/forms/embed.js" data-form="${key}" data-locale="${locale}" async></script>`;
    const iframe = `<iframe src="${hostedUrl}?embed=1" style="width:100%;border:0;min-height:520px" title="${form.name.replace(/"/g, '&quot;')}"></iframe>`;
    body = (
      <div className="forms-share">
        <section className="forms-share-block">
          <h2 className="crm-panel-title">{t('forms.share.hosted')}</h2>
          <p className="ui-help">{t('forms.share.hostedDesc')}</p>
          <div className="forms-share-row">
            <code className="data forms-code">{hostedUrl}</code>
            <CopyButton text={hostedUrl} />
            <a className="btn btn-secondary btn-sm" href={hostedUrl} target="_blank" rel="noreferrer">
              {t('forms.share.open')}
            </a>
          </div>
        </section>
        <section className="forms-share-block">
          <h2 className="crm-panel-title">{t('forms.share.embed')}</h2>
          <p className="ui-help">{t('forms.share.embedDesc')}</p>
          <div className="forms-share-row">
            <code className="data forms-code" data-testid="form-embed-snippet">
              {snippet}
            </code>
            <CopyButton text={snippet} />
          </div>
          <p className="ui-help">{t('forms.share.utmNote')}</p>
        </section>
        <section className="forms-share-block">
          <h2 className="crm-panel-title">{t('forms.share.iframe')}</h2>
          <p className="ui-help">{t('forms.share.iframeDesc')}</p>
          <div className="forms-share-row">
            <code className="data forms-code">{iframe}</code>
            <CopyButton text={iframe} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-page ui-page">
      <PageHeader
        back={{ href: '/app/crm/forms', label: t('forms.title') }}
        title={form.name}
        description={
          <span className="quote-head-meta">
            <span className={badgeClass(FORM_TONE, form.status)}>{t(`forms.status.${form.status}`)}</span>
            <span>{t('forms.submissionsCount', { count: form.submission_count })}</span>
          </span>
        }
        actions={
          <a className="btn btn-secondary" href={hostedUrl} target="_blank" rel="noreferrer">
            {t('forms.share.open')}
          </a>
        }
      />
      <nav className="ui-tabs" aria-label={form.name}>
        {TABS.map((x) => (
          <Link
            key={x}
            href={{ pathname: `/app/crm/forms/${form.id}`, query: x === 'build' ? {} : { tab: x } }}
            className="ui-tab"
            aria-current={tab === x ? 'page' : undefined}
          >
            {t(`forms.tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
