import { redirect } from '@/i18n/navigation';

// Ruta vieja de la lista de widgets ("Ajustes"): la canónica es /app/chat/widgets.
export default async function ChatSettingsRedirect(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect({ href: '/app/chat/widgets', locale });
}
