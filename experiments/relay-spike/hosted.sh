#!/usr/bin/env bash
# Prepare static assets / run a bounded LAN helper. Never uploads or uses a wallet.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable
export CARGO_TARGET_DIR="$PWD/target"
BROWSER="$PWD/../../apps/browser"

check_static() {
    node --input-type=module --check < "$BROWSER/app.js"
    npm --prefix "$BROWSER" test
}

case "${1:-}" in
    build)
        check_static
        bash phone.sh build
        node "$BROWSER/export.ts"
        ;;
    bundle)
        # Useful for regenerating only the static bundle; does not rebuild Rust.
        check_static
        node "$BROWSER/export.ts"
        ;;
    run)
        [[ $# == 3 ]] || { echo 'Usage: bash experiments/relay-spike/hosted.sh run <Mac-private-IPv4> <phone-private-IPv4>' >&2; exit 1; }
        [[ -x target/debug/relay-spike ]] || { echo 'Run hosted.sh build first.' >&2; exit 1; }
        ./target/debug/relay-spike browser-hosted --relay-ip "$2" --phone-ip "$3"
        ;;
    *)
        echo 'Usage: bash experiments/relay-spike/hosted.sh build|bundle|run <Mac-IP> <phone-IP>' >&2
        exit 1
        ;;
esac
