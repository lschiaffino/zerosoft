import { redirect } from 'next/navigation';
import { requireUser, userCanUseApp } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * A dónde se entra desde el sitio y al iniciar sesión: Track, la app más completa.
 * Quien no tiene Track en su workspace va al inicio, sin el aviso de app bloqueada.
 */
export default async function AppStartPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale, `/${locale}/app/start`);
  redirect(`/${locale}/app${userCanUseApp(user, 'track') ? '/track' : ''}`);
}
