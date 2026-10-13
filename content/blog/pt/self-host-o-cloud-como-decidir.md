---
title: "Self-host ou Zerosoft Cloud? Um checklist honesto"
description: "Hospedar o Zerosoft é grátis e está a um docker compose de distância. Rodar bem é uma lista de pequenas tarefas: HTTPS, Google OAuth, e-mail, cron, backups, domínios próprios. Aqui está a lista para você decidir."
date: "2026-08-30"
author: "Zerosoftware"
tags: ["self-hosting", "nuvem", "guia"]
---

Dizemos em todo lugar: hospedar o Zerosoft custa $0, para sempre. É verdade, e não é a verdade inteira. O software é grátis. A hora que você passa às 23h com um e-mail de lembrete que não sai, não é.

Este post é o checklist que gostaríamos de ter se estivéssemos decidindo. Sem vender nenhum dos lados: ganhamos dinheiro quando você escolhe a nuvem, e mesmo assim construímos cada produto para rodar no seu próprio servidor. Escolha a opção cujas tarefas você prefere assumir.

## O que "self-host" significa aqui

O ponto de partida é pequeno de verdade:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

Um contêiner, um processo Node, um arquivo SQLite no volume `zerosoft-data` e os anexos em `zerosoft-uploads`. As migrações do banco rodam sozinhas quando a app sobe. Sem Postgres, sem Redis, sem workers de fila.

Com isso você tem a app rodando na porta 3000. Passar de "está rodando" para "meu time depende disso" é o checklist abaixo.

## O checklist

### 1. HTTPS e um reverse proxy

O contêiner fala HTTP puro. Você coloca um reverse proxy na frente — Caddy, nginx, Traefik, o que você conhecer — e dá um certificado a ele. Com Caddy são poucas linhas e certificados automáticos. Configure `NEXTAUTH_URL` com o endereço HTTPS público, porque os callbacks de login dependem disso.

**Esforço:** uma hora na primeira vez, quase zero depois.

### 2. Google OAuth (o único login)

O login do Zerosoft é Google OAuth. `DEMO_MODE` serve para explorar e é ignorado em produção, a menos que você force explicitamente — não force. Então você precisa de um projeto no Google Cloud com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, e o redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`.

Se quiser a sincronização do Gmail no CRM ou do Google Calendar no Cal, adicione os callbacks (`/api/integrations/gmail/callback`, `/api/integrations/google-calendar/callback`) e habilite as APIs do Gmail e do Calendar. Leitura do Gmail é um escopo sensível do lado do Google: para uma app usada só dentro do seu próprio Google Workspace costuma ser tranquilo; para algo mais amplo, confira as regras de verificação atuais do Google antes de prometer para alguém.

**Esforço:** 30 a 60 minutos clicando no Google Cloud Console. Chato, uma vez só.

### 3. E-mail que chega de verdade

Confirmações de agendamento, avisos ao anfitrião, lembretes de 24 h, e-mails de cancelamento e os e-mails dos workflows do CRM saem pelo Resend quando `RESEND_API_KEY` e `EMAIL_FROM` estão configurados. Sem eles, os e-mails são **registrados no console**: a app funciona e ninguém recebe nada. É o "está quebrado" mais comum que na verdade não está.

Você vai precisar de uma conta no Resend e de um domínio de envio verificado com os registros DNS que eles fornecem.

**Esforço:** 20 minutos mais a espera do DNS.

### 4. O cron

Algumas tarefas rodam por timer: os lembretes do Cal, as novas tentativas de webhooks e o gatilho `task_due` dos workflows do CRM. Tudo passa por um endpoint, `/api/cron/tick`. Na nossa nuvem, o Vercel Cron chama de hora em hora. No seu servidor, quem chama é *você*, com o segredo:

```bash
# crontab -e
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

Em produção o endpoint se recusa a rodar sem `CRON_SECRET`. Esqueça esse passo e nada quebra: os lembretes simplesmente nunca saem, em silêncio.

**Esforço:** 5 minutos. Fácil de esquecer, por isso está na lista.

### 5. Backups e restores

Os seus dados são dois volumes mais o seu `.env`. Fazer backup direito não é difícil, mas "copie o arquivo" não é a história toda para um banco SQLite em uso no modo WAL. Escrevemos um post inteiro sobre isso: [backups que funcionam](/blog/backups-que-funcionan). Leia antes de colocar clientes reais no seu CRM.

**Esforço:** uma hora para configurar, dez minutos por trimestre para testar um restore. O teste é a parte que todo mundo pula.

### 6. Domínios próprios no Link

Na nossa nuvem, `go.suaempresa.com` ganha HTTPS automático. Em self-host, os domínios são verificados por DNS (um CNAME ou registro A apontando para o seu servidor), mas o certificado de cada domínio próprio é trabalho do seu reverse proxy. O on-demand TLS do Caddy ou um certificado adicionado manualmente resolvem. Se hostnames extras servem a própria app, liste-os em `APP_HOSTS` para que não sejam confundidos com domínios de links.

**Esforço:** pouco por domínio, mas é mais uma peça em movimento.

### 7. Atualizações e o servidor

`git pull`, rebuild da imagem, reinício. As migrações se aplicam sozinhas. Mais a parte chata do servidor: atualizações do sistema, espaço em disco, alguém percebendo quando cai. A nossa página de status lista os serviços, mas o monitoramento ao vivo ainda não está ligado; no seu servidor, o monitoramento é seu de qualquer jeito.

**Esforço:** minutos por mês, desde que alguém seja o responsável.

### 8. Arquivos enviados

Os anexos do Chat, do Track e das tarefas do CRM vão para o volume `zerosoft-uploads`, até 10 MB cada. Nada para configurar: só lembre que isso faz parte do backup.

## Quando self-host é a escolha certa

- Alguém do time se dá bem com um servidor Linux e vai assumir a responsabilidade.
- Os seus dados precisam ficar em infraestrutura que você controla — por contrato com cliente, regulador ou princípio.
- Você quer modificar o código. (Leia [por que AGPLv3](/blog/por-que-agpl) para entender o que isso implica.)
- Você prefere gastar uma tarde uma vez a pagar qualquer coisa, nunca.

## Quando a nuvem é a escolha certa

- Ninguém quer ficar de plantão por um servidor, e essa é uma decisão razoável.
- Você precisa que e-mail, cron, HTTPS em domínios próprios e backups simplesmente existam, hoje.
- Vocês são um time não técnico e o checklist acima já cansou.

O Zerosoft Cloud começa com um plano gratuito generoso; depois disso, você paga por uso — o que escala —, nunca por assento, com preços transparentes publicados antes de cobrarmos qualquer coisa. Não colocamos números neste post porque o número honesto para comparar é o seu próprio tempo.

## Mudar depois: o que é portável hoje

Veja isso com clareza, porque é aí que a decisão entre self-host e nuvem fica grudenta:

- **Link:** exportável — JSON pela API e CSV por link.
- **CRM:** exportação completa em CSV/JSON (só admins), e importação CSV com mapeamento e deduplicação do outro lado.
- **Track, Cal, Chat, Docs:** ainda sem recurso de exportação. Exportar conversas do Chat e exportar Docs em JSON/Markdown são lacunas conhecidas.
- **Self-hosted:** o arquivo SQLite *é* a exportação. Está tudo lá, legível com qualquer ferramenta de SQLite.

Hoje não existe um botão de "mover meu workspace da nuvem para o meu servidor" (nem o contrário). Se portabilidade entre os dois é um requisito rígido, comece onde pretende ficar — ou comece self-hosted, onde o arquivo inteiro está com você.

## A versão curta

Hospede você mesmo se tiver um responsável e um motivo para querer. Use a nuvem se preferir não pensar em cron. Os dois são o mesmo código, e essa é a ideia: escolha o que escolher, a outra porta continua aberta.
