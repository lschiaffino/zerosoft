import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-duplicate-status',
  date: '2026-11-23',
  title: {
    en: 'Track: Duplicate status',
    es: 'Track: estado Duplicado',
    pt: 'Track: status Duplicado',
  },
  items: [
    {
      product: 'track',
      en: 'Mark an issue as a duplicate of another from the command menu, the issue menu or with M then M, as in Linear. The issue moves to its team\'s Duplicate status (a canceled status, created the first time and renamable), both issues are linked, and its subscribers and customer requests move to the original. The original shows who marked it, with the duplicate\'s title, a short excerpt and how many comments and files it had. The duplicate shows a banner with a link to the original and an Unmark button, and ⌘Z puts everything back. You can only pick originals you can see; text from a private team is never copied into an issue other people can see. M then B, X or R add blocked by, blocking and related relations.',
      es: 'Marcá un issue como duplicado de otro desde el menú de comandos, el menú del issue o con M y M, como en Linear. El issue pasa al estado Duplicado de su team (un estado cancelado que se crea la primera vez y se puede renombrar), los dos quedan relacionados, y sus suscriptos y pedidos de clientes pasan al original. En el original queda quién lo marcó, con el título del duplicado, un extracto y cuántos comentarios y archivos tenía. El duplicado muestra un aviso con link al original y un botón para quitar la marca, y ⌘Z deja todo como estaba. Solo podés elegir originales que ves; el texto de un team privado nunca se copia a un issue que ve más gente. M y B, X o R suman las relaciones bloqueado por, bloquea y relacionado.',
      pt: 'Marque um issue como duplicado de outro pelo menu de comandos, pelo menu do issue ou com M e M, como no Linear. O issue vai para o status Duplicado do seu team (um status cancelado criado na primeira vez e que pode ser renomeado), os dois ficam relacionados, e seus seguidores e pedidos de clientes passam para o original. No original fica quem marcou, com o título do duplicado, um trecho e quantos comentários e arquivos ele tinha. O duplicado mostra um aviso com link para o original e um botão para remover a marca, e ⌘Z deixa tudo como estava. Você só escolhe originais que consegue ver; o texto de um team privado nunca é copiado para um issue que mais gente vê. M e B, X ou R adicionam as relações bloqueado por, bloqueia e relacionado.',
    },
  ],
} satisfies ChangelogEntry;
