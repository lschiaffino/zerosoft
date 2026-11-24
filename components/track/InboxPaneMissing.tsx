'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';

/**
 * El issue de un aviso que no se puede abrir en el panel de la bandeja (se
 * borró, es de otro workspace o falló al cargar): un mensaje en el panel, sin
 * tapar la lista, con el link a la página del issue y a la bandeja.
 */
export default function InboxPaneMissing({ retry }: { retry?: () => void }) {
  const ti = useTranslations('track.inbox.panel');
  const pathname = usePathname();
  const id = /\/app\/track\/inbox\/([^/?#]+)/.exec(pathname ?? '')?.[1] ?? '';
  return (
    <div className="track-inbox-pane-missing" role="status" data-testid="track-inbox-pane-missing">
      <p className="ui-help">{ti('missing')}</p>
      <div className="track-inbox-pane-actions">
        {retry && (
          <button type="button" className="btn btn-sm" onClick={retry}>
            {ti('retry')}
          </button>
        )}
        {id && (
          <Link href={`/app/track/issues/${id}`} className="btn btn-sm">
            {ti('openPage')}
          </Link>
        )}
        <Link href="/app/track/inbox" className="btn btn-ghost btn-sm">
          {ti('close')}
        </Link>
      </div>
    </div>
  );
}
