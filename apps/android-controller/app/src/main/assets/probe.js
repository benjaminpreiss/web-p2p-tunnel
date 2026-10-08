"use strict";
const output = document.querySelector("#diagnostics");
const log = (message) => { output.textContent += `${message}\n`; };
output.textContent = "";
log(`Origin: ${location.origin}`);
log(`Secure context: ${window.isSecureContext}`);
log(`Service Worker API: ${"serviceWorker" in navigator}`);
log("Bundled HTML and JavaScript loaded from phone loopback.");
if ("serviceWorker" in navigator) {
  log(`Root page controlled by worker (expected false): ${!!navigator.serviceWorker.controller}`);
}
function activated(worker) {
  return new Promise((resolve, reject) => {
    if (!worker) { reject(new Error("Registration has no worker")); return; }
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") finish(new Error("Worker became redundant"));
    };
    timer = setTimeout(() => finish(new Error("Worker activation timed out")), 10000);
    worker.addEventListener("statechange", changed);
    changed();
  });
}
document.querySelector("#register").addEventListener("click", async () => {
  try {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("Secure Service Worker support unavailable");
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/probe-scope/", updateViaCache: "none",
    });
    await activated(registration.installing || registration.waiting || registration.active);
    log(`PASS: worker activated. Scope: ${registration.scope}`);
    log("Now open the worker-scope test page.");
  } catch (error) { log(`FAIL: ${error.name}: ${error.message}`); }
});
document.querySelector("#cleanup").addEventListener("click", async () => {
  try {
    if (!("serviceWorker" in navigator)) throw new Error("Service Worker API unavailable");
    const scope = new URL("/probe-scope/", location.origin).href;
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (registration.scope === scope) await registration.unregister();
    }
    log("Test worker unregistered. Close its test tabs to release existing controlled clients.");
  } catch (error) { log(`Cleanup failed: ${error.message}`); }
});
