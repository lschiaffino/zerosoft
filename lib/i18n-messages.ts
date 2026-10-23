// Recorte y mezcla de mensajes i18n para mandar al cliente solo lo que usa
// cada ruta (ver components/i18n/ClientMessages.tsx). Los server components
// siguen leyendo todos los namespaces con getTranslations.

export type MessageTree = { [key: string]: string | MessageTree };

function isTree(v: unknown): v is MessageTree {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Subárbol de `all` con las rutas pedidas: 'crm' trae el namespace entero y
 * 'crm.formsPublic' solo esa rama (con sus padres). Una ruta que no existe se
 * ignora.
 */
export function pickMessages(all: MessageTree, paths: readonly string[]): MessageTree {
  let out: MessageTree = {};
  for (const p of paths) {
    const parts = p.split('.');
    let node: unknown = all;
    for (const part of parts) node = isTree(node) ? node[part] : undefined;
    if (node === undefined) continue;
    let branch: string | MessageTree = node as string | MessageTree;
    for (let i = parts.length - 1; i >= 0; i--) branch = { [parts[i]]: branch };
    out = mergeMessages(out, branch as MessageTree);
  }
  return out;
}

/** Mezcla profunda: `b` agrega ramas a `a` sin pisar hermanos. Devuelve un objeto nuevo. */
export function mergeMessages(a: MessageTree, b: MessageTree): MessageTree {
  const out: MessageTree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = isTree(prev) && isTree(v) ? mergeMessages(prev, v) : v;
  }
  return out;
}
