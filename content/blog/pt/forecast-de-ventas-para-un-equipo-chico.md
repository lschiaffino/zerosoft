---
title: "Como montar um forecast de vendas que uma equipe pequena consiga defender"
description: "Categorias, metas e envios por pessoa: como transformar um pipeline cheio de deals em um número mensal confiável, com exemplos no zerosoft CRM."
date: "2026-11-05"
author: "zerosoft"
tags: ["crm", "vendas", "forecast", "playbook"]
---

No dia 28 alguém pergunta quanto vamos fechar no mês, e a resposta sai da intuição de quem estiver mais perto do teclado. Às vezes acerta. Quando não acerta, aparece o valor que "estava quase fechado" e nunca foi assinado.

Um forecast serve para parar de adivinhar: ele registra, com regras fixas, o que achamos que vai acontecer, e depois você compara com o que aconteceu. O Pipedrive [descreve a sua ferramenta](https://www.pipedrive.com/en/features/sales-forecasting-software) como uma projeção que combina dados históricos, vendas atuais e o pipeline em tempo real. Para uma equipe de três a oito pessoas com pouco histórico, a parte útil é outra: regras simples e um número que cada vendedor assina.

Isto é o que usaríamos nós mesmos, e como montar com o que o zerosoft CRM faz hoje.

## Passo 1: separe o que aconteceu do que você espera

Um forecast mistura três coisas diferentes, e convém não somá-las às cegas:

- **Ganho:** deals fechados no período. É um fato.
- **Aberto com compromisso:** deals em que o vendedor apostaria.
- **Aberto com esperança:** deals que poderiam fechar se tudo der certo.

No zerosoft CRM essas camadas se chamam Ganho, Commit, Best case e Pipeline. Os deals abertos contam no período da data de fechamento, e os ganhos no período em que foram fechados. Os perdidos ficam de fora.

A conta mais honesta do mês é Ganho mais Commit. O painel mostra isso como "mais provável". Best case e Pipeline são a margem de upside, não o plano.

## Passo 2: defina o que é "commit" antes da reunião

Se cada vendedor decide o commit pelo humor do dia, o forecast mede humor. Deixe um critério escrito. Um exemplo para uma equipe B2B de ticket médio:

1. Uma proposta foi enviada e o comprador abriu.
2. Existe data de fechamento dentro do período.
3. Sabemos quem assina e essa pessoa respondeu nos últimos sete dias.

Se faltar uma das três, o deal é Best case, por mais que você goste dele.

No CRM, a categoria padrão vem da probabilidade da etapa: 70% ou mais é commit, 40% ou mais é best case, o resto é pipeline. Por isso as probabilidades das suas etapas devem refletir o seu histórico (veja [as regras de higiene do pipeline](/blog/higiene-del-pipeline)). Quando um deal não se encaixa na regra padrão, cada deal permite escolher a categoria à mão, e existe a opção Omitir, que tira o deal do forecast sem perdê-lo nem marcá-lo como perdido. Um deal parado porque o cliente espera o orçamento do ano seguinte é o caso típico.

## Passo 3: defina uma meta por pessoa

Um número sem meta não diz se você está bem. Cadastre a cota de valor ganho de cada pessoa nos ajustes do CRM (seção Cotas). O forecast mostra a cota ao lado do que já foi ganho e calcula o percentual atingido.

Exemplo com números inventados para ilustrar, não de nenhum cliente: meta mensal de 20.000 USD para a Ana, 8.000 ganhos no dia 15, 6.000 em commit e 9.000 em best case.

- Ganho mais commit: 14.000. Faltam 6.000 para a meta.
- Com todo o best case: 23.000. A meta só é atingida se quase todos os deals esperançosos fecharem.

Essa segunda linha é a que você quer ver no dia 15 e não no dia 28: é preciso abrir deals novos agora, não torcer.

## Passo 4: cada pessoa envia o seu número

Esta é a parte que mais distingue um forecast de um relatório. O sistema calcula o relatório. O envio é feito por uma pessoa: ela olha o ganho mais o commit, ajusta com o que sabe e manda um número com uma nota opcional.

No zerosoft cada envio fica guardado com data, vale o último, e o histórico pode ser aberto. Assim dá para ver quanto o número mudou durante o mês e quem sempre ajusta para baixo perto do fim. Leia essa tendência sem acusar ninguém: em geral indica que o critério de commit está frouxo, e não que alguém está mentindo.

Uma rotina que funciona com cinco pessoas:

1. Segunda-feira, 15 minutos: cada pessoa envia o forecast do mês.
2. Abre-se a visão da equipe e revisam-se só os deals em commit com data de fechamento próxima.
3. Os deals que mudaram de categoria desde a semana passada são explicados em uma frase.

## Passo 5: conserte o que quebra o forecast

Três problemas sujam o número quase sempre:

- **Deals sem data de fechamento.** Não entram em nenhum período. A visão de forecast avisa quantos deals abertos não têm data, e essa é a primeira lista a limpar.
- **Datas antigas.** Um deal "para 30 de abril" ainda aberto em novembro infla o pipeline. Ordene a tabela de deals por data de fechamento na sua [revisão semanal](/blog/revision-semanal-del-crm).
- **Moedas misturadas.** O CRM converte para a moeda base do workspace com as taxas de câmbio que você cadastra à mão; se faltar uma taxa, ela conta 1 para 1 e fica listada nos relatórios. Cadastre as taxas do mês antes de olhar os totais.

Filtrar por pipeline também ajuda: renovações e negócio novo têm ciclos diferentes, e juntá-los produz uma média que não descreve nenhum dos dois.

## O que ainda não faz

Um aviso honesto: o forecast do zerosoft usa as probabilidades de etapa e as categorias que você define. Ele não calcula probabilidades a partir do seu histórico de fechamentos nem prevê com modelos. Para uma equipe pequena isso é uma vantagem, porque você consegue explicar de onde sai cada peso do número. Se o seu volume justificar um modelo estatístico, hoje seria preciso exportar os deals (CSV ou JSON) e montá-lo fora.

## Onde mora o seu forecast

Um forecast guarda decisões: quem prometeu o quê e quando. Esse histórico é da sua empresa. No zerosoft os envios ficam no seu banco de dados, seja no self-host por $0 ou no zerosoft Cloud, e o CRM exporta tudo quando você quiser sair. O forecast é montado no CRM, e a briga de sempre (o deal que ninguém atualiza) se resolve com [tarefas e workflows](/blog/workflows-crm-tareas-de-seguimiento) que criam o próximo passo sozinhos.

## Resumo para imprimir

1. Ganho mais commit é o plano. Best case é margem.
2. Escreva o critério de commit e não o mude no meio do mês.
3. Uma meta por pessoa, cadastrada.
4. Cada pessoa envia o seu número na segunda, com uma nota.
5. Limpe deals sem data, datas antigas e moedas antes de ler os totais.
6. Revise o histórico de envios no fim do mês: é onde você aprende.
