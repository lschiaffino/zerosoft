---
title: "Heresia técnica: SQLite é suficiente"
description: "O banco de dados mais implantado do planeta roda no seu celular, no seu navegador e, sim, no Link. Milhões de linhas sem drama, WAL mode e backups que são copiar um arquivo."
date: "2026-06-12"
author: "zerosoft"
tags: ["sqlite", "self-host", "arquitetura"]
---

Dizer em voz alta que seu app roda em SQLite provoca uma reação previsível: a cara de "isso é um banco de dados de brinquedo". É o contrário. SQLite é o banco de dados mais implantado e mais testado do mundo: está em cada iPhone, cada Android, cada navegador, cada TV. Bilhões de instâncias em produção. O "brinquedo" tem mais horas de voo do que qualquer outro software de dados já escrito.

## O que o SQLite faz hoje

- **WAL mode.** Com Write-Ahead Logging, as leituras não bloqueiam a escrita e a escrita não bloqueia as leituras. Centenas de leitores concorrentes enquanto se escreve.
- **Volume.** Milhões de linhas são rotina. O limite teórico de um banco SQLite é 281 TB. O analytics de um ano inteiro do Link cabe em poucos GB.
- **Velocidade.** Roda in-process, dentro do seu app: sem rede, socket nem salto de latência entre a query e os dados. Muitas consultas respondem mais rápido do que contra um Postgres em outro container.
- **Backups.** `cp link.db backup.db`. Fim do runbook. Com Litestream, replicação contínua para object storage por centavos.
- **À prova de guerra.** O sqlite.org roda sobre SQLite. A própria documentação diz que aguenta sem drama sites de até ~100.000 requisições por dia, e isso é conservador.

## Por que o Link usa SQLite

A workload do Link é o paraíso do SQLite: um redirect é um `SELECT` por chave primária mais um `INSERT` pequeno. Leitura intensiva, escrita leve, um único servidor. O banco inteiro de um usuário pesado (centenas de milhares de cliques) são dezenas de megabytes.

Para quem faz self-host, a diferença é brutal: não há nada para instalar. Não tem Postgres para configurar, Redis para ajustar nem docker-compose com seis serviços, sem volume persistente para mapear. Baixe o Link, rode, pronto. Um processo, um arquivo.

E esse arquivo é tudo: seu banco, seu backup e seu plano de saída. Se um dia você for embora, leva o `link.db` e tem seus dados completos, legíveis e portáveis. Sem dump proprietário, sem exportador trancado num plano pago.

## Quando você PRECISA de Postgres

A heresia tem limites, e nomeá-los é parte da honestidade:

- **Escrita concorrente alta.** O SQLite tem um único escritor. Se seu app insere milhares de linhas por segundo a partir de muitos processos, você precisa de um banco em rede.
- **Vários nós escrevendo.** Se você escala na horizontal com múltiplos servidores de aplicação, precisa de Postgres (ou equivalente).
- **Features específicas.** Row-level security, replicação lógica, extensões como PostGIS: o ecossistema Postgres não tem rival.

Dito isso: seu CRM, seu encurtador de links, seu dashboard interno não chegam nem perto desses limites. Vivem num VPS de US$ 5 com tráfego de sobra. Escolher Postgres "por via das dúvidas" é pagar complexidade hoje por um problema que talvez nunca chegue. E se chegar, começar com SQLite não foi um beco sem saída: seu banco é um arquivo e exportá-lo é um script de uma tarde.

Comece simples. A escala que você imagina provavelmente não é a escala que você tem.
