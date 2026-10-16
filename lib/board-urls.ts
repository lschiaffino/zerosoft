import { primaryFeedbackHost } from './host-rewrite';
import { boardItemPath, boardPath } from './board-paths';

/**
 * URLs absolutas del board (emails, OG). Cuando la app vive en zerosoft.ai o
 * FEEDBACK_HOST está configurado, el board se sirve en su subdominio; en un
 * self-host sin subdominio, en <sitio>/<locale>/feedback-board.
 */

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** Donde se hace el login (NEXTAUTH_URL): la cookie de sesión nace ahí. */
export function authBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || siteUrl()).replace(/\/$/, '');
}

export function boardUsesSubdomain(): boolean {
  if (process.env.FEEDBACK_HOST?.trim()) return true;
  try {
    const host = new URL(siteUrl()).hostname;
    return host === 'zerosoft.ai' || host.endsWith('.zerosoft.ai');
  } catch {
    return false;
  }
}

function boardOrigin(): string {
  return boardUsesSubdomain() ? `https://${primaryFeedbackHost()}` : siteUrl();
}

export function absoluteBoardUrl(locale: string, path = ''): string {
  return `${boardOrigin()}${boardPath(locale, boardUsesSubdomain(), path)}`;
}

export function absoluteItemUrl(locale: string, id: string, title: string): string {
  return `${boardOrigin()}${boardItemPath(locale, boardUsesSubdomain(), id, title)}`;
}
