import { getTranslations } from 'next-intl/server';

export default async function RecNotFound() {
  const t = await getTranslations('rec.watch');
  return (
    <main className="rec-watch rec-gate" data-testid="rec-gate" data-state="not_found">
      <div className="rec-gate-card">
        <h1 className="rec-watch-title">{t('gate.not_found.title')}</h1>
        <p className="muted">{t('gate.not_found.body')}</p>
      </div>
    </main>
  );
}
