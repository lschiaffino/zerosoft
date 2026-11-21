---
title: "Calendário de conteúdo para redes: modelo em CSV e Social"
description: "Monte o calendário do mês numa planilha, importe no Social como agendadas, para aprovar ou rascunhos, e deixe a fila preencher os buracos. Passos, modelo e limites."
date: "2026-11-21"
author: "zerosoft"
tags: ["social", "hootsuite", "guia"]
---

Um calendário de conteúdo é uma lista do que você vai publicar, em qual rede e em qual dia. A Hootsuite o descreve [no guia deles](https://blog.hootsuite.com/how-to-create-a-social-media-content-calendar/) como um plano que pode viver numa planilha, num documento ou numa ferramenta de projetos. Concordamos no básico. O que muda é onde essa lista termina: num modelo que você baixa depois de preencher um formulário, ou na sua própria ferramenta, com seus dados, pronta para sair.

Este guia monta o calendário de um mês numa planilha que você controla e o importa no Social, o app de redes sociais do zerosoft.

## Antes de começar: o estado do Social

O Social ainda aparece como "Em breve" no site. As redes (Facebook, Instagram, LinkedIn, X, TikTok, YouTube, Threads e Bluesky) foram feitas sobre as APIs oficiais e testadas contra redes simuladas. Ainda não as verificamos com contas reais, e várias precisam do app de desenvolvedor de quem administra a instância. Se você faz self-host, isso faz parte do trabalho. O detalhe linha por linha está na tabela de paridade da página do [Social](/products/social).

Tudo o que segue pode ser testado hoje com as redes simuladas. O fluxo da planilha é o mesmo quando você conectar contas reais.

## Passo 1: decida três coisas antes de escrever uma linha

1. **Quantas vezes por semana, por rede.** Escolha um número que sua equipe consiga manter. Três publicações por semana em duas redes dão 24 linhas por mês. Quatro redes todo dia são 120, e alguém vai desistir na segunda semana.
2. **Pilares.** Três ou quatro temas que se repetem: produto, clientes, bastidores, ideias do seu setor. Eles evitam que o calendário se encha com a primeira coisa que vier à cabeça.
3. **Quem aprova.** Se alguém da equipe precisa que outra pessoa revise suas publicações, defina agora (passo 5, abaixo).

## Passo 2: a planilha

O Social lê um CSV com estas colunas: data, hora, texto e link (opcional). Com cabeçalho, a ordem não importa, e os nomes são reconhecidos em português, inglês e espanhol (`data`, `hora`, `texto`, `link`). Sem cabeçalho, a ordem é a de cima. O separador pode ser vírgula ou ponto e vírgula, então o CSV exportado por uma planilha em português funciona do jeito que está.

Um modelo para começar:

```
data,hora,texto,link
2026-12-01,09:30,"Lançamos a versão de dezembro: o que mudou no calendário.",https://seusite.com/novidades
2026-12-03,18:00,"Três perguntas que ouvimos antes de toda contratação.",
2026-12-08,09:30,"Uma segunda-feira com a equipe: nossa reunião de 15 minutos.",
```

Regras úteis, tiradas do código do importador:

- **A hora é lida no fuso do workspace.** Uma data sem hora é um erro: não se adivinha.
- **Formatos de data.** `2026-12-31` sempre é entendido. Com barras (`03/04/2026`), você escolhe ao importar se o dia ou o mês vem primeiro.
- **Até 350 linhas por arquivo** e 2 MB. O que passar disso fica de fora, e você é avisado.
- **O link entra no fim do texto** se o texto ainda não o contiver.
- **Sem fotos por linha.** Um CSV traz só texto.

Você pode somar colunas suas (pilar, responsável, objetivo): as que o Social não reconhece são ignoradas, então sua planilha pode ser mais rica do que o que se importa.

## Passo 3: importe e leia a prévia

No Social, abra **Importar CSV**. Escolha as contas (cada linha sai em todas as contas marcadas), envie o arquivo ou cole as linhas e olhe a **Prévia**. Cada linha fica como "Pronta" ou "Fica de fora", com o motivo:

- a data ou a hora não são entendidas,
- essa data e hora já passaram,
- não tem texto nem link,
- o link não é uma URL válida.

Problemas por rede também são avisados, como um texto acima do limite de caracteres do X. Corrija a planilha e carregue de novo, ou importe as linhas boas e pule o resto.

## Passo 4: escolha como entra

O seletor **Importar como** tem três opções:

- **Publicações agendadas:** saem sozinhas na data e hora de cada linha.
- **Publicações para aprovar:** ficam na aba "Para aprovar" até um admin revisar.
- **Rascunhos:** não saem. Use quando a publicação leva foto ou vídeo, porque o CSV não os traz. Abra cada rascunho no editor, adicione o arquivo (até 10 MB) e agende.

No primeiro mês, minha sugestão é importar como rascunhos ou para aprovar, revisar o calendário inteiro na visão de mês e só então agendar. As agendadas podem ser arrastadas para outro dia no calendário e mantêm o horário.

## Passo 5: aprovações para quem precisa

Membros com o papel "Precisa de aprovação" enviam suas publicações para revisão em vez de agendá-las. Um admin aprova ou recusa com um comentário, e quem escreveu recebe o aviso. Cada publicação guarda quem a aprovou. Aprovações em várias etapas ainda não existem: é uma revisão só.

## Passo 6: a fila para os buracos

Um calendário de datas fixas não cobre tudo. Para o conteúdo que pode sair em qualquer dia, cada conta tem **Horários da fila** (na tela Contas): os dias da semana e as horas em que você quer que as coisas saiam. No editor, **Adicionar à fila** pega o próximo horário livre da conta e mostra qual é antes de você confirmar. Se a conta não tem horários, ele avisa.

Uma combinação que funciona: o CSV para as publicações com data (lançamentos, eventos) e a fila para o conteúdo que sempre serve.

## Passo 7: revise uma vez por semana

Quando há 10 publicações com métricas, o Social sugere melhores horários a partir das suas próprias interações. Antes disso mostra horários para começar, identificados como tais. Encare como uma sugestão: duas ou três semanas de dados de uma equipe pequena dizem pouco.

Se você passa os links pelo encurtador da suíte, o Link conta os cliques e o Social pode adicionar parâmetros UTM. Como montá-los: [UTMs sem planilha](/blog/utms-sin-planilla).

## O que falta, para não surpreender

- Pinterest, Perfil da Empresa no Google e stories do Instagram e do Facebook ainda não.
- Não há editor de imagens nem integração com o Canva.
- As publicações no X aceitam texto e até quatro fotos, sem vídeo.
- Não existe busca de hashtags em alta. Há grupos salvos e sugestões a partir do que sua equipe já usou.

## Custo

Self-host: $0, com todas as funções do core sob AGPL. No zerosoft Cloud os assentos não são cobrados, então incluir alguém para revisar não muda a fatura. Se você vem da Hootsuite, a comparação completa está em [Hootsuite vs zerosoft Social](/compare/hootsuite-alternative).
