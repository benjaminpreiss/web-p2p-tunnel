#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${JAVA_HOME:-}" ]]; then
  echo 'Set JAVA_HOME to a JDK 17+ (Android Studio’s JBR works for these standalone tests).' >&2
  exit 1
fi
if [[ ! -f generated/assets/controller/index.html ]]; then
  echo 'Run node apps/android-controller/prepare.ts from the repository root first.' >&2
  exit 1
fi
../browser/node_modules/.bin/tsc -p tsconfig.json
mkdir -p .local-test
"$JAVA_HOME/bin/javac" --release 17 -d .local-test \
  app/src/main/java/dev/webp2p/controllerprobe/LoopbackServer.java \
  app/src/main/java/dev/webp2p/controllerprobe/BundledSite.java \
  tests/LoopbackServerTest.java
"$JAVA_HOME/bin/java" -cp .local-test dev.webp2p.controllerprobe.LoopbackServerTest app/src/main/assets generated/assets/controller
node --test tests/worker.test.mjs tests/prepare.test.ts
ANDROID_CONTROLLER_TEST=1 node --experimental-vm-modules --test ../browser/smoke/boot.test.ts
for script in app/src/main/assets/*.js; do node --check "$script"; done
