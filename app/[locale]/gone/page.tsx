import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ZeroField from '@/components/ZeroField';

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
      <ZeroField align="center" sizeFactor={1.2} interactive={false} alpha={0.08} />
      <p className="notfound-code">0</p>
      <h1 className="gone-title">{t(`gone.${reason}Title`)}</h1>
      <p className="notfound-msg">{t(`gone.${reason}Sub`)}</p>
      <Link href="/" className="btn btn-ghost">
        {t('gone.home')}
      </Link>
    </main>
  );
}
