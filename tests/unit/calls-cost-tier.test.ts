import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerFor, transcribeModel } from '@/lib/voice-transcribe';
import { DEFAULT_SETTINGS, economyAnalysisModel } from '@/lib/calls/types';
import { settingsSchema } from '@/lib/calls/settings';

describe('calls: cost tier', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to economy and validates the setting', () => {
    expect(DEFAULT_SETTINGS.costTier).toBe('economy');
    expect(settingsSchema.safeParse({ costTier: 'premium' }).success).toBe(true);
    expect(settingsSchema.safeParse({ costTier: 'cheap' }).success).toBe(false);
  });

  it('economy uses Groq only when its key is set', () => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', '');
    vi.stubEnv('GROQ_API_KEY', '');
    expect(providerFor('economy')).toBe('gateway');
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    expect(providerFor('economy')).toBe('groq');
    expect(providerFor('premium')).toBe('gateway');
    expect(providerFor(undefined)).toBe('gateway');
    expect(transcribeModel('groq')).toBe('whisper-large-v3-turbo');
  });

  it('never leaves the fake provider in tests', () => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    expect(providerFor('economy')).toBe('fake');
  });

  it('economy analysis uses a small model unless overridden', () => {
    vi.stubEnv('AI_MODEL_ECONOMY', '');
    expect(economyAnalysisModel()).toBe('anthropic/claude-haiku-5-5');
    vi.stubEnv('AI_MODEL_ECONOMY', 'openai/gpt-5-mini');
    expect(economyAnalysisModel()).toBe('openai/gpt-5-mini');
  });
});
