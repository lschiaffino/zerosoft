/**
 * Track — GitHub App instalable (además del webhook manual).
 *
 * Variables: GITHUB_APP_SLUG (la URL pública de la App), GITHUB_APP_CLIENT_ID
 * y GITHUB_APP_CLIENT_SECRET (para verificar quién instala) y
 * GITHUB_APP_WEBHOOK_SECRET (firma de las entregas). La App necesita permisos
 * de lectura de pull requests, checks, commit statuses, issues y contents, y
 * los eventos pull_request, pull_request_review, push, check_suite, status,
 * issues e issue_comment. Webhook: /api/track/github/app/webhook. Callback de
 * instalación (con "Request user authorization during installation"):
 * /api/track/github/app/callback.
 *
 * Instalar: la persona va a github.com/apps/<slug>/installations/new con un
 * state firmado; GitHub vuelve al callback con installation_id y un code de
 * OAuth. Con el code se confirma que esa persona tiene acceso a la
 * instalación (GET /user/installations) antes de atarla al workspace: así
 * nadie puede reclamar la instalación de otro adivinando el id.
 *
 * GITHUB_APP_FAKE=1 (tests): sin salir a GitHub; la instalación 4242 de la
 * cuenta "acme" vale para cualquiera.
 */

export function githubAppFake(): boolean {
  return process.env.GITHUB_APP_FAKE === '1';
}

export function githubAppConfigured(): boolean {
  return githubAppFake() || Boolean(process.env.GITHUB_APP_SLUG && process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_WEBHOOK_SECRET);
}

export function githubAppWebhookSecret(): string | null {
  return process.env.GITHUB_APP_WEBHOOK_SECRET || (githubAppFake() ? 'fake-github-app-secret' : null);
}

export function githubAppInstallUrl(state: string): string {
  if (githubAppFake()) return `/api/track/github/app/callback?installation_id=4242&setup_action=install&code=fake&state=${encodeURIComponent(state)}`;
  return `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG ?? '')}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * Confirma con el code de OAuth que la persona puede ver la instalación.
 * Devuelve la cuenta (org o usuario) o null si no.
 */
export async function verifyInstallationAccess(code: string, installationId: number): Promise<{ accountLogin: string } | null> {
  if (githubAppFake()) return code === 'fake' && installationId === 4242 ? { accountLogin: 'acme' } : null;
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = ((await tokenRes.json().catch(() => null)) as { access_token?: string } | null)?.access_token;
  if (!token) return null;
  const res = await fetch('https://api.github.com/user/installations?per_page=100', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'zerosoft-track' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { installations?: Array<{ id: number; account?: { login?: string } }> } | null;
  const found = body?.installations?.find((i) => i.id === installationId);
  return found ? { accountLogin: found.account?.login ?? '' } : null;
}
