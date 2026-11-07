---
title: "Migrar do Intercom para o Chat: como trazer suas conversas"
description: "Guia para trocar o Intercom pelo Chat: como tirar o JSON da API do Intercom, o que entra (pessoas, mensagens, status), o que não entra e o que revisar antes."
date: "2026-10-31"
author: "zerosoft"
tags: ["chat", "intercom", "migração", "guia"]
---

Quando um time de suporte sai do Intercom, o que mais pesa é o histórico. Cada conversa antiga é contexto: o que aquele cliente perguntou no ano passado, o que foi prometido, como foi resolvido. Começar do zero em outra caixa de entrada significa perder isso.

Este guia mostra como trazer esse histórico para o [Chat](/products/chat), o que o importador traz exatamente (lemos o código), o que fica de fora e em que ordem fazer a troca. Vale avisar logo: a importação do Intercom no Chat funciona com um arquivo JSON, e não com uma conexão direta, e foi testada com os exemplos da documentação do Intercom, não com uma conta real. Por isso o guia insiste em fazer um teste pequeno antes.

## O que você precisa

- **Um access token do Intercom.** Segundo a [documentação do Intercom](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication), ao criar um app no seu workspace pelo Developer Hub, o token aparece em Configure › Authentication desse app.
- **Um widget criado no Chat.** As conversas importadas ficam guardadas em um widget. Se ainda não tem um, crie primeiro.
- **Ser admin do workspace** no zerosoft.
- **Um terminal** com `curl` e `jq`, ou qualquer linguagem que faça requisições HTTP. É a única parte técnica.

## Passo 1: tirar o JSON do Intercom

O Chat lê o formato que a API do Intercom devolve quando você busca uma conversa: `GET /conversations/{id}`. Essa requisição traz a primeira mensagem e as partes da conversa. A listagem (`GET /conversations`) serve para conseguir os ids, mas a documentação do Intercom avisa que ela não inclui as partes, então é preciso buscar cada conversa separadamente. O Intercom também informa que a API devolve no máximo as 500 partes mais recentes de uma conversa.

Um exemplo mínimo para uma página da listagem:

```bash
TOKEN="seu_access_token"
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
  "https://api.intercom.io/conversations?per_page=50" | jq -r '.conversations[].id' > ids.txt

while read id; do
  curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "https://api.intercom.io/conversations/$id"
done < ids.txt | jq -s '.' > intercom.json
```

A listagem vem paginada: para trazer tudo, repita a primeira requisição com o cursor que o Intercom devolve e junte os ids. O Chat aceita um array de conversas, um objeto com `conversations` ou `data` dentro, ou uma conversa só.

Dois limites do lado do Chat: **até 4 MB por arquivo** e **2.000 conversas por arquivo**. Se o seu histórico for maior, divida em vários arquivos e envie um de cada vez.

## Passo 2: importar no Chat

1. No Chat, vá em **Relatórios** e clique em **Importar conversas** no cabeçalho da página.
2. Em **Para o widget**, escolha para onde vão as conversas.
3. Em **Arquivo JSON**, envie o arquivo e clique em **Importar**.

No fim você vê quantas conversas entraram, quantas já existiam e quantas mensagens foram importadas. Se alguma falhou, ela é limpa e você pode tentar de novo enviando o mesmo arquivo: o que já entrou não se duplica.

## O que é importado

De cada conversa:

- **A pessoa**: nome e email do contato (ou do autor da primeira mensagem, quando é o cliente). Valores que não têm cara de email são descartados.
- **O assunto**, se a conversa tinha, ou o título dela.
- **As mensagens em ordem**, com data. O que foi escrito pelo contato, lead ou usuário fica como do visitante; o resto conta como resposta do time.
- **O status**: aberta se estava aberta no Intercom; qualquer outro estado entra como resolvida.
- **Uma etiqueta `import-intercom`** em cada conversa, para encontrar e separar na caixa de entrada.

O que é importado não dispara regras, bot nem webhooks. E as pessoas importadas não recebem campanhas até um admin marcar o consentimento na ficha.

## O que não é importado

- **As notas internas.** O importador pula de propósito.
- **Anexos e imagens.** O Intercom manda as mensagens em HTML; o Chat fica com o texto.
- **Quem respondeu.** As respostas do time entram como do time, sem a pessoa específica. Mensagens de bots também caem aí.
- **Atribuições, mudanças de status e conversas adiadas.** As atribuições chegam como partes sem texto e não são importadas. Uma conversa adiada entra como resolvida.
- **Tags, atributos, empresas e avaliações** do Intercom.
- **A pessoa unificada.** Cada conversa importada cria o seu próprio registro de visitante, mesmo quando o email se repete.
- **Artigos da central de ajuda, bots e regras.** Isso se monta de novo no Chat.

## Antes de trocar o widget

1. **Teste com um arquivo pequeno**, de dez ou vinte conversas. Abra algumas no Chat e compare com o Intercom.
2. **Importe o resto** em lotes.
3. **Cadastre suas respostas salvas** e os artigos de ajuda que o bot pode usar. Em [artigos de ajuda que o bot consegue ler](/blog/articulos-de-ayuda-que-el-bot-puede-leer) está o passo a passo.
4. **Cole o script do widget do Chat** no seu site e tire o do Intercom.
5. **Faça uma última exportação** do Intercom com as conversas dos últimos dias e importe. O que se repete é pulado.

## O que ainda falta no Chat em relação ao Intercom

Da tabela de paridade, do jeito que está:

- **WhatsApp, Instagram, Messenger e SMS**: ainda não.
- **Telefone e voz**: ainda não.
- **Apps nativos de iOS e Android para o time e SDK mobile do messenger**: ainda não.
- **Loja de apps**: não há. O Intercom tem mais de 450.
- **Central de ajuda multilíngue, privada ou com domínio próprio**: ainda não.
- **Email de entrada, tickets, workflows visuais, multimarca e SSO**: cobertos em parte. Por exemplo, os issues do Track funcionam como tracker tickets, mas não há tipos de ticket nem portal para o cliente.
- **Campanhas por email**: só texto, para pessoas com consentimento, com limite diário.
- **Prioridades**: quatro níveis; o Intercom tem cinco.
- **Idiomas do messenger**: 15, contra cerca de 45 do Intercom.
- **A própria importação**: sem conexão direta, anexos nem notas internas.

A tabela completa está em [/compare/zerosoft-vs-intercom](/compare/zerosoft-vs-intercom).

## Quanto custa

O Intercom começa em cerca de US$ 29 por assento por mês: um time de dez paga US$ 3.480 por ano. O Chat no seu servidor custa $0, com o core em AGPLv3. No zerosoft Cloud você começa com um plano gratuito e depois paga pelo uso. Assentos não são cobrados, então colocar mais alguém no suporte não muda a fatura.

Para ver a comparação do dia a dia antes de mudar, leia [Chat vs Intercom](/blog/zerosoft-chat-vs-intercom).
