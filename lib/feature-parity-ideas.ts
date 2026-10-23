import researchIdeas from '@/research/ideas.json';

/**
 * Cruce entre research/ideas.json y la paridad de funciones: una idea con
 * `parity: "<id de capacidad>"` cubre esa fila de content/feature-parity/<product>.ts.
 * Lo usan la página de producto (el link "votar" de lo que falta) y el test que
 * no deja una idea hecha apuntando a una capacidad marcada como faltante.
 */
export interface ParityIdea {
  title: string;
  product: string;
  status?: string;
  parity?: string;
}

export const PARITY_IDEAS: readonly ParityIdea[] = (researchIdeas as ParityIdea[]).filter((i) => typeof i.parity === 'string');

/** La idea abierta (o la última) que cubre esa capacidad, si hay una. */
export function ideaForCapability(product: string, capabilityId: string, ideas: readonly ParityIdea[] = PARITY_IDEAS): ParityIdea | undefined {
  const matches = ideas.filter((i) => i.product === product && i.parity === capabilityId);
  return matches.find((i) => i.status !== 'done') ?? matches[matches.length - 1];
}
