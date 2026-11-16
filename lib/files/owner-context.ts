/**
 * Dueño de los archivos que se guardan dentro de un trabajo sin sesión (un
 * import, un webhook, un cron): saveUpload lo toma de acá si quien llama no
 * lo pasa. Server-only.
 *
 *   await runWithFileOwner({ workspaceId: job.workspace_id, userId: job.user_id }, () => adapter.writeStep(...));
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface FileOwnerContext {
  workspaceId: string;
  userId: string | null;
}

const store = new AsyncLocalStorage<FileOwnerContext>();

export function runWithFileOwner<T>(owner: FileOwnerContext, fn: () => Promise<T>): Promise<T> {
  return store.run(owner, fn);
}

export function currentFileOwner(): FileOwnerContext | null {
  return store.getStore() ?? null;
}
