"use strict";
const output = document.querySelector("#diagnostics");
(async () => {
  try {
    if (!("serviceWorker" in navigator)) throw new Error("Service Worker API unavailable");
    if (!navigator.serviceWorker.controller) throw new Error("Not controlled. Register the worker on the main page, then reload here.");
    const response = await fetch("/probe-scope/proof", { cache: "no-store" });
    if (!response.ok || await response.text() !== "local-controller-worker-v1") throw new Error("Synthetic worker response did not match");
    output.textContent = "PASS: Service Worker intercepted the request and returned the expected synthetic response.\nThis is a routing probe, not yet a tunnel test.";
  } catch (error) { output.textContent = `FAIL: ${error.name}: ${error.message}`; }
})();
