---
title: "Migrar do Notion para o Docs: dois caminhos e uma lista de conferência"
description: "Como levar seu workspace do Notion para o Docs com a exportação em Markdown e CSV ou com uma integração por API: o que viaja, o que revisar e em que ordem."
date: "2026-10-29"
author: "zerosoft"
tags: ["docs", "notion", "migração"]
---

Um workspace do Notion se acumula ao longo dos anos: wikis, bancos de dados de projetos, notas de reunião, páginas que alguém duplicou "só por garantia". Levar isso para outro lugar dá preguiça, quase sempre por causa de uma pergunta sem resposta à mão: o que se perde no caminho?

Este guia responde isso para o Docs. Há dois caminhos de importação, uma lista para fazer antes e outra para conferir depois. Se você ainda está avaliando se o Docs atende, veja primeiro a [comparação com o Notion](/blog/zerosoft-docs-vs-notion).

## Antes de começar: organize o que vai mover

Importar é uma boa desculpa para não levar o lixo. Uma hora de preparo economiza várias depois:

1. Abra seu workspace e liste as dez páginas que o time realmente consulta.
2. Marque os bancos de dados que continuam vivos (linhas editadas nos últimos meses).
3. Arquive ou apague o resto. Na dúvida, exporte mesmo assim e deixe numa página Arquivo.

Com esse mapa, o resto é mecânico.

## Caminho 1: a exportação em Markdown e CSV

O caminho mais simples, e não precisa de credencial de ninguém.

**No Notion.** Segundo a [ajuda oficial de exportação](https://www.notion.com/help/export-your-content), a exportação do workspace inteiro fica em Settings, General, Export all workspace content, e o Notion manda um e-mail com o link de download quando fica pronta. Eles avisam que pode demorar bastante em workspaces grandes e que o link vence em 7 dias, então não deixe para o último dia. Também dá para exportar uma página só pelo menu de três pontos. Escolha Markdown & CSV, com subpáginas e com arquivos e imagens.

**No Docs.** Abra o Docs, vá em Importar, escolha o Notion como origem, o destino (o workspace ou um teamspace onde você possa escrever) e envie o .zip. Antes de gravar qualquer coisa, o Docs mostra uma prévia com a quantidade de páginas, bancos, arquivos e o tamanho, além da árvore de páginas. Se estiver certo, você confirma.

O que o importador faz, segundo o código:

- Cada arquivo .md vira uma página, mantendo a árvore de pastas que o Notion monta.
- Os links entre páginas do export viram links `[[` para as páginas novas, então a rede de referências sobrevive.
- Imagens e anexos sobem para o seu armazenamento como blocos de imagem ou arquivo.
- Os blocos `<aside>` do Notion viram callouts.
- Cada CSV vira um bloco de banco de dados, com os tipos de coluna detectados. A página de cada linha entra como o corpo dessa linha, não como subpágina.
- Limites: até 1 GB por arquivo e 5.000 páginas por importação. Se você importar o mesmo export de novo, as páginas que já entraram são puladas em vez de duplicadas.

## Caminho 2: a integração por API

Serve quando você não quer esperar um export, quando precisa levar só uma parte ou quando quer sincronizar de novo depois.

1. No Notion, crie uma integração interna e copie o segredo. Dê permissão para ler conteúdo e, se quiser que as pessoas correspondam aos seus membros, para ler informações de usuário com e-mail.
2. Em cada página raiz que quiser levar, abra o menu de três pontos, Conexões, e adicione a integração. O que você não compartilhar com ela fica invisível.
3. No Docs, vá em Configurações, Importar, Notion, cole o segredo e escolha o destino. O Docs testa o token com um pedido de leitura antes de importar qualquer coisa.
4. Confira a prévia: ela mostra páginas, bancos e linhas, deixa você escolher o que levar (páginas, bancos, imagens e arquivos) e estima quanto vai demorar.

Esse caminho respeita o limite da API do Notion de 3 pedidos por segundo, por isso uma importação grande pode levar vários minutos. Se parar, continua de onde parou. Menções e links entre páginas são reescritos para as páginas importadas, fórmulas e rollups entram com o valor atual (não como fórmula viva), e arquivos de até 10 MB são copiados para o seu armazenamento.

Uma vantagem prática: se importar de novo, o que já foi importado é atualizado em vez de duplicado. E se alguém editou no zerosoft uma página importada, ela não é sobrescrita, a menos que você escolha substituir de propósito. Isso permite migrar por etapas: leve um time, teste por uma semana e depois leve o próximo.

## O que conferir depois

Nenhuma migração é idêntica à origem. Dedique meia hora a esta lista:

- **Páginas-chave.** Abra suas dez páginas mais usadas e compare com o Notion. Títulos, listas, tabelas e código devem ficar iguais.
- **Bancos de dados.** Confira os tipos de coluna detectados (datas, selects, números) e as visões. Fórmulas e rollups chegam com o valor do momento da importação; se você dependia de recálculo, será preciso refazê-las.
- **Links.** Escolha uma página com muitas referências e clique em cada `[[`.
- **Arquivos grandes.** Os que passam de 10 MB ficam só com o nome e não sobem. O resumo da importação diz quantos foram.
- **Acessos.** As permissões do Notion não viajam. As páginas ficam com o acesso do destino escolhido, então crie o teamspace antes de importar e coloque os membros certos.
- **Páginas públicas.** Se você publicava páginas do Notion com um link, publique de novo pelo Docs; a URL muda.

## Um plano de uma semana

- **Dia 1.** Organize o workspace do Notion e peça o export.
- **Dia 2.** Importe para um teamspace de teste e passe pela lista acima.
- **Dia 3.** Corrija o que saiu diferente e avise o time.
- **Dia 4.** Importe o resto para o destino definitivo.
- **Dia 5.** Troque o hábito: a wiki nova é o único lugar onde se escreve.
- **Depois.** Deixe o Notion só para leitura por um mês e exporte uma última vez antes de encerrar.

## Por que vale pensar na saída

Migrar é um bom momento para perguntar onde moram seus dados. No Docs você exporta cada página para Markdown ou PDF e, se hospedar o zerosoft por conta própria, as páginas ficam no seu banco e no seu armazenamento. A próxima mudança, se um dia for necessária, não depende de um e-mail com link que vence. O Docs tem seus próprios limites, que publicamos na [página do produto](/products/docs): vale ler antes de decidir.
