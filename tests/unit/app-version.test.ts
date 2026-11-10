import { describe, expect, it } from 'vitest';
import { isNewBuild } from '@/lib/app-version';

describe('aviso de versión nueva de la web', () => {
  it('avisa solo cuando las dos versiones se conocen y difieren', () => {
    expect(isNewBuild('aaa', 'bbb')).toBe(true);
    expect(isNewBuild('aaa', 'aaa')).toBe(false);
    expect(isNewBuild('', 'bbb')).toBe(false);
    expect(isNewBuild('aaa', '')).toBe(false);
    expect(isNewBuild('aaa', undefined)).toBe(false);
    expect(isNewBuild('aaa', 42)).toBe(false);
  });
});
