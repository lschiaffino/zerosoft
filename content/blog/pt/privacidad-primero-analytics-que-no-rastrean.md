---
title: "Analytics que não rastreiam pessoas"
description: "O que os analytics da zerosoft registram de cada clique, o que deixam de fora (IPs, cookies, perfis) e por quê."
date: "2026-06-01"
author: "zerosoft"
tags: ["privacidade", "manifesto", "analytics", "open source"]
---

A web moderna foi construída sobre um acordo silencioso: o software é "grátis" e, em troca, observa você. Cada clique, cada scroll, cada segundo numa página vai parar num banco de dados que você não conhece, misturado ao seu histórico de outros mil sites, vendido a terceiros que você também não conhece. Esse é o modelo de negócio de boa parte da web.

A zerosoft parte do lado oposto: uma ferramenta de trabalho não precisa observar ninguém. Este post lista o que coletamos, o que não coletamos e por que a diferença importa.

## O que NÃO coletamos

A lista do que não fazemos é mais importante do que a do que fazemos:

- **Não guardamos endereços de IP.** Nem inteiros, nem com hash. Um IP é um identificador pessoal; se você não o guarda, não pode vazá-lo nem vendê-lo.
- **Não usamos cookies de rastreamento.** Nem nossos, nem de terceiros. É por isso que o Link não precisa de banner de consentimento: não há nada a consentir.
- **Não fazemos fingerprinting.** Nada de canvas, fontes instaladas ou combinações exóticas de atributos para reconhecer você entre sessões.
- **Não seguimos pessoas entre sites.** Nossos analytics veem um clique, não um usuário. "Perfis de usuário" não existem no nosso banco de dados porque nunca criamos essa tabela.
- **Não vendemos nem compartilhamos dados.** Com ninguém, nunca. Sem "parceiros confiáveis", sem asteriscos.

## O que medimos (e por que é suficiente)

Os analytics do Link respondem às perguntas que o dono de um link realmente tem: quantas pessoas clicaram, de onde vieram, em que dispositivo. Para isso, cada clique registra:

- A data e a hora.
- O referrer (o site de origem, se o navegador o envia).
- O país, calculado com uma base geográfica local: sem chamadas a serviços externos.
- Device, navegador e sistema operacional, lidos do header `User-Agent` e descartados em seguida: guardamos "iPhone / Safari / iOS", não o header bruto.

Contagens agregadas. Com esses dados, não dá para identificar uma pessoa, e essa é exatamente a ideia. Desenhamos o esquema do banco de dados de modo que nem nós conseguiríamos rastrear você se quiséssemos. Privacidade que depende de promessa é frágil; a que depende de arquitetura, não.

## Software que trabalha para você, não que vigia você

Um martelo não reporta à fábrica cada prego que você bateu. Uma planilha não deveria reportar os números que você digita. Durante vinte anos, aceitamos como normal que nossas ferramentas nos espionassem porque "é assim que se financiam". Falso: elas se financiam assim porque é mais lucrativo, não porque é necessário.

O nosso modelo não precisa dos seus dados. O código é open source: você pode auditar exatamente o que é guardado e o que não é, não precisa acreditar na gente, pode ler. Pode hospedar por conta própria num VPS de US$ 5 e seus dados nunca saem do seu servidor. Ou usar a nossa nuvem e pagar o custo real da infraestrutura. Nenhum dos três caminhos envolve monetizar o seu comportamento.

## Os princípios

1. **Coletar o mínimo.** Se um dado não é essencial para a ferramenta funcionar, não é guardado.
2. **Impossível por design.** O que não é guardado não pode vazar, ser vendido nem intimado.
3. **Verificável, não confiável.** Código aberto, sempre. Privacidade que não se pode auditar é marketing.
4. **Seus dados são seus.** Exportação completa desde o primeiro dia, em cada produto: Link hoje; CRM, scheduling e gestão de projetos amanhã.

Privacidade não é uma feature que se adiciona na versão 2.3 para cumprir uma regulação. É uma decisão fundacional: de arquitetura e de modelo de negócio. Nós a tomamos no dia zero, e não há volta.
