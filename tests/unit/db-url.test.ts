import { describe, expect, it } from 'vitest';
import { databaseUrl, LOCAL_DB_PATH } from '../../lib/db-url';

describe('databaseUrl', () => {
  it('usa el archivo local cuando la variable no está', () => {
    expect(databaseUrl({})).toBe(`file:${LOCAL_DB_PATH}`);
  });

  it('usa el archivo local cuando la variable está vacía, como en .env.example', () => {
    expect(databaseUrl({ TURSO_DATABASE_URL: '' })).toBe(`file:${LOCAL_DB_PATH}`);
    expect(databaseUrl({ TURSO_DATABASE_URL: '   ' })).toBe(`file:${LOCAL_DB_PATH}`);
  });

  it('respeta una URL configurada', () => {
    expect(databaseUrl({ TURSO_DATABASE_URL: 'libsql://x.turso.io' })).toBe('libsql://x.turso.io');
    expect(databaseUrl({ TURSO_DATABASE_URL: 'file:/tmp/e2e.db' })).toBe('file:/tmp/e2e.db');
  });
});
