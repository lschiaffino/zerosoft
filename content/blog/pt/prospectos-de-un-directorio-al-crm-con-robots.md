---
title: "De um diretório na web a empresas no seu CRM: lista de prospects com um robô"
description: "Como percorrer um diretório público com paginação, ficar só com as linhas novas e carregá-las como empresas no CRM sem duplicatas, usando o Robots da zerosoft. Passos, configuração e limites reais."
date: "2026-11-03"
author: "zerosoft"
tags: ["robots", "crm", "browse-ai"]
---

A Browse AI oferece um robô pronto para [extrair dados de um lugar do Google Maps](https://browse.ai/t/extract-details-info-place-google-maps) e deixa claro que telefone e site só são capturados quando o negócio os publicou. Esse detalhe pesa mais do que qualquer modelo: uma lista de prospects vale tanto quanto os campos que o site realmente mostra.

Este post resolve o mesmo problema com o Robots, a automação de navegador da zerosoft. Pegamos um diretório público (uma câmara de comércio, uma lista de fornecedores, o catálogo de um evento), percorremos página por página e deixamos as empresas no CRM, uma vez cada uma.

## Antes de começar: o que fazer e o que evitar

Escolha diretórios que permitam a leitura automática. Confira os termos do site e o arquivo robots.txt antes de agendar qualquer coisa, e evite sites que proíbem a extração. A Browse AI diz isso nas próprias páginas: a legalidade depende da jurisdição e do uso, então vale consultar quem entende.

Uma regra prática para o CRM: carregue empresas, não pessoas. Dados pessoais (email pessoal, telefone) têm regras de consentimento que uma empresa listada em um diretório comercial normalmente não tem. No Robots o destino CRM pode criar empresas por domínio, e é esse o caminho que usamos aqui.

## Passo 1: criar o robô e ler a lista

Crie um robô novo a partir de Modelos. "Lista e cada página de detalhe" serve para este caso, porque já traz a estrutura: abrir a URL, extrair uma lista e percorrê-la. Troque a URL pela do diretório.

No passo Extrair lista:

1. **Seletor do cartão.** O bloco que se repete para cada empresa, por exemplo `li.empresa`.
2. **Campos.** Um nome de coluna por dado, com um seletor relativo ao cartão: `nome`, `site` (atributo `href` do link), `cidade`, `categoria`, `telefone`. Até 20 campos por linha.
3. **Paginação.** Escolha o modo que o diretório usa: botão Próximo, botão Carregar mais ou scroll infinito. Defina um máximo de páginas. O Robots percorre até 20 páginas por passo e junta até 1.000 linhas no total.

Se o site mostra o telefone só na página da empresa, o passo Percorrer lista abre cada link e lê ali os campos que faltam. Ative "Se um item falhar, registrar um aviso e passar para o próximo", assim uma ficha quebrada não trava as outras.

Rode o robô uma vez à mão. Na aba Execuções você vê as linhas que saíram. Se faltar uma coluna, quase sempre o motivo é um seletor específico demais.

## Passo 2: escolher a chave da tabela

Abra a aba Dados. O Robots guarda uma tabela entre execuções e marca cada linha como nova, alterada ou "não está mais". Para isso funcionar ele precisa de uma chave única: indique `site`. Sem chave, a linha inteira conta como chave, e uma mudança de telefone pareceria uma empresa nova mais uma empresa que sumiu.

A tabela guarda até 10.000 linhas por robô e você pode baixá-la em CSV quando quiser.

## Passo 3: enviar as empresas ao CRM

Em Integrações, adicione um destino do tipo CRM e escolha Empresas (por domínio ou nome). Depois mapeie as colunas para os campos do CRM: nome, domínio, site, telefone, setor, cidade e país.

Duas decisões que evitam problemas:

- **Domínio.** Mapeie `site` para Domínio ou para Site. O destino normaliza a URL para um domínio em minúsculas e procura uma empresa existente com esse domínio. Se não houver domínio, procura pelo nome.
- **Se o registro já existe.** O padrão é "Só preencher os campos vazios": nunca sobrescreve o que sua equipe digitou à mão. Escolha "Deixar como está" se o robô só deve trazer empresas novas, ou "Sobrescrever com os dados do robô" apenas se o diretório for sua fonte de verdade.

O destino roda depois de cada execução bem-sucedida e envia as linhas novas e alteradas, não a tabela inteira. Linhas sem nome nem domínio são ignoradas, e o resultado da execução informa quantas foram criadas, atualizadas e ignoradas.

## Passo 4: agendar e saber o que mudou

Em Horário, uma execução semanal basta para um diretório. O intervalo mínimo que o Robots aceita é de 5 minutos, mas uma lista de empresas não muda tão seguido, e quanto menos você pede, mais tranquilo fica o site de origem.

Em Integrações, ative também o email de mudanças: ele chega com as linhas novas e as que sumiram. Se o robô falhar várias vezes seguidas (por exemplo, porque o diretório foi redesenhado), o agendamento pausa sozinho (por padrão após 3 falhas seguidas, configurável) e para de bater em uma página quebrada. A opção "Reaprender seletores sozinho", que vem desligada, faz o Robots tentar reencontrar o elemento pela impressão da última execução boa e salvar o seletor novo se a execução terminar bem.

## Passo 5: priorizar com uma coluna de IA

Uma lista de 400 empresas ainda não é uma lista de ligações. Em Dados você pode adicionar uma coluna com IA que preenche cada linha a partir de uma instrução curta, como "É uma empresa com menos de 50 pessoas segundo a descrição? sim ou não". Cada coluna processa até 100 linhas por execução e as linhas que não mudaram mantêm o valor. Na nuvem, a IA é cobrada por tokens.

Trate essa coluna como uma pista e não como um dado: revise uma amostra antes de filtrar com ela.

## O que ainda não faz

- Não resolve captchas. Se o diretório usa, o robô não avança.
- O destino CRM cria contatos só com email. Um diretório que não publica emails dá empresas, não contatos, e isso é o certo para este fluxo.
- Não enriquece com emails de terceiros nem compra bases. O que entra no CRM é o que o site mostrou.

## O que muda em relação a um plano de créditos

Em um serviço de créditos, cada linha extraída consome cota, e percorrer 20 páginas toda semana aparece na fatura. Na zerosoft o core é AGPL: no seu servidor o robô roda no seu Chromium e a tabela fica no seu banco. Na zerosoft Cloud você paga o uso ao custo vezes três, com os dois números à vista.

O resultado prático: um robô, uma tabela com histórico e empresas no CRM que já tinham ficha antes de a sua equipe abrir o diretório. Depois da primeira execução, seu trabalho é revisar as linhas novas de cada semana, não refazer a lista.
