---
title: "Como tirar seus contatos da HubSpot com um CSV"
description: "Guia passo a passo para exportar contatos e empresas da HubSpot e importar no zerosoft CRM: mapeamento de colunas, deduplicação por email e domínio, e o que fica para trás."
date: "2026-07-24"
author: "zerosoft"
tags: ["crm", "hubspot", "migração"]
---

Trocar de CRM parece projeto de um trimestre. Para a maioria dos times pequenos é uma tarde: dois CSVs, uma tela de mapeamento e um café. O segredo é saber exatamente o que o importador faz com cada linha antes de apertar o botão, para não terminar com 400 duplicados e uma coluna de lifecycle cheia de vazios.

Esta é a versão honesta. O que vai, o que não vai, e a ordem que evita faxina depois.

## O que dá para importar (e o que não dá)

O importador do zerosoft CRM (`/app/crm/settings` → Import / Export) trabalha com duas entidades:

- **Contatos**: nome, sobrenome, email, telefone, cargo, site, cidade, país, lifecycle stage, lead status e origem.
- **Empresas**: nome, domínio, setor, funcionários, telefone, site, cidade, país e lifecycle stage.

O que ele **não** importa hoje:

- **Deals.** Ainda não existe importador de deals. Se você tem um pipeline vivo, ou recria os deals abertos à mão (para um time pequeno costuma ser o caminho mais rápido) ou escreve um script contra a API pública: `POST /api/v1/crm/deals` existe e recebe pipeline, etapa, valor, data de fechamento e contatos.
- **Atividades.** Notas, ligações, emails e reuniões registrados na HubSpot ficam na HubSpot. Exporte para um arquivo como referência; eles não vão aparecer na timeline.
- **Campos personalizados.** O mapeamento do CSV só aponta para os campos padrão acima. Valores custom podem ser gravados pela API (`custom` em contatos, empresas e deals), não pela tela do CSV.
- **Owners.** Não existe coluna de owner na importação. Atribua depois, em cada registro ou via API.

Se algum desses itens for impeditivo, melhor saber agora do que no meio do caminho.

## Passo 1: exportar da HubSpot

Na HubSpot, exporte contatos e empresas como dois CSVs separados a partir da visão de índice de cada objeto. Duas dicas:

- **Exporte só o que você vai mapear.** Os exports da HubSpot podem vir com dezenas de colunas. As que o importador não reconhece são ignoradas por padrão, mas uma tela de mapeamento com 60 colunas é receita para erro. Escolha as propriedades da visão antes de exportar.
- **Guarde os arquivos originais.** Deixe-os num lugar seguro. Eles são o seu backup de tudo que não migra, incluindo propriedades custom e IDs de registro.

## Passo 2: empresas primeiro

A ordem importa. Quando um contato é criado sem empresa explícita, o zerosoft olha o domínio do email e vincula o contato à empresa com exatamente esse domínio (emails pessoais como Gmail são ignorados). Se `ana@acme.com` chega quando já existe uma empresa com domínio `acme.com`, a Ana fica vinculada sozinha.

Isso só funciona se as empresas já estiverem lá. Empresas primeiro, contatos depois.

Para o match funcionar, o domínio da empresa precisa ser o domínio puro: `acme.com`, não `https://www.acme.com/`. Limpe essa coluna antes de importar.

## Passo 3: a tela de mapeamento

O importador tem três passos: enviar (ou colar) o CSV, mapear colunas, ver o resultado. No mapeamento, cada coluna do seu arquivo mostra o cabeçalho, um valor de exemplo da primeira linha e um dropdown com o campo de destino. O importador chuta com base no nome do cabeçalho, ignorando maiúsculas, espaços e pontuação, e conhece alguns aliases em inglês e espanhol (`nombre`, `correo`, `empresa`, `cargo`…).

Com os cabeçalhos típicos da HubSpot, alguns se mapeiam sozinhos e outros pedem um clique:

- Costumam mapear sozinhos: `First Name`, `Last Name`, `Email`, `Job Title`, `City`, `Lifecycle Stage`, `Lead Status`, `Industry`, `Company name`.
- Costumam pedir mapeamento manual: `Phone Number`, `Country/Region`, `Website URL`, `Company Domain Name`, `Number of Employees`.

O que ficar em "— ignorar —" é descartado. `Record ID` e companhia podem ficar ignorados.

### Valores de enum: a armadilha silenciosa

Lifecycle stage, lead status e origem são listas fixas no zerosoft:

```
lifecycle:   subscriber, lead, mql, sql, opportunity, customer, evangelist
lead status: new, open, in_progress, open_deal, unqualified, connected, bad_timing
source:      organic, referral, ads, social, email, event, other
```

O importador aceita esses valores sem diferenciar maiúsculas, então `Lead` ou `Customer` funcionam. Mas um valor que não bate exatamente fica **vazio em silêncio**, não é rejeitado. Se o seu export diz `Marketing Qualified Lead` ou `In Progress`, faça um localizar-e-substituir para `mql` ou `in_progress` no CSV antes. Senão o contato entra normalmente e o campo fica em branco, e você descobre isso três semanas depois, num relatório.

## Passo 4: escolha o modo de deduplicação

Antes de rodar, você escolhe o que acontece quando um registro já existe:

- **Pular**: o registro existente não é tocado; a linha conta como pulada.
- **Atualizar**: o registro existente recebe os valores do arquivo.

As chaves de deduplicação são simples e vale decorar:

- **Contatos**: por email, sem diferenciar maiúsculas. `Ana@Acme.com` e `ana@acme.com` são a mesma pessoa.
- **Empresas**: por domínio, sem diferenciar maiúsculas.

E os casos de borda:

- Um contato **sem email** é sempre criado. Não há chave para comparar, então reimportar o mesmo arquivo duplica esses contatos sem email.
- Uma empresa **sem domínio** é sempre criada, pelo mesmo motivo. Uma linha de empresa sem nome nem domínio é rejeitada.
- Uma linha com **email inválido** não é importada e aparece na lista de erros com o número da linha.
- No modo atualizar, **células vazias não sobrescrevem** nada. Só valores preenchidos viajam, então um arquivo incompleto não apaga dados bons.

Cada importação roda numa única transação e mostra um resumo: total, criados, atualizados, pulados e erros.

## Limites que vale conhecer

- Até **5.000 linhas por importação**. Arquivo maior? Divida. Mesmo mapeamento, rode de novo.
- Até **20 importações por hora** por usuário.

Se você tem 40.000 contatos, são oito arquivos e alguns minutos, não um chamado no suporte.

## Passo 5: confira e limpe

Depois de importar:

1. **Mescle os duplicados que sobrarem.** A página de cada contato tem um painel de duplicados que lista outros contatos com o mesmo email e permite mesclá-los. O que você descarta passa os deals, atividades, emails e participações em listas estáticas para o que você mantém.
2. **Confira os enums.** Filtre contatos por lifecycle stage. Se um monte ficou sem valor, é a armadilha do Passo 3.
3. **Pause automações em importações grandes.** Contatos importados são criados como qualquer outro, então um workflow disparado por "Contato criado" pode reagir a eles. Se algum envia emails, desligue antes de importar 5.000 linhas.

## Fazendo por script

Se você se dá bem com um pouco de código, a API pública (`/api/v1/crm/contacts`, `/companies`, `/deals`, documentada em [/docs](/docs)) permite mover o que o CSV não move: campos custom, owners, deals. Autentique com uma chave pessoal em `Authorization: Bearer zs_…` e fique abaixo de 100 requisições por minuto.

A maioria dos times não precisa disso. Dois CSVs, empresas primeiro, limpe os enums, escolha o modo de deduplicação. E depois o mais importante: [seus dados podem sair com a mesma facilidade](/blog/exportar-tus-datos-deberia-ser-un-derecho). Admins podem exportar contatos, empresas, deals e atividades em CSV ou JSON quando quiserem.
