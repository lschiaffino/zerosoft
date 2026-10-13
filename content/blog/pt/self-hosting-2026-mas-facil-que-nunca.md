---
title: "Self-hosting em 2026: mais fácil do que nunca (e não é só para nerds)"
description: "Um VPS de US$ 5, três comandos e o seu próprio software rodando. A distância entre 'instalar' e 'assinar' nunca foi tão pequena."
date: "2026-07-11"
author: "zerosoft"
tags: ["self-hosting", "open source", "tutorial"]
---

Durante anos, a resposta do SaaS ao self-hosting foi sempre a mesma: "claro que você pode rodar você mesmo, mas quem quer essa dor". Servidores para configurar, bancos de dados para manter, certificados, backups, atualizações. Era verdade: era uma dor.

Essa verdade envelheceu. Em 2026, hospedar você mesmo um app bem feito é mais fácil que configurar a sua impressora.

## O que mudou

Três coisas derrubaram a dificuldade:

1. **Os contêineres venceram.** Docker e seus sucessores empacotam um app inteiro (código, runtime, configuração) em algo que sobe com um comando. Você não "instala" mais software: você o *roda*.
2. **Os VPSs ficaram baratos e simples.** Hetzner, DigitalOcean, Fly.io, Railway: um servidor em dois minutos, US$ 5 por mês, com snapshots automáticos e redes privadas.
3. **O software foi desenhado para isso.** Os bons apps modernos tratam self-host como cidadão de primeira classe: um único banco de dados embutido (SQLite), variáveis de ambiente documentadas, zero serviços externos obrigatórios.

## A prova: Link em três comandos

Nosso encurtador de links roda assim:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

Sem banco de dados para instalar (o SQLite se cria sozinho). Não precisa de Redis, filas nem workers. Um processo Node e um arquivo de dados. O backup é copiar esse arquivo.

Login? Google OAuth com duas variáveis de ambiente. HTTPS? Caddy ou o seu proxy favorito em dez linhas. Atualizações? `git pull && npm run build`.

## O que realmente precisa manter

Sejamos honestos: self-hosting não é trabalho *zero*. Num app bem desenhado, é:

- Um `apt update` de vez em quando.
- Verificar que o backup existe (ou automatizá-lo: um cron de uma linha).
- Atualizar o app quando sair algo que te interessa.

É menos tempo do que você gasta por ano brigando com mudanças de plano, aumentos de preço e features que o seu fornecedor mudou de tier.

## E se você não quiser nem isso

Para isso existe a outra opção: o zerosoft Cloud, com um plano grátis para começar e cobrança pelo uso depois. O ponto não é que todo mundo faça self-host. É que a opção existe, e isso muda a relação com o fornecedor: você fica porque quer.
