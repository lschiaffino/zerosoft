---
title: "Como testar um agente de IA antes que ele fale com seus clientes"
description: "Um método em quatro passos para testar um agente de suporte: testes salvos avaliados por um juiz de IA, conversas simuladas, repetição de chats reais e versões com rascunho."
date: "2026-10-31"
author: "zerosoft"
tags: ["agents", "ia", "suporte", "qualidade"]
---

Você muda uma linha nas instruções do seu agente de suporte e, nessa mesma tarde, alguém conta que o bot prometeu um reembolso. Ninguém testou, porque testar um agente na mão é lento e sempre se acaba testando a mesma pergunta fácil.

A Intercom documenta como testar o Fin antes do lançamento: uma [prévia no Messenger](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers) para sua equipe ou segmentos de clientes, e um [Batch Test](https://www.intercom.com/help/en/articles/10521711-batch-test-fin-ai-agent) que roda perguntas reais antes de as respostas chegarem a um cliente. A ideia é boa. Este post pega o mesmo problema e o resolve com as ferramentas do Agents, dizendo o que cada uma faz e o que ainda não faz.

## O problema: um agente muda a cada edição

Um agente depende de três coisas que você edita com frequência: as instruções, o conhecimento e as ferramentas. Mexer em qualquer uma pode quebrar uma resposta que antes saía bem. Testar bem significa ter uma lista fixa de situações e rodá-la de novo sempre que algo muda, como em qualquer suíte de testes.

O método tem quatro peças. Dá para usá-las separadamente, mas juntas cobrem quase tudo.

## Passo 1: salve perguntas com o comportamento esperado

Na aba Playground do agente há uma seção Testes. Cada teste é uma pergunta de um visitante e uma descrição do que faz uma boa resposta, com suas palavras. Um agente aceita até 50.

O importante é o que você escreve em "Comportamento esperado". Descreva ações, não redação:

```
Pergunta: Vocês enviam para o Brasil?
Esperado: Busca no conhecimento e diz que o envio para o Brasil leva
5 dias úteis. Não agenda reuniões.
```

Cada teste roda no playground em modo simulação: o agente responde de verdade, mas as ferramentas que escrevem (salvar um contato, agendar, executar um flow) não são executadas. Depois um juiz de IA compara a resposta e as ferramentas usadas com o esperado, e marca Aprovado ou Reprovado com um motivo de uma ou duas frases. A redação não precisa coincidir; o juiz avalia o conteúdo.

Um ponto de partida de dez testes para um agente de suporte:

1. Três perguntas cuja resposta está no seu conhecimento (preço, prazo, política).
2. Duas perguntas cuja resposta não está. Esperado: não inventa e encaminha para uma pessoa.
3. Um pedido de reembolso. Esperado: encaminha, não promete nada.
4. Alguém que pede para falar com uma pessoa. Esperado: encaminha na primeira mensagem.
5. Uma pergunta fora do assunto. Esperado: recusa com educação.
6. Uma tentativa de fazê-lo ignorar suas instruções. Esperado: o comportamento não muda.
7. Uma pergunta em espanhol ou inglês. Esperado: responde no idioma do visitante.

Se você já tem uma boa troca no playground, o botão "Salvar como teste" a transforma em caso sem redigitar a pergunta.

## Passo 2: simule conversas completas

Muitos problemas aparecem na terceira mensagem, não na primeira: o agente pede o email, o cliente reclama, o agente se perde. Para isso, um teste pode ser do tipo "Conversa simulada".

Você define uma persona e um objetivo, por exemplo: "Ana, dona de uma padaria pequena. Quer uma demo na semana que vem e dá o email quando pedem". Um cliente simulado por IA conversa com o rascunho do agente até cumprir o objetivo, ser encaminhado a uma pessoa ou chegar ao limite de turnos (entre 2 e 8, padrão 4). Depois o juiz avalia a conversa inteira contra o seu critério de sucesso, e você pode ler a transcrição turno a turno.

Duas simulações que vale sempre ter:

- **O cliente cooperativo.** Dá os dados que pedem. Verifica se o agente completa a tarefa (por exemplo, agendar).
- **O cliente que se irrita.** Repete a pergunta e escreve seco. Verifica se o agente encaminha em vez de insistir.

Uma simulação gasta tokens de duas conversas, a do cliente e a do agente, então não precisa rodar todas a cada edição pequena. Rode as simulações antes de publicar e os testes de uma pergunta quando mudar o conhecimento.

## Passo 3: repita conversas reais contra o rascunho

Seus testes inventados refletem o que você imagina que os clientes perguntam. As conversas reais mostram o que eles perguntam de verdade. O Playground também tem "Repetir as últimas 10": pega as primeiras mensagens das últimas dez conversas reais, envia ao rascunho salvo (também em simulação) e mostra lado a lado o que o agente respondeu antes e o que responde agora, com um veredito de Melhor, Igual ou Pior.

É o teste que mais surpreende. Se você mudou o tom das instruções, vê na hora se as dez respostas continuam dizendo o que deviam. Quando aparece um "Pior", você já tem o próximo teste para salvar.

## Passo 4: publique com rascunho e deixe uma saída

Os testes só servem se o agente em produção não mudar enquanto você os executa. Por isso o Agents tem versões. Depois de publicar a primeira, o que você salva a partir daí fica como rascunho: o playground e os testes usam o rascunho, e os canais ao vivo seguem na versão publicada até você apertar Publicar. O fluxo completo:

1. Edite e salve. Aparece "Mudanças não publicadas" ao lado do estado da versão ao vivo.
2. Rode os testes, as simulações e a repetição.
3. Se tudo passar, Publicar, com uma nota opcional dizendo o que mudou ("adicionei a política de devoluções").
4. Se algo deu errado, "Descartar rascunho" devolve o editor à versão ao vivo, e "Voltar para esta versão" coloca qualquer versão anterior no ar como uma versão nova.

O registro de mudanças guarda quem mudou o quê e quando: instruções, arquivos de conhecimento, ferramentas, conexões. Quando numa terça o agente se comporta diferente, você vê o que foi mexido na segunda.

Para mudanças grandes há uma opção mais cautelosa: o teste A/B, na aba Versões. Uma versão salva atende entre 5% e 95% das conversas novas e o resto segue na publicada. A tabela compara conversas, resolvidas, encaminhamentos e polegares para cima e para baixo de cada variante, e você pode colocar a B no ar ou encerrar o teste. Com pouco tráfego os números demoram a dizer algo, então use quando tiver volume e não como substituto dos testes.

## O que ainda não faz

Convém conhecer os limites antes de confiar nos testes:

- **O juiz é um modelo.** Pode errar. Leia o motivo de cada Reprovado e de alguns Aprovado ao acaso, principalmente no início.
- **A simulação não executa as ferramentas.** Verifica se o agente decidiu chamar "Agendar reunião" com os dados certos, não se a reserva foi criada. Essa parte se testa uma vez, na mão, com um caso real.
- **Os testes usam a versão salva.** Se o editor tem mudanças sem salvar, o aviso pede para salvar primeiro.
- **Os testes não bloqueiam a publicação.** A aba Canais mostra quantos testes o agente tem e quantos passaram, com um atalho para rodá-los, mas publicar não depende disso. A decisão é sua.

## Quanto custa testar

Na Intercom, testar com clientes reais no ambiente ao vivo [é cobrado por resolução](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers). No Agents não existe preço por resolução: os testes consomem tokens do modelo que você escolheu, com sua própria chave se você faz self-host ou por consumo no zerosoft Cloud, onde a IA é cobrada ao custo do provedor ×1,2. Um conjunto de dez testes de uma pergunta são dez respostas curtas e dez vereditos curtos. Testar antes de publicar custa muito menos do que corrigir depois uma promessa errada.

## Uma rotina que se sustenta

- **Cada vez que mudar algo:** salve e rode os testes de uma pergunta.
- **Antes de publicar:** rode as simulações e "Repetir as últimas 10".
- **Toda semana:** olhe as conversas avaliadas com polegar para baixo e transforme duas em testes novos.

Depois de um mês você tem de 20 a 30 casos vindos de situações reais, e mudar as instruções deixa de dar medo.
