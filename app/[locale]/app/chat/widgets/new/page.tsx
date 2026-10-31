import { requireUser } from '@/lib/session';
import WidgetsIndex from '@/components/chat/WidgetsIndex';

export const dynamic = 'force-dynamic';

/**
 * Crear widget: la lista de widgets con el modal mínimo abierto (nombre y
 * color). El resto se configura después en el editor del widget.
 */
export default async function NewWidgetPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <WidgetsIndex locale={locale} user={user} openNew />;
}
