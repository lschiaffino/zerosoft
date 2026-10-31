/**
 * Robots — subida a un bucket S3 o compatible (R2, MinIO, Spaces) con AWS
 * Signature V4, sin SDK. Server-only. Todo el HTTP pasa por safeFetch y la
 * respuesta se lee con tope.
 */
import { createHash, createHmac } from 'crypto';
import { safeFetch } from './safe-fetch';

export interface S3Target {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  /** Vacío = AWS (bucket.s3.region.amazonaws.com). Con endpoint: estilo de ruta. */
  endpoint: string;
  key: string;
}

const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const hmac = (k: string | Buffer, v: string) => createHmac('sha256', k).update(v).digest();

/** Clave del objeto con cada segmento codificado (las / quedan). */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Firma SigV4 de un PUT (exportada para probarla contra los vectores de AWS). */
export function signS3Put(
  t: Pick<S3Target, 'accessKeyId' | 'secretAccessKey' | 'region'>,
  url: URL,
  body: string | Buffer,
  extra: Record<string, string>,
  now: Date,
): Record<string, string> {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const hash = sha256(body);
  const headers: Record<string, string> = { ...extra, host: url.host, 'x-amz-content-sha256': hash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonical = ['PUT', url.pathname, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), hash].join('\n');
  const scope = `${day}/${t.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${t.secretAccessKey}`, day), t.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export function s3Url(t: Pick<S3Target, 'bucket' | 'region' | 'endpoint' | 'key'>): URL {
  const path = encodeKey(t.key);
  if (t.endpoint) return new URL(`${t.endpoint.replace(/\/+$/, '')}/${t.bucket}/${path}`);
  return new URL(`https://${t.bucket}.s3.${t.region}.amazonaws.com/${path}`);
}

/** PUT del objeto. Devuelve el status HTTP (el cuerpo no se lee: puede ser un XML grande). */
export async function putS3Object(t: S3Target, body: string, contentType: string, now = new Date()): Promise<number> {
  const url = s3Url(t);
  const headers = signS3Put(t, url, body, { 'content-type': contentType }, now);
  const res = await safeFetch(url.toString(), { method: 'PUT', headers, body }, 30_000);
  await res.body?.cancel().catch(() => {});
  return res.status;
}
