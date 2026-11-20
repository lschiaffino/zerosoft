'use client';

import { useTranslations } from 'next-intl';
import type { ImportStatus } from '@/lib/groups-import';
import { linesImportNotice, type ImportNotice } from '@/lib/wa-import-notice';
import ImportNotices from './wa/ImportNotices';

/**
 * El aviso de importación de la bandeja de Lines: qué está haciendo la
 * importación de cada línea a la vista (lib/wa-import-notice.ts). Se puede
 * cerrar en cualquier estado; "terminó" se va solo.
 */
export default function LinesImportNotices({ imports, line }: { imports: ImportStatus[]; line: string }) {
  const t = useTranslations('groups.wa');
  // Con una línea elegida, solo sus avisos: los de otra línea no son de esta vista.
  const notices = imports.filter((im) => line === 'all' || im.numberId === line).map(linesImportNotice);

  const text = (n: ImportNotice) => {
    switch (n.kind) {
      case 'done':
        return t('importDone', { chats: n.total, messages: n.messages });
      case 'nothingNew':
        return t('importNothingNew', { chats: n.total });
      case 'failed':
        return t('importFailed');
      case 'stalled':
        return t('importStalled');
      case 'paused':
        return t('importPaused');
      case 'older':
        return t('importOlder', { messages: n.messages });
      case 'finishing':
        return t('importFinishing');
      case 'progress':
        return t('importMessages', { done: n.done, total: n.total });
      default:
        return t('importChats', { n: n.total });
    }
  };

  return <ImportNotices notices={notices} storageKey="zs-lines-import-closed" text={text} closeLabel={t('importClose')} progressLabel={t('importProgress')} testid="lines-import-banner" />;
}
