package dev.webp2p.controllerprobe;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Real TCP integration checks without Android, Gradle or third-party test libraries. */
public final class LoopbackServerTest {
    private static int assertions;
    private static void check(boolean condition, String label) {
        assertions++;
        if (!condition) throw new AssertionError(label);
    }
    private record Reply(String headers, byte[] body) {
        String text() { return headers + new String(body, StandardCharsets.UTF_8); }
    }
    private static Reply exchangeReply(int port, String request) throws Exception {
        try (Socket socket = new Socket(InetAddress.getByName("127.0.0.1"), port)) {
            socket.setSoTimeout(4000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            // Read the declared response, not to EOF: rejected oversized requests may
            // leave unread input and cause TCP reset when the server closes.
            java.io.ByteArrayOutputStream response = new java.io.ByteArrayOutputStream();
            int tail = 0;
            while (tail != 0x0d0a0d0a) {
                int b = socket.getInputStream().read();
                if (b == -1) throw new AssertionError("Incomplete response headers");
                response.write(b);
                tail = (tail << 8) | b;
            }
            String head = response.toString(StandardCharsets.US_ASCII);
            int length = Integer.parseInt(head.split("Content-Length: ")[1].split("\\r\\n")[0]);
            byte[] body = socket.getInputStream().readNBytes(length);
            if (body.length != length) throw new AssertionError("Incomplete response body");
            return new Reply(head, body);
        }
    }
    private static String exchange(int port, String request) throws Exception {
        return exchangeReply(port, request).text();
    }
    private static Reply getReply(int port, String path, String headers) throws Exception {
        return exchangeReply(port, "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n" + headers + "\r\n");
    }
    private static String get(int port, String path, String headers) throws Exception {
        return getReply(port, path, headers).text();
    }
    private static void status(String response, int expected, String label) {
        check(response.startsWith("HTTP/1.1 " + expected + " "), label + ": " + response);
    }
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]);
        Path controller = Path.of(args[1]);
        BundledSite.Source source = name -> Files.newInputStream(name.startsWith("controller/")
                ? controller.resolve(name.substring("controller/".length())) : dir.resolve(name));
        Map<String, LoopbackServer.Asset> assets = BundledSite.load(source);
        check(assets.keySet().equals(Set.of("/", "/probe.js", "/sw.js", "/probe-scope/index.html",
                "/probe-scope/check.js", "/controller/", "/controller/app.js", "/controller/style.css",
                "/controller/pkg/relay_crypto.js", "/controller/pkg/relay_crypto_bg.wasm")), "exact production routes");
        try {
            BundledSite.load(name -> {
                if (name.equals("controller/pkg/relay_crypto_bg.wasm")) throw new java.io.FileNotFoundException("missing fixture WASM");
                return source.open(name);
            });
            throw new AssertionError("missing WASM accepted");
        } catch (java.io.FileNotFoundException expected) { assertions++; }
        for (String oversized : new String[] {"index.html", "controller/pkg/relay_crypto_bg.wasm"}) {
            var closed = new java.util.concurrent.atomic.AtomicBoolean();
            try {
                BundledSite.load(name -> {
                    if (!name.equals(oversized)) return source.open(name);
                    int limit = name.startsWith("controller/") ? 16 * 1024 * 1024 : 65536;
                    return new java.io.ByteArrayInputStream(new byte[limit + 1]) {
                        @Override public void close() { closed.set(true); }
                    };
                });
                throw new AssertionError("oversized bundled file accepted");
            } catch (java.io.IOException expected) {
                check(expected.getMessage().equals("Bundled asset exceeds size limit"), "asset bound rejection");
                check(closed.get(), "oversized input closed");
            }
        }
        Map<String, String> controllerTypes = Map.of(
                "index.html", "text/html; charset=utf-8", "app.js", "text/javascript; charset=utf-8",
                "style.css", "text/css; charset=utf-8", "pkg/relay_crypto.js", "text/javascript; charset=utf-8",
                "pkg/relay_crypto_bg.wasm", "application/wasm");
        AtomicReference<Throwable> background = new AtomicReference<>();
        LoopbackServer server = new LoopbackServer(0, assets);
        int port = server.port();
        Thread thread = new Thread(() -> {
            try { server.serve(); }
            catch (java.net.SocketException expectedOnClose) { }
            catch (Throwable failure) { background.set(failure); }
        });
        thread.setDaemon(true);
        thread.start();
        try (server) {
            String root = get(port, "/", "Sec-Fetch-Site: none\r\n");
            status(root, 200, "normal browser navigation");
            check(root.endsWith(Files.readString(dir.resolve("index.html"))), "exact bundled bytes");
            check(root.contains("Cache-Control: no-store\r\n"), "no HTTP caching");
            check(root.contains("frame-ancestors 'none'"), "no embedding");
            check(root.contains("X-Content-Type-Options: nosniff"), "no MIME sniffing");
            check(!root.contains("Access-Control-Allow-Origin"), "no CORS grant");
            status(get(port, "/", "Origin: " + server.origin() + "\r\nSec-Fetch-Site: same-origin\r\n"), 200, "own-origin fetch");
            status(get(port, "/", "Origin: https://untrusted.example\r\n"), 403, "foreign origin");
            status(get(port, "/", "Origin: null\r\n"), 403, "opaque origin");
            status(get(port, "/", "Sec-Fetch-Site: cross-site\r\n"), 403, "cross-site fetch");
            status(get(port, "/", "Sec-Fetch-Site: same-site\r\n"), 403, "different same-site origin");
            status(exchange(port, "GET / HTTP/1.1\r\nHost: untrusted.example:" + port + "\r\n\r\n"), 403, "DNS rebinding hostname");
            status(exchange(port, "GET / HTTP/1.1\r\n\r\n"), 403, "missing host");
            status(get(port, "/", "Host: 127.0.0.1:" + port + "\r\n"), 400, "duplicate host");
            status(get(port, "/", "Transfer-Encoding: chunked\r\n"), 400, "no request transfer encoding");
            status(get(port, "/", "Content-Length: 1\r\n"), 400, "no request body");
            status(exchange(port, "POST / HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n\r\n"), 405, "GET only");
            for (String path : new String[] {"/../index.html", "/%2e%2e/index.html", "/?q=1", "/missing", "/probe-scope/proof", "http://127.0.0.1/"}) {
                status(get(port, path, ""), 404, "no route alias or worker proof: " + path);
            }
            for (var entry : controllerTypes.entrySet()) {
                String route = "/controller/" + (entry.getKey().equals("index.html") ? "" : entry.getKey());
                Reply reply = getReply(port, route, "Sec-Fetch-Site: same-origin\r\n");
                String response = reply.text();
                status(response, 200, "controller asset: " + route);
                check(response.contains("Content-Type: " + entry.getValue() + "\r\n"), "controller MIME: " + route);
                check(response.contains("script-src 'self' 'wasm-unsafe-eval'"), "WASM compilation permission");
                check(!response.contains("'unsafe-eval'") && response.contains("connect-src 'self'; worker-src 'none'"), "no broad script/network/worker permission");
                check(!response.contains("Service-Worker-Allowed:"), "controller is outside probe worker");
                check(Arrays.equals(reply.body(), Files.readAllBytes(controller.resolve(entry.getKey()))), "exact binary asset body: " + route);
            }
            for (String path : new String[] {"/controller", "/controller/index.html", "/controller/../sw.js", "/controller/session.json", "/session.json"}) {
                status(get(port, path, ""), 404, "no controller alias or metadata: " + path);
            }
            check(get(port, "/controller/", "").contains("data-fixture=\"hosted\""), "manual-descriptor mode, not desktop fixture");
            String sw = get(port, "/sw.js", "Sec-Fetch-Site: same-origin\r\n");
            status(sw, 200, "worker served");
            check(sw.contains("Content-Type: text/javascript; charset=utf-8"), "worker MIME");
            check(sw.contains("Service-Worker-Allowed: /probe-scope/\r\n"), "restricted worker scope");
            check(!root.contains("Service-Worker-Allowed:"), "scope header only on worker");
            status(get(port, "/", "X-Large: " + "a".repeat(8100) + "\r\nX-Overflow: " + "b".repeat(200) + "\r\n"), 431, "header budget");
            try (Socket stalled = new Socket("127.0.0.1", port)) {
                stalled.setSoTimeout(4000);
                stalled.getOutputStream().write("GET / HTTP/1.1\r\n".getBytes(StandardCharsets.US_ASCII));
                check(stalled.getInputStream().read() == -1, "stalled client deadline");
            }
            status(get(port, "/", ""), 200, "healthy after rejected and stalled clients");
            try (LoopbackServer duplicate = new LoopbackServer(port, assets)) {
                throw new AssertionError("occupied port unexpectedly bound");
            } catch (java.net.BindException expected) { assertions++; }
        }
        thread.join(3000);
        check(!thread.isAlive(), "stop terminates listener");
        check(background.get() == null, "no unexpected background error: " + background.get());
        try (ServerSocket replacement = new ServerSocket()) {
            replacement.setReuseAddress(true);
            replacement.bind(new InetSocketAddress("127.0.0.1", port));
            assertions++;
        }
        System.out.println("PASS: " + assertions + " loopback server assertions (desktop JVM; not Android policy validation).");
    }
}
