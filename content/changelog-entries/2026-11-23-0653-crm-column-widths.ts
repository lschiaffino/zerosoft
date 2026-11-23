import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0653-crm-column-widths',
  date: '2026-11-23',
  title: {
    en: 'CRM: resize columns in contacts, companies and deals',
    es: 'CRM: cambiá el ancho de las columnas en contactos, empresas y deals',
    pt: 'CRM: mude a largura das colunas em contatos, empresas e negócios',
  },
  items: [
    {
      product: 'crm',
      en: 'Drag the edge of a column header to make the column wider or narrower, and double-click the edge to fit it to its content. From the keyboard, focus the edge and use the left and right arrows (Shift moves faster) and Enter to fit. Widths are saved with the view like the columns themselves, and the name column stays frozen while the table scrolls. Edit columns now shows up with the rest of the toolbar instead of a moment later, and on a phone the quick filter row uses one text size.',
      es: 'Arrastrá el borde del encabezado de una columna para hacerla más ancha o más angosta, y hacé doble clic en el borde para ajustarla a su contenido. Con el teclado, poné el foco en el borde y usá las flechas izquierda y derecha (con Mayúsculas va más rápido) y Enter para ajustar. Los anchos se guardan con la vista como las columnas, y la columna del nombre queda fija al desplazar la tabla. Editar columnas ahora aparece con el resto de la barra y no un momento después, y en el teléfono la fila de filtros rápidos usa un solo tamaño de letra.',
      pt: 'Arraste a borda do cabeçalho de uma coluna para deixá-la mais larga ou mais estreita, e clique duas vezes na borda para ajustá-la ao conteúdo. Pelo teclado, coloque o foco na borda e use as setas esquerda e direita (com Shift vai mais rápido) e Enter para ajustar. As larguras são salvas com a visualização como as colunas, e a coluna do nome fica fixa ao rolar a tabela. Editar colunas agora aparece com o resto da barra e não um momento depois, e no celular a linha de filtros rápidos usa um só tamanho de letra.',
    },
  ],
} satisfies ChangelogEntry;
