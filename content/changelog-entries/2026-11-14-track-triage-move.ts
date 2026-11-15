import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-track-triage-move',
  date: '2026-11-14',
  title: {
    en: 'Track: triage rules can send issues to another team',
    es: 'Track: las reglas de triage pueden mandar issues a otro team',
    pt: 'Track: as regras de triage podem mandar issues para outro team',
  },
  items: [
    {
      product: 'track',
      en: 'A triage rule can now move a matching issue to another team in the workspace. It lands in that team\'s triage queue with a new identifier, and that team\'s rules and person on duty take it from there. When the other team has triage off, the issue goes straight to its default status. Status, cycle and assignee belong to the original team, so they are turned off in a rule that moves. Two teams that send issues to each other stop after a few hops.',
      es: 'Una regla de triage ahora puede mover el issue que cumple la condición a otro team del workspace. Llega a la cola de triage de ese team con un identificador nuevo, y desde ahí siguen las reglas y quien está de turno en ese team. Si el otro team tiene el triage apagado, el issue entra directo a su estado por defecto. Estado, cycle y asignado son del team de origen, así que en una regla que mueve quedan desactivados. Dos teams que se mandan issues entre sí paran después de unos pocos saltos.',
      pt: 'Uma regra de triage agora pode mover o issue que cumpre a condição para outro team do workspace. Ele chega à fila de triage desse team com um identificador novo, e daí seguem as regras e quem está de plantão nesse team. Se o outro team está com o triage desligado, o issue entra direto no status padrão. Status, cycle e responsável são do team de origem, então numa regra que move ficam desativados. Dois teams que mandam issues um para o outro param depois de poucos saltos.',
    },
  ],
} satisfies ChangelogEntry;
