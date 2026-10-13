---
title: "zerosoft CRM vs. HubSpot: uma comparação honesta"
description: "Onde o HubSpot está muito à frente, onde o zerosoft CRM se garante e quem deveria ficar onde está. Uma comparação que admite as lacunas em vez de escondê-las."
date: "2026-10-05"
author: "zerosoft"
tags: ["crm", "hubspot", "comparativo"]
---

O HubSpot é uma plataforma de marketing, vendas, atendimento e conteúdo com um CRM no meio, construída ao longo de quase duas décadas por uma empresa muito grande. O zerosoft CRM é um CRM de vendas: contatos, empresas, negócios, email, cotações, formulários e relatórios. Este post diz onde o HubSpot ganha, o que o zerosoft CRM faz hoje e quem deveria escolher qual.

## A versão curta

- **Fique no HubSpot** se o seu marketing passa pelo CRM (campanhas, landing pages, nutrição por comportamento no site), se você depende de um marketplace grande de integrações, de apps móveis ou de SSO e logs de auditoria hoje.
- **Olhe o zerosoft CRM** se o que você usa é pipeline, fichas de contato, email de vendas, sequências, cotações e relatórios, se está pagando por assentos que não usa, e se prefere ser dono do banco de dados, da API e do código.

## Onde o HubSpot está muito à frente

**Automação de marketing.** O HubSpot toca uma operação de marketing inteira: campanhas, fluxos de nutrição, landing pages, segmentação pelo comportamento no site. O zerosoft CRM não tem módulo de marketing. Os workflows e as sequências cobrem email de vendas, não campanhas em massa.

**Gmail em produção.** Enviar e sincronizar pelo Gmail funciona, mas exige um cliente OAuth do Google verificado pelo Google. Até essa verificação, só usuários de teste conseguem conectar. Não há integração com Outlook.

**Cotações com cobrança.** Nossas cotações têm página pública com aceite e PDF, mas não têm assinatura eletrônica de um provedor nem cobrança integrada. As taxas de câmbio são manuais.

**Formulários avançados.** Os formulários do zerosoft CRM não têm várias páginas, campos condicionais, upload de arquivos nem CAPTCHA (a proteção é honeypot, tempo mínimo e limite por IP).

**Marketplace de integrações.** O HubSpot tem um marketplace enorme. O zerosoft CRM tem API REST, webhooks assinados (contact.*, deal.*), integração com o Flow e conexões nativas com o resto da suíte.

**Apps móveis.** O HubSpot tem apps para iOS e Android. O zerosoft CRM funciona no navegador do celular, e as tabelas rolam para o lado em vez de virar cartões.

**Enterprise e maturidade.** SSO, SCIM, logs de auditoria, documentação de compliance, rede de parceiros. Nossos recursos enterprise ficam na pasta `/ee` e estão em desenvolvimento.

## O que o zerosoft CRM faz hoje

**Registros e associações.** Contatos, empresas e negócios, com associações muitos-para-muitos (um contato pode ter várias empresas, com rótulos como decisor ou financeiro), hierarquia de empresas, campos personalizados, tags e histórico de alterações.

**Pipelines.** Vários pipelines com etapas e probabilidades, quadro kanban com arrastar entre etapas, ganho e perdido com motivo. Escrevemos sobre [como manter esse quadro honesto](/blog/higiene-del-pipeline).

**Email de vendas.** Envio pelo seu Gmail a partir da timeline, sincronização automática da caixa de entrada, templates e snippets com variáveis, rastreamento de aberturas e cliques, e sequências de várias etapas que param quando o contato responde, agenda pelo Cal ou se descadastra.

**Produtos, itens de linha e cotações.** Catálogo de produtos, itens de linha no negócio com desconto e imposto, várias moedas e cotações com página pública para o cliente aceitar.

**Formulários e lead scoring.** Formulários hospedados ou incorporados que criam o contato, registram a origem (UTM) e disparam workflows. Regras de pontuação por propriedade e por atividade recente.

**Listas, visões e relatórios.** Listas estáticas e dinâmicas, visões salvas, funil, forecast, desempenho por origem e por responsável, cotas por vendedor e dashboards com widgets. Dá para conduzir [uma revisão semanal](/blog/revision-semanal-del-crm) sem planilha.

**Workflows.** Gatilhos em registros, tarefas, emails, reuniões, cotações, formulários e pontuação, com ações como criar tarefa, atualizar campo, enviar email, chamar webhook, inscrever numa sequência ou rodar um flow. Aqui estão [cinco receitas práticas](/blog/workflows-crm-tareas-de-seguimiento).

**Times e visibilidade.** Times de vendas, distribuição de leads em round-robin e uma regra por workspace para cada membro ver todos os registros, só os seus ou os do seu time.

**Importar e exportar.** Importação de CSV de contatos, empresas e negócios com mapeamento de colunas, deduplicação e um preset para o export do HubSpot. Exportação para CSV ou JSON. O [guia de migração do HubSpot](/blog/migrar-contactos-de-hubspot-por-csv) explica passo a passo.

**API.** `/api/v1/crm/*` cobre os registros, atividades, tarefas, pipelines, produtos, cotações, tags, sequências e formulários, com chaves pessoais `zs_` e escopos, documentadas em [/docs](/docs).

## Preços, sem números inventados

O HubSpot tem um CRM gratuito e hubs pagos vendidos por plano e por assento, com alguns produtos cobrando também por contatos de marketing. Os detalhes mudam com frequência; confira a página de preços deles.

Hospedar o zerosoft CRM custa $0, com todos os recursos do núcleo, sob AGPLv3. No zerosoft Cloud há um plano grátis para começar e depois você paga pelo uso do workspace (emails, armazenamento). Não cobramos por assento nem por contato.

## Quem deveria ficar no HubSpot

- Times em que **marketing e vendas compartilham o CRM** e vivem de campanhas e nutrição.
- Empresas cujo stack se sustenta em **integrações do marketplace**.
- Vendedores que trabalham pelo **app do celular**.
- Organizações que precisam de **SSO, logs de auditoria e compliance** hoje.

## Quem ganha com o zerosoft CRM

- Times pequenos que usam o HubSpot como **pipeline, email de vendas e relatórios** e pagam por muito mais.
- Founders e agências que querem **sequências, cotações e formulários** sem call de vendas nem upgrade de plano.
- **Desenvolvedores** que querem API documentada, exportação completa e self-hosting num arquivo SQLite ou no Turso.
- Times que se importam com **onde ficam os dados dos clientes** e querem ler o código que mexe neles.
- Quem já usa **zerosoft Cal, Chat ou Flow**.

## Teste com os seus próprios dados

Exporte uma parte dos seus contatos, empresas e negócios do HubSpot, importe com o preset do HubSpot, monte um pipeline e faça a próxima revisão semanal a partir dele. Uma tarde basta para saber se serve.
