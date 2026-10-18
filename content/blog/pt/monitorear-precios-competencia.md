---
title: "Acompanhar os preços da concorrência com um robô e um flow"
description: "Um robô que lê a página de preços dos concorrentes todos os dias, guarda o histórico em uma planilha e avisa quando algo muda ou quando a página é redesenhada. Passo a passo com Robots e Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["robots", "flow", "browse-ai"]
---

A Browse AI publicou um bom caso de uso: [como automatizar o monitoramento de preços de concorrentes SaaS](https://www.browse.ai/blog/how-i-automated-saas-competitor-price-monitoring). Um robô lê a página de preços, guarda os dados e avisa no Slack. A ideia está certa e serve para qualquer time pequeno que vende contra dois ou três rivais: descobrir um aumento de preço porque um cliente contou numa call é descobrir tarde.

Este post monta o mesmo com o Robots, a automação de navegador da zerosoft, e o Flow, nossos fluxos. Sem créditos por extração: no seu servidor, o robô roda no seu próprio Chromium. Mostramos os passos exatos, as decisões que valem a pena e onde o Robots ainda fica devendo.

## O que vale vigiar

Antes de abrir qualquer ferramenta, faça a lista. Para cada concorrente, olhe a página de preços e anote:

- **Nome e preço de cada plano.** O óbvio.
- **O seletor de cobrança.** Quase toda página tem um botão mensal/anual. O preço que aparece ao carregar costuma ser o anual. Decida qual você quer ler e seja consistente.
- **Limites que importam para a sua venda.** Usuários incluídos, contatos, armazenamento. Muito aumento de preço chega como um limite que cai, com o preço igual.
- **O texto da promoção**, se houver. Um "50% no primeiro ano" muda a comparação mesmo que a tabela não mude.

Com três concorrentes e quatro dados de cada um, você já tem um painel que ninguém do seu time mantém hoje.

## Passo 1: o robô

No Robots, comece pelo template **Verificar um preço todos os dias**. Ele vem com duas entradas, a URL do produto e o seletor do preço, e um agendamento diário. Para uma página de preços SaaS, ajuste assim:

1. **Ir para URL**: `{{inputs.url}}`, com a página de preços do concorrente como valor da entrada.
2. **Clicar** com o texto visível `Mensal` (ou `Monthly`). Quando não há um seletor estável, o Robots encontra o elemento pelo texto que você escreveu.
3. **Esperar** até o seletor dos preços aparecer. Páginas que carregam preços com JavaScript precisam desse passo.
4. **Extrair** no modo "Todos os resultados (lista)" sobre o seletor dos nomes dos planos, salvo como `planos`. Ele devolve uma lista com o texto de cada elemento, até 200.
5. **Extrair**, mesmo modo, sobre o seletor dos preços, salvo como `precos`.
6. **Captura de tela**, com o nome `pagina`. Ela fica guardada na execução, e uma imagem da página naquele dia resolve a pergunta "desde quando eles cobram isso?".

Para achar seletores: clique com o botão direito no preço, Inspecionar, Copiar seletor, e depois simplifique até sobrar algo legível como `.pricing-card .price`. Se preferir não mexer no inspetor, o gravador do Robots é um bookmarklet: você abre na página, faz os cliques à mão e ele devolve os passos com seletores escolhidos por ordem de estabilidade (data-testid, id, name, aria-label, texto visível).

Se um elemento aparece só às vezes, como um banner de promoção, use **Se o elemento existir** com "Pular os próximos passos" antes do passo que extrai o texto dele: se o banner não estiver lá, o robô pula esse passo e segue.

Rode o robô à mão uma vez. O painel de execuções mostra a captura e a saída em JSON, algo assim:

```json
{
  "planos": ["Starter", "Pro", "Business"],
  "precos": ["$12", "$29", "$59"]
}
```

## Passo 2: o agendamento

No robô, defina o agendamento como **Todos os dias** às 9:00 no seu fuso horário. Ele também aceita intervalos (no mínimo a cada 15 minutos) ou uma expressão cron. Para preços, uma vez por dia basta; ninguém muda a página de preços a cada hora, e menos visitas também é mais respeitoso com o site que você lê.

Um robô por concorrente é o mais simples de manter: se um deles redesenha a página, você quebra um robô só.

## Passo 3: o flow que registra e avisa

Cada execução que termina emite o evento `robot.run.finished`, com o nome do robô e a saída. No Flow:

1. **Gatilho: evento** `robot.run.finished`. Em avançado, filtre por `robot.name` igual a "Preços: Concorrente A".
2. **Google Sheets**, operação append, com uma linha: `{{now}}`, `{{trigger.robot.name}}`, `{{trigger.output.planos | json}}`, `{{trigger.output.precos | json}}`. Esse é o seu histórico: uma linha por dia e por concorrente.
3. **Se**: `{{trigger.output.precos | json}}` diferente de `["$12","$29","$59"]`, o último valor que você conhece.
4. No ramo verdadeiro, **Slack** ou **Email**: "A página de preços do Concorrente A mudou: {{trigger.output.precos | json}}".

Quando chega um aviso, você confere, atualiza o valor do passo 3 e pronto.

Uma lacuna honesta: o Robots não compara uma execução com a anterior por conta própria. A comparação é a condição do flow contra o valor que você cadastrou. Se quiser comparar com o dia anterior automaticamente, dá para fazer com um passo do Google Sheets em modo leitura e um nó de código que compare com a última linha, mas aí o flow fica maior.

## Passo 4: seja avisado também quando o robô falhar

Quando uma execução falha, é emitido `robot.run.failed`, com o número do passo e o erro. Monte um segundo flow, pequeno, que mande esse erro por email.

Isso importa mais do que parece. Se o seletor para de encontrar os preços, quase sempre é porque o concorrente redesenhou a página de preços. E um redesenho da página de preços costuma vir junto com uma mudança de preços ou de planos. A falha já é um sinal.

## O que fazer com os dados

O histórico na planilha responde perguntas concretas:

- **Quando mudou?** A primeira linha com o valor novo. A captura daquele dia confirma.
- **O que mudou?** Preço, nome de plano ou quantidade de planos. Um plano que some costuma ser uma consolidação para cima.
- **O que dizemos para vendas?** Uma linha no canal do time quando algo muda, com a captura. Se você usa o CRM, é bom material para as notas dos deals em que esse concorrente está na disputa.

## Limites que vale conhecer

Os limites de uma execução estão no código: até 100 passos, 20 páginas, 5 capturas e 180 segundos. Roda um robô por vez em cada workspace, então se você acompanha dez concorrentes, escalone os horários: os que coincidem esperam a próxima passada do cron. Na zerosoft Cloud, os minutos de navegador que você usa são medidos; o código traz uma cota mensal por workspace configurável com `ROBOTS_FREE_MINUTES_PER_MONTH` (120 minutos por padrão). Um robô de preços leva segundos por execução.

Para comparar: o plano Free da Browse AI dá [50 créditos por mês e monitoramento no máximo a cada hora](https://www.browse.ai/pricing).

O que o Robots ainda não faz, e que ferramentas pagas de scraping costumam incluir:

- **Não se adapta sozinho** quando a página muda. Se o seletor quebra, você corrige (e o passo 4 avisa).
- **Não tem proxies nem geolocalização.** Se o concorrente mostra preços diferentes por país, o robô vê os do país do seu servidor.
- **Não resolve captchas.** Uma página atrás de um captcha não é lida.
- **Não há robôs prontos** para sites populares. Você começa de um template genérico.

## Duas regras de convivência

Leia páginas públicas, uma vez por dia, e respeite os termos do site. O Robots pode guardar a sessão entre execuções para páginas com login, mas uma página de preços não precisa disso, e é melhor assim.

## Em um cartão

- Um robô por concorrente: ir para URL, clicar em "Mensal", esperar, extrair planos e preços, captura.
- Agendamento diário. Mais vezes não acrescenta nada.
- Flow em `robot.run.finished`: linha na planilha, condição contra o último valor, aviso.
- Flow em `robot.run.failed`: um seletor quebrado costuma ser um redesenho.
