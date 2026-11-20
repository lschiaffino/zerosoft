import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1918-hiring-reject-reasons',
  date: '2026-11-20',
  title: {
    en: 'Hiring: your own rejection reasons, and a reason can be required',
    es: 'Hiring: motivos de rechazo propios, y el motivo puede ser obligatorio',
    pt: 'Hiring: motivos de recusa próprios, e o motivo pode ser obrigatório',
  },
  items: [
    {
      product: 'hiring',
      en: 'In Hiring settings an admin can now edit the list of rejection reasons: rename, remove or add them, or go back to the defaults. A new option asks for a reason before anyone rejects a candidate, one by one or in bulk. When rejecting, the reason is a list to pick from, with Other to write one. Reports keep counting rejections per reason.',
      es: 'En los ajustes de Hiring un admin ahora edita la lista de motivos de rechazo: cambiarles el nombre, quitarlos, sumar otros o volver a los de fábrica. Una opción nueva pide un motivo antes de rechazar a un candidato, de a uno o en lote. Al rechazar, el motivo se elige de una lista, con Otro para escribir uno. Los informes siguen contando los rechazos por motivo.',
      pt: 'Nos ajustes do Hiring um admin agora edita a lista de motivos de recusa: renomear, remover, adicionar outros ou voltar aos padrão. Uma opção nova pede um motivo antes de recusar um candidato, um por vez ou em lote. Ao recusar, o motivo é escolhido de uma lista, com Outro para escrever um. Os relatórios continuam contando as recusas por motivo.',
    },
  ],
} satisfies ChangelogEntry;
