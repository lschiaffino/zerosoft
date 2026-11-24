import { describe, expect, it } from 'vitest';
import { describeItem, type TrackMailItem } from '@/lib/track-notify';

const item = (p: Omit<Partial<TrackMailItem>, 'meta'> & { meta?: Record<string, string> }): TrackMailItem => ({
  id: 'n1',
  type: 'project_update',
  source_type: 'track_plan',
  source_id: 'p1',
  title: 'English title',
  body: null,
  href: '/app/track/projects/p1?tab=updates',
  created_at: '2026-11-23T10:00:00.000Z',
  ...p,
  meta: JSON.stringify(p.meta ?? {}),
});

describe('email de Track: updates de projects e iniciativas', () => {
  it('update con salud, comentario y recordatorio en el idioma de la persona', () => {
    expect(describeItem(item({ meta: { planName: 'Mobile', actorName: 'Ana', health: 'at_risk', kind: 'update' } }), 'es')).toBe('Ana publicó un update de Mobile: en riesgo');
    expect(describeItem(item({ meta: { planName: 'Mobile', actorName: 'Ana', kind: 'update' } }), 'en')).toBe('Ana posted an update on Mobile');
    expect(describeItem(item({ type: 'comment', meta: { planName: 'Mobile', actorName: 'Ana', kind: 'comment' } }), 'pt')).toBe('Ana comentou um update de Mobile');
    expect(describeItem(item({ type: 'track_reminder', meta: { planName: 'Mobile', kind: 'reminder' } }), 'en')).toBe('Time to post an update on Mobile');
  });

  it('initiative por su nombre; sin nombre en meta queda el título', () => {
    expect(
      describeItem(item({ source_type: 'track_initiative', meta: { initiativeName: 'Launch', actorName: 'Bo', health: 'on_track', kind: 'update' } }), 'en'),
    ).toBe('Bo posted an update on Launch: on track');
    expect(describeItem(item({}), 'en')).toBe('English title');
  });
});
