#!/usr/bin/env bash
# Developer-only phone-browser fixture. No Android app or public deployment.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable
export CARGO_TARGET_DIR="$PWD/target"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
PORT=18880
BROWSER="$PWD/../../apps/browser"

case "${1:-}" in
    build)
        npm ci --prefix "$BROWSER" --ignore-scripts
        "$HOME/.cargo/bin/cargo" test --locked --offline
        "$HOME/.cargo/bin/cargo" build --locked --offline
        if [[ ! -s "$BROWSER/pkg/relay_crypto.js" || ! -s "$BROWSER/pkg/relay_crypto_bg.wasm" || ! -s "$BROWSER/pkg/relay_crypto.d.ts" ]]; then
            echo 'Building missing WASM assets. wasm-pack may download its binding tooling/dependencies.'
            node "$BROWSER/build.ts" --dev
        fi
        npm --prefix "$BROWSER" run build:frontend
        ;;
    run)
        if [[ $# != 3 ]]; then
            echo 'Usage: bash experiments/relay-spike/phone.sh run <Mac-private-IPv4> <phone-private-IPv4>' >&2
            exit 1
        fi
        [[ -x target/debug/relay-spike ]] || { echo 'Run phone.sh build first.' >&2; exit 1; }
        [[ -s "$BROWSER/dist/local-browser/app.js" && -s "$BROWSER/dist/local-browser/pkg/relay_crypto_bg.wasm" ]] || { echo 'Missing browser bundle; run phone.sh build.' >&2; exit 1; }
        [[ "$("$ADB" get-state)" == device ]] || { echo 'One authorized USB device is required.' >&2; exit 1; }
        # Do not replace or remove another session's reverse mapping.
        "$ADB" reverse --no-rebind "tcp:$PORT" "tcp:$PORT"
        trap '"$ADB" reverse --remove "tcp:$PORT" || true' EXIT
        echo "Development-only reverse mapping: phone localhost:$PORT -> Mac localhost:$PORT (HTTP only)."
        echo 'Wait for the Open on the PHONE message, then use phone.sh open in another terminal.'
        ./target/debug/relay-spike browser-phone --port "$PORT" --relay-ip "$2" --phone-ip "$3"
        ;;
    open)
        [[ "$("$ADB" get-state)" == device ]] || { echo 'One authorized USB device is required.' >&2; exit 1; }
        "$ADB" shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:$PORT/"
        ;;
    cleanup)
        echo 'Only use after stopping the fixture; removing its developer-only reverse mapping.'
        "$ADB" reverse --remove "tcp:$PORT"
        ;;
    *)
        echo 'Usage: bash experiments/relay-spike/phone.sh build|run <Mac-IP> <phone-IP>|open|cleanup' >&2
        exit 1
        ;;
esac
