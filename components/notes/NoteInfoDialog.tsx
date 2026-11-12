'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { NoteDetail } from '@/lib/notes-types';
import { NotesModal } from './NotesModal';
import { noteStats } from './notes-ui';

/** Info de la nota: cifras del texto y fechas, como "Note Info" de Evernote. */
export default function NoteInfoDialog({ note, onClose }: { note: NoteDetail; onClose: () => void }) {
  const t = useTranslations('notes.info');
  const locale = useLocale();
  const stats = noteStats(note.title, note.content);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const nf = new Intl.NumberFormat(locale);
  const rows: Array<[string, string]> = [
    [t('words'), nf.format(stats.words)],
    [t('characters'), nf.format(stats.characters)],
    [t('reading'), stats.readingMinutes === 0 ? '-' : t('minutes', { count: stats.readingMinutes })],
    [t('tasks'), stats.tasksTotal === 0 ? '-' : t('tasksOf', { done: stats.tasksDone, total: stats.tasksTotal })],
    [t('attachments'), nf.format(stats.attachments)],
    [t('created'), fmt.format(new Date(note.created_at))],
    [t('updated'), fmt.format(new Date(note.updated_at))],
  ];
  return (
    <NotesModal title={t('title')} onClose={onClose} closeLabel={t('close')} className="note-info">
      <dl className="note-info-list" data-testid="note-info">
        {rows.map(([k, v]) => (
          <div key={k} className="note-info-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </NotesModal>
  );
}
