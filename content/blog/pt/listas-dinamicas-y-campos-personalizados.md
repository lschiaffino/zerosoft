---
title: "Listas estáticas, listas dinâmicas e campos personalizados, sem fazer bagunça"
description: "Como segmentar contatos no Zerosoft CRM com listas estáticas, listas dinâmicas, visualizações salvas e campos personalizados: para que serve cada um, o que não consegue fazer e algumas regras para manter os dados limpos."
date: "2026-09-20"
author: "Zerosoftware"
tags: ["crm", "segmentação", "guia"]
---

Todo CRM acaba ganhando uma gaveta da bagunça. Um campo chamado "Notas 2". Um seletor com as opções "Sim", "sim" e "S". Trinta listas chamadas "Webinar", "Webinar março", "webinar março FINAL". Nenhuma foi uma má ideia na hora. Juntas, deixam a segmentação mais lenta do que exportar para uma planilha, que é exatamente o que o pessoal acaba fazendo.

O Zerosoft CRM te dá três ferramentas para fatiar seus contatos: listas estáticas, listas dinâmicas e visualizações salvas, além dos campos personalizados para fatiar por eles. Elas se sobrepõem um pouco, e cada uma tem limites que vale conhecer. Veja quando usar cada uma.

## As três ferramentas, um parágrafo cada

**Listas estáticas** são um conjunto de contatos escolhidos a dedo. Você adiciona pessoas pela página da lista (buscar e adicionar) ou automaticamente com a ação de workflow "Adicionar à lista". Elas não mudam, a menos que alguém, ou um workflow, as mude. Servem para: participantes de um evento, clientes beta, "o pessoal que conhecemos na feira".

**Listas dinâmicas** são um filtro salvo sobre contatos que é recalculado toda vez que você a abre. O filtro pode combinar uma busca de texto (nome ou e-mail), estágio do ciclo de vida, status do lead e origem. A página de listas mostra a contagem de membros ao vivo; a lista em si mostra até 500 membros. Servem para: "todos os SQLs", "leads novos que vieram de indicação", "todo mundo em momento ruim".

**Visualizações salvas** são uma configuração de tabela salva sobre contatos, empresas, deals ou tarefas: filtros rápidos, filtros avançados e ordenação. O construtor de filtros avançados combina regras com E e funciona com campos padrão e com campos personalizados. Servem para: tudo o que depende de um campo personalizado, ou que é sobre empresas e deals em vez de contatos.

## O limite que decide a maioria dos casos

Aqui vai a parte honesta: **listas dinâmicas filtram só por quatro coisas**: busca de texto, estágio do ciclo de vida, status do lead e origem. Elas não filtram por campos personalizados, responsável, empresa ou data de criação, e as listas são só de contatos.

Então a regra prática é simples:

- O segmento depende do ciclo de vida, do status do lead ou da origem → **lista dinâmica**.
- O segmento depende de um campo personalizado, de um responsável, de uma data, ou é sobre empresas ou deals → **visualização salva**.
- O segmento é um grupo de pessoas específicas que nenhum filtro descreve → **lista estática**.

Mais uma coisa que as listas não fazem: elas não são listas de e-mail. O Zerosoft CRM não envia campanhas de marketing nem sequências. Uma lista serve para organizar, contar e disparar trabalho, não para disparar e-mail em massa.

## Campos personalizados: o que existe

Os campos personalizados ficam em Configurações → Campos personalizados e podem ser adicionados a **contatos, empresas e deals**. Cinco tipos:

- **Texto**: texto livre.
- **Número**: valores, quantidades, meses.
- **Data**: datas de renovação, fim do trial, última auditoria.
- **Seleção**: um conjunto fixo de opções (até 100).
- **Booleano**: sim ou não.

Cada campo tem uma **chave** e um **rótulo**. A chave é o que os dados, a API e os workflows usam: minúsculas, começando com letra, só letras, dígitos e sublinhados, como `contract_months` ou `renewal_date`. O rótulo é o que as pessoas veem, e você pode mudá-lo quando quiser. Escolha a chave com cuidado: na tela de configurações dá para editar o rótulo e as opções de seleção, mas não a chave.

Onde os campos personalizados aparecem:

- Na **página do registro**, numa seção própria.
- Nos **filtros**: campos de seleção viram filtros rápidos em dropdown nas tabelas de contatos e deals, e todo campo personalizado fica disponível no construtor de filtros avançados, com operadores adequados ao tipo (contém, =, >, antes de, entre, é / não é…).
- Nos **workflows**: "Atualizar campo" pode gravar `custom.sua_chave`, e e-mails e notificações podem imprimir `{{contact.custom.sua_chave}}`, `{{deal.custom.sua_chave}}` e assim por diante.
- Na **API**, como o objeto `custom` de contatos, empresas e deals.
- Nas **exportações**, dentro da coluna `custom`.

## Regras para não fazer bagunça

### 1. Prefira seleção a texto sempre que a resposta for uma categoria

Um campo de texto chamado "Setor" vai acumular "SaaS", "saas", "Software" e "software (B2B)" em um mês. Uma seleção com seis opções não deixa. Se dá para listar as respostas, é seleção. Texto é para coisas realmente livres: uma nota curta, um número de referência.

### 2. Prefira um campo padrão a um personalizado

Antes de criar um campo, confira se ele já existe. Estágio do ciclo de vida, status do lead, origem, prioridade, valor e data de fechamento são padrão e funcionam em todo lugar: listas dinâmicas, relatórios, o quadro. Uma "Temperatura do lead" personalizada que duplica o status do lead vai rachar seus dados em dois.

### 3. Dê nomes às chaves pensando no futuro, não no hoje

`q3_webinar_attended` é um campo que você vai apagar em outubro. `webinar_attended_at` (uma data) serve para todos os webinars. Nomeie as chaves pelo conceito estável e coloque a parte variável no valor.

### 4. Todo campo precisa de um dono e de um motivo

Se ninguém sabe dizer qual relatório, filtro ou decisão usa um campo, não crie. Revise os campos personalizados uma vez por trimestre. Excluir um é só para admins e o tira de formulários e filtros, mas não limpa os valores armazenados nos registros, que continuam saindo nas exportações. Excluir é arrumação, não apagamento.

### 5. Dinâmica antes de estática

Uma lista estática congela no momento em que você a cria. Um mês depois ela está errada nas duas direções: falta gente que deveria estar e sobra gente que não deveria. Se um filtro consegue descrever o segmento, use uma lista dinâmica ou uma visualização salva. Use listas estáticas só quando a participação for um fato do passado ("foi ao evento de março") e não um estado ("é cliente").

### 6. Deixe os workflows manterem as listas estáticas

Quando uma lista estática fizer sentido, não a mantenha na mão. Exemplo: "Clientes 2026" como lista estática, alimentada por um workflow com o gatilho **Deal ganho** e a ação **Adicionar à lista**. A ação adiciona o primeiro contato do deal. Vira um registro que só cresce de quem virou cliente, sem nenhum clique.

### 7. Uma única convenção de nomes para listas

Escolha um padrão e siga, por exemplo `[Tipo] Descrição`: `[Evento] Feira Madri 2026`, `[Segmento] SQL de indicação`, `[Ops] Leads intocados`. Quando houver 40 listas, você vai agradecer por elas se organizarem sozinhas.

## Um exemplo completo

Digamos que você toca uma agência pequena e quer encontrar "clientes cujo contrato renova nos próximos 60 dias".

1. Crie um campo personalizado em **empresas**: `renewal_date`, tipo Data.
2. Preencha para seus clientes (na mão, ou uma vez pela API se estiver numa planilha).
3. Na tabela de empresas, abra os filtros avançados: **ciclo de vida é Cliente** E **renewal_date entre** hoje e daqui a 60 dias.
4. Salve como visualização: "Renovações, próximos 60 dias".

Isso é uma visualização salva, não uma lista, porque depende de um campo personalizado e vive em empresas. Atenção: as datas dos filtros são absolutas, então atualize o intervalo sempre que for usar.

A melhor configuração de CRM não é a que tem mais campos e listas. É aquela em que todo campo tem um motivo, toda lista tem uma regra, e qualquer pessoa do time encontra o segmento certo em dez segundos.
