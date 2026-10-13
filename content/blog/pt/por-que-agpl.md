---
title: "Por que AGPLv3 (e não MIT, Apache ou BSL)"
description: "Escolhemos a licença que assusta alguns advogados. O que a AGPLv3 realmente exige, o que não exige, a cláusula de rede sem juridiquês e o que significa hospedar o Zerosoft na sua empresa."
date: "2026-07-31"
author: "Zerosoftware"
tags: ["open source", "licenças", "agpl"]
---

Toda empresa open source, mais cedo ou mais tarde, tem a conversa sobre licença. A nossa foi curta: o core do Zerosoft — cada recurso do Link, CRM, Track, Cal, Chat e Docs — está sob a GNU Affero General Public License, versão 3. Não MIT. Não Apache 2.0. Não a Business Source License que está na moda nesta década.

A AGPL tem fama. Algumas empresas proíbem de cara, e muitos devs acham que ela significa "você vai ter que abrir o código da empresa inteira". Não é isso. Então aqui vai por que escolhemos a AGPL e o que ela realmente pede de você.

Um aviso antes de começar: esta é a nossa leitura de uma licença pública, escrita por gente que faz software, não por advogados. Não é aconselhamento jurídico. Se a sua empresa tem algo sério em jogo numa questão de licença, o texto da licença e o seu advogado valem mais que um post de blog.

## As opções que descartamos

**MIT e Apache 2.0** são permissivas. Qualquer um pode pegar o código, modificar, fechar e vender, sem obrigação de devolver nada. É uma escolha totalmente honesta e muito software excelente usa. Para nós, tem um problema concreto: uma empresa com muito dinheiro poderia pegar os seis produtos, colocar atrás de um login, melhorar em segredo e competir com exatamente aquilo que estamos tentando manter livre. Licenças permissivas tornam isso legal e barato.

**BSL e outras licenças "source-available"** vão para o outro lado. Você pode ler o código, mas o uso em produção é restrito (normalmente: não ofereça como serviço concorrente) até uma data de mudança, anos depois, quando vira uma licença aberta. Protege a empresa. Mas não é open source pela definição da Open Source Initiative, e as regras podem endurecer a cada nova versão. Não queríamos que o nosso core fosse algo que você pode *olhar*. Queríamos que fosse algo que você *tem*.

**AGPLv3** fica no meio de um jeito bem específico: é uma licença open source de verdade, aprovada pela OSI, e fecha a única brecha que importa em software web.

## O que a família GPL exige

A ideia da GPL é antiga e simples: você pode usar, estudar, modificar e compartilhar o software, e se *distribuir* uma versão modificada, precisa compartilhar o código dela sob a mesma licença. As liberdades viajam com o código.

O problema com web apps é que elas nunca são distribuídas. Os usuários acessam um servidor; nunca recebem um binário. Com a GPL pura, uma empresa pode modificar uma web app, rodá-la como serviço para milhões de pessoas e nunca compartilhar uma linha. Isso às vezes é chamado de "brecha do SaaS".

## A cláusula de rede, sem juridiquês

A AGPL acrescenta uma coisa só: a seção 13. Se você **modificar** o programa e houver usuários **interagindo com ele remotamente pela rede**, a sua versão modificada precisa oferecer a esses usuários um jeito de obter o código-fonte correspondente.

É isso. Algumas consequências que muita gente não percebe:

- **Sem modificação, sem obrigação extra.** Rodar o Zerosoft sem modificar — mesmo como serviço público — não ativa a seção 13. O código já é público.
- **É sobre os usuários da sua instância.** A obrigação é com as pessoas que interagem com a sua versão modificada, não com "a internet inteira" nem com a gente.
- **Cobre o programa e as suas alterações**, sob a mesma licença. Não se estende a software alheio que só conversa com ele por HTTP, como os scripts que chamam a nossa API pública com uma chave `zs_…`.

## O que significa se você hospeda na empresa

O caso mais comum: uma empresa roda o Zerosoft no próprio servidor para o próprio time.

- **Sem modificar:** use como quiser. Interno, externo, comercial: nenhuma obrigação além de manter os avisos de licença. Você não paga nada para a gente e não publica nada.
- **Modificado, só para uso interno:** quem interage com ele são os seus próprios funcionários. Oferecer a eles o código do seu próprio fork interno é, na prática, um não-evento. Nada fica público.
- **Modificado, com superfícies públicas:** esta é a parte que vale pensar. Vários recursos do Zerosoft são usados por pessoas de fora da sua empresa: as páginas públicas de agendamento do Cal em `/book/[slug]`, o widget incorporável do Chat, as páginas link-in-bio em `/@handle`. Uma leitura conservadora é que esses visitantes também interagem com a sua versão modificada, então você deveria poder oferecer o código a eles. O jeito fácil de ficar tranquilo: mantenha o seu fork num repositório público, ou mande as alterações para a gente.

E se você contribuir com a sua alteração, a questão desaparece: ela passa a estar no código principal, que já é público.

## Por que isso também protege você

A AGPL costuma ser apresentada como proteção para o autor. Ela também protege o usuário.

Cada melhoria que alguém faz num serviço público do Zerosoft volta para o bem comum. Ninguém consegue montar uma versão fechada e melhor em cima do código do qual você depende e deixar você para trás. E como o copyleft vale para todo mundo — inclusive para qualquer empresa que um dia nos compre —, o código publicado hoje continua AGPL para sempre. Um futuro dono poderia mudar a licença do código *novo*, mas não pode retirar o que já foi publicado. Você sempre pode fazer um fork da última versão livre.

Essa é a diferença para uma licença que é revisada a cada release. Fizemos a promessa no único formato que não pode ser quebrado em silêncio. É o lado prático do que escrevemos em [open source não é grátis: é livre](/blog/open-source-no-es-gratis-es-libre).

## O que a AGPL não cobre: /ee

Existe uma única pasta que não é AGPL: `/ee`. Ela é para recursos enterprise — SSO/SAML, logs de auditoria, papéis personalizados, white-label — sob uma licença comercial separada, source-available, e ainda está majoritariamente em desenvolvimento. O código do core só pode tocá-la por um arquivo (`ee/lib/license.ts`), e sem uma chave de licença o core funciona exatamente igual. Onde fica essa linha e por quê, contamos em [open core explicado](/blog/open-core-explicado).

## A versão curta

- Você pode usar o Zerosoft para o que quiser, inclusive comercialmente, de graça.
- Você pode modificar. Se rodar uma versão modificada que as pessoas usam pela rede, compartilhe as alterações com essas pessoas.
- Você não pode fechar o código.

Achamos um acordo justo. É o mesmo que nos mantém honestos: se um dia a nuvem ficar pior que o código, você pega o código e vai embora.
