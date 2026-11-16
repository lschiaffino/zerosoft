import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUpdateManifest, pickReleaseWithAsset, type GhRelease } from '@/lib/desktop-release';
import { GET as latestJson } from '@/app/api/desktop/update/latest.json/route';

/**
 * Feed del updater de la app de escritorio (/api/desktop/update/latest.json): qué release elige,
 * qué manifiesto acepta y que responde sin sesión (las apps lo piden sin cookie).
 */

const rel = (tag: string, files: string[], extra: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  published_at: '2026-11-15T00:00:00Z',
  assets: files.map((name) => ({ name, size: 1, browser_download_url: `https://github.com/o/r/releases/download/${tag}/${name}` })),
  ...extra,
});

const manifest = (version: string, platforms?: Record<string, { signature: string; url: string }>) =>
  JSON.stringify({
    version,
    notes: 'https://zerosoft.ai/changelog',
    pub_date: '2026-11-15T03:48:46.941Z',
    platforms: platforms ?? {
      'darwin-aarch64': { signature: 'c2ln', url: `https://github.com/o/r/releases/download/desktop-v${version}/zerosoft-${version}-mac-arm64.app.tar.gz` },
      'darwin-x86_64': { signature: 'c2ln', url: `https://github.com/o/r/releases/download/desktop-v${version}/zerosoft-${version}-mac-x64.app.tar.gz` },
      'windows-x86_64': { signature: 'c2ln', url: `https://github.com/o/r/releases/download/desktop-v${version}/zerosoft-${version}-win-x64.exe` },
    },
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('desktop: feed de actualizaciones', () => {
  it('elige el release más nuevo que trae latest.json, comparando versiones como números', () => {
    const releases = [
      rel('desktop-v0.3.9', ['latest.json']),
      rel('desktop-v0.3.10', ['latest.json']),
      rel('desktop-v0.4.0', ['zerosoft-0.4.0-win-x64.exe']), // a medio publicar: sin latest.json
      rel('desktop-v0.5.0', ['latest.json'], { draft: true }),
      rel('desktop-v0.6.0', ['latest.json'], { prerelease: true }),
    ];
    expect(pickReleaseWithAsset(releases, 'latest.json')?.tag_name).toBe('desktop-v0.3.10');
    expect(pickReleaseWithAsset(releases, 'latest-mac.yml')).toBeNull();
  });

  it('acepta el latest.json que publica el workflow', () => {
    const m = parseUpdateManifest(manifest('0.3.9'), '0.3.9');
    expect(m?.version).toBe('0.3.9');
    expect(Object.keys(m!.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']);
  });

  it('rechaza un manifiesto que haría fallar al updater', () => {
    expect(parseUpdateManifest('not json')).toBeNull();
    expect(parseUpdateManifest('{}')).toBeNull();
    expect(parseUpdateManifest(manifest('v0.3.9'))).toBeNull();
    expect(parseUpdateManifest(manifest('0.3.9'), '0.3.10'), 'versión distinta a la del tag').toBeNull();
    expect(parseUpdateManifest(manifest('0.3.9', {}))).toBeNull();
    expect(parseUpdateManifest(manifest('0.3.9', { 'darwin-aarch64': { signature: '', url: 'https://x/a.tar.gz' } }))).toBeNull();
    expect(parseUpdateManifest(manifest('0.3.9', { 'darwin-aarch64': { signature: 'c2ln', url: 'http://x/a.tar.gz' } }))).toBeNull();
  });

  it('la ruta responde sin sesión con el formato del updater de Tauri', async () => {
    vi.stubEnv('DESKTOP_RELEASES_FAKE', '1');
    const res = await latestJson();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = parseUpdateManifest(await res.text(), '0.1.0');
    expect(body).not.toBeNull();
    expect(body!.platforms['darwin-aarch64'].url).toMatch(/\/desktop-v0\.1\.0\/zerosoft-0\.1\.0-mac-arm64\.app\.tar\.gz$/);
    expect(body!.platforms['windows-x86_64'].url).toMatch(/zerosoft-0\.1\.0-win-x64\.exe$/);
  });

  it('sin releases la ruta contesta 404 (la app lo muestra como error, no como "al día")', async () => {
    vi.stubEnv('DESKTOP_RELEASES_FAKE', 'empty');
    expect((await latestJson()).status).toBe(404);
  });
});
