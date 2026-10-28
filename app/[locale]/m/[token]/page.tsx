import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { resolveShare } from '@/lib/voice-share';
import { speakerName } from '@/lib/voice';
import { formatDuration } from '@/lib/voice-types';
import '@/styles/voice.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice.sharedPage' });
  // El título de la reunión no va en el metadata: la tarjeta del link no muestra nada privado.
  return { title: t('meta'), robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Reunión de Voice compartida por link (como Granola): la nota de solo
 * lectura y, si quien la compartió lo eligió, la transcripción. El acceso se
 * chequea en cada carga (workspace, personas o cualquiera con el link).
 */
export default async function SharedMeetingPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const user = await getCurrentUser();
  const res = await resolveShare(token, user ? realUserId(user) : null);
  if (res.state === 'not_found') notFound();
  const t = await getTranslations({ locale, namespace: 'voice.sharedPage' });
  const tx = await getTranslations({ locale, namespace: 'voice.export' });
  const format = await getFormatter({ locale });
  if (res.state !== 'ok') {
    const back = `/${locale}/m/${token}`;
    return (
      <main className="vc-public" data-testid="voice-share-gate" data-state={res.state}>
        <h1 className="vc-public-title">{t(`${res.state}.title`)}</h1>
        <p className="vc-muted">{t(`${res.state}.body`)}</p>
        {res.state === 'signin' && (
          <a className="btn btn-primary" href={`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(back)}`}>
            {t('signIn')}
          </a>
        )}
      </main>
    );
  }
  const v = res.view;
  const e = v.enhanced;
  const labels = { me: tx('me'), them: tx('them'), speaker: tx('speaker') };
  return (
    <main className="vc-public" data-testid="voice-shared-meeting">
      <p className="vc-public-meta data">
        {t('sharedBy', { name: v.ownerName })} · {format.dateTime(new Date(v.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
        {v.durationMs > 0 && ` · ${formatDuration(v.durationMs)}`} · {t('readOnly')}
      </p>
      <h1 className="vc-public-title">{v.title || t('untitled')}</h1>
      {e ? (
        <article className="vc-enhanced">
          {e.summary && (
            <section>
              <h2 className="vc-h3">{tx('summary')}</h2>
              <p>{e.summary}</p>
            </section>
          )}
          {e.sections
            .filter((s) => s.points.length)
            .map((s, i) => (
              <section key={i}>
                <h2 className="vc-h3">{s.heading}</h2>
                <ul className="vc-points">
                  {s.points.map((p, j) => (
                    <li key={j}>{p.text}</li>
                  ))}
                </ul>
              </section>
            ))}
          {e.decisions.length > 0 && (
            <section>
              <h2 className="vc-h3">{tx('decisions')}</h2>
              <ul className="vc-points">
                {e.decisions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          {e.actionItems.length > 0 && (
            <section>
              <h2 className="vc-h3">{tx('actionItems')}</h2>
              <ul className="vc-points">
                {e.actionItems.map((a, i) => (
                  <li key={i}>
                    {a.text}
                    {(a.owner || a.due) && <span className="vc-muted"> ({[a.owner, a.due].filter(Boolean).join(', ')})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      ) : v.myNotes.trim() ? (
        <article className="vc-enhanced">
          <h2 className="vc-h3">{tx('myNotes')}</h2>
          <p className="vc-public-notes">{v.myNotes}</p>
        </article>
      ) : (
        <p className="vc-muted">{t('empty')}</p>
      )}
      {v.segments && v.segments.length > 0 && (
        <section className="vc-public-transcript" aria-labelledby="vc-public-tr">
          <h2 id="vc-public-tr" className="ui-section-title">
            {tx('transcript')}
          </h2>
          <ol className="vc-segments">
            {v.segments.map((s) => (
              <li key={s.id} className={`vc-seg is-${s.source}`}>
                <span className="vc-seg-time data">{mmss(s.startMs)}</span>
                <span className="vc-speaker-static">{speakerName(s, v.speakers, labels)}</span>
                <span className="vc-seg-text">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
