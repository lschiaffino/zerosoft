---
title: "Dar feedback em vídeo: uma revisão de 3 minutos com o Rec"
description: "Como revisar um design ou um pull request num vídeo curto, com uma estrutura que se entende sem reunião, e como fazer isso no Rec com comentários com tempo, acesso restrito e uma issue do Track."
date: "2026-11-16"
author: "zerosoft"
tags: ["rec", "feedback", "assíncrono"]
---

Um comentário de texto sobre um design diz "o espaçamento está estranho". Quem recebe pergunta "onde?", e a conversa que ia evitar uma reunião vira um vai e vem longo. Um vídeo de três minutos em que você aponta a tela resolve isso, desde que o vídeo tenha estrutura.

O Loom tem [um guia de boas práticas para dar feedback em vídeo](https://www.loom.com/blog/best-practices-for-providing-feedback-via-loom). Este post parte do mesmo problema e propõe um método que você pode copiar hoje, com as partes do Rec que o sustentam e o que ele ainda não faz.

## Quando usar vídeo e quando usar texto

Vídeo quando o feedback é visual ou sequencial: um design, um fluxo de telas, um pull request grande, uma landing com vários problemas. Texto para uma correção de uma linha. Uma regra prática: se você diria "olha aqui" mais de duas vezes, grave.

E um limite: se a pessoa vai discordar com força, o vídeo não substitui uma chamada. Ele ajuda a chegar na chamada com os pontos já mostrados.

## A estrutura de uma revisão de 3 minutos

Uma estrutura fixa avisa a quem assiste o que vem e deixa pular partes.

1. **Veredito nos primeiros 15 segundos.** "Quase pronto, duas mudanças obrigatórias e três sugestões." Quem está com pressa pode parar ali.
2. **Obrigatórias primeiro.** Cada uma com o que você vê, por que importa e o que mudaria. Uma frase por parte.
3. **Sugestões depois.** Diga em voz alta que são opcionais. Evita que alguém gaste uma hora em algo que você queria como comentário de passagem.
4. **Feche com o próximo passo.** Quem faz o quê e até quando. Sem um pedido concreto, o vídeo fica como uma opinião.

Um modelo de roteiro, com suas palavras:

```
Veredito: [pronto / quase pronto / refazer]
Obrigatória 1: [onde] [o que vejo] [o que mudaria]
Obrigatória 2: ...
Sugestões: [onde] [ideia]
Próximo passo: [pessoa] [ação] [data]
```

Grave uma tomada. Se errar, recomece em vez de editar: uma revisão com uma pausa ou um "desculpa, quis dizer" continua mais clara que uma conversa em texto.

## Como gravar no Rec

O Rec grava pelo navegador: tela, câmera ou as duas ao mesmo tempo, com a bolha da câmera desenhada no vídeo. Você escolhe tela inteira, janela ou aba. Há contagem de 3 segundos ao começar, pausa, recomeçar a tomada e silenciar o microfone.

Dois detalhes que ajudam numa revisão:

- **Grave a aba, não a tela inteira**, se o material está no navegador. Assim não entra a notificação de outra pessoa.
- **Uma tomada por assunto.** Se você revisa um design e um documento, faça dois vídeos. Fica mais fácil colocar cada link onde ele pertence.

O vídeo sobe em partes enquanto você grava e o link é copiado assim que você para. Se a rede cair, a gravação continua e tenta de novo sozinha.

O que o Rec ainda não tem: desenhar na tela nem destacar o mouse durante a gravação. Para apontar, mova o cursor devagar e diga onde está. Também não há extensão do Chrome; há um app desktop para Mac e Windows.

## Fechando o ciclo: comentários com tempo

O que torna o vídeo útil como feedback é que a resposta aponta o segundo exato. No Rec, os comentários ficam marcados na linha do tempo: um clique leva ao segundo, e quando a reprodução passa pela marca o comentário aparece sobre o vídeo. Também há seis reações com emoji, ancoradas a um segundo.

Peça a quem recebe a revisão que responda ali e não no chat. Duas razões: cada resposta fica colada ao momento que discute, e você recebe um aviso agrupado ("3 comentários novos") em vez de três mensagens soltas. As respostas são de texto; ainda não dá para responder com outro vídeo.

## Quem pode ver

Um feedback sobre um design não lançado ou sobre código interno não deveria ficar aberto ao mundo.

- O que é novo nasce **restrito**: só quem gravou e as pessoas convidadas. Você pode passar para membros do workspace ou para qualquer pessoa com o link.
- Você pode **convidar por email** como leitor ou comentarista. Quem é de fora recebe um link de uso único.
- Você pode definir **senha** e **vencimento**, e bloquear o download. Atenção ao último: o vídeo continua sendo transmitido, então alguém decidido consegue capturá-lo. Bloquear o download barra o reenvio por descuido.

## Da revisão à tarefa

Uma revisão que não termina em trabalho atribuído é esquecida. A partir do vídeo, com um clique, o Rec cria uma issue do Track ou uma página do Docs com o link, o resumo de IA, os capítulos e a transcrição. O texto é copiado como está, sem ser reescrito.

A transcrição, o resumo e os capítulos dependem de haver um provedor de transcrição configurado e da cota de IA do workspace. Se você roda por conta própria, escolhe o provedor (a variável `REC_TRANSCRIBE_PROVIDER`). Sem isso, o vídeo funciona igual, mas sem texto.

O fluxo completo: grava a revisão, compartilha restrita a quem interessa, a pessoa comenta no segundo exato e você transforma as obrigatórias em issues do Track. Se o que você quer tirar da agenda é a reunião de revisão, [notas de reunião que terminam em tarefas](/blog/notas-de-reunion-que-terminan-en-tareas) seguem a mesma lógica.

## Por que importa onde o vídeo mora

Um vídeo de revisão costuma mostrar coisas que você não quer num serviço alheio: telas de produto não lançadas, dados de clientes num painel, código. Com o Rec em self-host, os arquivos ficam no armazenamento da sua instalação e você paga só por ele. No zerosoft Cloud você paga por uso e os assentos não custam.

O Rec é um produto novo e está longe de ter tudo o que o Loom tem: não há remoção de vícios de fala com IA, nem app mobile, nem gravação de reuniões. A lista completa e atualizada está na página de comparação do Rec.

## Resumo

- Vídeo para feedback visual ou sequencial, texto para mudanças de uma linha.
- Veredito primeiro, depois obrigatórias, sugestões, próximo passo.
- Uma tomada por assunto, três minutos no máximo.
- Comentários com tempo para responder, acesso restrito por padrão.
- As obrigatórias viram issues do Track antes de fechar a aba.
