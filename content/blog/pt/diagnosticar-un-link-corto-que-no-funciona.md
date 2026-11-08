---
title: "Um link curto que não funciona: como diagnosticar em cinco minutos"
description: "Guia de diagnóstico para links curtos quebrados: as causas mais comuns, como distingui-las de fora e o que o Link mostra em cada caso, com uma lista de verificação para copiar."
date: "2026-11-04"
author: "zerosoft"
tags: ["link", "diagnóstico", "guia"]
---

Um link curto quebrado quase nunca avisa. Alguém imprimiu num cartaz, outra pessoa colou num e-mail para 2.000 pessoas, e três dias depois um cliente escreve: "está dando erro". O Bitly tem [seu próprio guia para resolver problemas com short links](https://bitly.com/blog/troubleshoot-short-link-issues/), pensado para o produto dele. Esta é a versão para qualquer encurtador, com o que o Link mostra em cada caso, porque conhecemos o código e podemos dizer o que ele faz de verdade.

A ideia central: um link quebrado tem uma entre poucas causas, e cada uma deixa um rastro diferente. Se você olhar em ordem, o diagnóstico leva cinco minutos.

## Passo 1: teste de fora

Antes de mexer em qualquer coisa, abra o link numa janela anônima e, se puder, no celular com dados móveis. Isso separa dois mundos:

- **Falha para todos:** o problema está no link (vencido, arquivado, destino fora do ar).
- **Falha só para alguns:** o problema está no caminho (um firewall, um cache, o domínio).

Se aparecer uma tela da zerosoft, ótimo: o título diz a causa exata (veja a tabela abaixo). Se aparecer um erro do navegador, o problema é de DNS ou de rede, e o link nem chegou ao encurtador.

## Passo 2: que tela aparece?

Quando um link do Link não redireciona, ele não deixa você com um erro genérico. Mostra uma destas telas, cada uma com sua causa:

| Tela | Causa | O que fazer |
|---|---|---|
| "Este link se foi" | Nunca existiu, foi apagado ou está arquivado | Confira o slug e o arquivo de links |
| "Este link expirou" | Passou a data de **Expira em** | Edite a data ou crie outro link |
| "Limite de cliques atingido" | Chegou ao **Máximo de cliques** | Aumente o máximo |
| "Link protegido" | Tem senha | Passe a senha ou tire a proteção |
| "Este link foi bloqueado" | O destino foi marcado como phishing ou malware | Revise o destino |

Dois detalhes úteis. Primeiro, um link vencido ou sem cliques restantes pode levar a uma URL de reserva em vez da tela: cada link e cada domínio próprio aceitam uma. Se os visitantes chegam a uma página que você não esperava, olhe essa configuração. Segundo, o aviso de bloqueio existe porque o destino é verificado ao criar o link e de novo toda semana: uma URL limpa hoje pode estar comprometida amanhã.

## Passo 3: maiúsculas e minúsculas

É a causa mais boba e a mais frequente quando alguém digita o link à mão. No Link, os slugs aceitam letras maiúsculas e minúsculas, e a busca é exata: `/Promo` e `/promo` são dois links diferentes, e um dos dois pode não existir.

O que fazer:

1. Abra o link pelo painel e copie a URL em vez de digitar.
2. Se o link vai num cartaz ou num QR, use slugs em minúsculas. São mais fáceis de ditar e não dependem da memória de ninguém.
3. Evite caracteres que se confundem ao ler: `l` minúsculo contra `I` maiúsculo, `0` contra `O`.

## Passo 4: o domínio próprio

Se o link usa um domínio seu (`go.suaempresa.com/oferta`) e falha com um erro do navegador ou cai numa página da zerosoft, olhe o domínio, não o link. O Link verifica a propriedade com dois registros: um que aponta o domínio para o servidor e um TXT em `_zerosoft-verify.<seu-domínio>`. Enquanto o domínio não estiver verificado, o host não resolve nada: qualquer slug mostra "Este link se foi".

Verificações:

- No painel de domínios, confirme que consta como verificado.
- Se você trocou de provedor de DNS, recrie os dois registros. TTLs longos fazem a mudança demorar a aparecer.
- Os links vivem dentro do domínio: o mesmo slug no domínio padrão e no seu são links separados.

## Passo 5: o destino

Às vezes o link está perfeito e a página para a qual ele aponta não. Teste o destino diretamente. Se o site mudou de estrutura, a URL antiga dá 404 e o encurtador não tem nada a ver com isso. Esse é o principal motivo para escolher um encurtador em que você possa **editar o destino sem mudar o link curto**: você corrige uma vez e todos os cartazes impressos voltam a funcionar.

Uma consequência prática: o Link responde seus redirects com `cache-control: no-store`, inclusive os 301. Se você edita o destino, arquiva ou vence um link, a mudança vale na próxima visita e não depende do cache do navegador.

## Passo 6: funciona para uns e para outros não

Se o link abre na sua casa mas não no escritório de um cliente, desconfie do firewall. Algumas redes corporativas bloqueiam domínios inteiros de encurtadores, e aí não há conserto do lado do link. O que você pode fazer:

- Usar um domínio próprio: é mais fácil o TI aprovar um domínio seu do que um compartilhado por milhares de encurtadores.
- Mostrar o destino quando der ("docs.suaempresa.com/guia"), para que quem não consegue abrir o link curto possa copiar a URL longa.
- Mandar o link também como texto: se for um QR, imprima o link curto embaixo.

## Passo 7: as visitas não batem com o esperado

"Meu link tem 40 cliques e mandei o e-mail para 2.000 pessoas" quase nunca é um link quebrado. O Link não conta como visitas os bots, os geradores de preview do Slack, WhatsApp ou iMessage nem as requisições HEAD, e eles também não gastam o **Máximo de cliques**. Um clique é uma pessoa que abriu o link, e isso tem pouco a ver com a quantidade de envios.

Para detectar um problema de verdade, olhe a tendência na aba de analytics. Uma queda brusca para zero com campanha ativa merece o diagnóstico completo.

## Lista de verificação para copiar

1. Abrir o link em janela anônima e com dados móveis.
2. Ler o título da tela que aparece.
3. Comparar maiúsculas e minúsculas do slug com o do painel.
4. Se usa domínio próprio, confirmar que está verificado e que os dois registros DNS continuam criados.
5. Abrir o destino direto.
6. Se falha só numa rede, pedir ao TI que libere o domínio ou migrar para um próprio.
7. Olhar a tendência de cliques antes de dar por quebrado um link com poucas visitas.

## Um último hábito

Uma vez por mês, abra seus dez links mais usados. É uma checagem de dois minutos que pega destinos fora do ar antes de um cliente pegar. O Link ainda não faz essa checagem sozinho, então por ora ela é manual.
