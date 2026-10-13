---
title: "Backups que funcionam para um Zerosoft self-hosted"
description: "Todo o seu Zerosoft é um arquivo SQLite, uma pasta de uploads e um .env. Como copiá-los de forma consistente com a app rodando, tirá-los do servidor e provar que eles realmente restauram."
date: "2026-10-12"
author: "Zerosoftware"
tags: ["self-hosting", "backups", "sqlite"]
---

Já dissemos algumas vezes neste blog: no Zerosoft, o backup é "só um arquivo". É verdade no espírito e um pouco perigoso na prática. Um banco SQLite que está recebendo escritas não é um arquivo que você pode copiar com `cp` às cegas e confiar.

Esta é a versão prática: o que fazer backup, como copiar de forma consistente com a app rodando, para onde mandar e como saber que o backup realmente restaura. Quinze minutos de configuração, dez minutos por trimestre.

## Do que você está fazendo backup

Um Zerosoft self-hosted com Docker tem exatamente três coisas que importam:

1. **O banco de dados.** Um arquivo SQLite, `zerosoftware.db`, em `/app/data` dentro do contêiner, guardado no volume `zerosoft-data`. Links, cliques, contatos, negócios, issues, agendamentos, conversas, docs, usuários, times, chaves de API: tudo.
2. **Uploads.** Os anexos do Chat, do Track e das tarefas do CRM, em `/app/public/uploads`, guardados no volume `zerosoft-uploads`.
3. **O seu `.env`.** Fácil de esquecer, e pesa mais do que parece. Explicamos o porquê mais abaixo.

Sem Docker é a mesma ideia: `data/zerosoftware.db` e `public/uploads/` no diretório da app.

Um detalhe do Docker antes: o Compose coloca o nome do projeto na frente dos volumes, e esse nome, por padrão, é o do diretório. Se você clonou em `zerosoft/`, os seus volumes provavelmente se chamam `zerosoft_zerosoft-data` e `zerosoft_zerosoft-uploads`. Confira em vez de adivinhar:

```bash
docker volume ls | grep zerosoft
```

## Por que um cp não basta

O Zerosoft abre o banco local em **modo WAL** (`PRAGMA journal_mode = WAL`). No modo WAL, as escritas novas vão primeiro para um arquivo à parte, `zerosoftware.db-wal`, e são incorporadas ao arquivo principal depois, num checkpoint. Com a app rodando, normalmente você vai ver três arquivos: `zerosoftware.db`, `-wal` e `-shm`.

Então, se você fizer `cp zerosoftware.db` com a app rodando:

- Dados já confirmados podem ainda estar no `-wal`, e a sua cópia não terá esses dados.
- Se você copiar o `.db` e o `-wal` separadamente, uma escrita pode cair no meio e o par que você obtém pode não bater.

Copiar na mão *funciona* se a app estiver parada: num desligamento limpo o SQLite faz o checkpoint do WAL no arquivo principal. Se o processo foi morto, pode sobrar um `-wal` com dados confirmados, então copie todos os arquivos juntos. Mas parar a app toda noite para fazer backup não faz sentido quando o SQLite tem um jeito correto de fazer isso a quente.

## O jeito certo: .backup ou VACUUM INTO

O SQLite traz duas formas de tirar um snapshot consistente de um banco em uso:

- **`.backup`** (o backup online do CLI `sqlite3`) copia o banco página por página para um arquivo novo e gera um snapshot consistente mesmo com a app continuando a escrever.
- **`VACUUM INTO '/caminho/arquivo.db'`** escreve uma cópia nova e compactada do banco como estava numa única transação. Dá um pouco mais de trabalho e gera um arquivo menor. O arquivo de destino não pode existir ainda.

As duas estão corretas. As duas incluem o que está no WAL. A imagem do Zerosoft não traz o CLI `sqlite3`, então o caminho mais simples é um contêiner Alpine descartável que monta o volume:

```bash
#!/bin/sh
# /usr/local/bin/zerosoft-backup.sh
set -eu
DATA_VOL=zerosoft_zerosoft-data        # confira com: docker volume ls
UPLOADS_VOL=zerosoft_zerosoft-uploads
DEST=/var/backups/zerosoft
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

# 1. Snapshot consistente do banco em uso (seguro com a app rodando)
docker run --rm -v "$DATA_VOL":/data -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/zerosoftware.db \".backup '/backup/db-$STAMP.db'\""

# 2. Verificar a cópia antes de confiar nela
docker run --rm -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /backup/db-$STAMP.db 'PRAGMA integrity_check;'" | grep -qx ok

# 3. Uploads são arquivos comuns: tar resolve
docker run --rm -v "$UPLOADS_VOL":/uploads:ro -v "$DEST":/backup alpine:3.20 \
  tar czf "/backup/uploads-$STAMP.tgz" -C /uploads .

# 4. Manter duas semanas localmente
find "$DEST" -type f -mtime +14 -delete
```

Rode pelo cron, num horário tranquilo:

```bash
# crontab -e
15 3 * * * /usr/local/bin/zerosoft-backup.sh >> /var/log/zerosoft-backup.log 2>&1
```

Prefere `VACUUM INTO`? Troque a linha do `.backup` por `sqlite3 /data/zerosoftware.db \"VACUUM INTO '/backup/db-$STAMP.db'\"`.

## Não esqueça o .env

O Zerosoft criptografa no banco os tokens OAuth (as integrações com Gmail e Google Calendar) e os segredos dos webhooks com AES-256-GCM. A chave vem de `ENCRYPTION_KEY`, ou de `NEXTAUTH_SECRET` se ela não estiver definida.

O que isso significa para backups: se você restaurar o banco num servidor com um segredo *diferente*, tudo carrega normalmente, mas esses valores criptografados não podem ser decifrados. As integrações precisam ser reconectadas e os segredos de assinatura dos webhooks se perdem. Faça backup do seu `.env` também, separado e criptografado (ele guarda o seu client secret do Google), no seu gerenciador de senhas ou cofre de segredos. Não como um arquivo solto ao lado dos dumps do banco.

## Tire do servidor

Um backup no mesmo disco do banco protege você de erros, não de um disco morto ou de uma VPS apagada. Mande a pasta de backups para outro lugar. Qualquer ferramenta serve; duas comuns:

```bash
# rclone: copiar para qualquer bucket compatível com S3 configurado como "offsite"
rclone copy /var/backups/zerosoft offsite:zerosoft-backups

# ou restic: snapshots criptografados e deduplicados
restic -r s3:https://<endpoint>/<bucket> backup /var/backups/zerosoft
```

Coloque essa linha no fim do script. Mantenha mais retenção fora do que localmente: algumas semanas de diários mais alguns mensais bastam para a maioria dos times pequenos. E, se o seu storage permitir, faça com que as credenciais do servidor possam *gravar* backups mas não apagar os antigos; ransomware adora um backup que ele consegue apagar.

Se você quer algo mais próximo de contínuo, o Litestream envia as mudanças do WAL do SQLite para object storage. Mencionamos porque combina bem com SQLite, mas não validamos especificamente com o Zerosoft: teste o restore antes de depender dele.

## Restaurar, de verdade

O procedimento de restore, com a app parada:

```bash
docker compose stop

docker run --rm -v zerosoft_zerosoft-data:/data -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "rm -f /data/zerosoftware.db-wal /data/zerosoftware.db-shm \
    && cp /backup/db-2026-10-12_0315.db /data/zerosoftware.db \
    && chown 1001 /data/zerosoftware.db"

docker run --rm -v zerosoft_zerosoft-uploads:/uploads -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "tar xzf /backup/uploads-2026-10-12_0315.tgz -C /uploads && chown -R 1001 /uploads"

docker compose start
```

Dois detalhes que pegam muita gente:

- **Apague o `-wal` e o `-shm` antigos.** Um WAL que sobrou do banco anterior nunca deve ser aplicado sobre o arquivo restaurado.
- **Dono dos arquivos.** A app roda como o usuário `zerosoft` (uid 1001). Arquivos restaurados como root podem ser legíveis mas não graváveis, e a app vai falhar na primeira escrita.

As migrações rodam sozinhas quando a app sobe, então restaurar um backup antigo numa versão mais nova do Zerosoft atualiza o esquema. O caminho inverso — um banco mais novo com código mais antigo — não é algo com que você possa contar.

## O simulado que ninguém faz

Um backup que você nunca restaurou é uma esperança, não um backup. Uma vez por trimestre, pegue a cópia offsite mais recente (não a local) e confira em algum lugar que não seja produção:

```bash
sqlite3 db-2026-10-12_0315.db "PRAGMA integrity_check;"
sqlite3 db-2026-10-12_0315.db "SELECT count(*) FROM links; SELECT count(*) FROM crm_contacts; SELECT count(*) FROM track_issues;"
```

Os números parecem com os reais? O tarball de uploads abre? Melhor ainda: uma vez por ano, faça o restore completo acima numa VPS reserva com o seu `.env` guardado, entre e navegue um pouco. Cronometre. Esse número é o seu tempo real de recuperação, e vale conhecê-lo antes de precisar.

## Se você usa Turso

Defina `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` e o banco deixa de estar no seu servidor: vira um banco libSQL remoto, que é onde a nossa própria nuvem roda. O Turso tem recursos próprios de backup e restore; confira o que o seu plano inclui. Mesmo assim, nós guardaríamos uma cópia sob o nosso controle:

```bash
turso db shell <your-db> .dump > zerosoft-$(date +%F).sql
```

Os uploads continuam sendo responsabilidade sua em qualquer caso (no seu disco, ou no Vercel Blob se você definir `BLOB_READ_WRITE_TOKEN`).

## Checklist

- Snapshot do banco com `.backup` ou `VACUUM INTO`, nunca um `cp` às cegas de um banco em uso.
- Verificação de integridade em cada cópia.
- Tarball dos uploads.
- `.env` guardado à parte e criptografado.
- Cópia offsite, com retenção.
- Um simulado de restore na agenda.

Esse é o runbook inteiro. É curto porque a arquitetura é pequena: [um processo, um arquivo](/blog/sqlite-es-suficiente). A única parte difícil é fazer o simulado.
