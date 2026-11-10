// What the bot's browser may load. Navigations (any frame) only to Google
// hosts Meet needs; other requests only https (or data:/blob:) and never to
// private, loopback or link-local hosts. In fake mode, this server's own
// origin is allowed too.

export const NAV_SUFFIXES = ['google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'youtube.com'];

/** @param {string} host @param {string[]} suffixes */
export function hostMatches(host, suffixes) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return suffixes.some((s) => h === s || h.endsWith('.' + s));
}

/** @param {string} ip */
function privateV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * True for hosts the browser must never reach: loopback, private and
 * link-local IP literals, localhost and internal-looking names.
 * @param {string} hostname as in URL.hostname (IPv6 in brackets)
 */
export function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) {
    return true;
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // integer IPs
  if (privateV4(h)) return true;
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return true;
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true; // ULA, link-local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped && privateV4(mapped[1])) return true;
    if (/^::ffff:/.test(v6)) return true; // hex-form mapped: refuse
  }
  return false;
}

/**
 * @param {string} rawUrl
 * @param {{ isNavigation: boolean, fakeOrigin?: string|null }} opts
 * @returns {boolean}
 */
export function allowRequest(rawUrl, opts) {
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return !opts.isNavigation;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (opts.fakeOrigin && u.origin === opts.fakeOrigin) return true;
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
  if (u.username || u.password) return false;
  if (isPrivateHost(u.hostname)) return false;
  if (opts.isNavigation) return hostMatches(u.hostname, NAV_SUFFIXES);
  return true;
}
