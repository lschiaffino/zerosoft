import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export type WidgetSection = 'settings' | 'rules' | 'canned' | 'sla';

interface WidgetHeaderProps {
  locale: string;
  widget: { id: string; name: string; color: string };
  active: WidgetSection;
  /** Cantidad de conversaciones del widget (opcional, solo en la vista principal). */
  conversations?: number;
}

/**
 * Cabecera común de las páginas de un widget: nombre, volver a la lista y
 * tabs (configuración, reglas, respuestas guardadas, SLA). Antes cada
 * subpágina tenía su propio título y solo la de edición mostraba las tabs.
 */
export default async function WidgetHeader({ locale, widget, active, conversations }: WidgetHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'chat' });
  const base = `/app/chat/widgets/${widget.id}`;
  const tabs: Array<{ key: WidgetSection; href: string; label: string }> = [
    { key: 'settings', href: base, label: t('widgetNav.settings') },
    { key: 'rules', href: `${base}/rules`, label: t('rules.title') },
    { key: 'canned', href: `${base}/canned`, label: t('canned.title') },
    { key: 'sla', href: `${base}/sla`, label: t('sla.policies') },
  ];

  return (
    <>
      <div className="page-head chat-widget-head">
        <div>
          <Link href="/app/chat" className="chat-widget-back mono">
            ← {t('widgetNav.back')}
          </Link>
          <h1 className="app-title chat-widget-title">
            <span className="chat-widget-dot" style={{ backgroundColor: widget.color }} aria-hidden />
            {widget.name}
          </h1>
        </div>
        {conversations != null && (
          <Link href="/app/chat/inbox" className="btn btn-small">
            {t('widgetNav.conversations', { count: conversations })} →
          </Link>
        )}
      </div>
      <nav className="chat-widget-nav" aria-label={widget.name}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`chat-widget-nav-link${tab.key === active ? ' active' : ''}`}
            aria-current={tab.key === active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
