'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '@/styles/desktop-download.css';
import { useLocale, useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import { detectPlatform, formatSize, inDesktopApp, type DesktopTarget, type DetectedPlatform } from '@/lib/desktop-detect';
import { downloadHref, type DownloadPlacement } from '@/lib/desktop-os';

export interface DesktopRelease {
  version: string;
  pageUrl: string;
  links: { macArm64: string | null; macX64: string | null; win: string | null };
  sizes: { macArm64: number | null; macX64: number | null; win: number | null };
}

const TARGETS: DesktopTarget[] = ['mac-arm', 'mac-intel', 'win'];

function linkFor(r: DesktopRelease, t: DesktopTarget): string | null {
  return t === 'mac-arm' ? r.links.macArm64 : t === 'mac-intel' ? r.links.macX64 : r.links.win;
}
function sizeFor(r: DesktopRelease, t: DesktopTarget): number | null {
  return t === 'mac-arm' ? r.sizes.macArm64 : t === 'mac-intel' ? r.sizes.macX64 : r.sizes.win;
}

/**
 * Descarga de la app de escritorio: detecta el sistema y el chip (lib/desktop-detect.ts),
 * deja elegir a mano, baja el instalador del último release (resuelto en el servidor,
 * lib/desktop-release.ts) y muestra cómo instalarlo (builds sin firmar: Abrir igualmente
 * en Mac, Ejecutar de todas formas en Windows). Dentro de la app de escritorio no ofrece
 * nada: dice que ya está.
 *
 * - `variant="page"` (/download, /app/download): los pasos siempre a la vista.
 * - `variant="step"` (onboarding): los pasos aparecen al descargar y, con `watch`, espera
 *   a que la app avise que se abrió con esta cuenta (GET /api/onboarding) y se marca sola.
 * - `track`: avisa la descarga a /api/onboarding (solo con sesión).
 * - `from`: el lugar con el que se cuenta el clic en Pulse (lib/desktop-track.ts), igual que
 *   el resto de los botones de descarga del sitio.
 */
export default function DesktopDownload({
  release,
  variant = 'page',
  track = false,
  from,
  watch = false,
  seen = false,
  onSeen,
  headingLevel = 2,
}: {
  release: DesktopRelease | null;
  variant?: 'page' | 'step';
  track?: boolean;
  from?: DownloadPlacement;
  watch?: boolean;
  seen?: boolean;
  onSeen?: () => void;
  headingLevel?: 2 | 3;
}) {
  const t = useTranslations('common.desktop');
  const locale = useLocale();
  const [detected, setDetected] = useState<{ platform: DetectedPlatform; sure: boolean } | null>(null);
  const [target, setTarget] = useState<DesktopTarget>('mac-arm');
  const [downloaded, setDownloaded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [isSeen, setIsSeen] = useState(seen);
  const [copied, setCopied] = useState(false);
  const stepsRef = useRef<HTMLHeadingElement>(null);
  const H = headingLevel === 2 ? 'h2' : 'h3';

  useEffect(() => {
    setDesktop(inDesktopApp());
    let alive = true;
    void detectPlatform().then((g) => {
      if (!alive) return;
      setDetected({ platform: g.platform, sure: g.confidence === 'sure' });
      if (g.platform === 'mac-arm' || g.platform === 'mac-intel' || g.platform === 'win') setTarget(g.platform);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Esperar a que la app de escritorio avise (onboarding): cada 5 s mientras la pestaña está visible.
  const poll = useCallback(async () => {
    const res = await fetch('/api/onboarding', { cache: 'no-store' }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { state?: { desktop?: { seenAt?: string | null } } } | null) : null;
    if (data?.state?.desktop?.seenAt) {
      setIsSeen(true);
      onSeen?.();
    }
  }, [onSeen]);
  useEffect(() => {
    if (!watch || isSeen || !downloaded) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, 5000);
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [watch, isSeen, downloaded, poll]);

  if (desktop || isSeen) {
    return (
      <div className="dd dd-done" data-testid="desktop-done" role="status">
        <span className="dd-done-mark" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <div>
          <p className="dd-done-title">{desktop ? t('inApp') : t('seen')}</p>
          {desktop && <p className="dd-done-body">{t('inAppBody')}</p>}
        </div>
      </div>
    );
  }

  const href = release ? linkFor(release, target) : null;
  const size = release ? formatSize(sizeFor(release, target), locale) : null;
  const platform = detected?.platform ?? null;
  const offComputer = platform === 'mobile' || platform === 'linux';
  const showSteps = variant === 'page' || downloaded;
  const mac = target !== 'win';

  function onDownload() {
    setDownloaded(true);
    if (from) {
      // Solo cuenta el clic: el link ya baja el instalador, así que la redirección no se sigue.
      void fetch(downloadHref(from, { os: target, locale }), { redirect: 'manual', keepalive: true }).catch(() => {});
    }
    if (track) {
      void fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'desktop', event: 'download' }),
        keepalive: true,
      }).catch(() => {});
    }
    // Los pasos aparecen debajo: el foco va al título para que se lean (y lo anuncie el lector).
    window.setTimeout(() => stepsRef.current?.focus(), 50);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${locale}/download`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin portapapeles */
    }
  }

  return (
    <div className="dd" data-variant={variant} data-target={target} data-platform={platform ?? ''}>
      {offComputer && (
        <div className="dd-note" role="note" data-testid="desktop-off-computer">
          <p>{platform === 'mobile' ? t('mobile') : t('linux')}</p>
          {platform === 'mobile' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyLink()}>
              {copied ? t('copied') : t('copyLink')}
            </button>
          )}
        </div>
      )}

      {!release ? (
        <div className="dd-note" data-testid="desktop-no-release">
          <p>{t('noRelease')}</p>
          <a className="btn btn-secondary btn-sm" href="https://github.com/lschiaffino/zerosoft/releases" target="_blank" rel="noreferrer">
            {t('releases')}
          </a>
        </div>
      ) : (
        <>
          <fieldset className="dd-pick">
            <legend className="label">{t('pickLabel')}</legend>
            <div className="dd-pick-row" role="radiogroup" aria-label={t('pickLabel')}>
              {TARGETS.map((k) => {
                const on = target === k;
                const isDetected = platform === k;
                return (
                  <label key={k} className={`dd-opt${on ? ' is-on' : ''}${linkFor(release, k) ? '' : ' is-off'}`}>
                    <input
                      type="radio"
                      name="dd-target"
                      value={k}
                      checked={on}
                      disabled={!linkFor(release, k)}
                      onChange={() => setTarget(k)}
                    />
                    <span className="dd-opt-name">{k === 'mac-arm' ? t('macArm') : k === 'mac-intel' ? t('macIntel') : t('win')}</span>
                    {isDetected && <span className="dd-opt-tag">{detected?.sure ? t('detected') : t('probable')}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="dd-cta">
            {href && (
              <a className={`btn ${offComputer ? 'btn-secondary' : 'btn-primary'} btn-lg dd-btn`} href={href} onClick={onDownload} data-testid="desktop-download">
                <Icon name="download" size={18} />
                {t(`download.${target}`)}
              </a>
            )}
            <p className="dd-meta">
              <span className="data">{size ? t('metaSize', { version: release.version, size }) : t('meta', { version: release.version })}</span>
              <a href={release.pageUrl} target="_blank" rel="noreferrer">
                {t('allFiles')}
              </a>
            </p>
          </div>
          {/* El chip no siempre se sabe: cómo verlo, salvo que el navegador lo haya dicho. */}
          {mac && !(detected?.sure && (platform === 'mac-arm' || platform === 'mac-intel')) && <p className="dd-help">{t('chipHelp')}</p>}
        </>
      )}

      {release && showSteps && (
        <section className="dd-steps" aria-labelledby="dd-steps-title" data-testid="desktop-steps">
          <H id="dd-steps-title" className="dd-h" tabIndex={-1} ref={stepsRef}>
            {downloaded ? t('installTitleAfter') : t('installTitle')}
          </H>
          <ol className="dd-list">
            {(['s1', 's2', 's3', 's4'] as const).map((s, i) => (
              <li key={s}>
                <span className="dd-num data" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{t(`${mac ? 'mac' : 'windows'}.${s}`)}</span>
              </li>
            ))}
          </ol>
          {watch && downloaded && (
            <p className="dd-wait" role="status">
              <span className="dd-pulse" aria-hidden="true" />
              {t('waiting')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** Lo que suma la app de escritorio (cuatro filas con ícono), para el paso del onboarding y /app/download. */
export function DesktopFeatures({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const t = useTranslations('common.desktop');
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const rows = [
    { k: 'f1', icon: 'voice' },
    { k: 'f2', icon: 'recorder' },
    { k: 'f3', icon: 'bell' },
    { k: 'f4', icon: 'desktop' },
  ] as const;
  return (
    <section className="dd-features" aria-labelledby="dd-features-title">
      <H id="dd-features-title" className="dd-h">
        {t('featuresTitle')}
      </H>
      <ul>
        {rows.map((r) => (
          <li key={r.k}>
            <span className="dd-feat-icon" aria-hidden="true">
              <Icon name={r.icon} size={16} />
            </span>
            <span className="dd-feat-text">
              <span className="dd-feat-title">{t(`${r.k}t`)}</span>
              <span className="dd-feat-body">{t(`${r.k}d`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
