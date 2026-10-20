'use client';

import type { CrmTaskFileRow } from '@/lib/db';
import FilesPanel from './FilesPanel';

interface TaskFilesProps {
  taskId: string;
  files: CrmTaskFileRow[];
}

/** Adjuntos de una tarea (la misma lista que usan notas y registros). */
export default function TaskFiles({ taskId, files }: TaskFilesProps) {
  return <FilesPanel endpoint={`/api/crm/tasks/${taskId}/files`} files={files} />;
}
