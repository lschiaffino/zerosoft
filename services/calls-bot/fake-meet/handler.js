// Fake Google Meet for tests (only mounted when CALLS_BOT_FAKE_MEET=1).
//   GET  /fake-meet/<code>?admit=3&ends=25   the meeting page
//   POST /fake-meet/<code>/{join,admitted,chat,ended}   page reports
//   GET  /fake-meet/<code>/state           what the page reported (self-test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html'));
const CODE = /^[a-z0-9-]{1,40}$/;

/** @type {Map<string, { join?: any, admitted?: boolean, chat: { from: string, text: string }[], ended?: string }>} */
const meetings = new Map();

/** @param {string} code */
function stateFor(code) {
  let s = meetings.get(code);
  if (!s) {
    if (meetings.size >= 50) meetings.delete(/** @type {string} */ (meetings.keys().next().value));
    s = { chat: [] };
    meetings.set(code, s);
  }
  return s;
}

/** @param {string} code */
export function fakeMeetState(code) {
  return meetings.get(code) || null;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer>} readBody
 * @returns {Promise<boolean>} true if handled
 */
export async function handleFakeMeet(req, res, url, readBody) {
  const m = /^\/fake-meet\/([^/]+)(?:\/(join|admitted|chat|ended|state))?$/.exec(url.pathname);
  if (!m || !CODE.test(m[1])) return false;
  const [, code, action] = m;
  if (!action && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAGE);
    return true;
  }
  if (action === 'state' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(meetings.get(code) || null));
    return true;
  }
  if (action && action !== 'state' && req.method === 'POST') {
    let body = {};
    try {
      body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
    } catch {}
    const s = stateFor(code);
    const b = /** @type {any} */ (body);
    if (action === 'join') s.join = { name: String(b.name || '').slice(0, 100), micOff: !!b.micOff, camOff: !!b.camOff };
    if (action === 'admitted') s.admitted = true;
    if (action === 'chat' && s.chat.length < 100) s.chat.push({ from: String(b.from || '').slice(0, 100), text: String(b.text || '').slice(0, 2000) });
    if (action === 'ended') s.ended = String(b.kind || 'host').slice(0, 20);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return true;
  }
  return false;
}
