/**
 * Fleet: fetch hacia GitHub y Vercel. Con FLEET_FAKE=1 y un token que empieza con "fake", responde lib/fleet/fake.ts
 * (las mismas formas que las APIs reales) y nada sale a internet: lo usan los e2e y el modo offline.
 * Server-only.
 */
export function fleetFake(): boolean {
  return process.env.FLEET_FAKE === '1' || process.env.FLEET_FAKE === 'true';
}

function bearer(init: RequestInit): string {
  const h = new Headers(init.headers);
  return (h.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
}

export async function fleetFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (fleetFake() && bearer(init).startsWith('fake')) {
    const { fakeResponse } = await import('./fake');
    return fakeResponse(url, init);
  }
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000), cache: 'no-store' });
}
