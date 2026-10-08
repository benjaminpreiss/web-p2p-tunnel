package dev.webp2p.controllerprobe;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Fixed in-memory assets only. No filesystem paths, proxying, credentials or target access. */
public final class LoopbackServer implements AutoCloseable {
    public record Asset(String contentType, byte[] body) {}

    private final ServerSocket listener;
    private final Map<String, Asset> assets;
    private volatile boolean closed;
    private Socket active;

    public LoopbackServer(int port, Map<String, Asset> assets) throws IOException {
        this.assets = new HashMap<>(assets);
        listener = new ServerSocket();
        try {
            // Numeric IPv4 loopback: never wildcard, LAN, DNS resolution or fallback port.
            listener.bind(new InetSocketAddress(
                    InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), port), 8);
        } catch (IOException failure) {
            listener.close();
            throw failure;
        }
    }

    public int port() { return listener.getLocalPort(); }
    public String origin() { return "http://127.0.0.1:" + port(); }

    /** Runs on one service-owned background thread; each client gets a two-second budget. */
    public void serve() throws IOException {
        while (!closed) {
            Socket client = listener.accept();
            synchronized (this) {
                if (closed) {
                    client.close();
                    return;
                }
                active = client;
            }
            try (client) {
                handle(client);
            } catch (IOException ignored) {
                // A timed-out, malformed or disconnected browser request must not kill the listener.
            } finally {
                synchronized (this) { active = null; }
            }
        }
    }

    private void handle(Socket client) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        long deadline = System.nanoTime() + 2_000_000_000L;
        int tail = 0;
        boolean complete = false;
        while (header.size() < 8192) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) return;
            client.setSoTimeout((int) Math.max(1, remaining / 1_000_000));
            int b = client.getInputStream().read();
            if (b == -1) return;
            if (b != 9 && b != 10 && b != 13 && (b < 32 || b > 126)) {
                reply(client, 400, null, "");
                return;
            }
            header.write(b);
            tail = (tail << 8) | b;
            if (tail == 0x0d0a0d0a) { complete = true; break; }
        }
        if (!complete) { reply(client, 431, null, ""); return; }
        String[] lines = new String(header.toByteArray(), StandardCharsets.US_ASCII).split("\r\n");
        String[] request = lines[0].split(" ", -1);
        if (request.length != 3 || !request[2].equals("HTTP/1.1")) {
            reply(client, 400, null, ""); return;
        }
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon < 1 || !lines[i].substring(0, colon).matches("[A-Za-z0-9!#$%&'*+.^_`|~-]+")) {
                reply(client, 400, null, ""); return;
            }
            String name = lines[i].substring(0, colon).toLowerCase(Locale.ROOT);
            if (headers.put(name, lines[i].substring(colon + 1).trim()) != null) {
                reply(client, 400, null, ""); return;
            }
        }
        String site = headers.get("sec-fetch-site");
        if (!headers.getOrDefault("host", "").equals("127.0.0.1:" + port())
                || (headers.containsKey("origin") && !headers.get("origin").equals(origin()))
                || (site != null && !site.equals("none") && !site.equals("same-origin"))) {
            reply(client, 403, null, ""); return;
        }
        if (!request[0].equals("GET")) { reply(client, 405, null, ""); return; }
        if (headers.containsKey("transfer-encoding")
                || !headers.getOrDefault("content-length", "0").equals("0")) {
            reply(client, 400, null, ""); return;
        }
        // Exact lookup: traversal, query strings, encoded aliases and absolute URLs aren't routes.
        Asset asset = assets.get(request[1]);
        reply(client, asset == null ? 404 : 200, asset, request[1]);
    }

    private void reply(Socket client, int status, Asset asset, String path) throws IOException {
        byte[] body = asset == null ? ("HTTP " + status + "\n").getBytes(StandardCharsets.UTF_8) : asset.body();
        // WebAssembly compilation needs this narrow CSP permission, not unsafe-eval.
        // Keep fetch/XHR same-origin; browser WebRTC retains the existing relay path.
        boolean controller = status == 200 && path.startsWith("/controller/");
        String policy = controller
                ? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; "
                    + "connect-src 'self'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                : "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
                    + "connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
        String headers = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Rejected") + "\r\n"
                + "Content-Type: " + (asset == null ? "text/plain; charset=utf-8" : asset.contentType()) + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\nCache-Control: no-store\r\n"
                + "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
                + "Content-Security-Policy: " + policy + "\r\n"
                + (path.equals("/sw.js") ? "Service-Worker-Allowed: /probe-scope/\r\n" : "")
                + "\r\n";
        OutputStream out = client.getOutputStream();
        out.write(headers.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    @Override public synchronized void close() throws IOException {
        closed = true;
        try { listener.close(); }
        finally { if (active != null) active.close(); }
    }
}
