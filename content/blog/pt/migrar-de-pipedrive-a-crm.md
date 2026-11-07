---
title: "Como migrar do Pipedrive para o CRM do zerosoft"
description: "Guia para levar pessoas, organizações, negócios, pipelines, campos personalizados e atividades do Pipedrive para o CRM com seu token de API, e o que conferir."
date: "2026-10-31"
author: "zerosoft"
tags: ["crm", "pipedrive", "migração", "guia"]
---

Se o seu time trabalha no Pipedrive, o que mais pesa numa mudança é o pipeline: os negócios em aberto, a etapa de cada um e o histórico de ligações e notas que explica o porquê. O [CRM](/products/crm) do zerosoft puxa tudo isso direto da API do Pipedrive, com uma prévia antes de gravar qualquer coisa. A seguir, o que vem campo a campo, o que fica para trás e os passos exatos.

## O que você precisa

Uma coisa só: o seu **token pessoal de API** do Pipedrive. No Pipedrive, abra seu avatar › Preferências pessoais › API. Use o token de uma conta admin. O token enxerga o que o usuário dele enxerga, então com uma conta admin vêm os registros do time todo.

No zerosoft, quem roda a importação é alguém que administra o workspace. O token fica guardado criptografado enquanto a importação roda e é apagado quando ela termina, falha ou é cancelada. Ele nunca vai numa URL.

## O que é importado

O importador lê cinco coisas, nesta ordem: organizações, pessoas, negócios, notas e atividades. Antes disso, lê os usuários, os campos personalizados e os pipelines.

- **Organizações viram empresas.** Nome, site (o domínio sai dele), setor, número de funcionários, cidade e país do endereço, e owner.
- **Pessoas viram contatos.** Nome e sobrenome, o email e o telefone principais, cargo, owner e a organização, que fica como empresa principal.
- **Pipelines e etapas**, na ordem e com a probabilidade de cada etapa. Se já existe um pipeline ou uma etapa com o mesmo nome, ele é reaproveitado.
- **Negócios.** Título, pipeline, etapa, valor, moeda, data de fechamento, owner, motivo da perda, a pessoa e a organização vinculadas. Vêm os abertos, ganhos e perdidos; os excluídos, não.
- **Notas** entram na timeline do contato, da empresa ou do negócio a que estavam ligadas, com data e autor. O HTML do Pipedrive vira texto.
- **Atividades.** Ligações, reuniões e emails mantêm o tipo. Qualquer outro tipo, inclusive os personalizados que você criou, entra como tarefa. Vêm o assunto, a nota, o vencimento, se está concluída e a duração.
- **Campos personalizados** de pessoas, organizações e negócios. Cada um vira um campo personalizado com tipo equivalente: número, moeda, data, seleção, seleção múltipla, telefone ou texto. As opções dos campos de seleção chegam com seus rótulos.
- **Owners.** Cada usuário do Pipedrive é cruzado pelo email com alguém do workspace. Os que não batem você atribui ou convida pela mesma tela.

### Ganho e perdido

No Pipedrive, ganho ou perdido é um status do negócio. No CRM é uma etapa. Por isso cada pipeline importado ganha duas etapas no final, **Won** e **Lost**, e os negócios fechados vão para lá. A data de fechamento vem de quando o negócio foi ganho ou perdido; se ainda está aberto, da data prevista de fechamento.

## O que não é importado

Pelo código do importador, isto fica no Pipedrive:

- **Arquivos anexados** a negócios, pessoas ou organizações.
- **Leads** da caixa de leads e **produtos** dos negócios. O importador não lê essas partes da API.
- **Emails e telefones secundários.** Só o principal de cada pessoa viaja.
- **Campos de sistema** fora da lista acima, como a etiqueta da pessoa ou o endereço completo (só cidade e país).
- **A descrição do negócio** e o resultado das ligações.

Se precisar de algum deles, exporte do Pipedrive como backup antes de encerrar a conta.

## Passo a passo

1. **Abra o importador.** No zerosoft, vá em Configurações › Importar e escolha **HubSpot ou Pipedrive para o CRM**. Ele também está no CRM, em Configurações › Importar e exportar › **Importar de outro CRM**.
2. **Conecte.** No cartão **Importar do Pipedrive**, clique em **Conectar Pipedrive**, cole o token em **Token de API** e clique em **Conectar e ver prévia**.
3. **Revise a prévia.** Nada foi importado ainda. Aparecem uma amostra de empresas e contatos, os campos personalizados (cada um para usar um existente ou criar), os pipelines com suas etapas e a tabela de owners. O Pipedrive não informa totais antes, então no lugar da quantidade aparece "Tudo".
4. **Escolha o que importar.** Em **O que importar**, marque Empresas, Contatos, Deals e Atividades. As atividades incluem as notas.
5. **Atribua os owners.** Quem bate pelo email já aparece marcado. Para o resto, escolha alguém ou deixe o owner padrão. Se você convidar essa pessoa depois e ela entrar com o mesmo email, os registros que ninguém reatribuiu passam a ser dela.
6. **Clique em Começar import.** A importação roda em partes, em segundo plano. Pode fechar a aba: a tela retoma quando você volta, e o progresso conta o que já foi processado.

## O que conferir no final

- **O resumo por objeto.** No fim você vê processados, criados, atualizados, ignorados e com erro. Se houver erros, a lista de avisos diz quais.
- **As duplicatas que não foram criadas.** Um contato com um email que já existia ou uma empresa com o mesmo domínio não são duplicados: os campos vazios deles são preenchidos.
- **As etapas Won e Lost.** Se o seu processo usa outros nomes, renomeie nas configurações do pipeline.
- **Suas automações.** Os registros importados são gravados direto e não disparam workflows nem webhooks. Se um workflow precisava rodar para os contatos existentes, rode à mão.
- **Alguns negócios grandes.** Abra três ou quatro e compare valor, etapa e timeline com o Pipedrive.

## Rodar de novo

Cada registro guarda o id do Pipedrive. Importar de novo atualiza em vez de duplicar. Se alguém editou um registro no zerosoft depois da importação, ele não é sobrescrito: só os campos vazios são preenchidos, a menos que você marque **Substituir pelo que está na Pipedrive**. Isso permite migrar em duas etapas: importa agora, o time testa, e importa de novo no dia em que desligar o Pipedrive.

Se preferir arquivos, a importação por CSV do CRM tem o preset **Export do Pipedrive**, que mapeia as colunas sozinho. O mapeamento e os valores de enum funcionam como no [guia de CSV da HubSpot](/blog/migrar-contactos-de-hubspot-por-csv).

## O que ainda falta

Nossa tabela de paridade compara o CRM com a HubSpot, não com o Pipedrive, então aqui vão só as lacunas que publicamos lá:

- **Notetaker.** Ligações e reuniões da timeline têm resumo com IA a partir das notas ou de uma transcrição anexada. Nenhum bot entra na chamada para gravar.
- **App nativo.** É um app instalável (PWA) no iOS e no Android, e as telas já abertas funcionam offline. Não está na App Store nem no Google Play.
- **Diretório de apps.** Slack, Zoom, Stripe, Zapier e Make vêm integrados, além de webhooks e API REST. Não há marketplace de terceiros.

## Quanto custa

Self-host custa $0, com o código sob AGPLv3 e todas as funções. O zerosoft Cloud tem um plano grátis para começar e depois cobra pelo uso, como emails e armazenamento. Assentos não são cobrados: somar dez vendedores não muda a fatura. A comparação lado a lado com a HubSpot está em [zerosoft vs HubSpot](/compare/zerosoft-vs-hubspot).

Depois de entrar, uma boa primeira tarefa é uma [faxina no pipeline](/blog/higiene-del-pipeline): negócios vindos de um CRM antigo costumam trazer etapas que ninguém mexe há meses.
