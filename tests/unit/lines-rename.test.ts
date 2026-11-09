import { describe, expect, it } from 'vitest';
import { PRODUCT_CONFIG, appFromPath, productHref, productKeyFromSlug, productSlug } from '@/lib/products';
import nextConfig from '../../next.config.mjs';

/** Groups pasó a llamarse Lines: la clave `groups` queda interna y las URLs públicas usan el nombre nuevo. */
describe('Groups ahora es Lines', () => {
  it('nombre, entrada y página del sitio con el nombre nuevo', () => {
    expect(PRODUCT_CONFIG.groups.name).toBe('Lines');
    expect(PRODUCT_CONFIG.groups.launch).toBe('/app/lines');
    expect(productSlug('groups')).toBe('lines');
    expect(productHref('groups')).toBe('/products/lines');
    expect(productKeyFromSlug('lines')).toBe('groups');
    // La clave vieja ya no es un slug: /products/groups redirige antes de llegar a la página.
    expect(productKeyFromSlug('groups')).toBeNull();
    expect(productHref('crm')).toBe('/products/crm');
    expect(productKeyFromSlug('crm')).toBe('crm');
  });

  it('los permisos siguen viendo la app en la ruta nueva, en la API y en links viejos guardados', () => {
    expect(appFromPath('/es/app/lines/inbox/abc')).toBe('groups');
    expect(appFromPath('/app/lines/settings')).toBe('groups');
    expect(appFromPath('/api/groups/chats')).toBe('groups');
    expect(appFromPath('/app/groups/inbox/abc')).toBe('groups');
  });

  it('las URLs viejas redirigen para siempre, con y sin idioma, y la API no se toca', async () => {
    const redirects = await (nextConfig as { redirects: () => Promise<{ source: string; destination: string; permanent: boolean }[]> }).redirects();
    const find = (source: string) => redirects.find((r) => r.source === source);
    expect(find('/:locale(en|es|pt)/app/groups/:path*')).toMatchObject({ destination: '/:locale/app/lines/:path*', permanent: true });
    expect(find('/:locale(en|es|pt)/app/groups')).toMatchObject({ destination: '/:locale/app/lines', permanent: true });
    expect(find('/app/groups/:path*')).toMatchObject({ destination: '/app/lines/:path*', permanent: true });
    expect(find('/:locale(en|es|pt)/products/groups')).toMatchObject({ destination: '/:locale/products/lines', permanent: true });
    expect(redirects.some((r) => r.source.includes('/api/'))).toBe(false);
  });
});
