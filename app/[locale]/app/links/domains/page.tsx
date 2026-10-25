import { redirect } from '@/i18n/navigation';

/** Ruta vieja de los dominios propios: ahora son una pestaña de los ajustes de Link. */
export default async function LinkDomainsRedirect(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect({ href: '/app/links/settings?tab=domains', locale });
}
