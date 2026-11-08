#!/bin/sh
# Firma estable de la app de Mac sin cuenta de Apple Developer.
#
# Con la firma ad hoc, macOS ata Accesibilidad y el micrófono a la build exacta: después de cada
# actualización la llave sigue prendida en Ajustes del Sistema pero no vale, y hay que borrarla y
# darla de nuevo. Con un certificado propio y fijo, la identidad de la app es "este identificador
# firmado con este certificado" y el permiso sigue entre versiones.
#
# Este script crea ese certificado (una sola vez; guardalo: cambiarlo cambia la identidad de la
# app) y lo sube como secretos del repo, que usa .github/workflows/desktop.yml:
#   MACOS_SIGNING_P12           el .p12 en base64
#   MACOS_SIGNING_P12_PASSWORD  su contraseña
#
# Uso:  sh desktop/scripts/macos-signing-cert.sh [carpeta]   (por defecto ~/.zerosoft-signing)
# Pide: openssl y gh con permiso para escribir secretos del repo.
set -eu

DIR="${1:-$HOME/.zerosoft-signing}"
NAME="zerosoft desktop"
P12="$DIR/zerosoft-desktop.p12"
PASS="$DIR/zerosoft-desktop.password"
REPO="${GH_REPO:-lschiaffino/zerosoft}"

mkdir -p "$DIR"
chmod 700 "$DIR"

if [ -f "$P12" ] && [ -f "$PASS" ]; then
  echo "Ya existe $P12: se sube ese mismo (la identidad de la app no cambia)."
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cat > "$tmp/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
O = zerosoft
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 7300 -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -config "$tmp/cert.cnf" 2>/dev/null
  openssl rand -base64 30 | tr -d '\n' > "$PASS"
  chmod 600 "$PASS"
  # -legacy: el formato que lee `security import` en todas las versiones de macOS.
  if ! openssl pkcs12 -export -legacy -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$NAME" -out "$P12" -passout "file:$PASS" 2>/dev/null; then
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$NAME" -out "$P12" -passout "file:$PASS"
  fi
  chmod 600 "$P12"
  echo "Certificado nuevo en $P12 (guardá una copia de esta carpeta en un lugar seguro)."
fi

base64 < "$P12" | tr -d '\n' | gh secret set MACOS_SIGNING_P12 -R "$REPO"
gh secret set MACOS_SIGNING_P12_PASSWORD -R "$REPO" < "$PASS"
echo "Listo: MACOS_SIGNING_P12 y MACOS_SIGNING_P12_PASSWORD en $REPO."
echo "La próxima versión sale firmada con este certificado. Después de instalarla, una sola vez:"
echo "Ajustes del Sistema > Privacidad y seguridad > Accesibilidad: quitá zerosoft (-) y volvé a prenderlo"
echo "(o en zerosoft: Ajustes > Primeros pasos > Restablecer permiso)."
