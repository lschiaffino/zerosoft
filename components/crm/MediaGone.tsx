import { getTranslations } from 'next-intl/server';
import ZeroTorus from '@/components/zero/ZeroTorus';
import '@/styles/link.css';

/** Link de documento o video que ya no existe (borrado o desactivado): mismo cartel que /gone. */
export default async function MediaGone() {
  const t = await getTranslations('crm.mediaPublic');
  return (
    <main className="auth-page" data-testid="media-gone">
      <ZeroTorus interactive={false} className="zero-torus-bg" />
      <div className="auth-card">
        <span className="brand-zero" style={{ width: 44, height: 44, fontSize: 20 }}>
          0
        </span>
        <h1>{t('goneTitle')}</h1>
        <p className="auth-sub">{t('goneSub')}</p>
      </div>
    </main>
  );
}
