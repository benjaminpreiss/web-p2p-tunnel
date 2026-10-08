package dev.webp2p.controllerprobe;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/** The complete APK route allowlist and bounded loading, shared with desktop integration tests. */
public final class BundledSite {
    @FunctionalInterface
    public interface Source {
        InputStream open(String name) throws IOException;
    }

    private record Route(String path, String asset, String type) {}
    private static final Route[] ROUTES = {
        new Route("/", "index.html", "text/html; charset=utf-8"),
        new Route("/probe.js", "probe.js", "text/javascript; charset=utf-8"),
        new Route("/sw.js", "sw.js", "text/javascript; charset=utf-8"),
        new Route("/probe-scope/index.html", "worker.html", "text/html; charset=utf-8"),
        new Route("/probe-scope/check.js", "check.js", "text/javascript; charset=utf-8"),
        new Route("/controller/", "controller/index.html", "text/html; charset=utf-8"),
        new Route("/controller/app.js", "controller/app.js", "text/javascript; charset=utf-8"),
        new Route("/controller/style.css", "controller/style.css", "text/css; charset=utf-8"),
        new Route("/controller/pkg/relay_crypto.js", "controller/pkg/relay_crypto.js", "text/javascript; charset=utf-8"),
        new Route("/controller/pkg/relay_crypto_bg.wasm", "controller/pkg/relay_crypto_bg.wasm", "application/wasm"),
    };

    private BundledSite() {}

    public static Map<String, LoopbackServer.Asset> load(Source source) throws IOException {
        Map<String, LoopbackServer.Asset> assets = new LinkedHashMap<>();
        for (Route route : ROUTES) {
            int limit = route.asset().startsWith("controller/") ? 16 * 1024 * 1024 : 65536;
            try (InputStream in = source.open(route.asset()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (out.size() + count > limit) throw new IOException("Bundled asset exceeds size limit");
                    out.write(buffer, 0, count);
                }
                assets.put(route.path(), new LoopbackServer.Asset(route.type(), out.toByteArray()));
            }
        }
        return assets;
    }
}
