import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps, type Server as HttpsServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Robots: redirecciones reales en el Chromium local. Cada 30x se valida en el
 * arnés y vuelve al navegador, que la sigue como pedido nuevo: el documento
 * tiene que quedar con la URL final (y los links relativos resolver contra
 * ella), tanto entre orígenes como de http a https. El https local es
 * autofirmado (ROBOTS_TEST_IGNORE_HTTPS_ERRORS=1 en playwright.config.ts).
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const A = BASE + 14; // origen que redirige
const B = BASE + 15; // otro origen (otro host y puerto)
const PLAIN = BASE + 16; // http que manda a https
const TLS = BASE + 17; // https autofirmado
const servers: Array<Server | HttpsServer> = [];

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><a id="rel" href="/next">next</a></body></html>`;

test.beforeAll(async () => {
  const a = createHttp((req, res) => {
    if (req.url === '/go') {
      res.writeHead(302, { location: `http://localhost:${B}/land` });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  const b = createHttp((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(`landed ${req.url}`));
  });
  const plain = createHttp((req, res) => {
    res.writeHead(301, { location: `https://127.0.0.1:${TLS}/secure` });
    res.end();
  });
  // Certificado autofirmado de un día para el https local.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zs-robots-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const tls = createHttps({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(`secure ${req.url}`));
  });
  const listen = (s: Server | HttpsServer, port: number, host = '127.0.0.1') => new Promise<void>((r) => s.listen(port, host, () => r()));
  await listen(a, A);
  await listen(b, B, 'localhost');
  await listen(plain, PLAIN);
  await listen(tls, TLS);
  servers.push(a, b, plain, tls);
});

test.afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function runRobot(request: APIRequestContext, url: string) {
  const res = await request.post('/api/robots', {
    data: {
      name: `Redirect ${url}`,
      steps: [
        { type: 'goto', url },
        { type: 'evaluate', name: 'where', script: 'return { href: location.href, rel: document.getElementById("rel").href, title: document.title };' },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  const ran = await request.post(`/api/robots/run/${id}`, { data: {} });
  expect(ran.ok()).toBe(true);
  return ((await ran.json()) as { run: { status: string; error: string | null; output: { where?: { href: string; rel: string; title: string } } } }).run;
}

test('robots: una redirección entre orígenes deja el documento en la URL final', async ({ request }) => {
  test.setTimeout(90_000);
  const run = await runRobot(request, `http://127.0.0.1:${A}/go`);
  expect(run.status, run.error ?? '').toBe('success');
  expect(run.output.where?.href).toBe(`http://localhost:${B}/land`);
  expect(run.output.where?.rel).toBe(`http://localhost:${B}/next`);
  expect(run.output.where?.title).toBe('landed /land');
});

test('robots: http → https local sigue la redirección y queda en https', async ({ request }) => {
  test.setTimeout(90_000);
  const run = await runRobot(request, `http://127.0.0.1:${PLAIN}/`);
  expect(run.status, run.error ?? '').toBe('success');
  expect(run.output.where?.href).toBe(`https://127.0.0.1:${TLS}/secure`);
  expect(run.output.where?.rel).toBe(`https://127.0.0.1:${TLS}/next`);
});
