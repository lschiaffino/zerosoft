import { app } from 'electron';

/**
 * Variables de desarrollo y e2e (ZEROSOFT_SERVER, ZEROSOFT_DESKTOP_TEST,
 * ZEROSOFT_USER_DATA, ZEROSOFT_UPDATE_URL…). En la app empaquetada no se
 * leen: nadie puede cambiar el servidor, el feed de actualizaciones ni
 * prender el modo test desde el entorno.
 */
export function devEnv(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name];
}
