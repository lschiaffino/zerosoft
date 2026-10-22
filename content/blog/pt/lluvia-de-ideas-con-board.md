---
title: "Brainstorming em equipe: roteiro de 60 minutos com notas, timer e votos ocultos"
description: "Como conduzir uma sessão de ideias no Board: pergunta bem formulada, rodada de escrita em silêncio, agrupamento, votação com pontos e notas que viram issues no Track."
date: "2026-10-22"
author: "zerosoft"
tags: ["board", "miro", "oficinas"]
---

O Miro publica um [guia para conduzir uma sessão de brainstorming](https://miro.com/brainstorming/how-to-conduct-a-brainstorming-session/) pensado em torno do próprio quadro. Uma equipe de cinco pessoas precisa de bem menos: uma pergunta clara, um quadro, um relógio e um jeito de decidir quais ideias seguem.

Esta é uma versão para rodar no Board, o quadro branco da zerosoft. Cada passo usa algo que o Board faz hoje, e no final há uma seção sobre o que ele não faz.

## A pergunta importa mais que o quadro

Sessões de ideias costumam falhar na consigna. "Ideias para melhorar o produto" gera quarenta cartões que ninguém consegue comparar. Uma boa pergunta tem sujeito, verbo e limite:

- Fraca: "Ideias de marketing".
- Melhor: "Como conseguimos 20 reservas de demo em outubro sem gastar com anúncios?"
- Fraca: "Melhorias do onboarding".
- Melhor: "O que tiraríamos do primeiro dia de uma pessoa nova para que ela chegue à primeira tarefa em uma hora?"

Poste a pergunta no chat da equipe antes da reunião. Se ela não cabe em uma linha, são duas sessões.

## Monte o quadro

Na lista do Board, abra **Começar com um modelo** e escolha **Brainstorm**. Ele traz um tema central em uma elipse e seis ideias de exemplo ligadas por linhas. Troque o tema pela sua pergunta.

Apague as seis ideias de exemplo. Para esta sessão, outra disposição funciona melhor: desenhe quatro ou cinco retângulos vazios com um título cada, um por ângulo que você quer cobrir ("canais", "conteúdo", "produto", "parcerias"). Eles viram zonas de agrupamento depois. Se o tema não tem ângulos óbvios, deixe o quadro livre e agrupe depois.

Passe o link para quem participa. Por padrão, qualquer membro do workspace abre e edita o quadro. Se for convidar alguém de fora, o painel de acesso cria um link de convidado com edição, que você desliga quando a sessão acaba.

## Rodada 1: escrever em silêncio (10 minutos)

Abra **Workshop**, escolha **5 min** no cronômetro e toque em **Começar**. Todos veem a contagem regressiva na própria tela; o Board a calcula com a hora do servidor, então ela não depende do relógio de cada máquina. Quem pode editar o quadro inicia o cronômetro, e **+1 min** ou **Pausar** ajusta sem cortar a rodada.

Nesses cinco minutos ninguém fala. Cada pessoa cria ideias com a ferramenta **Stickies**:

1. Escolha uma cor. Uma cor por pessoa ou por ângulo funciona bem, combinada antes.
2. Adicione uma nota e escreva uma ideia com um verbo. Cada nota aceita até 500 caracteres, e quanto menos, melhor.
3. Coloque tags com `#` se já souber o ângulo (até 8 por nota).

Escrever em silêncio evita que a primeira ideia dita em voz alta ancore todas as outras, e dá o mesmo espaço a quem fala menos.

Uma variante útil: se alguém chega com uma lista pronta em uma nota ou planilha, pode usar **Colar uma lista**. Uma nota por linha, até 100 por colagem, e as palavras com `#` viram tags. Uma linha como `Webinar mensal com clientes #conteudo` vira uma nota com a tag `conteudo`.

Depois da rodada, faça uma segunda de dois minutos para melhorar a ideia de outra pessoa: cada um adiciona uma nota que desenvolve ou corrige a de alguém. É aí que surgem ideias que ninguém tinha sozinho.

## Rodada 2: agrupar (10 minutos)

Uma pessoa compartilha a tela e arrasta. Só ela edita nesse trecho, para ninguém sobrescrever ninguém.

Regras para agrupar:

- Junte o que resolve a mesma coisa, mesmo escrito de outro jeito.
- Se duas notas são iguais, deixe uma e apague a outra. A autoria não pesa: a ideia continua lá.
- Cada grupo recebe um título de no máximo três palavras.
- Uma nota que não se encaixa em nada fica separada. Olha-se no final.

O painel de Stickies lista as tags do quadro e seleciona de uma vez todas as notas que compartilham uma. Se usaram tags, agrupar leva dois minutos.

## Rodada 3: votar com votos ocultos (10 minutos)

Em **Workshop**, abra uma **votação com pontos**. Você escolhe quantos votos cada pessoa tem, de 1 a 20. Uma regra razoável é um terço das ideias que sobraram, com mínimo de três: com 18 notas, seis votos.

Enquanto a votação está aberta, cada pessoa vê só os próprios votos, e o painel mostra quantas pessoas já votaram, sem dizer em quê. Vota-se com o botão **+** sobre cada nota, e dá para pôr mais de um voto na mesma. Ao **encerrar e ver resultados**, aparecem os totais por nota, do maior para o menor.

Manter os votos ocultos até o fechamento muda o resultado: ninguém vota no que já está ganhando nem no que a pessoa mais sênior escolheu. Se o empate em terceiro lugar for real, resolvam conversando, não com uma segunda votação.

## Fechamento: de notas a trabalho (15 minutos)

Pegue as duas ou três ideias mais votadas e responda três perguntas para cada: quem cuida, o que acontece na primeira semana e como saberemos se funcionou.

Depois selecione essas notas, abra o botão **Track** da barra e escolha o projeto. O Board cria uma issue por nota, com o texto da ideia e um link de volta ao quadro. Uma nota que já tem issue não é duplicada, e o status e o responsável da issue aparecem embaixo da nota, então o quadro vira um mapa do que avançou. Contamos isso no [fluxo de ações do post da retro](/blog/retro-en-una-pizarra); aqui funciona igual.

Deixe o quadro como está. O histórico guarda uma versão por hora durante 30 dias e restaura como cópia, caso alguém limpe demais.

## O roteiro em uma tabela

| Minutos | O que acontece | Ferramenta |
|---|---|---|
| 0 a 5 | Lê-se a pergunta e distribuem-se as cores | Modelo Brainstorm |
| 5 a 15 | Ideias em silêncio e rodada de melhoria | Workshop: timer 5 + 2 min, Stickies |
| 15 a 25 | Agrupamento | Tags, seleção por tag |
| 25 a 35 | Votação oculta | Workshop: votação com pontos |
| 35 a 50 | As 2 ou 3 primeiras: dono, primeira semana, sinal de sucesso | Comentários no quadro |
| 50 a 60 | Issues no Track | Botão Track |

## O que o Board ainda não faz

O Board não tem edição ao vivo com cursores: você não vê as outras pessoas se mexendo. Se duas salvam ao mesmo tempo, as mudanças se combinam elemento por elemento, e se uma editou algo que a outra apagou, o aviso pede para você escolher. O cronômetro e a votação se atualizam consultando o servidor a cada poucos segundos, não por uma conexão aberta, então espere um atraso de uns 4 segundos. Ele não agrupa notas com IA nem tem um modo que revela as ideias uma por vez. Para a rodada em silêncio, a regra da equipe substitui a ferramenta.

## Quanto custa

O Miro Starter custa [$8 por membro por mês com cobrança anual](https://miro.com/pricing/), e o plano Free inclui [três quadros editáveis](https://miro.com/pricing/). Ele tem o que aqui falta: cursores ao vivo, agrupamento com IA e milhares de modelos.

O Board custa $0 se você roda no seu servidor, e o zerosoft Cloud não cobra por assento. Para uma equipe que faz uma sessão por mês e quer que as ideias terminem em um projeto do Track, basta.
