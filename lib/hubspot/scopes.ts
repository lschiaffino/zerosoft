/**
 * HubSpot: los permisos (scopes) que usa cada función, con la clave del texto
 * que los explica en palabras simples (messages/<locale>/common.json ›
 * hubspot.scopes). Datos puros: sirve en cliente y servidor.
 */

/** Permisos con texto propio. Uno que no esté acá se muestra con su nombre de HubSpot. */
export const HUBSPOT_KNOWN_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
  'crm.lists.read',
  'sales-email-read',
] as const;

/** `crm.objects.contacts.read` → `crm_objects_contacts_read` (next-intl parte las claves en los puntos). */
export function hubspotScopeKey(scope: string): string | null {
  return (HUBSPOT_KNOWN_SCOPES as readonly string[]).includes(scope) ? scope.replace(/[.-]/g, '_') : null;
}

/** Los permisos que vienen en un código de error `…missing_scopes:a b c`. */
export function scopesFromErrorCode(code: string | undefined | null): string[] {
  const at = (code ?? '').indexOf(':');
  if (at < 0) return [];
  return (code ?? '')
    .slice(at + 1)
    .split(/[\s,]+/)
    .filter((s) => /^[a-z0-9._-]{3,80}$/i.test(s))
    .slice(0, 30);
}

/** Permisos de escritura para dejar notas: la nota se asocia a registros de cualquiera de los tres tipos. */
const NOTE_WRITE_SCOPES = ['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'] as const;

/**
 * El permiso que falta cuando HubSpot responde 403 a este pedido, o null si
 * no se puede saber. `have` son los permisos que Lines tiene guardados para la
 * clave: para una nota se nombra el primero de escritura que no figura ahí.
 */
export function hubspotScopeForRequest(method: string, path: string, have: readonly string[] = []): string | null {
  const p = (path.split('?')[0] ?? '').replace(/\/+$/, '');
  const read = method.toUpperCase() === 'GET' || /\/(search|batch\/read)$/.test(p);
  if (/^\/crm\/v[34]\/objects\/notes(\/|$)/.test(p)) {
    if (read) return null;
    return NOTE_WRITE_SCOPES.find((s) => !have.includes(s)) ?? null;
  }
  let m = /^\/crm\/v[34]\/objects\/(contacts|companies|deals)(\/|$)/.exec(p);
  if (m) return `crm.objects.${m[1]}.${read ? 'read' : 'write'}`;
  m = /^\/crm\/v3\/properties\/(contacts|companies|deals)(\/|$)/.exec(p);
  if (m) return `crm.schemas.${m[1]}.read`;
  if (/^\/crm\/v3\/owners(\/|$)/.test(p)) return 'crm.objects.owners.read';
  return null;
}

/** Dónde se crea cada tipo de clave y la documentación oficial. */
export const HUBSPOT_SERVICE_KEYS_DOCS = 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys';
export const HUBSPOT_LEGACY_APPS_DOCS = 'https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview';
