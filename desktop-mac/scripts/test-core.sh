#!/bin/sh
# Runs the ZerosoftCore tests (swift-testing). With Xcode, plain `swift test` works. With only the
# Command Line Tools, SwiftPM does not find the Testing framework on its own: point it there.
set -eu
cd "$(dirname "$0")/.."
clt=/Library/Developer/CommandLineTools/Library/Developer
if xcode-select -p 2>/dev/null | grep -q CommandLineTools && [ -d "$clt/Frameworks/Testing.framework" ]; then
  exec swift test \
    -Xswiftc -F"$clt/Frameworks" -Xlinker -F"$clt/Frameworks" \
    -Xlinker -rpath -Xlinker "$clt/Frameworks" -Xlinker -rpath -Xlinker "$clt/usr/lib" "$@"
fi
exec swift test "$@"
