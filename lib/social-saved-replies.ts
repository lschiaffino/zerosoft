/**
 * Social: respuestas guardadas de la bandeja (biblioteca, kind 'reply').
 * Al insertarlas se completan dos variables: {name} (el nombre de pila de
 * quien escribió) y {account} (nuestra cuenta). Lo demás queda como está.
 */

export interface SavedReplyVars {
  /** Nombre que muestra la red para quien escribió ("Ana Pérez"). */
  authorName?: string | null;
  /** Nombre de nuestra cuenta en esa red. */
  accountName?: string | null;
}

/** Primer nombre para saludar: "Ana Pérez" → "Ana"; un @handle pierde la arroba. */
export function firstName(name: string | null | undefined): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return first.replace(/^@+/, '');
}

/**
 * Completa {name} y {account} (sin importar mayúsculas). Si falta el dato, la
 * variable se va con el espacio que la precede ("Hola {name}, gracias" →
 * "Hola, gracias"), o con la coma que la sigue si abre la línea.
 */
export function fillSavedReply(body: string, vars: SavedReplyVars): string {
  const values: Record<string, string> = { name: firstName(vars.authorName), account: String(vars.accountName ?? '').trim() };
  return body.replace(/(^|[ \t]?)\{(name|account)\}(, ?)?/gim, (_m, before: string, key: string, tail: string | undefined) => {
    const v = values[key.toLowerCase()];
    if (v) return `${before}${v}${tail ?? ''}`;
    return before ? (tail ?? '') : '';
  });
}
