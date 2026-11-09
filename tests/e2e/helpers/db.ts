import { createClient, type Client } from '@libsql/client';

/**
 * La base del e2e abierta desde el test (para preparar casos que la interfaz no deja armar, como simular
 * que pasó una hora). La app escribe en el mismo archivo desde otro proceso: sin busy_timeout, una
 * escritura del test que coincide con una de la app falla al instante con SQLITE_BUSY. Con WAL (lo
 * deja la app al migrar) las lecturas no se bloquean y las escrituras esperan su turno hasta 15 s.
 * Esperar acá es síncrono, pero frena solo al proceso del test, no al servidor.
 */
export function e2eDb(): Client {
  const client = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const execute = client.execute.bind(client) as (stmt: unknown) => ReturnType<Client['execute']>;
  const ready = (async () => {
    await execute('PRAGMA busy_timeout = 15000');
    await execute('PRAGMA journal_mode = WAL');
  })();
  const wrap = <K extends 'execute' | 'batch' | 'executeMultiple' | 'migrate' | 'transaction'>(key: K) => {
    const original = (client[key] as (...args: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<K, unknown>)[key] = async (...args: unknown[]) => {
      await ready;
      return original(...args);
    };
  };
  wrap('execute');
  wrap('batch');
  wrap('executeMultiple');
  wrap('migrate');
  wrap('transaction');
  return client;
}
