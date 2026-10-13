---
title: "Zerosoft CRM vs. HubSpot: uma comparação honesta"
description: "Onde o HubSpot está muito à frente, onde o Zerosoft CRM se garante e quem deveria ficar onde está. Uma comparação que admite as lacunas em vez de escondê-las."
date: "2026-10-05"
author: "Zerosoftware"
tags: ["crm", "hubspot", "comparativo"]
---

O HubSpot não é um CRM. É uma plataforma de marketing, vendas, atendimento e conteúdo com um CRM no meio, construída ao longo de quase duas décadas por uma empresa muito grande. O Zerosoft CRM é um CRM: contatos, empresas, negócios, tarefas e os relatórios em volta. Comparar os dois recurso por recurso seria injusto com a gente e desonesto com você, então vamos fazer outra coisa: dizer claramente onde o HubSpot ganha, o que o Zerosoft CRM faz hoje e quem deveria escolher qual.

## A versão curta

- **Fique no HubSpot** se o seu marketing passa pelo CRM: campanhas de email, sequências, rastreamento de aberturas, formulários no seu site, lead scoring. Ou se você precisa de cotações, um marketplace grande de integrações, recursos de IA ou apps móveis.
- **Olhe o Zerosoft CRM** se o que você realmente usa é o pipeline, as fichas de contato e alguns relatórios, se está pagando por assentos e planos que não usa, e se prefere ser dono do banco de dados, da API e do código.

## Onde o HubSpot está muito à frente

Esta é a seção longa, de propósito.

**Automação de marketing.** O HubSpot pode tocar toda a sua operação de marketing: campanhas, fluxos de nutrição, landing pages, segmentação pelo comportamento no seu site. O Zerosoft CRM não tem módulo de marketing. Nossos workflows podem mandar um email quando algo acontece com um registro, mas é um email automático avulso, não uma ferramenta de campanhas.

**Sequências e templates de email.** Sequências de vendas com várias etapas que param quando o prospect responde, uma biblioteca de templates compartilhada, snippets. O Zerosoft CRM **não tem nada disso** hoje. Está no roadmap.

**Rastreamento de aberturas e cliques.** O HubSpot mostra quem abriu o quê. A gente não rastreia aberturas nem cliques dos emails do CRM.

**Sincronização automática de email.** O HubSpot registra sua caixa de entrada no contato certo em segundo plano. Nossa integração com o Gmail é **somente leitura e sob demanda**: você clica em "sincronizar", ela verifica até 100 dos seus contatos atualizados mais recentemente, traz até 8 mensagens recentes por contato e guarda metadados (assunto, trecho, direção, data), não o corpo. Nada roda em segundo plano. Sem Outlook.

**Cotações, produtos e itens de linha.** O HubSpot monta uma cotação a partir de um catálogo de produtos e envia para assinatura. Os negócios do Zerosoft CRM têm valor, etapa e data de fechamento. Sem produtos, sem cotações, sem itens de linha.

**Formulários de captura.** O HubSpot oferece formulários para incorporar no seu site que criam contatos sozinhos. A gente não tem formulários de leads no CRM. Dá para criar contatos pela API a partir do seu próprio formulário, mas aí é código escrito por você.

**Marketplace de integrações.** O HubSpot tem um marketplace com uma quantidade enorme de apps. O Zerosoft CRM tem uma API REST, uma ação `webhook` dentro dos workflows e conexões nativas com os outros produtos da Zerosoft. Ainda não emitimos eventos de webhook próprios do CRM.

**Recursos de IA.** O HubSpot traz assistentes de IA para escrever, resumir e prospectar. O Zerosoft CRM não tem recursos de IA.

**Apps móveis.** O HubSpot tem apps para iOS e Android. A gente não; o CRM funciona no navegador do celular e só.

**Enterprise e maturidade.** SSO, SCIM, logs de auditoria, papéis personalizados, permissões granulares, documentação de compliance, uma rede de parceiros e um exército de consultores. Nossos recursos enterprise ficam na pasta `/ee` e ainda estão em desenvolvimento. E um mais prosaico: negócios e atividades não podem ser importados, só contatos e empresas.

Se algum desses pontos é o motivo pelo qual você comprou o HubSpot, o resto deste post não muda isso.

## O que o Zerosoft CRM faz hoje

Nada disso é exótico. É o núcleo de um CRM, feito com cuidado, com o código aberto.

**Registros e associações.** Contatos, empresas e negócios, ligados entre si, cada um com sua timeline de atividades e suas tarefas. Campos personalizados de cinco tipos: texto, número, data, seleção e booleano.

**Pipelines.** Vários pipelines com suas próprias etapas e probabilidades, uma visão de tabela e um quadro kanban onde você arrasta negócios entre etapas. Escrevemos sobre [como manter esse quadro honesto](/blog/higiene-del-pipeline).

**Listas e visões.** Listas estáticas em que você adiciona pessoas à mão, listas dinâmicas que se atualizam a partir de um filtro, e visões salvas por entidade para ninguém reconstruir o mesmo filtro na segunda de manhã.

**Relatórios e dashboards.** KPIs e séries temporais, um funil com taxa de conversão por etapa, um forecast ponderado pela probabilidade de cada etapa, desempenho por origem e por responsável, um ranking de atividade, e dashboards que você monta com widgets. Dá para conduzir [uma revisão semanal](/blog/revision-semanal-del-crm) sem planilha.

**Workflows.** Gatilhos em contatos, negócios, tarefas e emails recebidos (criado, atualizado, mudança de etapa, ganho, perdido, tarefa vencida, email recebido, ou manual) que alimentam ações: enviar um email, criar uma tarefa, registrar uma atividade, atualizar um campo, adicionar a uma lista, chamar um webhook, avisar alguém do time. Workflows são só para admins. Aqui estão [cinco receitas práticas](/blog/workflows-crm-tareas-de-seguimiento).

**Importar e exportar.** Importação de CSV com mapeamento de colunas e deduplicação (por email para contatos, por domínio para empresas; pular ou atualizar os existentes), mais um painel de duplicados. Exportação para CSV ou JSON quando quiser, só para admins. O [guia de migração do HubSpot](/blog/migrar-contactos-de-hubspot-por-csv) explica passo a passo.

**Uma API que você não precisa negociar.** `/api/v1/crm/*` cobre contatos, empresas, negócios, tarefas e pipelines com as mesmas chaves pessoais `zs_` do resto da Zerosoft, documentadas em [/docs](/docs).

**O resto da suíte.** A partir de um contato você pega um link de agendamento do Zerosoft Cal com nome e email já preenchidos. Link, Track, Chat e Docs ficam atrás do mesmo login.

## Preços, sem números inventados

O HubSpot tem um CRM gratuito e hubs pagos vendidos por plano e por assento, com alguns produtos cobrando também por contatos de marketing. Os detalhes mudam com frequência; confira a página de preços deles em vez de confiar num número de post de blog, incluindo este.

O Zerosoft CRM é gratuito para self-hosting, para sempre, com todos os recursos do núcleo, sob AGPLv3. Na Zerosoft Cloud há um free tier generoso e depois pagamento por uso, com preços transparentes publicados antes de cobrarmos qualquer coisa. Nem por assento, nem por contato.

Preço só importa quando os recursos servem. Se você precisa de sequências e cotações, um CRM mais barato sem elas é só um problema mais barato.

## Quem deveria ficar no HubSpot

- Times em que **marketing e vendas compartilham o CRM** e vivem de campanhas, sequências, formulários e rastreamento.
- Times de vendas que dependem de **rastreamento de aberturas, templates e registro automático da caixa de entrada**.
- Quem envia **cotações a partir de um catálogo de produtos**.
- Empresas cujo stack se sustenta em **integrações do marketplace**.
- Vendedores que trabalham pelo **app do celular**.
- Organizações que precisam de **SSO, logs de auditoria e papéis personalizados** hoje.

Se é o seu caso, fique. O HubSpot é bom nessas coisas e não vamos fingir o contrário.

## Quem ganha com o Zerosoft CRM

- Times pequenos que usam o HubSpot como **uma base de contatos mais um pipeline** e pagam por muito mais.
- Founders e agências que querem **pipelines, tarefas e relatórios** sem call de vendas nem upgrade de plano.
- **Desenvolvedores** que querem uma API documentada, exportação completa e a opção de self-hosting num arquivo SQLite ou no Turso.
- Times que se importam com **onde ficam os dados dos clientes** e querem ler o código que mexe neles.
- Quem já usa **Zerosoft Cal, Link ou Chat**.

## Teste com os seus próprios dados

Exporte uma parte dos seus contatos e empresas do HubSpot, importe, monte um pipeline e faça sua próxima revisão semanal a partir dele. Uma tarde basta para saber. Se a primeira coisa de que você sentir falta for uma sequência ou um email rastreado, você já tem a resposta, e o HubSpot vale o que você paga.
