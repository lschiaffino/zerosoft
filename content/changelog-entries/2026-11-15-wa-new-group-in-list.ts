import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-new-group-in-list',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: new groups show up right away, with their notices',
    es: 'Inbox y Lines: los grupos nuevos aparecen en el momento, con sus avisos',
    pt: 'Inbox e Lines: grupos novos aparecem na hora, com seus avisos',
  },
  items: [
    {
      product: 'inbox',
      en: 'A WhatsApp group you create, or one someone adds you to, now shows at the top of the list right away, even before anyone writes, with "You created group" or "Ana added you" as its preview and no unread badge. The empty chat shows who created it and how many members it has.',
      es: 'Un grupo de WhatsApp que creás, o al que te agregan, ahora aparece arriba de la lista en el momento, aunque nadie haya escrito, con "Creaste el grupo" o "Ana te agregó" de vista previa y sin marca de no leído. El chat vacío muestra quién lo creó y cuántos miembros tiene.',
      pt: 'Um grupo do WhatsApp que você cria, ou ao qual adicionam você, agora aparece no topo da lista na hora, mesmo antes de alguém escrever, com "Você criou o grupo" ou "Ana adicionou você" como prévia e sem marca de não lido. A conversa vazia mostra quem criou e quantos membros tem.',
    },
    {
      product: 'inbox',
      en: 'Groups show what happens in them as centered lines, like WhatsApp: who added or removed someone, who left, who joined with the invite link and who became admin. The latest one is the preview in the list, without moving the chat or counting as unread. Empty groups from your history keep the place of their creation date, so old ones stay at the bottom.',
      es: 'Los grupos muestran lo que pasa en ellos como líneas centradas, como WhatsApp: quién agregó o sacó a alguien, quién salió, quién entró con el link de invitación y quién pasó a ser admin. El último es la vista previa de la lista, sin mover el chat ni contar como no leído. Los grupos vacíos de tu historial quedan en el lugar de su fecha de creación, así los viejos quedan abajo.',
      pt: 'Os grupos mostram o que acontece neles como linhas centralizadas, como o WhatsApp: quem adicionou ou removeu alguém, quem saiu, quem entrou pelo link de convite e quem virou admin. O último é a prévia da lista, sem mover a conversa nem contar como não lido. Grupos vazios do seu histórico ficam no lugar da data de criação, então os antigos ficam embaixo.',
    },
    {
      product: 'groups',
      en: 'The same in Lines: a new group, or one the line is added to, shows in the inbox at once with its notice. The empty group card lets you add members, copy the invite link or add a description, and name or description changes made from zerosoft are noted in the chat.',
      es: 'Lo mismo en Lines: un grupo nuevo, o uno al que agregan a la línea, aparece en la bandeja en el momento con su aviso. La tarjeta del grupo vacío deja agregar miembros, copiar el link de invitación o agregar una descripción, y los cambios de nombre o descripción hechos desde zerosoft quedan anotados en el chat.',
      pt: 'O mesmo no Lines: um grupo novo, ou um ao qual a linha é adicionada, aparece na caixa na hora com seu aviso. O cartão do grupo vazio permite adicionar membros, copiar o link de convite ou adicionar uma descrição, e as mudanças de nome ou descrição feitas pelo zerosoft ficam anotadas na conversa.',
    },
  ],
} satisfies ChangelogEntry;
