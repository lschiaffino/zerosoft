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

/** Dónde se crea cada tipo de clave y la documentación oficial. */
export const HUBSPOT_SERVICE_KEYS_DOCS = 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys';
export const HUBSPOT_LEGACY_APPS_DOCS = 'https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview';
