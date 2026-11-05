import { describe, expect, it } from 'vitest';
import { buildDealCloneBody, cloneName, cloneStageId, type CloneSourceDeal } from '@/lib/crm-deal-clone';

const stages = [
  { id: 'a', is_won: 0, is_lost: 0 },
  { id: 'b', is_won: 0, is_lost: 0 },
  { id: 'w', is_won: 1, is_lost: 0 },
  { id: 'l', is_won: 0, is_lost: 1 },
];
const deal: CloneSourceDeal = {
  pipeline_id: 'p',
  stage_id: 'b',
  name: 'Acme renewal',
  amount: 1200,
  currency: 'USD',
  close_date: '2026-12-01 00:00:00',
  priority: 'high',
  source: 'referral',
  description: 'x',
  owner_id: 'u1',
  custom: '{"region":"LATAM"}',
};

describe('crm-deal-clone', () => {
  it('suffixes the name once and respects the limit', () => {
    expect(cloneName('Acme', '(copy)')).toBe('Acme (copy)');
    expect(cloneName('Acme (copy)', '(copy)')).toBe('Acme (copy)');
    expect(cloneName('x'.repeat(600), '(copy)')).toHaveLength(500);
  });
  it('keeps an open stage and moves closed deals to the first open one', () => {
    expect(cloneStageId(stages, 'b')).toBe('b');
    expect(cloneStageId(stages, 'w')).toBe('a');
    expect(cloneStageId(stages, 'l')).toBe('a');
    expect(cloneStageId([{ id: 'w', is_won: 1, is_lost: 0 }], 'w')).toBeNull();
  });
  it('builds the create body with associations', () => {
    const body = buildDealCloneBody(deal, stages, { contactIds: ['c1'], companyId: 'k1', companyIds: ['k1', 'k2'] }, '(copy)');
    expect(body).toMatchObject({
      pipelineId: 'p',
      stageId: 'b',
      name: 'Acme renewal (copy)',
      amount: 1200,
      closeDate: '2026-12-01',
      companyId: 'k1',
      companyIds: ['k2'],
      contactIds: ['c1'],
      ownerId: 'u1',
      custom: { region: 'LATAM' },
    });
  });
  it('tolerates broken custom JSON and missing dates', () => {
    const body = buildDealCloneBody({ ...deal, custom: '{oops', close_date: null, owner_id: null }, stages, { contactIds: [], companyId: null, companyIds: [] }, '(copy)')!;
    expect(body.custom).toEqual({});
    expect(body).not.toHaveProperty('closeDate');
    expect(body).not.toHaveProperty('ownerId');
  });
});
