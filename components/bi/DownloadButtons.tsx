'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BI_EXPORT_MAX_ROWS, EXPORT_FORMATS, exportResult, type ExportFormat } from '@/lib/bi/export';
import type { BiResult } from '@/lib/bi/types';
import { BiApiError, biErrorText } from './client';

/**
 * Pedido que vuelve a correr la consulta en el servidor con el tope de
 * descarga (más filas que las que se muestran). Solo se usa si el resultado
 * en pantalla vino recortado.
 */
export interface ServerExport {
  url: string;
  body: Record<string, unknown>;
}

function save(body: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(body);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function filenameFrom(res: Response, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return m?.[1] ?? fallback;
}

/** Descargar el resultado en CSV, Excel o JSON. */
export default function DownloadButtons({ result, name, server }: { result: BiResult; name?: string; server?: ServerExport }) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (format: ExportFormat) => {
    setError(null);
    if (!result.truncated || !server) {
      const file = exportResult(result, format, name);
      save(new Blob([file.body as BlobPart], { type: file.mime }), file.filename);
      return;
    }
    setBusy(format);
    try {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...server.body, format, name }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new BiApiError(data.error ?? 'request_failed', res.status, data.detail ?? null);
      }
      save(await res.blob(), filenameFrom(res, exportResult({ columns: [], rows: [] }, format, name).filename));
    } catch (err) {
      setError(biErrorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="bi-download">
      <span role="group" aria-label={t('result.download')} className="bi-download-group" data-testid="bi-download">
        <span className="bi-muted" aria-hidden="true">
          {t('result.download')}
        </span>
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            className="btn btn-sm btn-ghost"
            data-testid={`bi-download-${f}`}
            aria-label={t('result.downloadAs', { format: t(`result.format.${f}`) })}
            onClick={() => void download(f)}
            disabled={busy !== null}
            aria-busy={busy === f}
          >
            {t(`result.format.${f}`)}
          </button>
        ))}
      </span>
      {result.truncated && server && <span className="bi-muted bi-download-hint">{t('result.downloadMore', { n: new Intl.NumberFormat(locale).format(BI_EXPORT_MAX_ROWS) })}</span>}
      {error && (
        <span className="ui-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
