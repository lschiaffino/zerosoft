import { afterEach, describe, expect, it } from 'vitest';
import { voiceBlobAccess, voiceBlobEnabled, voiceBlobToken } from '@/lib/voice-blob';

describe('Voice con el store privado de archivos', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it('sin store privado, como antes', () => {
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
    delete process.env.VOICE_BLOB_ACCESS;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_pub_x';
    expect(voiceBlobAccess()).toBe('public');
    expect(voiceBlobToken()).toEqual({});
  });

  it('con FILES_BLOB_READ_WRITE_TOKEN la grabación sube privada y se lee y borra con ese token', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_priv_x';
    expect(voiceBlobEnabled()).toBe(true);
    expect(voiceBlobAccess()).toBe('private');
    expect(voiceBlobToken()).toEqual({ token: 'vercel_blob_rw_priv_x' });
  });
});
