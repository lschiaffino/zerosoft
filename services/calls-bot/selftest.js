// npm run selftest: starts the bot with the fake meeting, runs one job end to
// end against a local receiver and checks the result with ffprobe.
// On macOS (no Xvfb/PulseAudio) it runs in dev mode: headless Chromium and a
// synthetic recording. The real capture path is checked in the Linux container.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelftest } from './lib/selftest-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = /** @type {net.AddressInfo} */ (s.address()).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

const port = await freePort();
const secret = crypto.randomBytes(32).toString('hex');
const dev = process.env.CALLS_BOT_DEV_HEADLESS ?? (process.platform === 'linux' ? '0' : '1');
const bot = spawn(process.execPath, [path.join(here, 'server.js')], {
  env: {
    ...process.env,
    PORT: String(port),
    CALLS_BOT_SECRET: secret,
    CALLS_BOT_FAKE_MEET: '1',
    CALLS_BOT_DEV_HEADLESS: dev,
    CALLS_BOT_SEGMENT_SEC: process.env.CALLS_BOT_SEGMENT_SEC || '10',
    CALLS_ALLOWED_CALLBACK_ORIGINS: '',
  },
  stdio: ['ignore', process.env.SELFTEST_VERBOSE ? 'inherit' : 'ignore', 'inherit'],
});

const base = `http://127.0.0.1:${port}`;
let code = 1;
try {
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`${base}/v1/health`).then((r) => r.ok, () => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const endsSec = Number(process.env.SELFTEST_ENDS_SEC || 25);
  const result = await runSelftest({ botBase: base, secret, endsSec });
  for (const c of result.checks) {
    const d = c.ok || c.detail === undefined ? '' : `  ${JSON.stringify(c.detail).slice(0, 300)}`;
    console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${d}`);
  }
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(result.ok ? `\nselftest passed (dev mode: ${dev === '1'})` : '\nselftest FAILED');
  code = result.ok ? 0 : 1;
} catch (e) {
  console.error('selftest error:', /** @type {Error} */ (e).message);
} finally {
  bot.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (bot.exitCode === null) bot.kill('SIGKILL');
}
process.exit(code);
