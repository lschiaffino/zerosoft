import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_SCOPES } from '@/lib/api-scopes';

describe('textos de los scopes de la API', () => {
  it.each(['en', 'es', 'pt'])('%s tiene la descripción de cada scope', (locale) => {
    const docs = JSON.parse(readFileSync(`messages/${locale}/pages.json`, 'utf8')).docs as Record<string, string>;
    const missing = [...API_SCOPES].filter((scope) => !docs[`scope_${scope.replace(':', '_')}`]);
    expect(missing).toEqual([]);
  });
});
