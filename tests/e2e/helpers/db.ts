import { createClient, type Client } from '@libsql/client';

const BUSY_WAIT_MS = 60_000;

/**
 * La base del e2e abierta desde el test (para preparar casos que la interfaz no deja armar, como simular
 * que pasó una hora). La app escribe en el mismo archivo desde otro proceso, así que una escritura del
 * test puede encontrar la base tomada (SQLITE_BUSY).
 *
 * Una sola conexión por proceso de test, que no se cierra. Abrir una por llamada y cerrarla dejaba la base
 * tomada: el close() de libsql no suelta la conexión en el momento (la libera el recolector), y con
 * conexiones así a medio soltar, una que chocó con una escritura de la app quedaba con el lock de escritura.
 * Desde ahí la app respondía 500 por SQLITE_BUSY a toda escritura y el test fallaba igual al minuto
 * (send-sources, robots-parity-2: el usuario nuevo no llegaba a la base). Se reproduce fuera de Playwright
 * con dos procesos: uno que escribe en loop y otro que abre, actualiza y cierra; con una conexión fija, no.
 * `close()` del cliente que devuelve e2eDb() no hace nada: los specs lo siguen llamando sin cerrar la compartida.
 *
 * Se reintenta cediendo el turno, hasta un minuto. No se usa un busy_timeout largo: esa espera es
 * síncrona y congela el proceso del test, que también atiende los servidores falsos a los que la app
 * llama (webhooks, proveedores simulados). Si la app tiene la base tomada mientras espera una de esas
 * respuestas, nadie avanza hasta que vence el plazo y la escritura falla igual.
 */
let shared: Client | null = null;

function open(): Client {
  const client = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const execute = client.execute.bind(client) as (stmt: unknown) => ReturnType<Client['execute']>;
  const ready = (async () => {
    await execute('PRAGMA busy_timeout = 25');
    await execute('PRAGMA journal_mode = WAL');
  })().catch(() => undefined);
  const wrap = <K extends 'execute' | 'batch' | 'executeMultiple' | 'migrate' | 'transaction'>(key: K) => {
    const original = (client[key] as (...args: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<K, unknown>)[key] = async (...args: unknown[]) => {
      await ready;
      const deadline = Date.now() + BUSY_WAIT_MS;
      for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
        try {
          return await original(...args);
        } catch (err) {
          if (!/SQLITE_BUSY|database is locked/i.test(String(err)) || Date.now() >= deadline) throw err;
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

export function e2eDb(): Client {
  shared ??= open();
  // La compartida no se cierra (ver arriba); el resto de la interfaz es la del cliente.
  return new Proxy(shared, {
    get(target, key) {
      if (key === 'close') return () => undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
