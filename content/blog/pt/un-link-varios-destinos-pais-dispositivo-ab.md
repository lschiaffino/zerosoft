---
title: "Um link, vários destinos: país, dispositivo e teste A/B"
description: "Como mandar cada visitante para o lugar certo com um único link curto: regras por país e dispositivo, teste A/B com pesos e deep links para o seu app, com a ordem exata em que o Link resolve tudo."
date: "2026-10-24"
author: "zerosoft"
tags: ["link", "roteamento", "ab-testing"]
---

Você cola um link na bio do Instagram e abrem de Montevidéu, de Madri e da Cidade do México, num iPhone, num Android e num notebook. Todos caem na mesma página. A loja de apps certa, o preço na moeda local ou a versão no idioma da pessoa ficam para depois, se ficarem.

A solução é um link curto que decide o destino na hora do clique. A Dub tem dois artigos de ajuda sobre isso, um de [geo targeting](https://dub.co/help/article/geo-targeting) e outro de [device targeting](https://dub.co/help/article/device-targeting), e a documentação diz que o segundo está disponível a partir do plano Pro. Este post trata do mesmo problema por outro lado: como desenhar regras que não se atropelem, como medir se funcionam e como montar no Link.

## O que um link pode decidir

No Link, o roteamento fica no detalhe de cada link, na seção **Roteamento**. Tem três peças:

- **Regras por país e dispositivo.** Até 20 regras. Cada uma tem uma lista de países (códigos de duas letras como `AR`, `UY`, `CL`), uma lista de dispositivos (iOS, Android, desktop) e uma URL de destino. Lista vazia significa "qualquer".
- **Teste A/B.** De 2 a 5 destinos com peso de 0 a 100. Cada visitante vê sempre a mesma variante.
- **Deep links.** Uma URL de app para iOS e outra para Android, cada uma com um fallback para quando o app não está instalado.

Sem nenhuma regra, o link vai para a URL de sempre e o redirect não faz trabalho extra.

## A ordem de resolução importa

Quando alguém clica, o Link resolve o destino nesta ordem:

1. **O deep link do dispositivo**, se você configurou um para o sistema dele (iOS ou Android).
2. **A primeira regra que coincide**, lendo a lista de cima para baixo.
3. **O teste A/B**, se nenhuma regra coincidiu.
4. **A URL do link**, se nada do anterior se aplica.

Daí saem três dicas de desenho:

**Ordene do específico para o geral.** Se você tem uma regra "Argentina, iOS" e outra "Argentina", a primeira vai em cima. Vale a primeira que coincide, e a segunda taparia a primeira por completo se viesse antes.

**O A/B só vê o tráfego que as regras deixaram passar.** Se uma regra manda todo o Brasil para uma página em português, esses visitantes nunca entram no teste. Para testar dentro de um país, rode o teste no link que esse país recebe, não num link geral.

**O deep link ganha de tudo na sua plataforma.** Se você definiu um app para iOS, nenhum visitante de iPhone chega às regras web. Use só quando quiser que o app seja sempre a primeira opção.

## Receita 1: uma campanha, três mercados

Uma campanha de lançamento para Argentina, Uruguai e o resto da região.

1. Crie o link com a página global como destino. Ela é o último recurso.
2. Em **Roteamento**, adicione a regra 1: país `AR`, destino `/ar/lancamento`.
3. Regra 2: país `UY`, destino `/uy/lancamento`.
4. Salve com **Salvar roteamento**.

O resto do mundo cai na URL do link. Cada clique registra qual regra o atendeu, e a análise do link mostra a regra que atendeu cada visita (Regra 1, Regra 2) ao lado do país. Assim você confere com dados se a divisão é a que imaginou.

Um detalhe: o país vem de um cabeçalho enviado pela plataforma de hospedagem. Se um clique chega sem país, ele não coincide com nenhuma regra que peça países e segue para o próximo passo.

## Receita 2: app ou web conforme o dispositivo

Você quer que quem abre o link no celular entre no app e que o resto vá para a web.

1. Em **Deep links**, informe a URL do app no iOS, por exemplo `meuapp://produto/42`, ou um universal link `https`.
2. Informe o fallback: a página da loja de apps ou a página web equivalente.
3. Repita para Android.

Com esquema próprio (`meuapp://`), o Link entrega uma página mínima que tenta abrir o app e, se em um segundo e meio nada acontecer, redireciona para o fallback. Com universal link `https`, o redirect é direto e o sistema operacional decide se abre o app.

O que ainda não faz: deep linking diferido. Se a pessoa não tem o app, vai para a loja, mas depois de instalar não volta sozinha ao produto em que tocou. Isso exige um SDK no app e não temos um.

Outra ressalva que o painel avisa: iPads com Safari se identificam como Mac, então recebem o destino de desktop.

## Receita 3: um teste A/B de landing de verdade

Duas versões de uma página de preços, 50 e 50.

1. Em **Teste A/B**, adicione a variante A com a URL atual e peso 50.
2. Adicione a variante B com a URL nova e peso 50.
3. Salve.

Duas coisas fazem o teste valer a pena:

- **O visitante não troca de variante.** O Link guarda um cookie de visitante (`zs_vid`) e calcula a variante com um hash estável. Quem volta amanhã vê a mesma página, e o resultado não se contamina.
- **Os cliques sabem de qual variante vieram.** Cada clique guarda a variante (A, B) e o CSV de exportação do link inclui uma coluna `variant`. Dá para cruzar com as conversões da sua análise.

O que o Link não faz é dizer qual variante ganhou. Ele mede cliques por variante, não conversões. A conversão acontece no site de destino, então para comparar você precisa dos UTMs de [uma convenção curta](/blog/utms-sin-planilla) e da sua ferramenta de analytics.

E uma regra de higiene: não encerre o teste antes de cada variante ter um volume razoável de visitas. Com 30 cliques por lado, qualquer diferença é ruído.

## Como não quebrar

- **Teste de fora.** Abra o link no celular com dados móveis e com uma VPN em outro país. É a forma mais rápida de ver cada ramo.
- **Um destino não pode apontar para o próprio link.** O Link revisa todos os destinos das regras, do A/B e dos deep links para evitar loops.
- **Cada regra precisa de países ou dispositivos.** Uma regra vazia é rejeitada ao salvar; para "todos", use a URL do link.
- **Um A/B precisa de pelo menos duas variantes**, e pelo menos uma com peso maior que zero.

## Self-host e custo

O roteamento faz parte do core AGPL. Nenhum plano o libera: se você roda o Link no seu servidor, ele está lá. No zerosoft Cloud não se cobra por regra nem por assento, só por cliques, reservas, emails e armazenamento.

E como a configuração fica numa coluna JSON na mesma linha que o redirect lê, um JSON quebrado nunca quebra o redirect: o link simplesmente volta para a sua URL.

## Para levar

- Ordem: deep link, primeira regra que coincide, A/B, URL do link.
- Regras do específico para o geral.
- Teste cada ramo num dispositivo e país reais.
- Meça cliques no Link e conversões na sua análise, unidos por UTM.

Se você vem de outro encurtador, o [importador do Link](/blog/migrar-de-bitly-a-link) traz seus links com os destinos, e o roteamento você configura depois nos que precisarem.
