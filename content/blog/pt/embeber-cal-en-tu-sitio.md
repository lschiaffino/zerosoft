---
title: "Incorpore o Cal no seu site: inline, popup, Google Meet e lembretes"
description: "Guia prático para colocar sua página de agendamento do Cal no seu próprio site, conectar o Google Calendar para ter links do Meet e garantir que os links de cancelamento e os lembretes de 24 horas saiam de verdade."
date: "2026-09-15"
author: "zerosoft"
tags: ["cal", "agendamento", "tutorial"]
---

Um link de agendamento na assinatura do email funciona. Uma página de agendamento *no seu próprio site*, onde o visitante já está, converte melhor e mostra que você leva a sério. Este guia cobre o setup completo: incorporar o Cal inline ou como popup, conectar o Google Calendar para que cada reunião tenha link do Meet, e as duas coisas que todo mundo esquece: o link do convidado para cancelar ou remarcar e o lembrete de 24 horas.

## 1. Incorpore a página de agendamento

Abra qualquer event type em **Cal → Event types**. No fim da página há um painel **Embed on your site** com duas abas. Copie o snippet que quiser e cole no seu site. Uma única tag de script, sem pacote npm, sem framework.

### Inline

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/pt/book/ana/intro"
        async></script>
```

O calendário aparece exatamente onde você colocou o script, como um iframe. A altura se ajusta sozinha: a página de agendamento informa a altura para a sua página conforme o visitante avança, então não há uma barra de rolagem interna brigando com o seu layout. Coloque numa página de "Agende uma demo" ou "Contato".

### Popup

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/pt/book/ana/intro"
        data-mode="popup"
        data-label="Agendar uma reunião"
        data-color="#0d0d0d"
        async></script>
```

Isto adiciona um botão flutuante no canto inferior direito. Ao clicar, a página de agendamento abre num modal. Escape ou um clique fora fecham. `data-label` é o texto do botão e `data-color` a cor de fundo. Ideal para ter no site inteiro: preços, docs, blog.

### Reagindo a uma reserva

Quando uma reserva é confirmada dentro do iframe, o script dispara um evento `zs-cal:booked` que sobe a partir da tag do script. Use para disparar seu próprio analytics ou mostrar uma mensagem de agradecimento:

```html
<script>
  document.addEventListener('zs-cal:booked', function (e) {
    // e.detail.start é o horário reservado (ISO), e.detail.eventTypeId o event type
    console.log('Booked!', e.detail.start);
  });
</script>
```

O script só escuta mensagens vindas da origem da página de agendamento e do próprio iframe, então outros frames da sua página não conseguem simular uma reserva.

### Detalhes que vale saber

- **Escolha o idioma na URL.** `/en/book/…`, `/es/book/…` ou `/pt/book/…`. A página, e os emails que o convidado recebe, seguem esse idioma.
- **O fuso do convidado é detectado sozinho** pelo navegador, e ele pode trocar num dropdown. Sua página não precisa fazer nada. (Os detalhes nerds estão em [como o Cal lida com fusos horários](/blog/zonas-horarias-en-agendas).)
- **Sua marca vai junto.** Cor da marca, logo e mensagem de boas-vindas do event type aparecem dentro do embed também.
- **Self-hosting?** Troque `zerosoft.ai` pelo seu domínio nas duas URLs. O script é servido com CORS aberto e fica em cache por uma hora.

## 2. Conecte o Google Calendar

Sem um calendário conectado, o Cal só conhece as reuniões marcadas pelo Cal e os blocked slots que você adiciona à mão. Conecte o Google e duas coisas mudam.

Vá em **Cal → Settings** e clique em **Connect Google Calendar**. O Google pede duas permissões (free/busy e eventos) e o Cal precisa das duas. Se você desmarcar uma, ele pede para tentar de novo.

**Horários ocupados bloqueiam a agenda.** Antes de mostrar disponibilidade, o Cal pede ao Google o free/busy do seu calendário **principal**. A consulta no dentista que você criou pelo celular esconde esses horários da sua página. A resposta fica em cache por cerca de um minuto, então as mudanças aparecem rápido.

**As reservas caem no seu calendário.** Cada nova reserva cria um evento no seu Google Calendar principal, com o convidado como participante. Se o local do event type estiver vazio ou for "Google Meet", o evento é criado com um **link do Google Meet**, que o Cal guarda e coloca nos emails de confirmação, no convite `.ics` e na sua lista de reservas ("Join meeting"). Remarcar move o evento; cancelar apaga.

O Cal cria o evento do Google com as notificações desligadas, porque o convidado já recebe o email do Cal com o convite anexado. Nada de convites duplicados. E se você tem o Google conectado, seu aviso como host vem sem o `.ics`, para você não ficar com a reunião duas vezes.

Tudo é best-effort de propósito: se o Google estiver fora do ar ou seu token tiver expirado, a reserva acontece mesmo assim. Uma queda do calendário não deveria custar uma reunião.

Cada pessoa conecta o próprio calendário. Num time com [round-robin](/blog/round-robin-con-cal), todos os hosts precisam fazer isso, senão o Cal vai achar que estão livres quando não estão.

**Self-hosting:** configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, e adicione `<NEXTAUTH_URL>/api/integrations/google-calendar/callback` como redirect URI autorizada no console do Google Cloud. Se faltar, a página de settings do Cal mostra a URI exata.

O que **não** existe: Outlook, iCloud e outros calendários CalDAV ainda não são suportados, e para conflitos só o calendário principal do Google é consultado, não os secundários.

## 3. Links para cancelar e remarcar

Todo email de confirmação que o convidado recebe traz um link **Reagendar ou cancelar**. Ele aponta para `/book/manage/<token>`, uma página privada ligada a um token longo e aleatório. Sem conta, sem senha: o link *é* a credencial.

Dali o convidado pode:

- **Remarcar** para qualquer outro horário que você esteja oferecendo. Mesmas regras de uma reserva nova: buffers, aviso mínimo, disponibilidade.
- **Cancelar**, com um motivo opcional que chega até você.

As duas ações enviam emails ao convidado e ao host (com um `.ics` atualizado ou de cancelamento), atualizam o Google Calendar e disparam o webhook `booking.rescheduled` ou `booking.cancelled`. Depois que a reunião começa, o link para de aceitar mudanças.

Do seu lado, você pode cancelar pela lista de reservas do Cal, ou pela API com `POST /api/v1/calendar/bookings/:id/cancel`.

## 4. Lembretes que saem de verdade

O Cal envia ao convidado um lembrete **24 horas antes** da reunião, no idioma dele, com o link para remarcar ou cancelar. Para isso acontecer, duas peças precisam estar no lugar.

**O envio de emails.** O Cal envia emails pelo Resend. Configure `RESEND_API_KEY` e `EMAIL_FROM` (um endereço de um domínio verificado no Resend). Sem a chave, os emails são impressos no console do servidor em vez de enviados: prático em desenvolvimento, uma falha silenciosa em produção.

**O cron.** Os lembretes ficam numa fila no banco e são enviados por um job periódico. Na Vercel, o `vercel.json` incluído chama `/api/cron/minute` a cada minuto (lembretes e passos de workflow do Cal, e o Flow) e `/api/cron/tick` uma vez por hora (que também envia lembretes, além das novas tentativas de webhooks e do resto do trabalho agendado). Em outro lugar, agende você mesmo. Os dois endpoints enviam lembretes; o de cada minuto é o que deixa eles pontuais:

```bash
# crontab: lembretes a cada minuto, o resto a cada hora aos :17
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://cal.example.com/api/cron/minute
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://cal.example.com/api/cron/tick
```

Em produção o endpoint se recusa a rodar sem `CRON_SECRET`, e exige o segredo como Bearer token. Com o cron de cada minuto, o lembrete sai cerca de 24 horas antes da reunião; se você só roda o tick de hora em hora, entre 24 e 23 horas antes. Se o envio falhar, ele não é marcado como enviado, então a próxima execução tenta de novo. Reservas canceladas descartam o lembrete pendente; as remarcadas ganham um novo. Reuniões marcadas com menos de 24 horas de antecedência não têm lembrete, porque a confirmação acabou de chegar.

Se você quer outros horários (por exemplo, três horas antes), adicione passos de workflow no tipo de evento: eles substituem este lembrete e saem pelo mesmo cron. Ainda não há lembretes por SMS.

## Checklist de cinco minutos

- Event type criado, com disponibilidade e buffers ([aqui explicamos como pensar neles](/blog/buffers-aviso-minimo-y-ventana)).
- Snippet colado, inline ou popup.
- Google Calendar conectado, local vazio ou "Google Meet".
- `RESEND_API_KEY`, `EMAIL_FROM` e `CRON_SECRET` configurados, cron rodando.
- Marque uma reunião de teste numa janela anônima, depois remarque e cancele pelo email.

Se a reserva de teste aparecer no seu calendário com link do Meet e o email de cancelamento chegar, pronto.
