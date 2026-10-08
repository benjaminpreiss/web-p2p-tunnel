import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Properties

plugins {
    id("com.android.application")
}

android {
    namespace = "dev.webp2p.controllerprobe"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.webp2p.controllerprobe"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2-controller"
    }

    sourceSets.getByName("main").assets.srcDir(rootProject.file("generated/assets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Manual Node preparation keeps Studio independent of its inherited Node PATH.
// Every APK build checks both staged bytes and their frontend source snapshot.
val verifyControllerAssets by tasks.registering {
    doLast {
        val generated = rootProject.file("generated")
        val receipt = generated.resolve("controller.properties")
        check(receipt.isFile) { "Run: node apps/android-controller/prepare.ts (from repository root)" }
        val properties = Properties().apply { receipt.inputStream().use { load(it) } }
        val names = setOf("index.html", "app.js", "style.css", "pkg/relay_crypto.js", "pkg/relay_crypto_bg.wasm")
        val assetRoot = generated.resolve("assets")
        val actual = assetRoot.walkTopDown().filter { it.isFile }.map { it.relativeTo(assetRoot).invariantSeparatorsPath }.toSet()
        check(actual == names.map { "controller/$it" }.toSet()) { "Unexpected or missing staged controller assets; rerun prepare.ts" }
        val browser = rootProject.file("../browser")
        val sourceNames = setOf("index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "tsconfig.tools.json",
            "build.ts", "export.ts", "pkg/relay_crypto.js", "pkg/relay_crypto_bg.wasm") +
            browser.resolve("src").walkTopDown().filter { it.isFile }.map { it.relativeTo(browser).invariantSeparatorsPath }.toSet()
        check(properties.stringPropertyNames() == names.map { "asset.$it" }.toSet() + sourceNames.map { "source.$it" }.toSet()) {
            "Controller source list changed; rerun prepare.ts"
        }
        fun verify(file: File, key: String) {
            check(file.isFile && !Files.isSymbolicLink(file.toPath())) { "Invalid controller input: $key" }
            val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            check(digest == properties.getProperty(key)) { "Controller bytes/source changed: $key; rerun prepare.ts" }
        }
        names.forEach { verify(assetRoot.resolve("controller/$it"), "asset.$it") }
        sourceNames.forEach { verify(browser.resolve(it), "source.$it") }
    }
}
tasks.named("preBuild") { dependsOn(verifyControllerAssets) }
