'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImportJobDto } from '@/lib/inbox/import-jobs';
import { importNoticeBusy, inboxImportNotice, type ImportNotice } from '@/lib/wa-import-notice';
import ImportNotices from '@/components/groups/wa/ImportNotices';
import { api, notifyInboxChanged } from './api';

const ACTIVE = new Set(['running', 'waiting']);

/**
 * El avance de la importación de WhatsApp o Gmail arriba de la lista, como en
 * Lines: mientras corre, cuántos chats van; si está frenada o se cortó, lo
 * dice; al terminar avisa y se va solo. Siempre se puede cerrar. Lee lo mismo
 * que Ajustes › Importar (/api/inbox/import).
 */
export default function ImportBanner() {
  const t = useTranslations('inbox.list');
  const [jobs, setJobs] = useState<ImportJobDto[]>([]);
  const wasActive = useRef(new Set<string>());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const r = await api<{ imports: ImportJobDto[] }>('/api/inbox/import');
      if (stop) return;
      const list = r.ok ? r.data.imports.filter((j) => j.kind === 'whatsapp' || j.kind === 'gmail') : [];
      setJobs(list);
      // Lo que terminó mientras se miraba: la lista se actualiza sola.
      for (const j of list) {
        if (ACTIVE.has(j.status)) wasActive.current.add(j.id);
        else if (wasActive.current.delete(j.id)) notifyInboxChanged();
      }
      const busy = list.some((j) => ACTIVE.has(j.status));
      timer = setTimeout(() => void load(), busy ? 4000 : 60_000);
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const now = Date.now();
  const notices = jobs.map((j) => inboxImportNotice(j, now)).filter((n): n is ImportNotice => n !== null);
  // De cada origen, solo la importación más nueva: una vieja que se cortó no queda al lado de la que corre ahora.
  const latest = notices.filter((n, i) => notices.findIndex((o) => o.source === n.source) === i || importNoticeBusy(n));

  const text = (n: ImportNotice) => {
    const gmail = n.source === 'gmail';
    switch (n.kind) {
      case 'done':
      case 'nothingNew':
        return t(gmail ? 'importDoneGmail' : 'importDone', { chats: n.total, messages: n.messages });
      case 'failed':
        return t('importFailed');
      case 'stalled':
        return t('importStalled');
      case 'paused':
        return t(gmail ? 'importPausedGmail' : 'importPaused');
      case 'waiting':
        return t('importWaiting');
      case 'counting':
        return t('importCounting');
      default:
        return t(gmail ? 'importGmail' : 'importWa', { done: n.done, total: n.total });
    }
  };

  return <ImportNotices notices={latest} storageKey="zs:inbox-import-closed" text={text} closeLabel={t('importClose')} progressLabel={t('importProgress')} testid="inbox-import-banner" />;
}
