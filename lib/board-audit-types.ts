/** Board: acciones y forma del registro de actividad (compartido con el cliente). */

export type BoardAuditVia = 'app' | 'api' | 'mcp';

export const BOARD_AUDIT_ACTIONS = [
  'board.created',
  'board.imported',
  'board.renamed',
  'board.duplicated',
  'board.moved',
  'board.trashed',
  'board.restored',
  'board.purged',
  'board.version_restored',
  'access.mode',
  'access.member',
  'access.guest_link',
  'share.link',
  'folder.created',
  'folder.renamed',
  'folder.deleted',
] as const;
export type BoardAuditAction = (typeof BOARD_AUDIT_ACTIONS)[number];

export interface BoardAuditEntry {
  id: string;
  boardId: string | null;
  boardName: string | null;
  actorId: string | null;
  actorName: string | null;
  via: BoardAuditVia;
  action: BoardAuditAction;
  data: Record<string, unknown>;
  createdAt: string;
  /** La pizarra sigue (no está en la papelera ni se borró): se puede abrir. */
  boardAlive?: boolean;
}
