// Login OAuth 2.1 de la CLI: navegador con redirect a loopback, o código de dispositivo sin navegador.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { saveClientId, savedClientId } from './credentials.mjs';

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } }).catch((e) => {
    throw new CliError(`Could not reach ${url}: ${e.message}`, 1);
  });
  if (!res.ok) throw new CliError(`${url} answered ${res.status}.`, 1);
  return res.json();
}

/** Descubrimiento como manda MCP: recurso protegido, después su servidor de autorización. */
export async function discover(baseUrl) {
  const resource = await getJson(`${baseUrl}/.well-known/oauth-protected-resource/api/mcp`);
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new CliError('The server does not name an authorization server.');
  if (new URL(issuer).origin !== new URL(baseUrl).origin) throw new CliError(`Refusing to sign in at ${issuer}: it is not ${baseUrl}.`);
  const meta = await getJson(`${issuer}/.well-known/oauth-authorization-server`);
  if (meta.issuer !== issuer) throw new CliError('The authorization server metadata does not match its issuer.');
  return { resource: resource.resource, issuer, meta };
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function registerClient(baseUrl, meta, redirectUri) {
  const known = savedClientId(baseUrl);
  if (known) {
    // ¿El servidor lo sigue conociendo? Un refresh inventado distingue cliente borrado (401) de token malo (400).
    const probe = await postForm(meta.token_endpoint, { grant_type: 'refresh_token', client_id: known, refresh_token: 'probe' });
    if (probe.status !== 401) return known;
  }
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'zerosoft CLI',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token', DEVICE_GRANT],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_id) throw new CliError(`Could not register the CLI: ${data.error_description ?? res.status}.`);
  saveClientId(baseUrl, data.client_id);
  return data.client_id;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* la URL ya se imprimió */
  }
}

const PAGE = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 16px"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p>`;

/** Abre el navegador y espera el redirect en 127.0.0.1, en un puerto que elige el sistema. */
export async function browserLogin({ baseUrl, scope, log, open = true, timeoutMs = 300_000 }) {
  const { resource, issuer, meta } = await discover(baseUrl);
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  try {
    const clientId = await registerClient(baseUrl, meta, redirectUri);
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope,
      state,
      resource,
    }).toString();

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CliError('Timed out waiting for the browser. Try `zerosoft login --device`.', 3)), timeoutMs);
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirectUri);
        if (q.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const finish = (ok, title, body, value) => {
          res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE(title, body));
          clearTimeout(timer);
          if (ok) resolve(value);
          else reject(new CliError(value, 3));
        };
        // state e iss antes de mirar nada más (RFC 9207: el iss se compara tal cual).
        if (q.searchParams.get('state') !== state) return finish(false, 'Sign-in failed', 'The response did not match this login.', 'The state did not match. Try again.');
        const iss = q.searchParams.get('iss');
        if (meta.authorization_response_iss_parameter_supported && iss !== issuer) return finish(false, 'Sign-in failed', 'The response came from another server.', 'The issuer did not match. Try again.');
        const err = q.searchParams.get('error');
        if (err) return finish(false, 'Sign-in cancelled', 'You can close this page.', err === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${err}.`);
        const value = q.searchParams.get('code');
        if (!value) return finish(false, 'Sign-in failed', 'No code came back.', 'No authorization code came back.');
        finish(true, 'You are signed in', 'You can close this page and go back to your terminal.', value);
      });
      log(`Opening your browser to sign in. If it does not open, visit:\n${url}\n`);
      if (open) openBrowser(url.toString());
    });

    const { status, data } = await postForm(meta.token_endpoint, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    });
    if (status !== 200) throw new CliError(`Sign-in failed: ${data.error_description ?? data.error ?? status}.`, 3);
    return toCreds(data, clientId, meta);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

/** Sin navegador en esta máquina: muestra un código para aprobar en cualquier otro lado. */
export async function deviceLogin({ baseUrl, scope, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const { resource, meta } = await discover(baseUrl);
  // El registro necesita un redirect aunque este flujo no lo use.
  const clientId = await registerClient(baseUrl, meta, 'http://127.0.0.1/callback');
  const started = await postForm(meta.device_authorization_endpoint, { client_id: clientId, scope, resource });
  if (started.status !== 200) throw new CliError(`Could not start the device login: ${started.data.error ?? started.status}.`, 3);
  const d = started.data;
  log(`On any device, open:\n  ${d.verification_uri}\nand enter this code:\n  ${d.user_code}\n`);
  let interval = (d.interval ?? 5) * 1000;
  const deadline = Date.now() + (d.expires_in ?? 600) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { status, data } = await postForm(meta.token_endpoint, { grant_type: DEVICE_GRANT, client_id: clientId, device_code: d.device_code });
    if (status === 200) return toCreds(data, clientId, meta);
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (data.error === 'access_denied') throw new CliError('Sign-in was cancelled.', 3);
    throw new CliError(`Sign-in failed: ${data.error_description ?? data.error ?? status}.`, 3);
  }
  throw new CliError('The code expired. Run `zerosoft login --device` again.', 3);
}

function toCreds(data, clientId, meta) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope,
    clientId,
    tokenEndpoint: meta.token_endpoint,
    revocationEndpoint: meta.revocation_endpoint,
  };
}

/**
 * Rota el refresh token. El viejo queda gastado: hay que guardar el nuevo enseguida.
 * null solo si el servidor dijo invalid_grant. Un 429, un 5xx o la red no borran
 * nada: son reintentables.
 */
export async function refresh(creds, resource) {
  let res;
  try {
    res = await postForm(creds.tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      refresh_token: creds.refreshToken,
      resource,
    });
  } catch (e) {
    throw new CliError(`Could not reach the server to renew the session: ${e.message}. Try again.`, 1);
  }
  const { status, data } = res;
  if (status === 200) {
    return { ...creds, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, scope: data.scope };
  }
  if (data.error === 'invalid_grant') return null;
  throw new CliError(`Could not renew the session (${data.error ?? status}). You are still signed in: try again.`, status === 429 ? 5 : 1);
}

/** true si el servidor confirmó la revocación. */
export async function revoke(creds) {
  if (!creds.revocationEndpoint || !creds.refreshToken) return false;
  try {
    const { status } = await postForm(creds.revocationEndpoint, { token: creds.refreshToken, client_id: creds.clientId });
    return status === 200;
  } catch {
    return false;
  }
}
