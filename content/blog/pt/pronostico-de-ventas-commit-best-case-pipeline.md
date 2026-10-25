---
title: "Uma previsão de vendas que dá para defender: commit, best case e pipeline"
description: "Como montar a previsão mensal de uma equipe pequena com três categorias, uma meta por pessoa e um número enviado a cada período, e como o zerosoft CRM faz isso."
date: "2026-10-25"
author: "zerosoft"
tags: ["crm", "vendas", "forecast"]
---

Equipes pequenas costumam prever vendas de duas formas. A primeira é somar tudo o que está aberto e chamar de "pipeline". A segunda é perguntar ao líder quanto ele acha que vai fechar e anotar a resposta. A primeira dá um número inflado. A segunda dá um número que depende do humor daquela semana.

A Pipedrive publica um [guia de previsão de vendas](https://pipedrive.com/es/blog/pronostico-de-ventas) que recomenda combinar métodos quantitativos e qualitativos. Concordamos. Aqui vai uma versão concreta para equipes de duas a quinze pessoas: quais categorias usar, como definir metas, qual número é enviado e como ele é corrigido com o tempo. Cada passo corresponde ao que o zerosoft CRM faz hoje.

## Um número só não basta: três categorias

Uma previsão útil separa o que já aconteceu do que pode acontecer. Quatro colunas bastam:

- **Ganho**: negócios fechados como ganhos dentro do período.
- **Commit**: negócios abertos que o vendedor aposta que vão fechar no período.
- **Best case**: negócios abertos que podem fechar se tudo der certo.
- **Pipeline**: o restante dos abertos com data de fechamento no período.

Ganho mais commit é o número "mais provável". É o que se comunica ao resto da empresa. Best case e pipeline são a margem: explicam por que um mês saiu melhor que o previsto.

No zerosoft, o forecast (`/app/crm/forecast`) mostra exatamente essas colunas por mês ou trimestre, com a meta ao lado e um total ponderado. Um detalhe importante: os negócios abertos contam no período da sua data de fechamento, e os ganhos no período em que foram fechados. Um negócio aberto sem data de fechamento não entra em nenhum período. A tela avisa quantos são ("N negócios abertos não têm data de fechamento"), e esse número é o primeiro item de toda revisão.

## A categoria vem da etapa, e dá para sobrescrever

Para que ninguém precise classificar cada negócio à mão, o zerosoft atribui a categoria pela probabilidade da etapa:

- 70% ou mais: commit.
- 40% ou mais e menos de 70%: best case.
- Menos de 40%: pipeline.

Esses limites estão no código e ainda não são configuráveis. Se as probabilidades das suas etapas forem razoáveis, a maioria dos negócios já cai onde deveria.

Depois vem a parte valiosa: cada negócio tem um seletor de categoria na tabela do forecast, com "Automática" e quatro opções manuais. Sobrescrever é uma decisão de critério. Um negócio em Negociação (70%) em que você sabe que o comprador espera orçamento desce para best case. Um negócio em Proposta (40%) com ordem de compra assinada e ainda sem fatura sobe para commit. Existe também "Omitir", que tira o negócio da previsão sem fechá-lo, útil para um negócio parado que você não quer perder nem contar.

Cada mudança de categoria fica no histórico do negócio com quem a fez, então na revisão você pode perguntar "por que este negócio saiu de commit?" e a resposta está registrada.

## Metas por pessoa, não uma meta para todos

Uma previsão sem meta é uma lista de valores. Com meta, é uma distância. Nas configurações do CRM você cadastra uma cota de valor ganho por pessoa, mensal ou trimestral. O forecast a usa para mostrar quanto da meta já foi ganho em cada linha ("45,5% da meta ganho"), e o total da equipe soma as metas individuais.

Uma regra prática para defini-las: parta do que a equipe ganhou nos últimos três períodos do mesmo tipo, não do que a empresa precisa. Se a diferença entre os dois for grande, é um problema de planejamento e deve ser discutido como tal, não escondido atrás de uma meta em que ninguém acredita.

Se vocês trabalham com equipes de vendas definidas, o forecast filtra por equipe e por pipeline. Isso ajuda quando há um pipeline de negócios novos e outro de renovações e você não quer misturar os números.

## O número que cada pessoa envia

A parte qualitativa do método é esta: cada vendedor olha seus negócios e envia **um número** para o período. Ele pode coincidir com ganho mais commit ou não. Se não coincidir, a nota (até 500 caracteres) explica o motivo: "o negócio de R$ 18.000 depende de o cliente aprovar o orçamento no dia 3".

No zerosoft, cada envio é salvo com data, autor e nota. Vale o último, mas o histórico fica visível em "Ver histórico de envios". Assim dá para ver quanto o número mudou durante o mês, algo que uma planilha compartilhada sobrescreve sem deixar rastro. Os admins podem ajustar o número de outra pessoa, e o histórico mostra quem fez.

Quando ganho mais commit e o número enviado divergem em mais de 15 ou 20% de forma recorrente, há algo a conversar: ou a pessoa é conservadora, ou as etapas não refletem a realidade.

## Quando há negócios compartilhados

Se duas pessoas trabalham um negócio, o forecast pode dividi-lo por porcentagem. Os splits de cada negócio contam nas linhas por pessoa, nas cotas e no total, então um negócio de R$ 10.000 dividido 60/40 contribui com R$ 6.000 e R$ 4.000, e o total continua R$ 10.000, não R$ 20.000. Sem splits, o negócio inteiro é do responsável.

## A revisão mensal em 20 minutos

Um roteiro para a reunião, usando só a tela de forecast:

1. **Feche o período anterior.** Veja o mês passado com o botão "Período anterior". Compare meta, ganho e número enviado. Anote a diferença entre enviado e ganho, por pessoa.
2. **Arrume o que não conta.** Confira o aviso de negócios sem data de fechamento. Cada um recebe data ou é fechado.
3. **Revise o commit um por um.** Para cada negócio em commit, uma pergunta: o que precisa acontecer para fechar e quando? Se ninguém sabe responder, ele desce para best case.
4. **Olhe o próximo período.** Com "Período seguinte" você vê o que entra no mês que vem. Se commit mais best case não chega na meta, o problema aparece com antecedência.
5. **Cada pessoa envia seu número.** Com nota. Na mesma reunião, não depois.

Vinte minutos bastam para cinco pessoas. Para mais, cada líder faz os passos 3 e 5 antes e a reunião se dedica às diferenças.

## O que ainda não faz

Para não prometer demais: o zerosoft não roda modelos estatísticos de previsão nem prevê datas de fechamento sozinho. O forecast é aritmética transparente sobre as categorias e probabilidades que você define, e essa é a ideia. Os limites de 70% e 40% não são editáveis pela interface. E se você quiser cruzar o forecast com outros dados, o construtor de relatórios agrupa por categoria de forecast.

## Como testar

Se você já usa o zerosoft, abra CRM, Relatórios e Forecast. Cadastre uma cota por pessoa nas configurações e revise as categorias dos negócios abertos do mês. Se vem de outro CRM, a [migração de contatos por CSV](/blog/migrar-contactos-de-hubspot-por-csv) permite começar com dados reais. E como o código é aberto sob AGPL, você pode rodar tudo na sua própria infraestrutura e ler em `lib/crm-forecast.ts` exatamente como cada coluna é calculada.

Uma boa previsão é discutida todo mês com os mesmos números à vista, e cada ciclo a torna mais honesta.
