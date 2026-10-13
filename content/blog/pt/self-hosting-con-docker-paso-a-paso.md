---
title: "Self-hosting do Zerosoft com Docker, passo a passo"
description: "De um VPS vazio a um Zerosoft rodando com HTTPS, login com Google, backups, atualizações e o cron que ninguém lembra de configurar. Cada comando, sem enrolação."
date: "2026-07-29"
author: "Zerosoftware"
tags: ["self-hosting", "docker", "tutorial"]
---

Já defendemos que [o self-hosting em 2026 está mais fácil do que nunca](/blog/self-hosting-2026-mas-facil-que-nunca). Este post é a continuação chata e útil: os passos exatos para sair de um VPS vazio e chegar a uma instância do Zerosoft em que você confiaria os links, contatos e agendamentos do seu time.

Partimos de um VPS Linux com Docker e Docker Compose instalados, um domínio que você controla e mais ou menos uma hora. Vamos usar `zs.example.com` como hostname — troque pelo seu.

## 1. Clone e veja o que você vai rodar

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
```

Três arquivos importam. O `Dockerfile` monta uma imagem Node 24 em três estágios, roda com um usuário sem privilégios (`zerosoft`, uid 1001) e declara dois volumes: `/app/data` e `/app/public/uploads`. O `docker-compose.yml` sobe um único serviço, expõe a porta 3000 e monta dois volumes nomeados, `zerosoft-data` e `zerosoft-uploads`. E toda a configuração fica no `.env`.

Essa é a stack inteira. Um contêiner, sem Postgres, sem Redis, sem workers de fila. O banco é um único arquivo SQLite em `/app/data/zerosoftware.db`, criado e migrado automaticamente na primeira inicialização.

## 2. Configure o Google OAuth

O Zerosoft só tem login com Google ([aqui explicamos por quê](/blog/por-que-solo-login-con-google)), então você precisa de credenciais OAuth antes que alguém consiga entrar.

No console do Google Cloud, vá em APIs & Services → Credentials, crie um cliente OAuth do tipo "Web application" e adicione estas redirect URIs autorizadas:

```
https://zs.example.com/api/auth/callback/google
https://zs.example.com/api/integrations/gmail/callback
https://zs.example.com/api/integrations/google-calendar/callback
```

A primeira é o login. As outras duas só são necessárias se você quiser a integração do CRM com o Gmail ou a sincronização do Cal com o Google Calendar — nesse caso, habilite também a Gmail API e a Google Calendar API no projeto.

Um detalhe importante: o Zerosoft não tem lista de e-mails permitidos. Qualquer pessoa com conta Google que complete o seu fluxo OAuth pode criar uma conta na sua instância. Se você usa Google Workspace, defina o tipo de usuário da tela de consentimento como **Internal** e só gente da sua organização vai conseguir entrar. Se não, não espalhe a URL e confira as regras atuais do Google para telas de consentimento em teste vs. produção.

## 3. Preencha o `.env`

Um `.env` sensato para produção:

```bash
NEXTAUTH_URL=https://zs.example.com
NEXTAUTH_SECRET=        # openssl rand -base64 32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SHORT_DOMAIN=zs.example.com
DEMO_MODE=false
CRON_SECRET=            # openssl rand -hex 32
ENCRYPTION_KEY=         # openssl rand -base64 32
RESEND_API_KEY=         # opcional: sem ela, os e-mails só vão para o log
EMAIL_FROM=cal@example.com
```

Algumas notas que vêm de ler o código:

- **`DEMO_MODE`** transforma cada visitante em um usuário demo compartilhado. A imagem roda com `NODE_ENV=production`, onde o modo demo é ignorado a menos que você também defina `DEMO_MODE_ALLOW_PRODUCTION=true`. Deixe em `false` mesmo assim; o seu eu do futuro agradece.
- **`ENCRYPTION_KEY`** criptografa no banco os tokens OAuth e os secrets de webhooks (AES-256-GCM). Se não estiver definida, é derivada do `NEXTAUTH_SECRET`. De qualquer jeito: se você trocá-la, os tokens salvos não podem mais ser descriptografados e as integrações precisam ser reconectadas. Faça backup do `.env` junto com o banco — backup sem a chave é meio backup.
- **`RESEND_API_KEY`** é o que faz os e-mails de confirmação e lembrete do Cal saírem de verdade. Sem ela, eles ficam escritos nos logs do contêiner.
- **Deixe `TURSO_DATABASE_URL` vazio.** Vazio significa arquivo SQLite local. Se preferir um banco remoto no Turso, isso é [outra decisão](/blog/un-codigo-sqlite-local-o-turso).

## 4. Suba

```bash
docker compose up -d --build
docker compose logs -f
```

O primeiro build leva alguns minutos. Quando estiver no ar, um `curl -I http://localhost:3000` de dentro do VPS deve responder.

Antes de seguir, um ajuste de segurança no seu `docker-compose.yml` local: troque `"3000:3000"` por `"127.0.0.1:3000:3000"`. O Docker publica portas escrevendo as próprias regras de firewall, que podem passar por cima do `ufw`. Amarrando em localhost, só o seu reverse proxy alcança o app.

## 5. HTTPS com um reverse proxy

Qualquer proxy serve. O Caddy é o caminho mais curto porque obtém os certificados sozinho:

```
zs.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Aponte o registro A do seu DNS para o VPS, recarregue o Caddy, pronto.

Se usar Nginx, configure `proxy_set_header X-Forwarded-For $remote_addr;` em vez de anexar ao header existente. Os rate limits por IP do Zerosoft leem o primeiro endereço do `X-Forwarded-For`, e se o proxy só anexa, o cliente pode colocar o que quiser nessa primeira posição. O Caddy, por padrão, não confia em headers de forwarding vindos de clientes desconhecidos, então de fábrica está tudo certo.

## 6. O cron (não pule esta parte)

Parte do trabalho do Zerosoft acontece por agenda, e tudo passa por um único endpoint: `GET /api/cron/tick`. Cada tick envia os lembretes pendentes do Cal, tenta de novo as entregas de webhooks que falharam e dispara os gatilhos de workflows do CRM para tarefas que acabaram de vencer.

Na Vercel, quem chama é o Vercel Cron. No seu VPS, ninguém chama se você não configurar. Em produção, o endpoint se recusa a rodar sem `CRON_SECRET` e exige o valor como Bearer token:

```bash
# crontab -e
*/5 * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

A cada cinco minutos é um padrão razoável — lembretes e novas tentativas de webhooks são tão pontuais quanto o seu tick.

## 7. Backups

Seus dados vivem em dois volumes do Docker. O Compose prefixa os nomes com o nome do projeto (por padrão, o do diretório), então confira com `docker volume ls` — com um diretório `zerosoft`, eles se chamam `zerosoft_zerosoft-data` e `zerosoft_zerosoft-uploads`.

O banco roda em modo WAL, então copiar o arquivo enquanto o app escreve não garante uma cópia consistente. Use o backup online do SQLite, a partir de um contêiner descartável:

```bash
mkdir -p /srv/backups
docker run --rm -v zerosoft_zerosoft-data:/data -v /srv/backups:/backups alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/zerosoftware.db ".backup /backups/zerosoftware.db"'
docker run --rm -v zerosoft_zerosoft-uploads:/u -v /srv/backups:/backups alpine \
  tar czf /backups/uploads.tgz -C /u .
```

Coloque isso num script noturno, acrescente a data aos nomes dos arquivos e mande `/srv/backups` para fora da máquina (object storage, outro servidor, seu notebook). Backup no mesmo disco é cópia, não backup. E restaure pelo menos uma vez numa máquina de teste — backup nunca testado é torcida.

## 8. Atualizações

```bash
# backup primeiro, depois:
git pull
docker compose up -d --build
```

Você não roda migrações na mão. Na inicialização, o app compara as migrações do código com uma tabela `schema_migrations` e aplica as pendentes antes da primeira query ([como isso funciona](/blog/migraciones-versionadas-sin-orm)). Por isso o backup vem antes: migrações só andam para frente.

## O que você tem agora

Um contêiner, dois volumes, uma linha de cron, um bloco de proxy. Link, CRM, Cal, Track, Chat e Docs no seu próprio hardware, com seus dados num arquivo que você pode copiar para onde quiser.

O que você não tem é alguém de olho nisso. Uptime, patches do sistema, espaço em disco e testes de restauração agora são com você. Se essa troca parece ruim, o Zerosoft Cloud existe exatamente para isso — o mesmo código, um plano gratuito generoso e preços por uso publicados antes de cobrarmos qualquer coisa. Se parece boa, seja bem-vindo. Seu servidor, suas regras.
