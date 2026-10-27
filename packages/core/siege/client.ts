import { z } from "zod";
import { parseWithFallback } from "../api/schema";
import { SessionSchema, RecognitionSchema, StatusSchema, SiegeLibrarySchema, type Drawing, type WeaponSpec, type CannonDesign } from "./schema";

export class SiegeError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SiegeError"; }
}
export class SiegeClient {
  constructor(private baseURL: string,
    private transport: typeof fetch) {}
  private async request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(this.baseURL + path, {
        method: body === undefined ? "GET" : "POST", credentials: "include",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new SiegeError("network_unavailable"); }
    let data: unknown;
    try { data = await response.json(); } catch { throw new SiegeError("invalid_response"); }
    if (!response.ok) {
      const error = parseWithFallback(data, z.object({ code: z.string() }), { code: "service_unavailable" }, { endpoint: "siege" + path });
      throw new SiegeError(error.code);
    }
    const result = parseWithFallback<T | null>(data, schema, null, { endpoint: "siege" + path });
    if (result === null) throw new SiegeError("invalid_response");
    return result;
  }
  status() { return this.request("/status", StatusSchema); }
  library() { return this.request("/library", SiegeLibrarySchema); }
  create(requestId: string) { return this.request("/sessions", SessionSchema, { requestId }); }
  read(id: string) { return this.request("/sessions/" + encodeURIComponent(id), SessionSchema); }
  recognize(id: string, requestId: string, drawing: Drawing) {
    return this.request("/sessions/" + encodeURIComponent(id) + "/recognitions", RecognitionSchema, { requestId, drawing });
  }
  receipt(id: string, requestId: string) {
    return this.request("/sessions/" + encodeURIComponent(id) + "/recognitions/" + encodeURIComponent(requestId), RecognitionSchema);
  }
  save(id: string, input: { requestId: string; expectedVersion: number; name: string; drawing: Drawing; spec: WeaponSpec; cannonDesign?: CannonDesign | null }) {
    return this.request("/sessions/" + encodeURIComponent(id) + "/blueprints", SessionSchema, input);
  }
}
