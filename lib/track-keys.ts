/**
 * Track — atajos con modificador para un issue (página del issue y barra de
 * selección de la lista), los mismos que Linear:
 * - ⌘⌫ / Ctrl+Backspace (o Delete): borrar.
 * - ⌘⇧, / Ctrl+Shift+,: copiar el link.
 * Sin dependencias: lo importan los componentes y los tests.
 */
export type IssueKeyAction = 'delete' | 'copyLink';

interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function issueKeyAction(e: KeyLike): IssueKeyAction | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return null;
  if (!e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) return 'delete';
  // Con Shift, "," puede llegar como "<" según el teclado: se mira también el code.
  if (e.shiftKey && (e.key === ',' || e.key === '<' || e.code === 'Comma')) return 'copyLink';
  return null;
}

/** Texto del atajo para mostrar en un menú (⌘ en Mac, Ctrl en el resto). */
export function issueKeyHint(action: IssueKeyAction, mac: boolean): string {
  if (action === 'delete') return mac ? '⌘⌫' : 'Ctrl+Backspace';
  return mac ? '⌘⇧,' : 'Ctrl+Shift+,';
}
