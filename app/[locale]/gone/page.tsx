import { getTranslations } from 'next-intl/server';
import ZeroTorus from '@/components/zero/ZeroTorus';

export const dynamic = 'force-dynamic';

type Reason = 'notfound' | 'expired' | 'limit' | 'password';

const REASONS: Reason[] = ['notfound', 'expired', 'limit', 'password'];

interface GonePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GonePage(props: GonePageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'link' });
  const raw = typeof searchParams.reason === 'string' ? searchParams.reason : 'notfound';
  const reason: Reason = (REASONS as string[]).includes(raw) ? (raw as Reason) : 'notfound';

  return (
    <main className="notfound-page">
      <ZeroTorus interactive={false} className="zero-torus-bg" />
      <p className="notfound-code">0</p>
      <h1 className="gone-title">{t(`gone.${reason}Title`)}</h1>
      <p className="notfound-msg">{t(`gone.${reason}Sub`)}</p>
      {/* <a> plano: en un dominio propio "/<locale>" no existe (404), y "/" ya
          lleva a la raíz configurada del dominio o, en la app, al inicio. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn btn-ghost">
        {t('gone.home')}
      </a>
    </main>
  );
}
