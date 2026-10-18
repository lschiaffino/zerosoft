---
title: "Lead scoring com regras: dez regras que você consegue explicar numa reunião"
description: "Como montar lead scoring para um time pequeno com regras de propriedades e de atividade recente, testar contra negócios que você já ganhou ou perdeu e transformar o score em tarefas com workflows."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "vendas", "lead scoring", "playbook"]
---

Você tem 300 contatos abertos e tempo para ligar para quinze. O lead scoring responde uma pergunta só: para quais primeiro. Todo o resto (modelos, pesos, previsões) é um jeito mais ou menos caro de responder isso.

O [guia de lead scoring da HubSpot](https://blog.hubspot.com/marketing/lead-scoring-instructions) percorre sete modelos, do encaixe por cargo e empresa até o scoring preditivo com regressão logística. Um time que fecha 40 negócios por ano não tem dados suficientes para treinar um modelo preditivo. O que funciona com pouco volume é um punhado de regras que qualquer pessoa do time consegue ler e discutir. Este post monta essas regras no CRM do zerosoft, testa contra o seu histórico e conecta tudo com trabalho concreto.

## Como o CRM calcula o score

Antes de desenhar regras, vale saber exatamente o que o motor faz. Isto sai do código (`lib/crm-scoring-schema.ts`):

- **Regras de propriedade** comparam um campo do contato: etapa do ciclo de vida, status do lead, origem, cargo, email, telefone, cidade, país, site ou qualquer campo personalizado. Operadores: igual, diferente, contém, maior que, menor que, preenchido, vazio. As comparações ignoram maiúsculas.
- **Regras de atividade** contam algo que aconteceu nos últimos N dias (de 1 a 365): emails abertos, cliques, respostas, reuniões agendadas, formulários enviados, ligações ou notas registradas. Cada regra tem um mínimo de ocorrências.
- **Cada regra soma uma vez.** Se bate, soma seus pontos (entre -1000 e 1000); se não, zero. Três respostas não valem o triplo de uma. Para premiar intensidade, crie duas regras: uma com mínimo 1 e outra com mínimo 3.
- **Recalcula sozinho**, a cada evento relevante (uma abertura, uma reunião, um formulário) e uma vez por dia pelo cron, então as janelas de "últimos 30 dias" vencem sem ninguém mexer.
- **Se explica.** A ficha do contato mostra quais regras somaram e quanto. O score é uma coluna que dá para ordenar e usar no filtro avançado.

## Passo 1: separe encaixe de interesse

Um contato pode ser o cliente ideal sem pressa nenhuma, ou estar muito ativo sem orçamento. Se você mistura as duas coisas sem nomeá-las, um 40 não diz qual dos dois casos você tem na frente.

O CRM guarda um score por contato, então a separação vai nos nomes: cada regra começa com "Encaixe:" ou "Interesse:". O detalhamento na ficha fica legível de relance.

## Passo 2: dez regras para começar

Um ponto de partida para um time que vende software para empresas pequenas. Os pontos são exemplo; você vai corrigi-los no passo 3.

| # | Regra | Tipo | Condição | Pontos |
|---|---|---|---|---|
| 1 | Encaixe: decide | Propriedade | Cargo contém "founder" | +15 |
| 2 | Encaixe: tamanho | Propriedade | `custom.funcionarios` maior que 10 | +10 |
| 3 | Encaixe: mercado | Propriedade | País igual ao que você atende | +10 |
| 4 | Encaixe: email pessoal | Propriedade | Email contém "@gmail." | -10 |
| 5 | Interesse: formulário | Atividade | 1 formulário em 30 dias | +20 |
| 6 | Interesse: reunião | Atividade | 1 reunião agendada em 30 dias | +30 |
| 7 | Interesse: respondeu | Atividade | 1 resposta em 14 dias | +25 |
| 8 | Interesse: clique | Atividade | 1 clique em 14 dias | +10 |
| 9 | Interesse: aberturas | Atividade | 3 aberturas em 14 dias | +5 |
| 10 | Descartado | Propriedade | Status do lead igual a "unqualified" | -50 |

Três decisões por trás da tabela:

- **Aberturas valem pouco.** O Apple Mail pré-carrega as imagens dos emails por privacidade, e isso registra aberturas que ninguém fez. Um clique ou uma resposta são sinais bem mais firmes.
- **O tamanho da empresa fica no contato.** As regras leem campos do contato, não da empresa. Se o dado importa, peça no formulário e guarde num campo personalizado do contato (os formulários do CRM mapeiam para campos personalizados).
- **Uma regra negativa forte fecha a porta.** Quando alguém marca um lead como não qualificado, ele tem que ir para o fim da lista mesmo que abra todos os seus emails.

Configure em **CRM → Configurações → Lead scoring**.

## Passo 3: teste contra o que já aconteceu

Um score serve se quem acabou comprando fica no topo. Teste antes de confiar:

1. Monte uma lista com os contatos dos seus últimos 20 negócios ganhos e outra com 20 perdidos.
2. Ordene as duas por score.
3. Compare as medianas. Se os ganhos não estão claramente acima, alguma regra está medindo ruído.
4. Abra os casos estranhos (um perdido com 70, um ganho com 5) e leia o detalhamento. Muitas vezes aparece uma regra que soma por algo que não prevê nada.

Um limite honesto: as regras de atividade olham os últimos N dias a partir de hoje, então um negócio de seis meses atrás já não tem a atividade dentro da janela. Para calibrar, use negócios recentes ou foque nas regras de encaixe, que não vencem.

## Passo 4: faça o score gerar trabalho

Um número numa coluna não liga para ninguém. Os workflows do CRM têm o gatilho "Lead score mudou" com um limite opcional e uma direção (sobe, desce ou qualquer). Três receitas:

- **Passa de 50 para cima:** criar uma tarefa para o responsável dizendo "Ligar hoje" e atualizar a etapa do ciclo de vida para SQL.
- **Passa de 30 para cima:** inscrever numa sequência de follow-up. Contamos como montar uma [neste post sobre sequências](/blog/secuencias-de-seguimiento-que-se-cortan-solas).
- **Cai abaixo de 30:** tarefa de revisão. Quem estava quente e esfriou merece uma mensagem humana antes de voltar para a pilha.

Para avisar outra ferramenta, o CRM emite o evento `contact.score_changed`, que você pode pegar no Flow ou com um webhook.

## Passo 5: uma revisão por mês

Quinze minutos bastam. Veja quais regras quase nunca batem (sobram, ou a condição está errada) e quais batem em quase todos (não distinguem ninguém). Ajuste pontos aos poucos e registre cada mudança numa página do Docs, para a próxima pessoa saber por que uma regra vale 25 e não 10.

## O que ainda não faz

- Não há score preditivo nem pesos sugeridos a partir do seu histórico.
- As regras leem só propriedades do contato, não da empresa nem dos negócios.
- Não há score separado por pipeline ou por produto; a separação entre encaixe e interesse é pelo nome.
- Cada regra soma uma vez; não há pontos por ocorrência.

Se você precisa de alguma dessas coisas hoje, um CRM maior atende melhor. Se o seu problema é decidir para quem ligar na segunda-feira, dez regras que você entende vão servir mais que um modelo que ninguém consegue explicar. O CRM do zerosoft roda por $0 no seu servidor, ou no zerosoft Cloud com um plano gratuito para começar.
