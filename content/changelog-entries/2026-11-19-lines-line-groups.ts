import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-line-groups',
  date: '2026-11-19',
  title: {
    en: 'Lines: group your lines and give access by group',
    es: 'Lines: agrupá tus líneas y dá acceso por grupo',
    pt: 'Lines: agrupe suas linhas e dê acesso por grupo',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Numbers has line groups (Sales, Operations): an admin creates them, renames them, orders them and puts each line in one. A group can be given to people or teams, and they see every line in it, including the lines added later. "Access by person" shows which groups and lines one person has and changes them in one place. Taking someone out of a group, or a line out of it, cuts their access to those chats, messages, search results, counts and notifications right away. Deleting a group never deletes its lines.',
      es: 'Ajustes › Números tiene grupos de líneas (Ventas, Operaciones): un admin los crea, los renombra, los ordena y pone cada línea en uno. Un grupo se le da a personas o equipos, que ven todas sus líneas, también las que se sumen después. "Acceso por persona" muestra qué grupos y qué líneas tiene una persona y los cambia en un solo lugar. Sacar a alguien de un grupo, o una línea del grupo, le corta en el acto el acceso a esos chats, mensajes, resultados de búsqueda, conteos y avisos. Borrar un grupo nunca borra sus líneas.',
      pt: 'Configurações › Números tem grupos de linhas (Vendas, Operações): um admin cria, renomeia, ordena e coloca cada linha em um. Um grupo é dado a pessoas ou equipes, que veem todas as linhas dele, também as adicionadas depois. "Acesso por pessoa" mostra quais grupos e linhas uma pessoa tem e muda tudo em um só lugar. Tirar alguém de um grupo, ou uma linha do grupo, corta na hora o acesso a essas conversas, mensagens, resultados de busca, contagens e avisos. Excluir um grupo nunca exclui as linhas dele.',
    },
    {
      product: 'groups',
      en: 'The line selector of the inbox lists each line under its group, and a whole group can be picked as the filter. Each person only sees the lines and groups they have access to.',
      es: 'El selector de línea de la bandeja lista cada línea debajo de su grupo, y se puede elegir un grupo entero como filtro. Cada persona ve solo las líneas y los grupos a los que tiene acceso.',
      pt: 'O seletor de linha da caixa lista cada linha abaixo do grupo dela, e dá para escolher um grupo inteiro como filtro. Cada pessoa vê só as linhas e os grupos a que tem acesso.',
    },
  ],
} satisfies ChangelogEntry;
