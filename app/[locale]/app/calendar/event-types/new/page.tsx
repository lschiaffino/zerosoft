import { redirect } from 'next/navigation';

/**
 * La creación vive en un modal rápido sobre la lista de event types
 * (como Calendly/Linear). Este path queda por compatibilidad: sidebar,
 * Cmd+K y links viejos abren la lista con el modal abierto.
 */
export default async function NewEventTypePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/app/calendar/event-types?new=1`);
}
