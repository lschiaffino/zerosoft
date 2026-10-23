---
title: "Webhooks de entrada no Flow: receber, proteger e responder"
description: "Como montar uma URL que outros serviços chamam: método, autenticação por header, leitura do corpo, resposta com seu próprio código de status e os limites que existem hoje."
date: "2026-10-23"
author: "zerosoft"
tags: ["flow", "webhooks", "automação"]
---

Um webhook de entrada é uma URL que você entrega a outro serviço para ele avisar quando algo acontece: um formulário enviado, um pagamento, um push em um repositório. Do seu lado, um flow começa sozinho. É o trigger mais usado em qualquer ferramenta de automação e também o mais mal configurado, porque a URL fica pública na internet.

O n8n resolve isso com um nó Webhook que tem dois endereços, um de teste e um de produção, conforme a [documentação do nó](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/). A URL de teste só escuta enquanto você olha o editor. A de produção é registrada ao ativar o workflow. O Flow tem uma única URL por trigger, e o que fazer com ela se resume a quatro ajustes. Aqui estão, com exemplos para copiar.

## 1. Criar o trigger e copiar a URL

No Flow, crie um flow novo e escolha **Webhook de entrada** como trigger. Salve: só então a URL aparece, neste formato:

```
https://seu-dominio/api/flow/hooks/fh_xxxxxxxxxxxxxxxxxxxx
```

O token depois de `fh_` é o segredo daquele nó. Há um por trigger, e se você apagar o nó o token vai junto. Trate como uma senha: não cole em um repositório público nem em um ticket.

Uma consequência prática: com o flow desligado, a URL responde 404. É a mesma resposta que um token inexistente recebe, então quem testa não sabe se o flow está pausado ou se a URL é inventada.

## 2. Escolher quais métodos aceita

O campo **Aceita** tem três opções: só POST (o padrão), só GET, ou GET e POST. Qualquer outro método recebe 405.

- **POST** para quase tudo: formulários, Stripe, GitHub, seu próprio backend.
- **GET** para serviços que verificam a URL antes de começar a mandar eventos, ou para um botão em um email que dispara uma ação.
- **GET e POST** quando você tem os dois casos na mesma URL.

O corpo é interpretado conforme o `Content-Type`. Com `application/json` vira um objeto (e se o JSON estiver quebrado, quem chama recebe 400 em vez de uma execução com lixo). Com `application/x-www-form-urlencoded` vira um objeto de campos. Qualquer outro tipo chega como texto. O limite é 256 KB: acima disso, 413.

## 3. Ler os dados nos passos seguintes

Tudo o que chega fica disponível como template nos nós seguintes:

- `{{trigger.body}}` para o corpo, e por exemplo `{{trigger.body.email}}` para um campo.
- `{{trigger.query}}` para os parâmetros da URL (`?origem=landing`).
- `{{trigger.headers}}` para os headers.
- `{{trigger.method}}` para saber se foi GET ou POST.

Um exemplo concreto: um formulário do seu site faz POST com `{"nome": "Ana", "email": "ana@exemplo.com"}`. Adicione um nó **CRM: criar contato** com o email `{{trigger.body.email}}`. Se já existir um contato com esse email, o nó devolve o existente em vez de duplicar, então reenviar o formulário não suja a base. Depois some **CRM: inscrever em sequência** para iniciar o acompanhamento.

Para ver como ficou cada valor, abra a execução: o histórico guarda a entrada e a saída de cada passo.

## 4. Fechar a porta com uma credencial

Por padrão, quem tem a URL pode chamá-la. Se o serviço que chama consegue mandar um header, peça autenticação no campo **Pedir autenticação**. Há duas formas:

- **API key em um header.** Você cria uma credencial com o nome do header (por exemplo `X-Api-Key`) e o valor. Toda requisição precisa trazê-lo; senão, recebe 401.
- **Usuário e senha (Basic).** Para serviços que só sabem mandar `Authorization: Basic`.

O segredo é comparado em tempo constante, e o header com a chave não é repassado ao flow, então não fica guardado no histórico de execuções. Se você apagar a credencial, a URL não se abre: fica fechada até você escolher outra. As tentativas falhas também contam contra o limite do IP, o que freia quem testa senhas.

Hoje o Flow não valida assinaturas HMAC genéricas neste trigger. Para Stripe existe um trigger próprio que verifica a assinatura com o signing secret. Se precisar verificar outra assinatura, a saída é um nó de código que a calcule, ou uma API key no header.

## 5. Responder com seu próprio código de status

Por padrão o webhook responde 202 de imediato e a execução continua por trás. Serve para quase tudo: o serviço de fora não fica esperando.

Quando a resposta precisa depender do resultado, mude **Responde** para **Com o passo Responder ao webhook** e adicione esse nó no final. Você escolhe o código de status, o tipo de conteúdo (JSON, texto ou HTML) e o corpo, que pode usar dados dos passos anteriores. Um caso simples:

1. O Webhook de entrada recebe `{"email": "ana@exemplo.com"}`.
2. Um nó **CRM: criar contato** cria ou encontra o contato.
3. **Responder ao webhook** devolve 200 com um JSON de confirmação. Se você colocar antes um nó **Filtro** que corta o ramo quando `{{trigger.body.email}}` não existe, pode usar outro **Responder ao webhook** no ramo de erro com um 422.

Os limites reais: quem chama espera até 25 segundos. Se a execução não respondeu a tempo, recebe 202 e a execução segue. Se o flow falhar, recebe 500. A resposta é entregue com `Content-Security-Policy: sandbox`, para que um corpo HTML montado com dados de fora não consiga rodar scripts no seu domínio.

Isso cobre verificação de endpoints, formulários que precisam de um código claro e APIs pequenas. Não cobre algo que demore um minuto: nesse caso, responda 202 e avise por outro canal quando terminar.

## Limites que convém conhecer

- Cada token aceita 600 requisições por minuto. Acima disso, recebe 429.
- Cada workspace tem um teto de execuções por hora: 1000 por padrão, configurável no self-host com a variável `FLOW_RUNS_PER_HOUR`. Passado o teto, o webhook responde 429 e quem chama pode tentar de novo mais tarde.
- Os headers `cookie`, `authorization` e os de infraestrutura (`x-forwarded-*` e similares) são descartados antes de chegar ao flow.
- Há só uma URL por trigger: não existe URL de teste separada. Para testar sem mexer na produção, monte um segundo flow com seu próprio trigger e aponte o serviço de teste para essa URL.

## Checklist antes de publicar a URL

1. Escolha o menor método que você precisa.
2. Se o serviço permitir, exija uma API key em um header.
3. Teste com `curl` e confira a execução no histórico.
4. Monte um flow de erros para saber se algo quebrar (falamos disso em [Quando um flow falha](/blog/cuando-un-flow-falla)).
5. Guarde a URL em um gerenciador de segredos, não no chat da equipe.

No self-host, tudo isso roda no seu servidor e as execuções ficam no seu próprio banco de dados.
