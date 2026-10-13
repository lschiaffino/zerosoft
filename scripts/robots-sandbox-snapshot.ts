/**
 * Robots — arma por adelantado el snapshot de Vercel Sandbox (playwright-core
 * + Chromium + librerías del sistema) para que la primera corrida no tenga
 * que instalarlo. Imprime el id: guardalo en ROBOTS_SANDBOX_SNAPSHOT_ID.
 *
 *   VERCEL_TOKEN=… VERCEL_TEAM_ID=… VERCEL_PROJECT_ID=… npx tsx scripts/robots-sandbox-snapshot.ts
 *   (o con VERCEL_OIDC_TOKEN de `vercel env pull`)
 */
import { createRobotsSnapshot } from '../lib/robots-sandbox';

createRobotsSnapshot()
  .then((id) => {
    // eslint-disable-next-line no-console
    console.log(`ROBOTS_SANDBOX_SNAPSHOT_ID=${id}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
