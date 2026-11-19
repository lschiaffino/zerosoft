#!/bin/sh
# Checks the built app: valid ad hoc signature, hardened runtime, exactly the entitlements this
# block needs, bundle id and minimum macOS. Usage: scripts/check-signature.sh path/to/zerosoft.app
set -eu
app="$1"
expected_entitlements="com.apple.security.app-sandbox com.apple.security.network.client"
fail() { echo "::error::$1"; exit 1; }

codesign --verify --strict --deep --verbose=2 "$app"
info=$(codesign -dv "$app" 2>&1)
echo "$info"
echo "$info" | grep -q '^Signature=adhoc' || fail "the app is not signed ad hoc"
echo "$info" | grep -q 'flags=.*runtime' || fail "hardened runtime is off"

tmp=$(mktemp -d)
codesign -d --entitlements - --xml "$app" > "$tmp/ent.plist" 2>/dev/null
plutil -convert json -o "$tmp/ent.json" "$tmp/ent.plist"
keys=$(/usr/bin/python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" ".join(sorted(k for k,v in d.items() if v is True)) if all(v is True for v in d.values()) else "non-boolean")' "$tmp/ent.json")
echo "entitlements: $keys"
[ "$keys" = "$expected_entitlements" ] || fail "entitlements are '$keys', expected '$expected_entitlements'"

plist="$app/Contents/Info.plist"
[ "$(plutil -extract CFBundleIdentifier raw "$plist")" = "ai.zerosoft.mac" ] || fail "unexpected bundle id"
[ "$(plutil -extract LSMinimumSystemVersion raw "$plist")" = "13.0" ] || fail "minimum macOS is not 13.0"
lipo -archs "$app/Contents/MacOS/zerosoft"
echo "signature and entitlements OK"
