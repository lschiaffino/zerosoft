'use client';

import { useTranslations } from 'next-intl';
import { HUBSPOT_LEGACY_APPS_DOCS, HUBSPOT_SERVICE_KEYS_DOCS, hubspotScopeKey } from '@/lib/hubspot/scopes';

/**
 * HubSpot: lo que comparten las pantallas que piden una clave (Lines ›
 * Integraciones y el importador del CRM): de dónde sale la clave en cada caso
 * (cuenta que tiene que crear una service key, cuenta que ya tiene una
 * private app), qué puede hacer la clave conectada y qué permisos le faltan,
 * en palabras. Textos en messages/<locale>/common.json › hubspot.
 */

type Kind = 'service_key' | 'private_app' | 'unknown';

/** Un permiso en palabras, con su nombre de HubSpot al lado (el que hay que tildar). */
export function useHubspotScopeText(): (scope: string) => string {
  const t = useTranslations('common.hubspot');
  return (scope) => {
    const key = hubspotScopeKey(scope);
    return key ? t('scopeWithName', { label: t(`scopes.${key}`), scope }) : scope;
  };
}

export function HubspotScopeList({ scopes, testId }: { scopes: readonly string[]; testId?: string }) {
  const t = useTranslations('common.hubspot');
  return (
    <ul className="hs-key-scopes" data-testid={testId}>
      {scopes.map((s) => {
        const key = hubspotScopeKey(s);
        return (
          <li key={s}>
            {key && <span>{t(`scopes.${key}`)}</span>}
            <code>{s}</code>
          </li>
        );
      })}
    </ul>
  );
}

/** Los dos caminos para conseguir la clave. Cerrados por defecto: cada cuenta abre el suyo. */
export function HubspotKeyHelp() {
  const t = useTranslations('common.hubspot.key');
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
  return (
    <div className="hs-key-help" data-testid="hubspot-key-help">
      <p className="ui-help">{t('intro')}</p>
      <details className="hs-key-case" data-testid="hubspot-key-new">
        <summary>{t('newTitle')}</summary>
        <p className="ui-help">{t('newNote')}</p>
        <ol>
          {(['1', '2', '3', '4'] as const).map((n) => (
            <li key={n}>{t(`new.${n}`)}</li>
          ))}
        </ol>
        <p className="ui-help">{link(HUBSPOT_SERVICE_KEYS_DOCS, t('newDocs'))}</p>
      </details>
      <details className="hs-key-case" data-testid="hubspot-key-legacy">
        <summary>{t('legacyTitle')}</summary>
        <ol>
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n}>{t(`legacy.${n}`)}</li>
          ))}
        </ol>
        <p className="ui-help">{t('legacyNote')}</p>
        <p className="ui-help">{link(HUBSPOT_LEGACY_APPS_DOCS, t('legacyDocs'))}</p>
      </details>
    </div>
  );
}

/** La clave conectada: a qué cuenta entra, de qué tipo es, qué puede hacer y qué todavía no. */
export function HubspotKeySummary({ portalId, kind, scopes, missing }: { portalId: string; kind: Kind; scopes: readonly string[]; missing: readonly string[] }) {
  const t = useTranslations('common.hubspot');
  const known = scopes.filter((s) => hubspotScopeKey(s));
  return (
    <div className="hs-key-summary" data-testid="hubspot-key-summary" data-kind={kind}>
      <p className="hs-key-account">
        <strong data-testid="hubspot-key-portal">{t('account', { id: portalId })}</strong>
        <span className="ui-help">{t(`kind.${kind}`)}</span>
      </p>
      {known.length > 0 && (
        <div>
          <p className="label">{t('can')}</p>
          <HubspotScopeList scopes={known} testId="hubspot-key-can" />
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <p className="label">{t('cannot')}</p>
          <HubspotScopeList scopes={missing} testId="hubspot-key-cannot" />
        </div>
      )}
    </div>
  );
}

/** El error al conectar con una clave a la que le faltan permisos obligatorios. */
export function HubspotMissingScopes({ scopes }: { scopes: readonly string[] }) {
  const t = useTranslations('common.hubspot');
  return (
    <div className="hs-key-missing" role="alert" data-testid="hubspot-key-missing">
      <p className="ui-error">{t('missingTitle')}</p>
      <HubspotScopeList scopes={scopes} />
      <p className="ui-help">{t('missingHelp')}</p>
    </div>
  );
}
