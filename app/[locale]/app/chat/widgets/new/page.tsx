import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import WidgetForm from '@/components/chat/WidgetForm';

export const dynamic = 'force-dynamic';

export default async function NewWidgetPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('widgetForm.newTitle')}</h1>
      <p className="app-sub muted">{t('widgetForm.newSub')}</p>
      <WidgetForm />
    </div>
  );
}
