import { describe, expect, it } from 'vitest';
import { analyticsRange } from '@/lib/analytics-kit/period';
import { aggregateSocial, isSocialDashboardEmpty, type SocialTargetRow } from '@/lib/social-dashboard';

const row = (over: Partial<SocialTargetRow>): SocialTargetRow => ({
  id: crypto.randomUUID(),
  post_id: 'p1',
  account_id: 'a1',
  published_at: '2030-03-10T15:00:00.000Z',
  impressions: 100,
  reach: 80,
  engagement: 10,
  clicks: 2,
  metrics_at: '2030-03-10T16:00:00.000Z',
  text: 'Hola',
  ...over,
});

describe('Social: analítica con el kit', () => {
  const now = new Date('2030-03-12T12:00:00Z');
  const q = analyticsRange({ days: 7, tz: 'America/Argentina/Buenos_Aires' }, now);
  const accounts = [
    { id: 'a1', name: 'Marca', network: 'linkedin', followers: 120 },
    { id: 'a2', name: 'Otra', network: 'facebook', followers: null },
  ];

  it('separa el período del anterior, suma por red y arma el mapa de calor en la zona de quien mira', () => {
    const d = aggregateSocial(
      q,
      [
        row({}),
        row({ account_id: 'a2', engagement: 30, impressions: 200 }),
        // Hace 10 días: período anterior.
        row({ published_at: '2030-03-02T15:00:00.000Z', engagement: 5 }),
      ],
      accounts,
      [
        { account_id: 'a1', day: '2030-03-01', followers: 100 },
        { account_id: 'a1', day: '2030-03-11', followers: 120 },
      ],
    );
    expect(d.kpis.posts).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.engagement).toEqual({ value: 40, prev: 5 });
    expect(d.kpis.engagementRate.value).toBeCloseTo(40 / 300);
    expect(d.kpis.followers).toEqual({ value: 120, prev: 100 });
    expect(d.networks.map((x) => x.network)).toEqual(['facebook', 'linkedin']);
    expect(d.accounts.find((a) => a.id === 'a1')?.followersDelta).toBe(20);
    // 2030-03-10 15:00 UTC es domingo 12:00 en Buenos Aires: fila 6 (domingo), hora 12.
    expect(d.heat[6][12]).toBe(40);
    expect(d.topPosts[0].engagement).toBe(30);
    expect(isSocialDashboardEmpty(d)).toBe(false);
  });

  it('sin cuentas o sin publicaciones en ninguno de los dos períodos, vacío', () => {
    expect(isSocialDashboardEmpty(aggregateSocial(q, [], [], []))).toBe(true);
    expect(isSocialDashboardEmpty(aggregateSocial(q, [], accounts, []))).toBe(true);
  });
});
