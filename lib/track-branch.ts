/**
 * Nombre de branch sugerido para un issue: zer-123-arreglar-el-login.
 * Función pura (sin imports de server) para poder usarla en el cliente.
 */
export function branchNameFor(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-$/, '');
  const id = identifier.toLowerCase();
  return slug ? `${id}-${slug}` : id;
}
