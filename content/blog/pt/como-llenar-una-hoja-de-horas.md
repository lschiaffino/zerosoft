---
title: "Como preencher uma folha de horas para que alguém consiga usá-la"
description: "O que anotar, com que frequência e com quanto detalhe: um formato de folha semanal, regras para as notas, exemplos de entradas boas e ruins, e como isso funciona no Time, o app de horas da zerosoft, incluindo o que ele ainda não faz."
date: "2026-11-23"
author: "zerosoft"
tags: ["time", "harvest", "folhas de horas"]
---

O Harvest publicou um [guia sobre como escrever uma folha de horas](https://www.getharvest.com/blog/how-do-you-write-a-timesheet), pensado para empresas médias que precisam escolher um formato, definir o período de pagamento e conseguir aprovações. Se você é um time de três a quinze pessoas que cobra por hora, ou só quer saber para onde foi a semana, o problema é menor e mais prático: o que anotar para que a folha sirva quando alguém que não estava lá a abrir.

Este post propõe um formato, regras para as notas e uma rotina semanal. No final, como isso funciona no Time, o app de horas da zerosoft, e o que ele ainda não tem.

## Uma folha de horas responde quatro perguntas

Antes do formato, a função. Uma folha serve se, aberta seis meses depois, responde:

1. **Quem** trabalhou.
2. **Para qual cliente ou projeto**.
3. **Em que tipo de trabalho** (design, desenvolvimento, reuniões, administrativo).
4. **Quanto tempo**, e se pode ser faturado.

O resto é opcional. Se a sua folha responde essas quatro coisas, já é melhor que a maioria das planilhas por aí.

## O formato mínimo: uma linha por projeto e tarefa

A estrutura que mais aguenta é uma grade semanal. Cada linha é um projeto com uma tarefa, cada coluna é um dia, e os totais ficam no fim:

| Projeto e tarefa | Seg | Ter | Qua | Qui | Sex | Total |
|---|---|---|---|---|---|---|
| Site Rivera, design | 3:00 | 2:30 | | 1:00 | | 6:30 |
| Site Rivera, desenvolvimento | | 3:00 | 5:00 | 4:00 | 2:00 | 14:00 |
| Interno, reuniões | 1:00 | 0:30 | 1:00 | | 1:00 | 3:30 |
| Total | 4:00 | 6:00 | 6:00 | 5:00 | 3:00 | 24:00 |

Duas decisões que valem tomar uma vez e não repetir:

- **Tarefas curtas e fixas.** Cinco a oito tipos de tarefa para o time todo. Se cada pessoa inventa as suas, os relatórios por tarefa não se comparam.
- **O trabalho interno também entra.** Reuniões, administrativo e capacitação têm o próprio projeto, marcado como não faturável. Se não for anotado, as horas faturáveis parecem mais eficientes do que são e o custo real de um cliente fica subestimado.

## Com que frequência registrar

Há três hábitos e os três se comportam de forma diferente:

- **Com cronômetro, na hora.** O mais preciso e o mais fácil de esquecer: você liga o cronômetro, te interrompem, passam duas horas.
- **No fim do dia, dez minutos.** O meio-termo. Você ainda lembra o que fez, e é curto o bastante para não pesar.
- **Na sexta, de memória.** O menos confiável. As horas tendem ao que "deveria" ter acontecido e as segundas longas desaparecem.

Para um time pequeno, a regra que melhor aguenta é: **registrar no fim de cada dia e revisar a semana na sexta**. O cronômetro fica para o trabalho feito de uma vez só e cobrado por minuto.

## Como escrever as notas

A nota transforma uma hora em uma explicação. Compare:

| Nota fraca | Nota útil |
|---|---|
| "Trabalho no site" | "Layout mobile da home, ajustes no menu" |
| "Reunião" | "Ligação com a Rivera: definição do escopo da loja" |
| "Diversos" | "Respondi 12 e-mails de suporte e corrigi o formulário de contato" |
| "Correções" | "Bug do carrinho: o cupom era aplicado duas vezes" |

Uma regra que ajuda: **verbo mais objeto**. Se quem fatura precisa te perguntar o que você quis dizer, a nota falhou. Duas ou três linhas bastam; não precisa ser um diário.

## Como anotar a duração

Escolha um formato e mantenha. Decimais (1.5) ou horas e minutos (1:30), mas sem misturar no mesmo relatório sem avisar. Sobre arredondamento, decida por escrito: se arredonda, que seja sempre igual; se não arredonda, que a política diga isso. O pior é cada pessoa arredondar do seu jeito.

## A rotina semanal em cinco passos

1. **Segunda**: abra a semana nova e copie as linhas da anterior, para não montar a grade do zero.
2. **Todo dia**: registre as horas e uma nota por entrada ao terminar.
3. **Sexta à tarde**: confira os totais. Algum dia vazio? Alguma linha com notas fracas?
4. **Sexta**: se o seu time aprova horas, envie a semana.
5. **Primeiro dia útil do mês**: exporte o mês e compare com o que foi faturado.

## Como isso funciona no Time

O Time é o app de horas da zerosoft. Um aviso primeiro: no site ele aparece como "Em breve". O código está no repositório, mas ainda não é um app que qualquer workspace consiga abrir pelo catálogo. O que segue descreve o que o código já faz e o que não faz.

**O que faz:**

- **Cronômetro e registro manual.** Um cronômetro por pessoa (iniciar outro para o primeiro) e durações digitadas como `1:30`, `1.5`, `1,5`, `90m` ou `1h 30m`, até 24 horas por entrada.
- **Visão do dia e folha semanal em grade**, com uma linha por projeto e tarefa, totais por linha, dia e semana, e um botão para copiar as linhas da última semana com horas. A semana vai de segunda a domingo.
- **Notas em cada entrada**, até 2000 caracteres. Elas são escritas na visão do dia.
- **Projetos com cliente, código, valor por hora e orçamento em horas.** Cada projeto pode ter equipe e tarefas próprias, cada uma faturável ou não naquele projeto.
- **Aprovação de semanas.** A pessoa envia a semana e as horas ficam travadas. Donos e admins aprovam ou devolvem com uma nota. Enquanto está pendente, a pessoa pode retirá-la.
- **Relatórios** por projeto, cliente, tarefa ou pessoa, com horas, horas faturáveis e valor, e exportação para CSV com data, pessoa, cliente, projeto, tarefa, notas, horas, faturável e valor. Um membro vê só as próprias horas.
- **Atalhos de teclado**: `N` abre uma entrada nova.
- Roda no seu servidor, com seus dados no seu banco.

**O que ainda não faz**, bom saber antes de adotar:

- Hora de início e de fim em cada entrada: você informa a duração.
- Lembretes para as pessoas registrarem as horas.
- Faturas a partir das horas, despesas e pagamentos.
- Valores por pessoa ou por tarefa, e avisos de orçamento.
- Editar as horas de outra pessoa (hoje cada um edita as suas).
- API pública e apps de celular ou desktop. Funciona no navegador do celular.
- Importar do Harvest.

Se hoje você precisa faturar a partir das horas ou mandar lembretes automáticos, o Harvest faz e o Time não. Se o que você procura é uma folha organizada, aprovações e um CSV que abre em qualquer planilha, o fluxo acima já existe.

## Modelo para copiar

Se por enquanto você controla as horas numa planilha, esta estrutura cobre o essencial. Uma linha por entrada:

```
data | pessoa | cliente | projeto | tarefa | notas | horas | faturável
2026-11-18 | Lucía | Rivera | Site | Design | Layout mobile da home | 3.00 | sim
```

É a mesma ordem de colunas do CSV do Time, então se você migrar depois, as colunas já batem.

## O resumo em um cartão

- Uma folha responde quatro coisas: quem, para quem, em que tipo de trabalho e quanto tempo.
- Uma linha por projeto e tarefa; cinco a oito tarefas fixas; registre também o trabalho interno.
- Registre no fim de cada dia e revise na sexta.
- Notas com verbo e objeto, não "diversos".
- Um formato de duração e uma política de arredondamento, por escrito.
- O Time faz a folha, as aprovações e o CSV. Ainda não fatura, não lembra e não registra hora de início e fim.
