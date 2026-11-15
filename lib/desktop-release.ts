/**
 * Releases de la app de escritorio en GitHub (tags desktop-vX.Y.Z, los arma
 * .github/workflows/desktop.yml). Los usan la página /download (links a los
 * instaladores) y el feed de actualizaciones (/api/desktop/update/*.yml).
 *
 * DESKTOP_RELEASES_REPO cambia el repo (self-host o fork); con
 * DESKTOP_RELEASES_TOKEN se consulta con token (más cupo de la API).
 * DESKTOP_RELEASES_FAKE=1 (e2e) devuelve un release fijo sin salir a internet.
 * Todo sale por safeFetch (guarda SSRF, timeout) con una caché en memoria de
 * 10 minutos por instancia (la API anónima de GitHub da 60 pedidos por hora).
 * Server-only.
 */
import { GITHUB_REPO } from './repo';
import { safeFetch } from './safe-fetch';

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { until: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await load();
  // Si GitHub falla (cupo de la API, caída) se sigue sirviendo lo último que anduvo: las apps
  // instaladas no ven un error por eso. Lo que falla se reintenta al minuto, no a los 10.
  if (value === null && hit && hit.value !== null) {
    cache.set(key, { until: Date.now() + 60_000, value: hit.value });
    return hit.value as T;
  }
  cache.set(key, { until: Date.now() + (value === null ? 60_000 : CACHE_MS), value });
  return value;
}

export const DESKTOP_REPO = process.env.DESKTOP_RELEASES_REPO || GITHUB_REPO;
export const DESKTOP_TAG_PREFIX = 'desktop-v';

export interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GhRelease {
  tag_name: string;
  name?: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  published_at: string | null;
  assets: GhAsset[];
}

export interface DesktopDownloads {
  version: string;
  tag: string;
  pageUrl: string;
  publishedAt: string | null;
  macArm64: string | null;
  macX64: string | null;
  win: string | null;
  /** Tamaño de cada instalador en bytes (null si no se sabe). */
  sizes: { macArm64: number | null; macX64: number | null; win: number | null };
}

function semver(tag: string): [number, number, number] | null {
  if (!tag.startsWith(DESKTOP_TAG_PREFIX)) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(tag.slice(DESKTOP_TAG_PREFIX.length));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** El último release estable del escritorio (ignora borradores, prereleases y otros tags del repo). */
export function pickDesktopRelease(releases: readonly GhRelease[]): GhRelease | null {
  let best: { r: GhRelease; v: [number, number, number] } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const v = semver(r.tag_name);
    if (!v) continue;
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) best = { r, v };
  }
  return best?.r ?? null;
}

/**
 * El último release estable que trae `file`. Un release a medio publicar (falló una plataforma y
 * todavía no tiene latest.json) no deja a las apps instaladas sin feed: siguen con el anterior.
 */
export function pickReleaseWithAsset(releases: readonly GhRelease[], file: string): GhRelease | null {
  return pickDesktopRelease(releases.filter((r) => r.assets.some((a) => a.name === file)));
}

export interface UpdateManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, { signature: string; url: string }>;
}

/**
 * latest.json del updater de Tauri, validado: versión X.Y.Z (la del tag si se pasa) y, por
 * plataforma, una URL https y una firma. null si no sirve (el updater fallaría con algo peor).
 */
export function parseUpdateManifest(text: string, expectedVersion?: string): UpdateManifest | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<UpdateManifest>;
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) return null;
  if (expectedVersion && m.version !== expectedVersion) return null;
  if (!m.platforms || typeof m.platforms !== 'object') return null;
  const entries = Object.entries(m.platforms);
  if (!entries.length) return null;
  for (const [, p] of entries) {
    if (!p || typeof p.signature !== 'string' || !p.signature || typeof p.url !== 'string' || !p.url.startsWith('https://')) return null;
  }
  return m as UpdateManifest;
}

/** Instaladores por sistema, por nombre de archivo (artifactName de desktop/electron-builder.yml). */
export function desktopDownloads(r: GhRelease): DesktopDownloads {
  const asset = (re: RegExp) => r.assets.find((a) => re.test(a.name)) ?? null;
  const find = (re: RegExp) => asset(re)?.browser_download_url ?? null;
  const size = (a: GhAsset | null) => (a && a.size > 1 ? a.size : null);
  const winAsset = asset(/-win-x64\.exe$/i) ?? asset(/\.exe$/i);
  return {
    sizes: { macArm64: size(asset(/-mac-arm64\.dmg$/i)), macX64: size(asset(/-mac-x64\.dmg$/i)), win: size(winAsset) },
    version: r.tag_name.slice(DESKTOP_TAG_PREFIX.length),
    tag: r.tag_name,
    pageUrl: r.html_url,
    publishedAt: r.published_at,
    macArm64: find(/-mac-arm64\.dmg$/i),
    macX64: find(/-mac-x64\.dmg$/i),
    win: find(/-win-x64\.exe$/i) ?? find(/\.exe$/i),
  };
}

/**
 * latest*.yml de electron-builder con los nombres de archivo relativos: se
 * reescriben a la URL de descarga del release (el feed vive en zerosoft.ai,
 * los binarios en GitHub).
 */
export function rewriteUpdateYml(yml: string, assets: readonly GhAsset[]): string {
  const byName = new Map(assets.map((a) => [a.name, a.browser_download_url]));
  return yml.replace(/^(\s*-?\s*(?:url|path):\s*)(['"]?)([^'"\r\n]+)\2\s*$/gm, (line, prefix: string, _q: string, value: string) => {
    const abs = byName.get(value.trim());
    return abs ? `${prefix}${abs}` : line;
  });
}

const FAKE: GhRelease = {
  tag_name: 'desktop-v0.1.0',
  name: 'zerosoft desktop 0.1.0',
  draft: false,
  prerelease: false,
  html_url: `https://github.com/${DESKTOP_REPO}/releases/tag/desktop-v0.1.0`,
  published_at: '2026-10-29T12:00:00Z',
  assets: ['zerosoft-0.1.0-mac-arm64.dmg', 'zerosoft-0.1.0-mac-x64.dmg', 'zerosoft-0.1.0-win-x64.exe', 'latest-mac.yml', 'latest.yml', 'latest.json'].map((name) => ({
    name,
    size: 1,
    browser_download_url: `https://github.com/${DESKTOP_REPO}/releases/download/desktop-v0.1.0/${name}`,
  })),
};

/** Releases del repo (cache de 10 min en el data cache de Next). null si GitHub no responde. */
export async function fetchReleases(): Promise<GhRelease[] | null> {
  if (process.env.DESKTOP_RELEASES_FAKE === '1') return [FAKE];
  if (process.env.DESKTOP_RELEASES_FAKE === 'empty') return [];
  return cached('releases', async () => {
    try {
      const token = process.env.DESKTOP_RELEASES_TOKEN;
      const res = await safeFetch(
        `https://api.github.com/repos/${DESKTOP_REPO}/releases?per_page=50`,
        { headers: { accept: 'application/vnd.github+json', 'user-agent': 'zerosoft-site', ...(token ? { authorization: `Bearer ${token}` } : {}) } },
        4000,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as GhRelease[]) : null;
    } catch {
      return null;
    }
  });
}

export async function latestDesktopRelease(): Promise<GhRelease | null> {
  const releases = await fetchReleases();
  return releases ? pickDesktopRelease(releases) : null;
}

/**
 * El feed de actualizaciones del último release: latest.json (updater de Tauri, ya con URLs
 * absolutas) o los latest*.yml de la app de Electron anterior, con URLs absolutas. null si no hay.
 */
export async function updateFeed(file: 'latest-mac.yml' | 'latest.yml' | 'latest.json'): Promise<string | null> {
  const releases = await fetchReleases();
  const release = releases ? pickReleaseWithAsset(releases, file) : null;
  const asset = release?.assets.find((a) => a.name === file);
  if (!release || !asset) return null;
  const version = release.tag_name.slice(DESKTOP_TAG_PREFIX.length);
  if (process.env.DESKTOP_RELEASES_FAKE === '1' && file === 'latest.json') {
    const base = `https://github.com/${DESKTOP_REPO}/releases/download/${release.tag_name}`;
    const platforms = Object.fromEntries(
      [['darwin-aarch64', 'mac-arm64.app.tar.gz'], ['darwin-x86_64', 'mac-x64.app.tar.gz'], ['windows-x86_64', 'win-x64.exe']].map(([k, f]) => [k, { signature: 'fake', url: `${base}/zerosoft-${version}-${f}` }]),
    );
    return JSON.stringify({ version, notes: 'https://zerosoft.ai/changelog', pub_date: '2026-10-29T12:00:00Z', platforms });
  }
  if (process.env.DESKTOP_RELEASES_FAKE === '1') {
    return rewriteUpdateYml(`version: 0.1.0\nfiles:\n  - url: zerosoft-0.1.0-mac-arm64.zip\n    sha512: x\n    size: 1\npath: zerosoft-0.1.0-mac-arm64.zip\nsha512: x\n`, [
      ...release.assets,
      { name: 'zerosoft-0.1.0-mac-arm64.zip', size: 1, browser_download_url: `https://github.com/${DESKTOP_REPO}/releases/download/desktop-v0.1.0/zerosoft-0.1.0-mac-arm64.zip` },
    ]);
  }
  return cached(`feed:${asset.browser_download_url}`, async () => {
    try {
      // GitHub responde la descarga con un 302 a su CDN.
      const res = await safeFetch(asset.browser_download_url, {}, 5000, { maxRedirects: 3 });
      if (!res.ok) return null;
      const text = await res.text();
      if (file !== 'latest.json') return rewriteUpdateYml(text, release.assets);
      return parseUpdateManifest(text, version) ? text : null;
    } catch {
      return null;
    }
  });
}

/**
 * El último release listo para components/desktop/DesktopDownload (links y tamaños
 * por sistema), o null si GitHub no responde o no hay instaladores.
 */
export async function desktopReleaseForClient(): Promise<{
  version: string;
  pageUrl: string;
  links: { macArm64: string | null; macX64: string | null; win: string | null };
  sizes: DesktopDownloads['sizes'];
} | null> {
  const release = await latestDesktopRelease().catch(() => null);
  if (!release) return null;
  const dl = desktopDownloads(release);
  if (!dl.macArm64 && !dl.macX64 && !dl.win) return null;
  return { version: dl.version, pageUrl: dl.pageUrl, links: { macArm64: dl.macArm64, macX64: dl.macX64, win: dl.win }, sizes: dl.sizes };
}
