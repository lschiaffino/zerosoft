'use client';

import { useState, type ComponentType, type ReactNode } from 'react';

export interface CsvImportStrings {
  title: string;
  help: string;
  file: string;
  preview: string;
  cancel: string;
  confirm: string;
  back: string;
  empty: string;
  summary: (d: Record<string, number>) => string;
  failedTitle: string;
  line: (n: number, code: string) => string;
  errorText: (code: string | undefined) => string;
}

type DialogLike = ComponentType<{ open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }>;

interface Preview {
  failed: Array<{ line: number; code: string }>;
  preview?: Array<Record<string, string>>;
  [k: string]: unknown;
}

/**
 * Importar un CSV en dos pasos: primero una vista previa (dryRun) con lo que se
 * va a crear y cada fila con error; recién al confirmar se guarda. El archivo se
 * lee en el navegador y viaja como texto.
 */
export default function CsvImportDialog({ open, onClose, url, Dialog, strings, onDone }: { open: boolean; onClose: () => void; url: string; Dialog: DialogLike; strings: CsvImportStrings; onDone: (result: Record<string, unknown>) => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCsv('');
    setPreview(null);
    setError('');
    onClose();
  };

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, dryRun }) });
      const data = (await res.json().catch(() => ({}))) as Preview & { error?: string };
      if (!res.ok) {
        setError(strings.errorText(data.error));
        return;
      }
      if (dryRun) setPreview(data);
      else {
        close();
        onDone(data);
      }
    } catch {
      setError(strings.errorText('network'));
    } finally {
      setBusy(false);
    }
  };

  const counts = preview ? (Object.fromEntries(Object.entries(preview).filter(([, v]) => typeof v === 'number')) as Record<string, number>) : {};
  const canImport = preview ? Object.values(counts).some((n) => n > 0) : false;

  return (
    <Dialog open={open} title={strings.title} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(!preview);
        }}
      >
        <div className="ui-modal-body ui-fields">
          {!preview ? (
            <>
              <p className="ui-help">{strings.help}</p>
              <label className="ui-field">
                <span className="label">{strings.file}</span>
                <input
                  className="input"
                  type="file"
                  accept=".csv,text/csv"
                  data-testid="csv-file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return setCsv('');
                    if (file.size > 2_000_000) {
                      setCsv('');
                      return setError(strings.errorText('file_too_large'));
                    }
                    setError('');
                    setCsv(await file.text());
                  }}
                />
              </label>
            </>
          ) : (
            <>
              <p data-testid="csv-summary">{strings.summary(counts)}</p>
              {(preview.preview ?? []).length > 0 && (
                <ul className="ui-help">
                  {(preview.preview ?? []).map((row, i) => (
                    <li key={i}>{Object.values(row).filter(Boolean).join(' · ')}</li>
                  ))}
                </ul>
              )}
              {preview.failed.length > 0 && (
                <>
                  <p className="label">{strings.failedTitle}</p>
                  <ul className="ui-help" data-testid="csv-failed">
                    {preview.failed.slice(0, 20).map((f) => (
                      <li key={`${f.line}-${f.code}`}>{strings.line(f.line, f.code)}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={preview ? () => setPreview(null) : close}>
            {preview ? strings.back : strings.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !csv || (Boolean(preview) && !canImport)}>
            {preview ? strings.confirm : strings.preview}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
