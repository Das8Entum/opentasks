/*
 * OpenTasks — Locker backend (Cloudflare Worker + R2)
 * ---------------------------------------------------
 * Relays encrypted blobs to/from an R2 bucket. It NEVER sees plaintext:
 * the OpenTasks client encrypts every chunk with AES-256-GCM (your vault
 * passphrase) BEFORE upload. The Worker only checks a bearer token and
 * streams bytes.
 *
 * Routes (all require  Authorization: Bearer <LOCKER_TOKEN>):
 *   PUT    /o/<key>   store an object (body = ciphertext)     -> "ok"
 *   GET    /o/<key>   fetch an object (streams ciphertext)
 *   DELETE /o/<key>   delete an object                         -> "ok"
 *   GET    /list      list object keys (JSON {keys:[...]})     (optional, for GC)
 *
 * Setup (Cloudflare dashboard, ~5 min):
 *   1. R2 -> Create bucket  e.g.  opentasks-locker
 *   2. Workers & Pages -> Create Worker -> paste this file -> Deploy
 *   3. Worker -> Settings -> Variables:
 *        - R2 Bucket Binding:  variable name = LOCKER  ->  bucket opentasks-locker
 *        - Secret:  LOCKER_TOKEN  = <a long random string>   (this is your locker password)
 *        - (optional) Text var:  ALLOW_ORIGINS = https://das8entum.github.io,http://localhost:7350
 *   4. Copy the Worker URL (https://opentasks-locker.<you>.workers.dev)
 *   5. In OpenTasks -> Locker settings: paste Worker URL + LOCKER_TOKEN.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // --- CORS ---
    const allow = (env.ALLOW_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const allowOrigin = (allow.length === 0) ? (origin || "*")
                      : (allow.includes(origin) ? origin : allow[0]);
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // --- auth ---
    if (!env.LOCKER_TOKEN) return json({ error: "LOCKER_TOKEN not configured" }, 500, cors);
    if ((request.headers.get("Authorization") || "") !== "Bearer " + env.LOCKER_TOKEN)
      return json({ error: "unauthorized" }, 401, cors);
    if (!env.LOCKER) return json({ error: "R2 binding LOCKER not configured" }, 500, cors);

    // --- list (GC / diagnostics) ---
    if (request.method === "GET" && url.pathname === "/list") {
      const prefix = url.searchParams.get("prefix") || undefined;
      const out = []; let cursor;
      do {
        const page = await env.LOCKER.list({ prefix, cursor, limit: 1000 });
        for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return json({ keys: out }, 200, cors);
    }

    // --- object ops:  /o/<key> ---
    const m = url.pathname.match(/^\/o\/(.+)$/);
    if (!m) return json({ error: "not found" }, 404, cors);
    const key = decodeURIComponent(m[1]);
    if (key.length > 512 || key.includes("..")) return json({ error: "bad key" }, 400, cors);

    if (request.method === "PUT") {
      if (!request.body) return json({ error: "empty body" }, 400, cors);
      await env.LOCKER.put(key, request.body, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      return json({ ok: true }, 200, cors);
    }

    if (request.method === "GET") {
      const obj = await env.LOCKER.get(key);
      if (!obj) return json({ error: "not found" }, 404, cors);
      const h = new Headers(cors);
      h.set("Content-Type", "application/octet-stream");
      h.set("Cache-Control", "no-store");
      if (obj.size != null) h.set("Content-Length", String(obj.size));
      return new Response(obj.body, { status: 200, headers: h });
    }

    if (request.method === "DELETE") {
      await env.LOCKER.delete(key);
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "method not allowed" }, 405, cors);
  },
};

function json(obj, status, cors) {
  const h = new Headers(cors);
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(obj), { status, headers: h });
}
