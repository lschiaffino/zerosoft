// Dónde se guardan los tokens: el llavero del sistema si hay, si no un archivo 0600.
// El secreto nunca va en la línea de comandos de otro proceso: `ps` lo mostraría.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVICE = 'zerosoft-cli';

export function configDir() {
  return process.env.ZEROSOFT_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zerosoft');
}

const filePath = () => path.join(configDir(), 'credentials.json');

function run(cmd, args, input) {
  try {
    return spawnSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
  } catch {
    return { status: 1, stdout: '' };
  }
}

function which() {
  if (process.env.ZEROSOFT_NO_KEYCHAIN === '1') return null;
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux' && run('which', ['secret-tool']).status === 0) return 'libsecret';
  return null;
}

const quoted = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

const keychains = {
  macos: {
    // `security -i` lee el comando por stdin: el token no aparece en la lista de procesos.
    set: (acct, value) => run('security', ['-i'], `add-generic-password -U -a ${quoted(acct)} -s ${SERVICE} -w ${quoted(value)}\n`).status === 0,
    get: (acct) => {
      const r = run('security', ['find-generic-password', '-a', acct, '-s', SERVICE, '-w']);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    del: (acct) => run('security', ['delete-generic-password', '-a', acct, '-s', SERVICE]).status === 0,
  },
  libsecret: {
    set: (acct, value) => run('secret-tool', ['store', '--label=zerosoft CLI', 'service', SERVICE, 'account', acct], value).status === 0,
    get: (acct) => {
      const r = run('secret-tool', ['lookup', 'service', SERVICE, 'account', acct]);
      return r.status === 0 && r.stdout ? r.stdout.trim() : null;
    },
    del: (acct) => run('secret-tool', ['clear', 'service', SERVICE, 'account', acct]).status === 0,
  },
};

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeFile(data) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${filePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath());
  fs.chmodSync(filePath(), 0o600);
}

/** Guarda las credenciales de un servidor y dice dónde quedaron. */
export function saveCredentials(baseUrl, creds) {
  const kind = which();
  if (kind && keychains[kind].set(baseUrl, JSON.stringify(creds))) {
    const all = readFile();
    if (all[baseUrl]) {
      delete all[baseUrl];
      writeFile(all);
    }
    return 'keychain';
  }
  const all = readFile();
  all[baseUrl] = creds;
  writeFile(all);
  return filePath();
}

export function loadCredentials(baseUrl) {
  const kind = which();
  if (kind) {
    const raw = keychains[kind].get(baseUrl);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        /* entrada rota: como si no hubiera */
      }
    }
  }
  return readFile()[baseUrl] ?? null;
}

export function deleteCredentials(baseUrl) {
  const kind = which();
  if (kind) keychains[kind].del(baseUrl);
  const all = readFile();
  if (all[baseUrl]) {
    delete all[baseUrl];
    writeFile(all);
  }
}

// El client_id no es secreto: se reusa entre logins para no registrar un cliente por vez.
const clientsPath = () => path.join(configDir(), 'clients.json');

export function savedClientId(baseUrl) {
  try {
    return JSON.parse(fs.readFileSync(clientsPath(), 'utf8'))[baseUrl] ?? null;
  } catch {
    return null;
  }
}

export function saveClientId(baseUrl, clientId) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(clientsPath(), 'utf8'));
  } catch {
    /* primero */
  }
  all[baseUrl] = clientId;
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(clientsPath(), JSON.stringify(all, null, 2), { mode: 0o600 });
}

// Varios comandos en paralelo comparten un solo refresh: gastar dos veces el mismo token revocaría la conexión.
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 20_000;

export async function withRefreshLock(fn) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const lock = path.join(configDir(), 'refresh.lock');
  const started = Date.now();
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx', 0o600));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {
        /* otro lo acaba de soltar */
      }
      if (Date.now() - started > LOCK_WAIT_MS) break; // Mejor intentar que quedarse colgado.
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
