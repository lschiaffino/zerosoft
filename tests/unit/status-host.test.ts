import { describe, expect, it } from 'vitest';
import { surfaceForHost, surfaceRewritePath } from '@/lib/host-rewrite';

describe('status.zerosoft.ai', () => {
  it('el host sirve /<locale>/status', () => {
    expect(surfaceForHost('status.zerosoft.ai')).toBe('status');
    expect(surfaceForHost('status.localhost:3000')).toBe('status');
    expect(surfaceForHost('zerosoft.ai')).toBeNull();
    expect(surfaceRewritePath('status', '/', 'es')).toEqual({ path: '/es/status', locale: 'es' });
    expect(surfaceRewritePath('status', '/pt', 'en')).toEqual({ path: '/pt/status', locale: 'pt' });
  });
});
