import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { signActorOf } from '@/lib/sign/http';
import { countBoxes, envelopeDto, listEnvelopes, requireSee, SIGN_BOXES, type SignBox } from '@/lib/sign/core';
import { getTemplate, listTemplates, templateDto } from '@/lib/sign/templates';
import { crmPrefill } from '@/lib/sign/integrations';
import { MAX_PDF_BYTES } from '@/lib/sign/pdf';
import { SignError } from '@/lib/sign/types';
import SignHome from '@/components/sign/SignHome';
import NewEnvelope from '@/components/sign/NewEnvelope';
import EnvelopeEditor from '@/components/sign/EnvelopeEditor';
import EnvelopeDetail from '@/components/sign/EnvelopeDetail';
import TemplatesList from '@/components/sign/TemplatesList';
import TemplateEditor from '@/components/sign/TemplateEditor';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const MAX_MB = MAX_PDF_BYTES / 1024 / 1024;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'sign' });
  const key = zs[0] === 'templates' ? 'nav.templates' : zs[0] === 'new' ? 'nav.new' : 'nav.envelopes';
  return { title: `${t(key)} · Sign` };
}

async function seeOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SignError) return null;
    throw err;
  }
}

/**
 * Sign en una sola ruta (presupuesto de rutas): /app/sign (?box, ?q),
 * /app/sign/new (?crm=deal:<id>|contact:<id>), /app/sign/envelopes/<id>,
 * /app/sign/templates (?q) y /app/sign/templates/<id> (?use=1, ?tab=bulk).
 */
export default async function SignPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'sign') || user.role === 'guest') notFound();
  const actor = signActorOf(user);
  const [section, id, sub] = zs;
  if (zs.length > 2 || sub) notFound();

  if (!section) {
    const box = (SIGN_BOXES as string[]).includes(sp.box ?? '') ? (sp.box as SignBox) : 'all';
    const all = await listEnvelopes(actor, { q: sp.q ?? '' });
    return <SignHome items={box === 'all' ? all : all.filter((e) => e.box === box)} counts={countBoxes(all)} box={box} q={sp.q ?? ''} />;
  }

  switch (section) {
    case 'new': {
      if (id) notFound();
      const prefill = sp.crm ? await crmPrefill(user, sp.crm) : null;
      const templates = (await listTemplates(actor)).map((tp) => ({ id: tp.id, name: tp.name, ready: Boolean(tp.document_ref) }));
      return (
        <NewEnvelope
          templates={templates}
          crm={prefill && sp.crm ? { ref: sp.crm, label: prefill.link.label ?? prefill.title, recipient: prefill.recipient?.name ?? null } : null}
          docsAvailable={userCanUseApp(user, 'docs')}
          maxMb={MAX_MB}
        />
      );
    }
    case 'envelopes': {
      if (!id) notFound();
      const found = await seeOrNull(() => requireSee(actor, id));
      if (!found) {
        // Desde el adjunto de un deal o contacto del CRM: un aviso en vez de un 404 mudo.
        if (sp.from === 'crm') {
          const t = await getTranslations({ locale, namespace: 'sign' });
          return (
            <div className="app-page ui-page sg-page">
              <EmptyState product="sign" title={t('noAccess.title')} body={t('noAccess.body')} action={{ label: t('nav.envelopes'), href: '/app/sign' }} />
            </div>
          );
        }
        notFound();
      }
      const dto = await envelopeDto(actor, found.env, found.recipients, { fields: true, events: true });
      if (found.env.status === 'draft') {
        if (!dto.canManage) notFound();
        return <EnvelopeEditor initial={dto} maxMb={MAX_MB} />;
      }
      return <EnvelopeDetail env={dto} />;
    }
    case 'templates': {
      if (!id) {
        const rows = await listTemplates(actor, sp.q ?? '');
        return <TemplatesList items={rows.map((r) => templateDto(r, actor))} q={sp.q ?? ''} />;
      }
      const tp = await seeOrNull(() => getTemplate(actor, id));
      if (!tp) notFound();
      const tab = sp.use === '1' ? 'use' : sp.tab === 'bulk' ? 'bulk' : sp.tab === 'fields' ? 'fields' : 'setup';
      return <TemplateEditor initial={templateDto(tp, actor)} startTab={tab} maxMb={MAX_MB} />;
    }
    default:
      notFound();
  }
}
