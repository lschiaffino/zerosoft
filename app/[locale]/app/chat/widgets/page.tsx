import { redirect } from '@/i18n/navigation';

// La lista de widgets vive en Ajustes de Chat; este índice evita el 404 del
// breadcrumb "Widgets" en las páginas de un widget.
export default async function ChatWidgetsIndex(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect({ href: '/app/chat/settings', locale });
}
