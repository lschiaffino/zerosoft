import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { NODE_DEFS, NODE_TYPES, defaultConfig, type FieldDef, type FlowNodeType } from '@/lib/flow-schema';
import { CREDENTIAL_NAME_RE } from '@/lib/flow-credentials-schema';
import { changedCount, nodeApp, splitFields, stepErrorInfo, suggestCredentialName } from '@/components/flow/flow-ui';

const fields = (type: FlowNodeType) => NODE_DEFS[type].fields as readonly FieldDef[];
const keys = (list: FieldDef[]) => list.map((f) => f.key);

describe('Flow editor: camino básico y Avanzado', () => {
  it('reintentos, timeouts y failOnError van a Avanzado en todos los nodos', () => {
    for (const type of NODE_TYPES) {
      for (const f of fields(type)) {
        if (['retries', 'timeoutMs', 'timeoutSec', 'failOnError'].includes(f.key)) {
          expect(f.advanced, `${type}.${f.key}`).toBe(true);
        }
      }
    }
  });

  it('ningún campo obligatorio para el camino básico queda escondido', () => {
    for (const type of NODE_TYPES) {
      const { basic } = splitFields(type, fields(type), defaultConfig(type));
      for (const f of fields(type)) {
        if (f.kind === 'credential' || f.kind === 'agentRef' || f.kind === 'flowRef' || f.key === 'url' || f.key === 'to') {
          expect(f.advanced, `${type}.${f.key}`).toBeFalsy();
        }
      }
      // Todo nodo con campos muestra al menos uno sin abrir Avanzado.
      if (fields(type).some((f) => !f.advanced)) expect(basic.length, type).toBeGreaterThan(0);
    }
  });

  it('separa HTTP en básico y avanzado respetando el orden', () => {
    const { basic, advanced } = splitFields('action.http', fields('action.http'), defaultConfig('action.http'));
    expect(keys(basic)).toEqual(['method', 'url', 'credentialId', 'body']);
    expect(keys(advanced)).toEqual(['headers', 'parseJson', 'paginate', 'timeoutMs', 'retries']);
  });

  it('respeta showIf y el filtro de eventos sin campo', () => {
    const notion = splitFields('app.notion', fields('app.notion'), { operation: 'append_text' });
    expect(keys(notion.basic)).toContain('pageId');
    expect(keys(notion.basic)).not.toContain('databaseId');
    expect(keys(notion.advanced)).not.toContain('titleProperty');

    const ev = splitFields('trigger.event', fields('trigger.event'), { event: 'deal.won' });
    expect(keys(ev.advanced)).toEqual(['filterPath']);
    const filtered = splitFields('trigger.event', fields('trigger.event'), { event: 'deal.won', filterPath: 'amount' });
    expect(keys(filtered.advanced)).toEqual(['filterPath', 'filterOp', 'filterValue']);
  });

  it('cuenta los avanzados que se apartan del default', () => {
    const adv = splitFields('app.slack', fields('app.slack'), {}).advanced;
    expect(changedCount(adv, defaultConfig('app.slack'))).toBe(0);
    expect(changedCount(adv, { retries: 3 })).toBe(1);
    expect(changedCount(adv, { retries: '' })).toBe(0);
  });
});

describe('Flow: nombres técnicos derivados', () => {
  it('deriva el nombre de la credencial del tipo y evita choques', () => {
    expect(suggestCredentialName('slack', [])).toBe('slack');
    expect(suggestCredentialName('slack', ['Slack'])).toBe('slack-2');
    expect(suggestCredentialName('slack', ['slack', 'slack-2'])).toBe('slack-3');
    expect(suggestCredentialName('api_key', [])).toBe('api-key');
    for (const t of ['api_key', 'oauth_token', 'basic', 'google']) expect(CREDENTIAL_NAME_RE.test(suggestCredentialName(t, []))).toBe(true);
  });
});

describe('Flow: nodos que tocan otras apps', () => {
  it('los nodos de apps de zerosoft devuelven la app que tocan', () => {
    expect(nodeApp('app.crm_contact')).toBe('crm');
    expect(nodeApp('app.track_issue')).toBe('track');
    expect(nodeApp('ai.agent')).toBe('agents');
    expect(nodeApp('trigger.event', { event: 'booking.created' })).toBe('cal');
    expect(nodeApp('trigger.event', { event: 'link.clicked' })).toBe('link');
    expect(nodeApp('action.http')).toBeNull();
    expect(nodeApp('app.slack')).toBeNull();
  });
});

describe('Flow: strings nuevas en los tres idiomas', () => {
  const root = join(__dirname, '..', '..');
  const load = (l: string) => JSON.parse(readFileSync(join(root, 'messages', l, 'flow.json'), 'utf8'));
  const paths = [
    'list.emptyTitle',
    'list.emptyTemplates',
    'editor.createCredential',
    'editor.advancedChanged',
    'editor.addStep',
    'editor.flowSettings',
    'editor.retry',
    'editor.copied',
    'editor.nodeId',
    'runs.emptyTitle',
    'runs.emptyBody',
    'runs.loadError',
    'versions.emptyTitle',
    'versions.loadError',
    'credentials.create',
    'credentials.saveChanges',
    'credentials.emptyTitle',
    'credentials.oneOf.slack',
    'credentials.oneOf.google',
    'editor.copyNodeRef',
    'runs.openInEditor',
    'versions.added',
    'versions.edgesAdded',
    'versions.edgesRemoved',
    'stepErrors.missing_credential',
    'stepErrors.missing_field',
    'stepErrors.invalid_credential',
    'stepErrors.http',
    'stepErrors.rate_limited',
  ];
  it.each(['en', 'es', 'pt'])('%s', (locale) => {
    const m = load(locale);
    for (const p of paths) {
      const v = p.split('.').reduce((acc: Record<string, unknown>, k) => acc?.[k] as Record<string, unknown>, m);
      expect(typeof v, `${locale}:${p}`).toBe('string');
      expect(String(v), `${locale}:${p}`).not.toMatch(/—/);
    }
  });
});

describe('Flow: errores de paso legibles', () => {
  it('traduce los códigos conocidos y deja el resto como dato', () => {
    expect(stepErrorInfo('missing_credentialid')).toMatchObject({ key: 'missing_credential', inEditor: true });
    expect(stepErrorInfo('missing_credential (retry 1/2)')).toMatchObject({ key: 'missing_credential' });
    expect(stepErrorInfo('missing_channel')).toMatchObject({ key: 'missing_field' });
    expect(stepErrorInfo('http_502')).toMatchObject({ key: 'http', values: { status: '502' } });
    expect(stepErrorInfo('slack_ratelimited')).toMatchObject({ key: 'rate_limited', inEditor: false });
    expect(stepErrorInfo('context_truncated')).toBeNull();
  });
});
