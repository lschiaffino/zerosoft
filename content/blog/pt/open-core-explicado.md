---
title: "Open core explicado: o que é livre, o que é /ee e por que a linha está ali"
description: "Todos os produtos do Zerosoft são AGPL. Uma pasta, /ee, não. O que mora lá exatamente, o que diz a licença em rascunho, o que já existe hoje e como decidimos onde traçar a linha."
date: "2026-08-15"
author: "Zerosoftware"
tags: ["open source", "open core", "licenças"]
---

"Open core" é uma daquelas expressões que podem significar qualquer coisa, de "aberto de verdade com alguns extras pagos" até "uma demo capada com um repositório no GitHub". Então, em vez de definir no abstrato, aqui vai o nosso, com nomes de pastas.

O Zerosoft é um único repositório. Tudo nele é AGPLv3, exceto uma pasta chamada `/ee`. Esse é o modelo inteiro. O resto do post é sobre o que vai nessa pasta, o que não vai e por quê.

## O que está no core (basicamente, tudo)

Todo recurso de produto que você usa no dia a dia está fora de `/ee`, sob [AGPLv3](/blog/por-que-agpl):

- **Link:** aliases personalizados, QR codes, criação em massa, domínios próprios, páginas link-in-bio, webhooks, analytics sem cookies, a API pública.
- **CRM:** contatos, empresas, negócios com múltiplos pipelines, listas, campos personalizados, relatórios e dashboards, workflows, importação e exportação.
- **Track, Cal, Chat, Docs:** tudo. Ciclos e visão Gantt, formulários de roteamento e anfitriões em round-robin, políticas de SLA e CSAT, páginas aninhadas e compartilhamento.
- **Times:** workspaces com papéis owner, admin e member, convites, e ações exclusivas de admin como os workflows do CRM, a exportação e a exclusão em massa.

Nada disso exige chave de licença. Nada é "grátis até N usuários". Hospedar os seis produtos não custa nada, para sempre. O nosso próprio [ee/README.md](https://github.com/lschiaffino/zerosoft/blob/main/ee/README.md) diz sem rodeios: tudo fora de `/ee` é AGPLv3 "e sempre será".

## O que mora em /ee

A lista é curta e, hoje, é principalmente um plano. O README diz "o que mora aqui (à medida que for construído)":

- **SSO / SAML e provisionamento SCIM** — login com o provedor de identidade da sua empresa, criação e remoção automática de usuários.
- **Logs de auditoria** — quem fez o quê e quando, para compliance.
- **Papéis personalizados e permissões granulares** — além de owner / admin / member.
- **White-label** — remover a marca Zerosoft das páginas de agendamento e do widget de chat.

Vamos ser precisos sobre o status, porque é disso que este blog trata: **esses recursos estão em desenvolvimento.** O que existe na pasta hoje é o encanamento de licenças — `ee/lib/license.ts`, que verifica uma chave de licença — e o próprio texto da licença. Se você precisa de SAML semana que vem, o Zerosoft ainda não chegou lá, e preferimos que você ouça isso da gente.

## Como funciona o encanamento

Duas regras impedem que `/ee` vaze para o core:

1. **O código do core nunca importa de `/ee`**, exceto por `ee/lib/license.ts`, que expõe `isEnterprise()` e `hasFeature()`.
2. **Recursos enterprise precisam degradar de forma limpa.** Sem licença, o core continua funcionando exatamente igual.

As chaves de licença são verificadas **offline**: uma assinatura Ed25519 sobre um pequeno JSON (cliente, data de expiração, recursos). Sem phone-home, sem telemetria, sem um servidor nosso que precise estar no ar para a sua instância funcionar. Você define `ZEROSOFT_LICENSE_KEY` no ambiente; se ela faltar ou for inválida, `/ee` simplesmente fica desligado.

## O que diz a licença do /ee

A [Zerosoft Enterprise License](https://github.com/lschiaffino/zerosoft/blob/main/ee/LICENSE) é source-available, não open source. Em resumo — e o que vale é o texto da licença:

- **Desenvolvimento e testes são grátis.** Leia, copie, modifique, rode em ambientes que não são de produção sem pagar.
- **Uso em produção exige uma assinatura** que cubra o seu escopo de uso (usuários, instâncias ou uso).
- **Nada de redistribuir, revender como serviço ou contornar a verificação de licença.** Forks do repositório estão liberados, desde que `/ee` mantenha a licença e os avisos.

Mais uma nota honesta: **a licença é um rascunho pendente de revisão jurídica.** Isso está escrito logo no topo, e alguns detalhes entre colchetes ainda não foram preenchidos. Ela será finalizada antes da primeira venda comercial. Até lá, expressa de boa-fé os termos que pretendemos. Perguntas vão para hola@zerosoft.ai.

## Por que a linha está exatamente ali

Tínhamos um teste simples: **um time pequeno precisa disso para fazer o trabalho?** Se sim, vai para o core. Contatos, pipelines, páginas de agendamento, issues, uma caixa de entrada compartilhada, documentos, uma API, webhooks, exportações: uma empresa de cinco pessoas precisa de tudo isso, então tudo isso é grátis.

Os recursos de `/ee` não passam nesse teste de propósito. Ninguém numa empresa de cinco pessoas está pedindo SAML. Logs de auditoria, SCIM e papéis personalizados detalhados aparecem quando existe um time de segurança, uma exigência de compliance, um checklist de compras. Essas são as organizações que já esperam pagar por software, que precisam de alguém para atender o telefone e que tiram valor real de um contrato.

Há uma segunda razão, menos óbvia: é ali que está o peso do suporte. Cada provedor de identidade é um pouco diferente; requisitos de auditoria são específicos de cada setor. Cobrar por isso financia as pessoas que fazem a coisa funcionar.

## O que prometemos não fazer

O open core tem um modo de falha conhecido: a empresa vai movendo aos poucos recursos úteis do lado gratuito para o pago, ou começa a lançar o essencial novo só atrás da licença. Alguns produtos open core pioraram assim para os usuários gratuitos.

As nossas proteções contra isso:

- **O core não pode ser retirado.** O que foi publicado sob AGPL continua AGPL. Mesmo que mudássemos de ideia, a última versão livre pode ser forkada para sempre.
- **A lista de `/ee` é pública e específica.** Está no README. Se um dia ela crescer para incluir algo que um time pequeno precisa, você vai ver num diff.
- **A nossa nuvem também não vende o core.** O Zerosoft Cloud tem um plano gratuito generoso e depois cobra por uso — o que escala — com preços transparentes publicados antes de cobrar qualquer coisa. Vendemos conveniência e extras enterprise, nunca os recursos em si.

## Para quem /ee importa

Sinceramente, para a maioria dos leitores deste blog, não importa. Se você é freelancer, startup ou empresa pequena hospedando o Zerosoft, o core é o produto e você nunca vai encostar numa chave de licença.

Se você está numa organização maior que precisa de SSO, trilhas de auditoria ou papéis personalizados: estão a caminho, o código vai estar legível antes de você comprar e dá para testar de graça. Escreva para a gente e conte qual você precisa primeiro — isso ajuda de verdade a decidir o que construir.
