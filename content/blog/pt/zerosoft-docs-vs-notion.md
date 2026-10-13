---
title: "zerosoft Docs vs Notion: uma comparação honesta"
description: "O Notion está à frente em coedição em tempo real, bancos de dados, IA, importação e exportação, integrações e apps móveis. O Docs é um editor enxuto e auto-hospedável para wikis e notas. Quem deveria ficar, e para quem ele serve."
date: "2026-10-07"
author: "zerosoft"
tags: ["docs", "notion", "comparação"]
---

O Notion mudou o que as pessoas esperam de uma ferramenta de documentos. Páginas dentro de páginas, blocos que você arrasta, um menu com barra, bancos de dados que transformam um documento num app leve. O Docs, a alternativa ao Notion da suíte zerosoft, pega muitas dessas ideias, e implementa uma fatia bem menor delas.

Então este não é um post de "somos tão bons quanto, só que de graça". É um mapa: onde o Notion está claramente à frente, o que o Docs faz de verdade e como saber qual dos dois o seu time precisa.

## A versão curta

- O **Notion** é um espaço de trabalho tudo-em-um e maduro: colaboração em tempo real, bancos de dados poderosos, IA integrada, importação e exportação de e para muitos formatos, um grande ecossistema de integrações e apps em todas as plataformas. Faz muita coisa, e quase tudo bem.
- O **Docs** é open source (AGPLv3), auto-hospedável e focado: um editor de blocos, páginas aninhadas, links com `[[`, templates, comentários, compartilhamento e lixeira. Serve bem para uma wiki de time, notas de reunião e specs: no seu próprio servidor, se você quiser.

## Onde o Notion está claramente à frente

**Coedição em tempo real.** No Notion, várias pessoas escrevem na mesma página ao mesmo tempo e veem o cursor umas das outras. O Docs salva sozinho, mas não mescla edições simultâneas: se duas pessoas editam a mesma página ao mesmo tempo, vale o último salvamento. Para uma wiki com donos de página, dá para lidar. Para um time que escreve junto ao vivo, não dá.

**Bancos de dados.** É o superpoder do Notion. Relações entre bancos, rollups, fórmulas, muitos tipos de propriedade e visões como board, calendário e timeline sobre os mesmos dados. O Docs tem um **bloco de banco de dados**: uma tabela pequena com colunas tipadas (texto, número, seleção, data) que pode ser vista como tabela ou galeria. Serve para uma lista de ferramentas ou de leituras. Não substitui um banco do Notion que roda metade da sua operação.

**IA.** O Notion tem IA integrada para escrever, resumir e responder perguntas sobre todo o seu espaço. O Docs não tem recursos de IA.

**Importação e exportação.** O Notion importa de muitas ferramentas e formatos, e exporta para Markdown, HTML e PDF. O Docs não importa do Notion e ainda não exporta para JSON nem Markdown; o mais próximo é "Copiar conteúdo da página", que copia a página como texto simples. Se você hospeda, suas páginas ficam no seu próprio banco de dados, mas uma exportação decente ainda é dívida nossa.

**Busca.** O Notion busca no conteúdo de todas as páginas. O Docs busca por título de página: é o que faz os links com `[[` funcionarem, e não procura dentro do corpo.

**Integrações e API.** O Notion tem API pública e um ecossistema enorme de integrações e automações. O Docs ainda não tem nenhum dos dois.

**Apps, offline e acabamento.** Apps nativos para desktop e celular, histórico de páginas, páginas públicas que você publica como site, blocos sincronizados, anos de refinamento. O Docs roda no navegador, e só.

**Enterprise.** SSO, logs de auditoria, permissões granulares. Nossas peças enterprise (SSO/SAML, logs de auditoria, papéis personalizados) estão em desenvolvimento em `/ee`, não lançadas.

## O que o Docs faz bem de verdade

**O básico do editor.** Digite `/` para o menu de comandos: parágrafos, três níveis de título, listas com marcadores e numeradas, to-dos, citações, blocos de código com linguagem, divisores, tabelas simples e o bloco de banco de dados. Formatação inline, ícones de página com seletor de emoji, capas.

**Uma árvore de páginas de verdade.** As páginas se aninham o quanto você precisar. A barra lateral mostra a árvore, dá para arrastar uma página sobre outra para aninhá-la, e mover uma página leva toda a subárvore junto.

**Links e menções.** Digite `[[` para linkar outra página pelo título. Digite `@` para mencionar um colega e notificá-lo.

**Templates.** Notas de reunião, spec de projeto e retro semanal, além da página em branco. Ainda não dá para salvar templates próprios, mas **Duplicar** copia uma página com todas as subpáginas, o que faz uma seção "Templates" na sua wiki funcionar surpreendentemente bem.

**Comentários.** Na página inteira ou num bloco específico, com resolver e reabrir.

**Compartilhamento e lixeira.** Um painel para compartilhar com as opções público, time e usuário específico; uma lixeira onde as páginas são restauradas ou excluídas de vez.

Escrevemos um [guia passo a passo para montar uma wiki interna com o Docs](/blog/wiki-interna-con-docs) se você quiser ver essas peças funcionando juntas.

## Onde o Docs leva vantagem

**É seu.** AGPLv3, auto-hospedável, páginas guardadas num arquivo SQLite ou num banco libSQL/Turso que você controla. Nenhum fornecedor pode mudar as regras sobre a base de conhecimento da sua empresa. Se o [lock-in](/blog/el-lock-in-es-el-producto) te preocupa, o ponto é esse.

**Faz parte de uma suíte.** O mesmo login e o mesmo time te dão as outras dez apps da suíte, como Track, Chat, CRM e Cal. Uma conexão concreta: o bot de resposta automática do Chat pode usar suas páginas do Docs como fonte (com IA, se estiver configurada, ou por palavras-chave). Sua wiki pode responder as perguntas simples dos clientes.

**Menos para configurar.** O Docs tem menos recursos, e isso não é só fraqueza. Tem time que se afogou em setups do Notion (bancos de bancos, relações que ninguém entende) e se dá melhor com uma ferramenta que só sabe de páginas e links.

**Preço.** O Notion tem um plano gratuito e planos pagos por usuário, com a IA cobrada à parte em alguns planos; confira a página de preços deles para os números atuais. O Docs auto-hospedado custa $0. O zerosoft Cloud tem um plano grátis para começar e depois cobra pelo uso do workspace, sem cobrança por assento.

## Quem deveria ficar no Notion

Fique se:

- Seu time escreve nas mesmas páginas ao mesmo tempo, com frequência.
- Você roda fluxos de verdade em bancos do Notion: relações, rollups, fórmulas, visões de board e calendário.
- Você usa o Notion AI todo dia.
- Você precisa de busca de texto completo num espaço grande.
- Você depende de integrações, da API ou de publicar páginas públicas.
- Você precisa de apps para celular ou desktop, ou de acesso offline.
- Você tem anos de conteúdo no Notion. Sem importador, migrar seria trabalho manual.

Para esses times, o Docs seria um passo atrás, e a gente prefere que você saiba disso antes de testar.

## Para quem é o Docs

- Times pequenos que precisam de uma wiki, notas de reunião e specs, com donos de página claros.
- Empresas que querem o conhecimento interno no próprio servidor, sob uma licença open source.
- Times que já usam outros produtos da zerosoft, principalmente o Chat, e querem docs e suporte no mesmo lugar.
- Qualquer um que achou o Notion mais poderoso do que precisava e está pagando por assento por um poder que não usa.

## Resumindo

O Notion é o produto mais amplo e capaz, e para muitos times é a ferramenta certa. O Docs é um editor enxuto, aberto e auto-hospedável que faz páginas, links, templates e comentários bem o bastante para sustentar uma wiki de time, e que é seu. Vamos continuar fechando lacunas; coedição em tempo real e exportação estão no nosso roadmap. Até saírem, não vamos prometê-las.
