'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import { ImportConfirm, ImportProgress, ImportStat, useImportErrorText, useImportJob, type ImportJobView } from '@/components/app/ImportJob';
import { formatFileSize } from '@/lib/docs-files';

/** Partes de la subida sin Blob (bajo los 4.5 MB de body de Vercel). */
const CHUNK = 4 * 1024 * 1024;
const MAX_BYTES = 1024 * 1024 * 1024;

interface Preview {
  pages: number;
  databases: number;
  /** Filas de base con página (van como cuerpo de la fila). */
  rows?: number;
  attachments: number;
  bytes: number;
  alreadyImported: number;
  tree: Array<{ title: string; kind: 'page' | 'database'; depth: number }>;
}

interface Report {
  pages: number;
  databases: number;
  rows?: number;
  files: number;
  filesSkipped: number;
  skipped: number;
  roots: Array<{ id: string; title: string }>;
}

/**
 * Docs › Importar desde Notion. El zip va directo a Vercel Blob (token de
 * /api/import/upload) o, sin Blob, en partes de 4 MB; después el servidor lo
 * lee por rangos y escribe de a tandas.
 */
export default function NotionImportPanel({ blobUpload }: { blobUpload: boolean }) {
  const t = useTranslations('docs.notionImport');
  const errorText = useImportErrorText();
  const router = useRouter();
  const { job, setJob, error, setError, loading, create, start, cancel, reset, finishUpload } = useImportJob('docs');
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  async function upload() {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) return setError('invalid_zip');
    if (file.size > MAX_BYTES) return setError('file_too_large');
    setError(null);
    setPercent(0);
    try {
      if (blobUpload) {
        const { upload: blobPut } = await import('@vercel/blob/client');
        const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.zip$/i, '').slice(0, 80) || 'notion';
        const blob = await blobPut(`imports/${safe}.zip`, file, {
          access: 'public',
          handleUploadUrl: '/api/import/upload',
          multipart: file.size > 50 * 1024 * 1024,
          contentType: 'application/zip',
          onUploadProgress: (e) => setPercent(Math.round(e.percentage)),
        });
        setPercent(null);
        await create({ source: 'notion', blobUrl: blob.url });
        return;
      }
      const created = await create({ source: 'notion', size: file.size });
      if (!created) return setPercent(null);
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const part = file.slice(offset, offset + CHUNK);
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const res = await fetch(`/api/import/jobs/${created.id}/chunk?offset=${offset}`, { method: 'PUT', body: part }).catch(() => null);
          ok = !!res?.ok;
        }
        if (!ok) {
          setPercent(null);
          setError('upload_failed');
          return;
        }
        setPercent(Math.min(100, Math.round(((offset + part.size) / file.size) * 100)));
      }
      setPercent(null);
      await finishUpload(created.id);
    } catch {
      setPercent(null);
      setError('upload_failed');
    }
  }

  let body;
  if (loading) body = <p className="ui-help">{t('loadingJobs')}</p>;
  else if (percent !== null || job?.status === 'uploading') {
    body = (
      <ImportProgress
        job={job}
        uploadPercent={percent ?? 0}
        onCancel={() => {
          setPercent(null);
          if (job) void cancel();
          else setJob(null);
        }}
      />
    );
  } else if (!job) {
    body = (
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <ol className="ximp-links">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
        </ol>
        <div className="ui-field">
          <label className="label" htmlFor="notion-file">
            {t('file')}
          </label>
          <input
            id="notion-file"
            className="input ximp-file-input"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-describedby="notion-file-help"
          />
          <p id="notion-file-help" className="ui-help">
            {t('fileHelp')}
          </p>
        </div>
        <div className="ximp-actions">
          <button type="submit" className="btn btn-primary" disabled={!file}>
            {t('preview')}
          </button>
        </div>
      </form>
    );
  } else if (job.status === 'fetching' || job.status === 'importing') {
    body = <ImportProgress job={job} onCancel={cancel} />;
  } else if (job.status === 'preview') {
    body = <PreviewView job={job} onConfirm={start} onCancel={cancel} />;
  } else if (job.status === 'done') {
    body = (
      <DoneView
        job={job}
        onAgain={() => {
          setFile(null);
          reset();
          router.refresh();
        }}
      />
    );
  } else {
    body = (
      <div className="ximp-done">
        <p className="ximp-note" data-tone="bad" role="alert">
          {t('failedTitle')} {errorText(job.error)}
        </p>
        <div>
          <button type="button" className="btn" onClick={reset}>
            {t('again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ximp" data-testid="notion-import">
      <FormSection title={t('title')} titleHidden>
        {error && (
          <p className="ximp-note" data-tone="bad" role="alert">
            {errorText(error)}{' '}
            <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
              {t('dismiss')}
            </button>
          </p>
        )}
        {body}
      </FormSection>
    </div>
  );
}

function PreviewView({ job, onConfirm, onCancel }: { job: ImportJobView; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const t = useTranslations('docs.notionImport');
  const p = job.preview as unknown as Preview;
  const count = p.pages + p.databases - p.alreadyImported;
  return (
    <div className="ximp" data-testid="notion-import-preview">
      <div className="ximp-stats">
        <ImportStat value={p.pages} label={t('stat.pages')} />
        <ImportStat value={p.databases} label={t('stat.databases')} />
        {(p.rows ?? 0) > 0 && <ImportStat value={p.rows} label={t('stat.rows')} />}
        <ImportStat value={p.attachments} label={t('stat.attachments')} />
        <ImportStat value={formatFileSize(p.bytes)} label={t('stat.size')} />
      </div>
      {(p.rows ?? 0) > 0 && <p className="ui-help">{t('rowsNote')}</p>}
      {p.alreadyImported > 0 && <p className="ximp-note">{t('already', { count: p.alreadyImported })}</p>}
      <section className="ximp-section">
        <h3>{t('treeTitle')}</h3>
        <ul className="ximp-tree">
          {p.tree.map((n, i) => (
            <li key={i} style={{ ['--depth' as string]: n.depth }}>
              {n.title}
              {n.kind === 'database' && <span className="ui-help">{t('databaseTag')}</span>}
            </li>
          ))}
        </ul>
        {p.pages + p.databases > p.tree.length && <p className="ui-help">{t('more', { count: p.pages + p.databases - p.tree.length })}</p>}
      </section>
      <ImportConfirm label={t('confirm', { count: Math.max(0, count) })} onConfirm={onConfirm} onCancel={onCancel} disabled={count <= 0} />
    </div>
  );
}

function DoneView({ job, onAgain }: { job: ImportJobView; onAgain: () => void }) {
  const t = useTranslations('docs.notionImport');
  const r = job.report as unknown as Report;
  return (
    <div className="ximp-done" data-testid="notion-import-done">
      <p role="status">
        <strong>{t('doneTitle')}</strong> {t('doneSummary', { pages: r.pages, databases: r.databases, files: r.files, skipped: r.skipped })}
      </p>
      {(r.rows ?? 0) > 0 && <p className="ui-help">{t('doneRows', { count: r.rows ?? 0 })}</p>}
      {r.filesSkipped > 0 && (
        <p className="ximp-note" data-tone="warn">
          {t('filesSkipped', { count: r.filesSkipped })}
        </p>
      )}
      {r.roots.length > 0 && (
        <ul className="ximp-links">
          {r.roots.map((p) => (
            <li key={p.id}>
              <Link href={`/app/docs/${p.id}`}>{t('open', { title: p.title || t('untitled') })}</Link>
            </li>
          ))}
        </ul>
      )}
      <div className="ximp-actions">
        <button type="button" className="btn" onClick={onAgain}>
          {t('again')}
        </button>
      </div>
    </div>
  );
}
