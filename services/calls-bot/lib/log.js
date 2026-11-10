// Structured, one-line JSON logs. Never pass tokens, secrets or callback URLs here.

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} msg
 * @param {Record<string, unknown>} [fields]
 */
export function log(level, msg, fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === 'info') process.stdout.write(line + '\n');
  else process.stderr.write(line + '\n');
}

/**
 * Safe description of an error: name/code/message, without URLs or causes that
 * might carry a callback URL.
 * @param {unknown} err
 */
export function errInfo(err) {
  if (!err || typeof err !== 'object') return { error: String(err).slice(0, 200) };
  const e = /** @type {any} */ (err);
  const message = String(e.message || '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 300);
  // `detail`, not `message`: Railway's log parser uses `message` for the log line.
  return { error: e.name || 'Error', code: e.code || e.reason || e.status || undefined, detail: message };
}
