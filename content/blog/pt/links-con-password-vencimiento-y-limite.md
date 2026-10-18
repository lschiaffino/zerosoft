---
title: "Links com senha, data de expiração ou limite de cliques: quando usar cada um"
description: "Casos de uso práticos para links com senha, que expiram ou com máximo de cliques no Link, o que exatamente o visitante vê quando um deles fecha, e onde entram os QR codes em SVG e PNG."
date: "2026-09-18"
author: "zerosoft"
tags: ["link", "qr", "casos de uso"]
---

A maioria dos links curtos não expira e deixa qualquer um passar. É o padrão certo. Mas de vez em quando você quer um link que saiba dizer não: só para quem tem a senha, só até sexta, só para os primeiros cem.

O Link tem três chaves para isso, em **Opções avançadas** ao criar ou editar um link: **Proteção por senha**, **Expira em** e **Máx. cliques**. São grátis, se combinam, e são simples o bastante para valer a pena saber exatamente como se comportam antes de imprimir um num cartaz.

## Links com senha

**O que acontece:** em vez de ser redirecionado, o visitante cai numa telinha de "Link protegido" com um campo de senha. Senha certa, ele segue para o destino. Senha errada, pode tentar de novo.

Detalhes que vale saber:

- **O navegador lembra por 7 dias.** Depois de desbloquear, um cookie vinculado àquele link deixa o mesmo navegador passar sem perguntar de novo por uma semana. Se você trocar a senha, todos os desbloqueios anteriores param de valer na hora.
- **Força bruta é freada.** As tentativas têm rate limit por IP e por link (cinco por minuto num mesmo link), então adivinhar uma senha razoável não é viável.
- **Os cliques contam depois do desbloqueio.** Quem abre o link e nunca digita a senha não aparece como clique nas suas analytics.
- **Guardamos um hash, não a senha.** Então não temos como te dizer qual era. Se esquecer, defina uma nova no formulário de edição, ou marque **Remover a proteção por senha**.
- **Nunca aparecem na sua [página bio](/blog/pagina-link-in-bio).** Uma página pública cheia de portas trancadas não faz sentido.

**Quando usar:** slides ou gravações para quem participou de um workshop; um kit de imprensa antes do fim do embargo; uma prévia para um cliente que você prefere que não seja repassada por aí.

**Quando não usar:** qualquer coisa realmente secreta. A senha protege o link curto, não o destino. Depois que alguém passa, vê a URL real e pode compartilhar essa. Se o destino é uma página pública, ele sempre esteve acessível. Para segredos de verdade, controle de acesso de verdade.

## Links que expiram

**O que acontece:** até a data e hora que você definiu, é um link normal. Depois, os visitantes veem uma página que diz "Este link expirou". O link aparece como **expirado** na sua lista e some sozinho da sua página bio.

O link não é apagado. As analytics ficam, e dá para trazê-lo de volta: edite e adie a data, ou limpe o campo (vazio significa nunca).

**Quando usar:**

- **Promoções com prazo.** O link da Black Friday para à meia-noite, e ninguém chega ao checkout para descobrir que o cupom não vale mais.
- **Inscrições em eventos.** A inscrição fecha quando o link fecha.
- **Compartilhamentos temporários.** Um link de download para um fornecedor que só deve funcionar nesta semana.

## Links com limite de cliques

**O que acontece:** cada redirecionamento soma um ao contador de cliques do link. Quando chega ao limite, o próximo visitante vê "Limite de cliques atingido" em vez do destino.

Duas ressalvas honestas sobre o que é "um clique":

- **Conta redirecionamentos, não pessoas.** As analytics do Link não usam cookies, então não sabemos se dez cliques são dez pessoas ou uma pessoa tocando dez vezes. Um limite de 100 são 100 redirecionamentos.
- **Requisições automáticas também contam.** Não há filtro de bots. Alguns apps de chat e redes sociais acessam o link para montar o card de preview, e se essa requisição segue o redirecionamento, é um clique como outro qualquer.

Então o limite de cliques é um bom **teto flexível**, não um sistema de ingressos. Use para "os primeiros cem, mais ou menos, ganham o template grátis", e coloque um pouco acima do número que realmente importa. Se precisar reabrir, edite o link e aumente o limite ou limpe o campo (vazio significa ilimitado).

Mais um detalhe: um link que atingiu o limite continua na sua página bio (diferente dos expirados), levando à página do limite. Desmarque-o lá quando lotar.

## Combinando

As chaves se somam. A ordem em que o Link as verifica é:

1. O link existe e não está arquivado? Se não: "Este link se foi".
2. Expirou? Se sim: "Este link expirou".
3. Atingiu o limite de cliques? Se sim: "Limite de cliques atingido".
4. Tem senha? Então, a página de senha.
5. Caso contrário: registra o clique e redireciona.

Ou seja, um link expirado nem chega a pedir a senha, e um link com cadeado e limite só conta quem passou. Um combo clássico: senha mais expiração para um link "só esta semana, só para participantes".

Todas essas páginas funcionam também no seu domínio próprio, então o visitante nunca vê um erro genérico.

## QR codes: as mesmas regras, no papel

Todo link tem seu QR code, para baixar em **SVG** (vetorial, para impressão) ou **PNG** (512 px, para slides e documentos). O QR contém a URL curta, não o destino, no seu [domínio próprio](/blog/dominios-propios-dns-paso-a-paso) se o link usar um. Isso tem duas consequências fáceis de passar batido:

**Tudo o que está acima vale para o QR.** Imprima o QR de um link que expira e, depois da data, quem escanear o cartaz cai em "Este link expirou". É uma vantagem para um panfleto que não deveria sobreviver ao evento; é uma armadilha para uma embalagem que vai passar anos na prateleira.

**Dá para mudar o destino do QR sem reimprimir.** Edite o destino do link e cada cópia impressa passa a apontar para o lugar novo. É o que outras ferramentas vendem como "QR code dinâmico". Aqui é simplesmente como links curtos funcionam.

Uma dica prática se você pretende trocar destinos: mantenha o tipo de redirect em **302 Temporário**, o padrão. Um **301 Permanente** diz aos navegadores que eles podem guardar o redirecionamento em cache, então alguém que escaneou antes da mudança pode continuar caindo no destino antigo. Use 301 só quando o destino realmente nunca for mudar.

O QR pode ser personalizado no detalhe do link: cores (com uma checagem de contraste para continuar escaneando), formato dos pontos e um logo no centro. O que ele ainda não faz são molduras. Para impressões pequenas, preto sobre branco continua sendo o que escaneia melhor.

## Guia rápido para decidir

- **Só algumas pessoas devem passar:** senha. Lembre que ela protege o link curto, não o destino.
- **Precisa parar de funcionar num momento específico:** data de expiração.
- **Precisa parar depois de uns N usos:** limite de cliques, com margem.
- **Vai para o papel:** QR, redirect 302, e pense duas vezes antes de colocar expiração.

E quando um link fecha, o visitante vê uma página clara dizendo o porquê, em vez de um redirecionamento quebrado. Uma gentileza pequena, uma diferença grande.
