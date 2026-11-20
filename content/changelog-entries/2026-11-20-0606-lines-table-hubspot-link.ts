import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-table-hubspot-link',
  date: '2026-11-20',
  title: {
    en: 'Lines: link HubSpot right in the Groups and Contacts tables',
    es: 'Lines: vincular HubSpot en la misma celda de las tablas de Grupos y Contactos',
    pt: 'Lines: vincular o HubSpot na própria célula das tabelas de Grupos e Contatos',
  },
  items: [
    {
      product: 'groups',
      en: 'In the Groups table, click "Not linked" in the HubSpot company column and the cell becomes a search box: type two letters, pick a company from the list under the cell (arrow keys and Enter work too) and the group is linked. A linked company has a small menu to change or unlink it. The Contacts table does the same with the HubSpot contact. Who can link is the same as in the details panel, and guests only see the link.',
      es: 'En la tabla de Grupos, al hacer clic en "Sin vincular" en la columna de empresa de HubSpot, la celda pasa a ser un buscador: escribís dos letras, elegís la empresa de la lista que aparece debajo (también con las flechas y Enter) y el grupo queda vinculado. Una empresa vinculada tiene un menú chico para cambiarla o desvincularla. La tabla de Contactos hace lo mismo con el contacto de HubSpot. Quién puede vincular es lo mismo que en el panel de detalles, y los invitados solo ven el vínculo.',
      pt: 'Na tabela de Grupos, ao clicar em "Sem vínculo" na coluna de empresa do HubSpot, a célula vira uma busca: digite duas letras, escolha a empresa na lista que aparece embaixo (também com as setas e Enter) e o grupo fica vinculado. Uma empresa vinculada tem um menu pequeno para trocar ou desvincular. A tabela de Contatos faz o mesmo com o contato do HubSpot. Quem pode vincular é o mesmo que no painel de detalhes, e os convidados só veem o vínculo.',
    },
  ],
} satisfies ChangelogEntry;
