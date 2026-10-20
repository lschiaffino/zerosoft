'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';

export interface FileItem {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
}

interface FilesPanelProps {
  /** Ruta de adjuntos: POST sube (`file`), DELETE ?fileId= borra. */
  endpoint: string;
  files: FileItem[];
  /** Compacto (dentro de una nota del timeline): sin texto de vacío. */
  compact?: boolean;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lista de adjuntos con subir y borrar (tareas, notas y registros). */
export default function FilesPanel({ endpoint, files, compact = false }: FilesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function onChange(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(endpoint, { method: 'POST', body: form }).catch(() => null);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    if (res && res.ok) {
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(data?.error ?? 'generic');
  }

  async function remove(fileId: string) {
    setConfirmId(null);
    await fetch(`${endpoint}?fileId=${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  return (
    <div className={`task-files${compact ? ' task-files-compact' : ''}`}>
      {files.length === 0 ? (
        compact ? null : <p className="muted">{t('tasks.detail.noFiles')}</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className="file-item">
              <a href={f.url} target="_blank" rel="noreferrer" className="file-name">
                {f.filename}
              </a>
              <span className="file-meta muted">{formatBytes(f.size)}</span>
              {confirmId === f.id ? (
                <>
                  <button type="button" className="icon-btn danger" onClick={() => remove(f.id)}>
                    {t('common.yes')}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setConfirmId(null)}>
                    {t('common.no')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`${t('common.delete')}: ${f.filename}`}
                  title={t('common.delete')}
                  onClick={() => setConfirmId(f.id)}
                >
                  <CrmIcon name="x" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <label className="btn btn-ghost btn-small file-upload-label">
        {uploading ? t('tasks.detail.uploading') : compact ? t('files.attach') : t('tasks.detail.upload')}
        <input ref={inputRef} type="file" className="file-upload-input" onChange={onChange} disabled={uploading} />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}` as 'errors.generic') : t('errors.generic')}
        </p>
      )}
    </div>
  );
}
