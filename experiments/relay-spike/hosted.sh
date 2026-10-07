#!/usr/bin/env bash
# Prepare static assets / run a bounded LAN helper. Never uploads or uses a wallet.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable
export CARGO_TARGET_DIR="$PWD/target"
BROWSER="$PWD/../../apps/browser"

check_static() {
    npm --prefix "$BROWSER" test
}

case "${1:-}" in
    build)
        check_static
        bash phone.sh build
        # phone.sh build also prepares the local and hosted Vite bundles.
        ;;
    bundle)
        # Rebuild the frontend with existing WASM; does not rebuild Rust.
        npm ci --prefix "$BROWSER" --ignore-scripts
        check_static
        npm --prefix "$BROWSER" run build:frontend
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
