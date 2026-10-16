import { describe, expect, it } from 'vitest';
import {
  AGENT_HANDLE_RE,
  AGENT_TOOL_GROUP_ORDER,
  AGENT_TOOL_KEYS,
  agentToolsInGroup,
  suggestAgentHandle,
} from '@/lib/agents-config';

describe('suggestAgentHandle', () => {
  it('deriva un handle válido del nombre (acentos, espacios, símbolos)', () => {
    expect(suggestAgentHandle('Soporte Acmé')).toBe('soporte-acme');
    expect(suggestAgentHandle('  SDR de ventas → CRM!  ')).toBe('sdr-de-ventas-crm');
    expect(suggestAgentHandle('Atenção ao cliente')).toBe('atencao-ao-cliente');
  });

  it('respeta el largo máximo y no termina en guion', () => {
    const h = suggestAgentHandle('Un agente con un nombre larguísimo para probar el recorte del handle');
    expect(h).not.toBeNull();
    expect(h!.length).toBeLessThanOrEqual(40);
    expect(AGENT_HANDLE_RE.test(h!)).toBe(true);
  });

  it('devuelve null si el nombre no da para un handle', () => {
    expect(suggestAgentHandle('')).toBeNull();
    expect(suggestAgentHandle('✦')).toBeNull();
    expect(suggestAgentHandle('ab')).toBeNull();
  });
});

describe('grupos de herramientas', () => {
  it('cada herramienta está en un grupo visible o en Avanzado (solo http_request)', () => {
    const grouped = AGENT_TOOL_GROUP_ORDER.flatMap((g) => agentToolsInGroup(g.key));
    expect(new Set(grouped).size).toBe(grouped.length);
    const rest = AGENT_TOOL_KEYS.filter((k) => !grouped.includes(k));
    expect(rest).toEqual(['http_request']);
  });

  it('agrupa por producto en el orden de la lista', () => {
    expect(agentToolsInGroup('crm')).toEqual(['crm_find_contact', 'crm_upsert_contact', 'crm_log_note']);
    expect(agentToolsInGroup('cal')).toEqual(['cal_get_availability', 'cal_book_meeting']);
  });
});
