import { redirect } from 'next/navigation';
import { requireUser, userCanUseApp } from '@/lib/session';
import { parseProfile } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

/**
 * A dónde se entra desde el sitio y al iniciar sesión: Track, la app más completa.
 * Quien no tiene Track en su workspace va al inicio, sin el aviso de app bloqueada.
 * Quien todavía tiene "Primeros pasos" a la vista (no lo ocultó) entra al inicio, donde está.
 */
export default async function AppStartPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale, `/${locale}/app/start`);
  const profile = parseProfile((user.actingUser ?? user).profile);
  if ((profile.v ?? 0) >= 2 && !profile.checklistDismissedAt) redirect(`/${locale}/app`);
  redirect(`/${locale}/app${userCanUseApp(user, 'track') ? '/track' : ''}`);
}
