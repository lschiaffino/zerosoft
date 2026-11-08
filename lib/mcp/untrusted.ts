import { randomBytes } from 'crypto';

/**
 * Lo que devuelve una operación es dato de terceros. Va entre etiquetas con un
 * nonce por respuesta: un texto hostil no puede cerrar la etiqueta porque no
 * conoce el nonce, y las instrucciones dicen cómo tratarlo. Lo usan el
 * servidor MCP y el asistente del panel.
 */
export function wrapUntrusted(op: string, payload: unknown): string {
  const nonce = randomBytes(8).toString('hex');
  return `<untrusted_data source="${op}" nonce="${nonce}">\n${JSON.stringify(payload)}\n</untrusted_data nonce="${nonce}">`;
}
