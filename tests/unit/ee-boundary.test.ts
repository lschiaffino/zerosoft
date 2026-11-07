import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViolations, isForbiddenEeImport, resolveSpecifier, specifiers } from '../../scripts/check-ee-boundary';

const root = join(__dirname, '..', '..');

describe('ee/ boundary', () => {
  it('finds import specifiers in every form', () => {
    // Built from pieces so this test file doesn't trip the check itself.
    const ee = 'ee';
    const src = [
      "import { a } from '@/ee/lib/license';",
      'import {\n  b,\n  c,\n} from "../ee/sso";',
      "export { d } from './x';",
      "import './side-effect';",
      `const e = await import('@/${ee}/audit');`,
      `const f = require('../../${ee}/roles');`,
    ].join('\n');
    expect(specifiers(src).sort()).toEqual(['../../ee/roles', '../ee/sso', './side-effect', './x', '@/ee/audit', '@/ee/lib/license'].sort());
  });

  it('allows only ee/lib/license from core', () => {
    const file = join(root, 'lib', 'auth.ts');
    expect(isForbiddenEeImport(resolveSpecifier('@/ee/lib/license', file, root)!)).toBe(false);
    expect(isForbiddenEeImport(resolveSpecifier('../ee/lib/license.ts', file, root)!)).toBe(false);
    expect(isForbiddenEeImport(resolveSpecifier('@/ee/sso/saml', file, root)!)).toBe(true);
    expect(isForbiddenEeImport(resolveSpecifier('../ee', file, root)!)).toBe(true);
    expect(isForbiddenEeImport(resolveSpecifier('./eel', file, root)!)).toBe(false);
    expect(resolveSpecifier('next/link', file, root)).toBeNull();
  });

  it('passes on the repository', () => {
    expect(findViolations(root)).toEqual([]);
  });
});
