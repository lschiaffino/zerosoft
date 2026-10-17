import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewLinkPath, linkTabHref, LINK_TABS, NEW_LINK_ROUTES, parseLinkTab } from '@/lib/link-detail-tabs';

const appDir = join(__dirname, '..', '..', 'app', '[locale]');

describe('pestañas del detalle de un link', () => {
  it('lee ?tab y cae en Resumen si falta o no existe', () => {
    expect(parseLinkTab({})).toBe('overview');
    expect(parseLinkTab({ tab: 'qr' })).toBe('qr');
    expect(parseLinkTab({ tab: 'routing' })).toBe('routing');
    expect(parseLinkTab({ tab: 'nope' })).toBe('overview');
    expect(parseLinkTab({ tab: ['qr', 'settings'] })).toBe('overview');
  });

  it('?edit=1 (links viejos de la tabla) abre Ajustes', () => {
    expect(parseLinkTab({ edit: '1' })).toBe('settings');
    expect(parseLinkTab({ edit: '1', tab: 'qr' })).toBe('qr');
  });

  it('arma hrefs sin ?tab para Resumen y con el resto de la query', () => {
    expect(linkTabHref('abc', 'overview')).toBe('/app/links/abc');
    expect(linkTabHref('abc', 'analytics', { range: '7d', country: undefined })).toBe(
      '/app/links/abc?tab=analytics&range=7d',
    );
    expect(LINK_TABS).toHaveLength(5);
  });
});

describe('una sola entrada para crear', () => {
  it('Un link, En lote e Importar son rutas de "Nuevo" y existen', () => {
    for (const href of Object.values(NEW_LINK_ROUTES)) {
      expect(isNewLinkPath(href), href).toBe(true);
      expect(existsSync(join(appDir, href.slice(1), 'page.tsx')), href).toBe(true);
    }
    expect(isNewLinkPath('/app/links')).toBe(false);
    expect(isNewLinkPath('/app/links/newsletter')).toBe(false);
  });

  it('Dominios tiene su pantalla dentro de Link', () => {
    expect(existsSync(join(appDir, 'app', 'links', 'domains', 'page.tsx'))).toBe(true);
  });
});
