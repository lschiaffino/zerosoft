'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { CrmTaskFileRow } from '@/lib/db';
import CrmIcon from './CrmIcon';

interface TaskFilesProps {
  taskId: string;
  files: CrmTaskFileRow[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskFiles({ taskId, files }: TaskFilesProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/crm/tasks/${taskId}/files`, {
      method: 'POST',
      body: form,
    }).catch(() => null);
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
    await fetch(`/api/crm/tasks/${taskId}/files?fileId=${fileId}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="task-files">
      {files.length === 0 ? (
        <p className="muted">{t('tasks.detail.noFiles')}</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className="file-item">
              <a href={f.url} target="_blank" rel="noreferrer" className="file-name">
                {f.filename}
              </a>
              <span className="file-meta muted">
                {formatBytes(f.size)} · {f.content_type}
              </span>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => remove(f.id)}
              >
                <CrmIcon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="btn btn-ghost btn-small file-upload-label">
        {uploading ? t('tasks.detail.uploading') : t('tasks.detail.upload')}
        <input
          ref={inputRef}
          type="file"
          className="file-upload-input"
          onChange={onChange}
          disabled={uploading}
        />
      </label>

      {error && <p className="form-error">{t(`errors.${error}`) ?? t('errors.generic')}</p>}
    </div>
  );
}
