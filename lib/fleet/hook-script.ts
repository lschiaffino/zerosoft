/**
 * Fleet: el hook de Claude Code y su instalador, como texto (los sirven /api/fleet/hook y /api/fleet/install).
 *
 * El hook es sh + perl (JSON::PP, que viene con perl en macOS y Linux) + curl: no hace falta node ni jq. Corre en
 * SessionStart, UserPromptSubmit, Notification, Stop, SubagentStop, StopFailure y SessionEnd, convive con otros
 * hooks del mismo evento (los de Orca incluidos: Claude Code los corre en paralelo) y lee las variables de Orca
 * (ORCA_PANE_KEY, ORCA_WORKTREE_ID, ORCA_TAB_ID) si están.
 *
 * Qué sale de la máquina: el evento, el id de la sesión, el nombre de la carpeta (no la ruta), la rama de git, los
 * ids de Orca, el prompt o la última respuesta recortados (con los secretos comunes tapados) y el tipo de aviso.
 * Nunca transcript_path, rutas, contenido de archivos ni variables de entorno. El token va en un archivo de config
 * de curl (-K, permisos 600), no en la línea de comandos.
 *
 * Salida: {} o, si hay respuestas tuyas en cola, {"decision":"block","reason":"…"} en Stop (Claude sigue con eso) o
 * additionalContext en UserPromptSubmit. Si zerosoft no responde, {} y el agente sigue como siempre.
 */

/** Eventos que registra el instalador. */
export const HOOKED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'StopFailure', 'SessionEnd'] as const;

const PERL_EXTRACT = String.raw`
use strict; use warnings;
use JSON::PP;
open(STDERR, '>', '/dev/null');
local $/; my $raw = <STDIN>;
my $in = eval { JSON::PP->new->utf8->decode($raw) };
exit 0 unless ref($in) eq 'HASH';
my $ev = $in->{hook_event_name} // '';
exit 0 unless $ev =~ /^(SessionStart|UserPromptSubmit|Notification|Stop|SubagentStop|StopFailure|SessionEnd)$/;
my $sid = $in->{session_id} // '';
exit 0 unless $sid =~ /^[A-Za-z0-9._:-]{1,120}$/;
sub clip { my ($s, $n) = @_; return '' unless defined $s && !ref $s; $s =~ s/\x00//g; return length($s) > $n ? substr($s, 0, $n - 1) . "\x{2026}" : $s; }
sub redact {
  my ($s) = @_;
  $s =~ s/\bgh[pousr]_[A-Za-z0-9]{20,}\b/[redacted]/g;
  $s =~ s/\bgithub_pat_[A-Za-z0-9_]{20,}\b/[redacted]/g;
  $s =~ s/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/[redacted]/g;
  $s =~ s/\bAKIA[0-9A-Z]{16}\b/[redacted]/g;
  $s =~ s/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/[redacted]/g;
  $s =~ s/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/[redacted]/g;
  $s =~ s/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\z)/[redacted]/gs;
  $s =~ s/\bzs[afk]_[A-Za-z0-9_-]{16,}\b/[redacted]/g;
  return $s;
}
my $cwd = $in->{cwd} // '';
$cwd = '' if ref $cwd;
my $project = $cwd; $project =~ s{/+\z}{}; $project =~ s{.*/}{};
my $branch = '';
if ($cwd ne '' && -d $cwd) {
  if (open(my $g, '-|', 'git', '-C', $cwd, 'rev-parse', '--abbrev-ref', 'HEAD')) { $branch = <$g> // ''; close $g; chomp $branch; }
}
my ($text, $detail) = ('', '');
if ($ev eq 'UserPromptSubmit') { $text = clip($in->{prompt}, 4000); }
elsif ($ev eq 'Stop') { $text = clip($in->{last_assistant_message}, 8000); }
elsif ($ev eq 'SubagentStop') { $text = clip($in->{last_assistant_message}, 600); $detail = $in->{agent_type} // ''; }
elsif ($ev eq 'Notification') { $text = clip($in->{message}, 600); $detail = $in->{notification_type} // ''; }
elsif ($ev eq 'StopFailure') { $detail = $in->{error} // ''; }
elsif ($ev eq 'SessionStart') { $detail = $in->{source} // ''; }
elsif ($ev eq 'SessionEnd') { $detail = $in->{reason} // ''; }
$detail = '' if ref $detail; $detail = clip($detail, 80);
my %out = (
  event => $ev, session => $sid, project => clip($project, 120), branch => clip($branch, 200),
  text => redact($text), detail => $detail,
  stop_hook_active => ($in->{stop_hook_active} ? JSON::PP::true : JSON::PP::false),
  orca_pane => clip($ENV{ORCA_PANE_KEY} // '', 200), orca_worktree => clip($ENV{ORCA_WORKTREE_ID} // '', 200), orca_tab => clip($ENV{ORCA_TAB_ID} // '', 200),
);
print JSON::PP->new->utf8->canonical->encode(\%out);
`;

const PERL_OUTPUT = String.raw`
use strict; use warnings; use JSON::PP;
open(STDERR, '>', '/dev/null');
local $/; my $raw = <STDIN>;
my $r = eval { JSON::PP->new->utf8->decode($raw) };
my $o = (ref($r) eq 'HASH' && ref($r->{output}) eq 'HASH') ? $r->{output} : {};
print JSON::PP->new->utf8->canonical->encode($o);
`;

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** El script del hook (~/.zerosoft/fleet-hook.sh). */
export function hookScript(): string {
  return `#!/bin/sh
# zerosoft Fleet: Claude Code hook. See /api/fleet/install for what it sends.
# Config: ~/.zerosoft/fleet.env (ZEROSOFT_FLEET_URL, optional ZEROSOFT_FLEET_WAIT seconds) and
# ~/.zerosoft/fleet.curlrc (the token header, mode 600).
ZS_DIR="\${ZEROSOFT_FLEET_DIR:-$HOME/.zerosoft}"
payload=$(cat 2>/dev/null)
done_empty() { printf '{}\\n'; exit 0; }
[ -n "$payload" ] || done_empty
[ -r "$ZS_DIR/fleet.env" ] && . "$ZS_DIR/fleet.env"
[ -n "\${ZEROSOFT_FLEET_URL:-}" ] && [ -r "$ZS_DIR/fleet.curlrc" ] || done_empty
command -v perl >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 || done_empty
body=$(printf '%s' "$payload" | perl -e ${shQuote(PERL_EXTRACT)})
[ -n "$body" ] || done_empty
case "$body" in *'"event":"Stop"'*) max=8 ;; *'"event":"UserPromptSubmit"'*) max=5 ;; *) max=4 ;; esac
resp=$(printf '%s' "$body" | curl -sS -K "$ZS_DIR/fleet.curlrc" -X POST "$ZEROSOFT_FLEET_URL/api/fleet/ingest" \\
  -H 'content-type: application/json' --connect-timeout 3 --max-time "$max" --data-binary @- 2>/dev/null)
out=$(printf '%s' "$resp" | perl -e ${shQuote(PERL_OUTPUT)})
[ -n "$out" ] || out='{}'
# Esperar tu respuesta en el Stop (opcional): ZEROSOFT_FLEET_WAIT=<segundos> en fleet.env.
wait_s="\${ZEROSOFT_FLEET_WAIT:-0}"
case "$wait_s" in ''|*[!0-9]*) wait_s=0 ;; esac
if [ "$out" = '{}' ] && [ "$wait_s" -gt 0 ]; then
  case "$body" in *'"event":"Stop"'*)
    sid=$(printf '%s' "$body" | perl -MJSON::PP -e 'local $/; my $b = eval { decode_json(<STDIN>) }; print ref($b) eq "HASH" ? ($b->{session} // "") : ""' 2>/dev/null)
    end=$(( $(date +%s) + wait_s ))
    while [ "$out" = '{}' ] && [ "$(date +%s)" -lt "$end" ]; do
      left=$(( end - $(date +%s) )); [ "$left" -gt 25 ] && left=25
      resp=$(printf '{"session":"%s","ms":%s}' "$sid" "$(( left * 1000 ))" | curl -sS -K "$ZS_DIR/fleet.curlrc" -X POST "$ZEROSOFT_FLEET_URL/api/fleet/ingest/wait" \\
        -H 'content-type: application/json' --connect-timeout 3 --max-time "$(( left + 5 ))" --data-binary @- 2>/dev/null) || sleep 2
      out=$(printf '%s' "$resp" | perl -e ${shQuote(PERL_OUTPUT)})
      [ -n "$out" ] || out='{}'
    done
  ;; esac
fi
printf '%s\\n' "$out"
exit 0
`;
}

const PERL_MERGE = String.raw`
use strict; use warnings; use JSON::PP;
my ($file, $cmd, $mode, $stopTimeout) = @ARGV;
my $data = {};
if (-s $file) {
  open(my $fh, '<', $file) or die "cannot read $file\n";
  local $/; my $raw = <$fh>; close $fh;
  $data = JSON::PP->new->utf8->relaxed->decode($raw);
  die "settings.json is not an object\n" unless ref($data) eq 'HASH';
}
$data->{hooks} = {} unless ref($data->{hooks}) eq 'HASH';
my @events = qw(SessionStart UserPromptSubmit Notification Stop SubagentStop StopFailure SessionEnd);
for my $ev (@events) {
  my $groups = ref($data->{hooks}{$ev}) eq 'ARRAY' ? $data->{hooks}{$ev} : [];
  my @kept;
  for my $g (@$groups) {
    if (ref($g) eq 'HASH' && ref($g->{hooks}) eq 'ARRAY') {
      my @h = grep { !(ref($_) eq 'HASH' && defined $_->{command} && $_->{command} =~ /fleet-hook\.sh/) } @{$g->{hooks}};
      next if !@h && @{$g->{hooks}};
      $g->{hooks} = \@h;
    }
    push @kept, $g;
  }
  if ($mode eq 'install') {
    my $t = $ev eq 'Stop' ? $stopTimeout + 0 : 15;
    push @kept, { hooks => [ { type => 'command', command => $cmd, timeout => $t } ] };
  }
  if (@kept) { $data->{hooks}{$ev} = \@kept; } else { delete $data->{hooks}{$ev}; }
}
delete $data->{hooks} unless %{$data->{hooks}};
my $tmp = "$file.zerosoft-tmp";
open(my $out, '>', $tmp) or die "cannot write $file\n";
print $out JSON::PP->new->utf8->pretty->canonical->encode($data);
close $out;
rename($tmp, $file) or die "cannot write $file\n";
`;

/**
 * El instalador. Uso: curl -fsSL <url>/api/fleet/install | sh -s -- <token>
 * (o ZEROSOFT_FLEET_TOKEN=<token> en el entorno). `--uninstall` lo saca. `--wait <segundos>` deja el Stop esperando
 * tu respuesta ese tiempo. Guarda una copia de settings.json antes de tocarlo y solo agrega o saca sus propias
 * entradas (las de Orca y cualquier otra quedan).
 */
export function installScript(baseUrl: string): string {
  return `#!/bin/sh
# zerosoft Fleet: installs the Claude Code hook that shows your agents in Fleet.
set -eu
URL=${shQuote(baseUrl.replace(/\/+$/, ''))}
MODE=install
TOKEN="\${ZEROSOFT_FLEET_TOKEN:-}"
WAIT="\${ZEROSOFT_FLEET_WAIT:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) MODE=uninstall ;;
    --wait) shift; WAIT="\${1:-0}" ;;
    zsf_*) TOKEN="$1" ;;
  esac
  shift
done
case "$WAIT" in ''|*[!0-9]*) WAIT=0 ;; esac
command -v perl >/dev/null 2>&1 || { echo "Fleet: perl is required (it ships with macOS and most Linux)." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Fleet: curl is required." >&2; exit 1; }
DIR="\${ZEROSOFT_FLEET_DIR:-$HOME/.zerosoft}"
SETTINGS="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
HOOK="$DIR/fleet-hook.sh"
CMD="sh '$HOOK'"
if [ "$MODE" = install ]; then
  case "$TOKEN" in zsf_*) ;; *) echo "Fleet: pass your token: curl -fsSL $URL/api/fleet/install | sh -s -- zsf_..." >&2; exit 1 ;; esac
  umask 077
  mkdir -p "$DIR"
  chmod 700 "$DIR"
  curl -fsSL "$URL/api/fleet/hook" -o "$HOOK.tmp"
  mv "$HOOK.tmp" "$HOOK"
  chmod 700 "$HOOK"
  printf 'ZEROSOFT_FLEET_URL=%s\\nZEROSOFT_FLEET_WAIT=%s\\n' "$URL" "$WAIT" > "$DIR/fleet.env"
  printf 'header = "Authorization: Bearer %s"\\n' "$TOKEN" > "$DIR/fleet.curlrc"
  chmod 600 "$DIR/fleet.env" "$DIR/fleet.curlrc"
  umask 022
fi
mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ]; then cp "$SETTINGS" "$SETTINGS.zerosoft-backup"; fi
perl -e ${shQuote(PERL_MERGE)} "$SETTINGS" "$CMD" "$MODE" "$(( WAIT + 30 ))"
if [ "$MODE" = install ]; then
  echo "Fleet: hook installed in $SETTINGS (backup: $SETTINGS.zerosoft-backup)."
  echo "New Claude Code sessions will show up in Fleet. Uninstall: curl -fsSL $URL/api/fleet/install | sh -s -- --uninstall"
else
  rm -f "$HOOK" "$DIR/fleet.env" "$DIR/fleet.curlrc"
  echo "Fleet: hook removed from $SETTINGS."
fi
`;
}

/** Comando de una línea que muestra la app (con el token recién creado). */
export function installCommand(baseUrl: string, token: string): string {
  return `curl -fsSL ${baseUrl.replace(/\/+$/, '')}/api/fleet/install | sh -s -- ${token}`;
}
