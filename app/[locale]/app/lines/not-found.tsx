import { getTranslations } from 'next-intl/server';
import EmptyState from '@/components/ui/EmptyState';

/** Un chat, grupo o ticket que ya no existe (p. ej. borrado en otra pestaña): dentro de la app, con salida a la bandeja. */
export default async function GroupsNotFound() {
  const t = await getTranslations('groups');
  return (
    <div className="ui-page">
      <EmptyState title={t('notFound.title')} body={t('notFound.body')} action={{ label: t('notFound.action'), href: '/app/lines/inbox' }} product="groups" />
    </div>
  );
}
