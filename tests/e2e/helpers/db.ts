import { createClient, type Client } from '@libsql/client';

const BUSY_WAIT_MS = 60_000;

/**
 * La base del e2e abierta desde el test (para preparar casos que la interfaz no deja armar, como simular
 * que pasó una hora). La app escribe en el mismo archivo desde otro proceso, así que una escritura del
 * test puede encontrar la base tomada (SQLITE_BUSY).
 *
 * Se reintenta cediendo el turno, hasta un minuto. No se usa un busy_timeout largo: esa espera es
 * síncrona y congela el proceso del test, que también atiende los servidores falsos a los que la app
 * llama (webhooks, proveedores simulados). Si la app tiene la base tomada mientras espera una de esas
 * respuestas, nadie avanza hasta que vence el plazo y la escritura falla igual.
 *
 * Antes de reintentar se abre otra conexión: libsql no resetea la sentencia que falló con BUSY, y con ella
 * "en curso" la escritura del reintento entra sin commit. La base quedaba tomada para la app hasta que el GC
 * del test juntaba la sentencia, y si el test cerraba la conexión antes, la escritura se perdía.
 */
export function e2eDb(): Client {
  const client = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const execute = client.execute.bind(client) as (stmt: unknown) => ReturnType<Client['execute']>;
  const setup = async () => {
    await execute('PRAGMA busy_timeout = 25');
    await execute('PRAGMA journal_mode = WAL');
  };
  let ready = setup().catch(() => undefined);
  const wrap = <K extends 'execute' | 'batch' | 'executeMultiple' | 'migrate' | 'transaction'>(key: K) => {
    const original = (client[key] as (...args: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<K, unknown>)[key] = async (...args: unknown[]) => {
      await ready;
      const start = Date.now();
      const deadline = start + BUSY_WAIT_MS;
      for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
        try {
          const out = await original(...args);
          if (Date.now() - start > 3000) console.log(`[e2e db] ${key} esperó la base ${Date.now() - start}ms: ${JSON.stringify(args[0]).slice(0, 200)}`);
          return out;
        } catch (err) {
          if (!/SQLITE_BUSY|database is locked/i.test(String(err))) throw err;
          ready = client
            .reconnect()
            .then(setup)
            .catch(() => undefined);
          await ready;
          if (Date.now() >= deadline) throw err;
          await new Promise((done) => setTimeout(done, wait));
        }
      }
    };
  };
  wrap('execute');
  wrap('batch');
  wrap('executeMultiple');
  wrap('migrate');
  wrap('transaction');
  return client;
}
