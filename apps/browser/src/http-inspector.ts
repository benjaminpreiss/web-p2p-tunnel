// Application records inside an already publisher-authenticated PQ session.
// No fetch(), DOM execution, persistence, credentials in URLs, or transport crypto here.
export const HTTP_LABEL = "web-p2p-tunnel.http-inspector.v1";
export const MAX_REQUESTS = 16;
export const MAX_BODY_BYTES = 4096;
type Exchange = (request: Uint8Array) => Promise<Uint8Array>;
export interface HttpResponse { status: number; contentType: string; body: Uint8Array }

// This is the only rendering sink: never innerHTML, srcdoc, executable Blob URLs,
// or clickable target-provided links. Results are deliberately not diagnostics.
export function appendHttpResponse(output: { textContent: string | null }, path: string, response: HttpResponse): void {
  const text = /^(text\/|application\/(json|javascript|xml)(;|$))/i.test(response.contentType);
  const body = text ? new TextDecoder().decode(response.body) : btoa(String.fromCharCode(...response.body));
  output.textContent = (output.textContent ?? "") + `GET ${path}\nHTTP ${response.status} · ${response.contentType} · ${response.body.length} bytes${text ? "" : " (base64)"}\n${body}\n\n`;
}

export function validatePath(path: string): void {
  if (path.length > 1024 || !/^\/[\x21-\x7e]*$/.test(path) || path.startsWith("//") || /[\\#]/.test(path)) {
    throw new Error("Use a single-slash absolute path, at most 1024 ASCII characters; no fragments or backslashes");
  }
}

export async function openHttpInspector(exchange: Exchange, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Expected the fresh 64-character visitor token from your helper");
  async function request(value: unknown): Promise<Record<string, unknown>> {
    const bytes = await exchange(new TextEncoder().encode(JSON.stringify(value)));
    if (bytes.length > 8192) throw new Error("Oversized inspector response");
    let response: unknown;
    try { response = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("Invalid inspector response"); }
    if (typeof response !== "object" || response === null || Array.isArray(response) || !("v" in response) || response.v !== 1) {
      throw new Error("Invalid inspector response version");
    }
    return response as Record<string, unknown>;
  }
  try {
    const response = await request({ v: 1, type: "authorize", token });
    if (response.type !== "authorized" || response.maxRequests !== MAX_REQUESTS || response.maxBodyBytes !== MAX_BODY_BYTES) {
      throw new Error("Visitor authorization failed or incompatible inspector");
    }
  } finally { token = ""; }
  let count = 0;
  let busy = false;
  let failed = false;
  return {
    async get(path: string): Promise<HttpResponse> {
      validatePath(path);
      if (busy || failed || count >= MAX_REQUESTS) throw new Error("Inspector closed, busy, or request limit reached");
      busy = true;
      const id = ++count;
      try {
        const response = await request({ v: 1, type: "get", id, path });
        if (response.type !== "response" || response.id !== id ||
            typeof response.status !== "number" || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 ||
            typeof response.contentType !== "string" || response.contentType.length > 256 ||
            typeof response.body !== "string" || response.body.length > 5464 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.body)) {
          throw new Error("Invalid inspector response");
        }
        const body = Uint8Array.from(atob(response.body), (character) => character.charCodeAt(0));
        if (body.length > MAX_BODY_BYTES) throw new Error("Oversized HTTP body");
        return { status: response.status, contentType: response.contentType, body };
      } catch (error) { failed = true; throw error; }
      finally { busy = false; }
    },
  };
}
