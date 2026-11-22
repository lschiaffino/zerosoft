import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-talk-group-to-channel',
  date: '2026-11-22',
  title: {
    en: 'Change a group message in Talk into a private channel',
    es: 'Pasá un grupo de Talk a canal privado',
    pt: 'Transforme um grupo do Talk em canal privado',
  },
  items: [
    {
      product: 'talk',
      en: 'When a group conversation turns into something longer, any member can now change it into a private channel from its details, under Settings. You pick a name, and the messages, files and members stay as they are. Anyone added later can read the earlier messages. A group that includes guests cannot be changed.',
      es: 'Cuando una conversación de grupo se vuelve algo más largo, cualquier miembro puede pasarla a canal privado desde sus detalles, en Ajustes. Elegís un nombre y los mensajes, los archivos y los miembros se quedan igual. Quien se sume después puede leer los mensajes anteriores. Un grupo con invitados no se puede pasar a canal.',
      pt: 'Quando uma conversa em grupo vira algo mais longo, qualquer membro pode torná-la um canal privado pelos detalhes, em Ajustes. Você escolhe um nome e as mensagens, os arquivos e os membros continuam iguais. Quem entrar depois pode ler as mensagens anteriores. Um grupo com convidados não pode virar canal.',
    },
  ],
} satisfies ChangelogEntry;
