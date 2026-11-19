import { describe, expect, it } from 'vitest';
import { HubspotApiError } from '@/lib/hubspot/client';
import { seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { hubspotScopeKey, scopesFromErrorCode, HUBSPOT_KNOWN_SCOPES } from '@/lib/hubspot/scopes';
import { inspectHubspotToken, looksLikeHubspotToken, missingHubspotScopes, openHubspotToken, sealHubspotToken } from '@/lib/hubspot/token';
import en from '@/messages/en/common.json';
import es from '@/messages/es/common.json';
import pt from '@/messages/pt/common.json';

/**
 * Validación de la clave de HubSpot (lib/hubspot/token.ts): una private app
 * heredada y una service key, los permisos que faltan, la clave que HubSpot
 * no acepta y el guardado cifrado. Contra la cuenta falsa.
 */

const PRIVATE = 'pat-na1-legacy-app-token';
const SERVICE = 'pat-na1-svc-key';
const LINES_SCOPES = ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.schemas.companies.read', 'crm.objects.owners.read', 'crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'];

const inspect = (portal: FakeHubspotPortal, token: string, probe: readonly string[] = LINES_SCOPES) => inspectHubspotToken(token, { fetch: portal.fetch, budget: null, probe });

describe('validar la clave', () => {
  it('private app heredada: cuenta, permisos de la info del token y tipo', async () => {
    const portal = seedSyncPortal();
    const info = await inspect(portal, PRIVATE);
    expect(info).toMatchObject({ portalId: '515151', uiDomain: 'app.hubspot.com', kind: 'private_app', scopesFrom: 'token_info' });
    expect(info.scopes).toEqual(expect.arrayContaining(LINES_SCOPES));
    // Dos llamadas: la info del token y los datos de la cuenta. No se prueba ningún permiso.
    expect(portal.calls.map((c) => c.path)).toEqual(['/oauth/v2/private-apps/get/access-token-info', '/account-info/v3/details']);
  });

  it('service key sin consulta de permisos: la cuenta sale de account-info y cada permiso se prueba', async () => {
    const portal = seedSyncPortal();
    const info = await inspect(portal, SERVICE);
    expect(info).toMatchObject({ portalId: '515151', kind: 'service_key', scopesFrom: 'probe' });
    expect(info.scopes).toEqual(LINES_SCOPES);
    // Los permisos de escritura se prueban con un PATCH sin propiedades al id 0: no cambia nada.
    const writes = portal.calls.filter((c) => c.method === 'PATCH');
    expect(writes.map((c) => c.path)).toEqual(['/crm/v3/objects/contacts/0', '/crm/v3/objects/companies/0', '/crm/v3/objects/deals/0']);
    expect(writes.every((c) => JSON.stringify(c.body) === '{"properties":{}}')).toBe(true);
    expect(portal.calls.some((c) => c.method === 'POST' && c.path.startsWith('/crm/v3/objects'))).toBe(false);
  });

  it('service key cuando HubSpot sí informa sus permisos: no hace falta probar', async () => {
    const portal = seedSyncPortal();
    portal.serviceKeyTokenInfo = 'supported';
    const info = await inspect(portal, SERVICE);
    expect(info).toMatchObject({ kind: 'service_key', scopesFrom: 'token_info', portalId: '515151' });
    expect(portal.calls).toHaveLength(2);
  });

  it('a una service key de solo lectura le faltan los permisos de escritura', async () => {
    const portal = seedSyncPortal();
    const info = await inspect(portal, 'pat-na1-svc-readonly');
    expect(info.kind).toBe('service_key');
    expect(missingHubspotScopes(info.scopes, LINES_SCOPES)).toEqual(['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write']);
  });

  it('una clave con un solo permiso: dice cuáles faltan, con cualquiera de los dos tipos', async () => {
    const portal = seedSyncPortal();
    const need = ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.schemas.companies.read'];
    const legacy = await inspect(portal, 'pat-na1-noscope', need);
    expect(missingHubspotScopes(legacy.scopes, need)).toEqual(['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.schemas.companies.read']);
    const key = await inspect(portal, 'pat-na1-svc-noscope', need);
    expect(key.scopesFrom).toBe('probe');
    expect(missingHubspotScopes(key.scopes, need)).toEqual(['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.schemas.companies.read']);
  });

  it('si la info del token no nombra un permiso, manda lo que responde su endpoint (cuando se pide verificar)', async () => {
    const portal = seedSyncPortal();
    // Una clave vieja: puede leer dueños, pero su lista de permisos no lo dice.
    portal.grant = () => ({ kind: 'private_app', scopes: LINES_SCOPES, reported: LINES_SCOPES.filter((s) => s !== 'crm.objects.owners.read' && s !== 'crm.objects.deals.write') });
    const plain = await inspect(portal, PRIVATE);
    expect(plain.scopes).not.toContain('crm.objects.owners.read');
    const checked = await inspectHubspotToken(PRIVATE, { fetch: portal.fetch, budget: null, probe: LINES_SCOPES, verifyMissing: true });
    expect(checked.scopesFrom).toBe('token_info');
    expect(checked.scopes).toEqual(expect.arrayContaining(['crm.objects.owners.read', 'crm.objects.deals.write']));
    // Y el que de verdad falta (403 en su endpoint) sigue faltando.
    portal.grant = () => ({ kind: 'private_app', scopes: LINES_SCOPES.filter((s) => s !== 'crm.objects.owners.read') });
    const lacking = await inspectHubspotToken(PRIVATE, { fetch: portal.fetch, budget: null, probe: LINES_SCOPES, verifyMissing: true });
    expect(missingHubspotScopes(lacking.scopes, LINES_SCOPES)).toEqual(['crm.objects.owners.read']);
  });

  it('una clave que HubSpot no acepta es `auth`, también si responde 400 por la forma', async () => {
    const portal = seedSyncPortal();
    await expect(inspect(portal, 'not-a-hubspot-key')).rejects.toMatchObject({ code: 'auth' });
    await expect(inspect(portal, 'has spaces')).rejects.toMatchObject({ code: 'auth' });
    expect(portal.calls.filter((c) => c.path !== '/oauth/v2/private-apps/get/access-token-info' && c.path !== '/account-info/v3/details')).toEqual([]);
    const malformed = async (url: string) => new Response(JSON.stringify({ message: 'Invalid request' }), { status: url.includes('access-token-info') ? 404 : 400 });
    await expect(inspectHubspotToken('weird-token', { fetch: malformed, budget: null })).rejects.toMatchObject({ code: 'auth' });
  });

  it('si HubSpot no responde o limita, no se da la clave por mala', async () => {
    const portal = seedSyncPortal();
    portal.fail(429, 5);
    await expect(inspect(portal, SERVICE)).rejects.toMatchObject({ code: 'rate_limited' });
    const down = async () => {
      throw new Error('offline');
    };
    await expect(inspectHubspotToken(PRIVATE, { fetch: down, budget: null })).rejects.toMatchObject({ code: 'network' });
  });

  it('una falla pasajera de la info del token no cambia el tipo a service key', async () => {
    const portal = seedSyncPortal();
    portal.fail(500, 1, { path: 'access-token-info' });
    const info = await inspect(portal, PRIVATE);
    expect(info).toMatchObject({ kind: 'unknown', scopesFrom: 'probe', portalId: '515151' });
  });

  it('el error de validación no lleva la clave', async () => {
    const portal = seedSyncPortal();
    const err = (await inspect(portal, 'pat-na1-svc-noscope-secret-9', []).then(
      () => null,
      (e) => e,
    )) as HubspotApiError | null;
    expect(err).toBeNull();
    const bad = (await inspect(portal, 'secret-key-that-is-wrong').catch((e) => e)) as HubspotApiError;
    expect(`${bad.message} ${JSON.stringify(bad)} ${bad.stack ?? ''}`).not.toContain('secret-key-that-is-wrong');
  });

  it('la forma mínima de una clave', () => {
    expect(looksLikeHubspotToken('pat-na1-abc')).toBe(true);
    expect(looksLikeHubspotToken('')).toBe(false);
    expect(looksLikeHubspotToken('a b')).toBe(false);
    expect(looksLikeHubspotToken('x'.repeat(401))).toBe(false);
    expect(looksLikeHubspotToken(null)).toBe(false);
  });
});

describe('guardado cifrado', () => {
  it('la clave se guarda cifrada y se vuelve a abrir', () => {
    const sealed = sealHubspotToken(SERVICE);
    expect(sealed).not.toContain(SERVICE);
    expect(sealed.startsWith('enc:')).toBe(true);
    expect(openHubspotToken(sealed)).toBe(SERVICE);
    expect(openHubspotToken('')).toBe('');
    expect(openHubspotToken('enc:v1:broken')).toBe('');
  });
});

describe('permisos en palabras', () => {
  it('cada permiso conocido tiene su texto en los tres idiomas', () => {
    for (const scope of HUBSPOT_KNOWN_SCOPES) {
      const key = hubspotScopeKey(scope)!;
      for (const messages of [en, es, pt]) {
        const text = (messages.hubspot.scopes as Record<string, string>)[key];
        expect(text, `${scope}`).toBeTruthy();
        expect(text).not.toContain(scope);
      }
    }
    expect(hubspotScopeKey('tickets')).toBeNull();
  });

  it('los permisos que faltan salen del código de error', () => {
    expect(scopesFromErrorCode('hubspot_missing_scopes:crm.objects.companies.read crm.objects.deals.read')).toEqual(['crm.objects.companies.read', 'crm.objects.deals.read']);
    expect(scopesFromErrorCode('hubspot_missing_scopes')).toEqual([]);
    expect(scopesFromErrorCode('x:<script>alert(1)</script>')).toEqual([]);
  });
});
