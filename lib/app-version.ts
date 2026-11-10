/**
 * Versión de la web que está corriendo: el commit del deploy. En Vercel sale
 * de VERCEL_GIT_COMMIT_SHA; en self-host se puede fijar con APP_BUILD_ID.
 * Vacío = no se sabe, y el aviso de versión nueva no aparece.
 */
export function serverBuildId(): string {
  return (process.env.APP_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
}

/** Hay versión nueva cuando las dos se conocen y son distintas. */
export function isNewBuild(mine: string | undefined | null, served: unknown): served is string {
  return typeof served === 'string' && served !== '' && !!mine && served !== mine;
}
