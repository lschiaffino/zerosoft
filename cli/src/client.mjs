// Cliente MCP mínimo sobre HTTP: la CLI no tiene otro camino al servidor que el del modelo.
import { deleteCredentials, loadCredentials, saveCredentials } from './credentials.mjs';
import { CliError, refresh } from './oauth.mjs';

const PROTOCOL = '2025-11-25';
const SKEW_MS = 60_000;

export function baseUrlFrom(flag) {
  const raw = (flag || process.env.ZEROSOFT_URL || 'https://zerosoft.ai').replace(/\/+$/, '');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new CliError(`Invalid URL: ${raw}`, 2);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new CliError('The server URL must be https (or http on localhost).', 2);
  return u.origin;
}

export class McpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.endpoint = `${baseUrl}/api/mcp`;
    this.nextId = 1;
    this.apiKey = process.env.ZEROSOFT_API_KEY || null;
  }

  async token(force = false) {
    if (this.apiKey) return this.apiKey;
    const creds = loadCredentials(this.baseUrl);
    if (!creds) throw new CliError('You are not signed in. Run `zerosoft login`.', 3);
    if (!force && creds.expiresAt - SKEW_MS > Date.now()) return creds.accessToken;
    const next = await refresh(creds, this.endpoint);
    if (!next) {
      deleteCredentials(this.baseUrl);
      throw new CliError('Your session ended. Run `zerosoft login` again.', 3);
    }
    saveCredentials(this.baseUrl, next);
    return next.accessToken;
  }

  async rpc(method, params, retried = false) {
    const token = await this.token(retried);
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
      });
    } catch (e) {
      throw new CliError(`Could not reach ${this.baseUrl}: ${e.message}`, 1);
    }
    if (res.status === 401) {
      if (!retried && !this.apiKey) return this.rpc(method, params, true);
      throw new CliError(this.apiKey ? 'The API key was rejected.' : 'Your session ended. Run `zerosoft login` again.', 3);
    }
    if (res.status === 429) throw new CliError('Too many requests. Try again in a minute.', 5);
    const body = await res.json().catch(() => null);
    if (!body) throw new CliError(`The server answered ${res.status} without JSON.`, 1);
    if (body.error) throw new CliError(body.error.message ?? 'Server error.', 1);
    return body.result;
  }

  /** Llama una herramienta y devuelve su JSON. Los errores de herramienta se vuelven CliError con su código. */
  async tool(name, args = {}) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const text = result?.content?.[0]?.text ?? '';
    if (result?.structuredContent) return { result: result.structuredContent, isError: Boolean(result.isError) };
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (result?.isError) throw toolError(parsed);
    return { result: parsed, isError: false };
  }
}

const EXIT_BY_ERROR = {
  invalid_arguments: 2,
  insufficient_scope: 4,
  app_not_available: 4,
  workspace_access_lost: 4,
  confirmation_required: 2,
  not_found: 4,
  rate_limited: 5,
};

function toolError(parsed) {
  if (parsed && typeof parsed === 'object') {
    const err = new CliError(parsed.message ?? parsed.error ?? 'The operation failed.', EXIT_BY_ERROR[parsed.error] ?? 1);
    err.code = parsed.error;
    return err;
  }
  return new CliError(String(parsed), 1);
}

export function exitCodeForStatus(status) {
  if (status === 401) return 3;
  if (status === 403 || status === 404) return 4;
  if (status === 429) return 5;
  if (status === 400 || status === 422) return 2;
  return 1;
}
