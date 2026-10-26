'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { downloadInParts } from './download';

/** Botón de descarga: baja el archivo de a partes por la ruta con permisos y muestra el avance. */
export default function RecDownload({ url, label, className = 'btn btn-secondary btn-sm', testId }: { url: string; label: string; className?: string; testId?: string }) {
  const t = useTranslations('rec.common');
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        disabled={pct !== null}
        aria-busy={pct !== null || undefined}
        onClick={async () => {
          setError(false);
          setPct(0);
          try {
            await downloadInParts(url, 'video.webm', setPct);
          } catch {
            setError(true);
          } finally {
            setPct(null);
          }
        }}
      >
        {pct !== null ? t('downloading', { pct }) : label}
      </button>
      {error && (
        <span className="ui-error" role="alert">
          {t('errors.download_failed')}
        </span>
      )}
    </>
  );
}
