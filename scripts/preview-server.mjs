import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicFiles = new Set([
  "index.html", "rsvp.html", "venue.html", "travel.html", "story.html", "schedule.html", "registry.html", "faq.html",
  "Arwen.png", "Eowyn.png", "Merry.png", "Pippin.png", "assets/favicon.png",
  "assets/css/styles.css", "assets/css/rsvp.css", "assets/css/portraits.css", "assets/data/images.generated.js",
  "assets/js/main.js", "assets/js/rsvp.js", "assets/js/rsvp-search.js"
]);
const apiPaths = new Set(["/api/rsvp/suggest", "/api/rsvp/lookup", "/api/rsvp/submit"]);
const types = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };

export function previewOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Set RSVP_PREVIEW_ORIGIN to the preview Worker's HTTPS workers.dev URL."); }
  if (url.protocol !== "https:" || !/^daniel-colleen-rsvp-preview\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
      url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Only https://daniel-colleen-rsvp-preview.<account-subdomain>.workers.dev is allowed. Production and custom-domain origins are refused.");
  }
  return url.origin;
}

export function createPreviewServer({ upstream, fetchImpl = fetch } = {}) {
  const target = upstream ? previewOrigin(upstream) : null;
  return createServer(async (request, response) => {
    const send = (status, body, contentType = "application/json; charset=utf-8", extra = {}) => {
      response.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
      response.end(body);
    };
    try {
      const localOrigins = new Set([`http://localhost:${request.socket.localPort}`, `http://127.0.0.1:${request.socket.localPort}`]);
      if (!localOrigins.has(`http://${request.headers.host}`)) return send(403, '{"message":"Local host required."}');
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.search || url.hash) return send(400, '{"message":"Query parameters are not supported."}');
      if (url.pathname.startsWith("/api/")) {
        if (!apiPaths.has(url.pathname)) return send(404, '{"message":"Not found."}');
        if (request.method !== "POST") return send(405, '{"message":"POST required."}');
        // Defend localhost from other websites issuing requests through this proxy.
        if (!localOrigins.has(request.headers.origin)) return send(403, '{"message":"Same-origin browser request required."}');
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) return send(415, '{"message":"JSON required."}');
        if (!target) return send(503, '{"message":"API disabled in static-only test mode."}');
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 32768) return send(413, '{"message":"Request too large."}');
          chunks.push(chunk);
        }
        const result = await fetchImpl(`${target}${url.pathname}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: Buffer.concat(chunks), redirect: "manual", signal: AbortSignal.timeout(20000)
        });
        // Never follow even a preview-issued redirect toward another environment.
        if (result.status >= 300 && result.status < 400) return send(502, '{"message":"Preview redirects are blocked."}');
        if (!result.headers.get("content-type")?.includes("application/json")) return send(502, '{"message":"Preview returned an unexpected response."}');
        const body = await result.text();
        return send(result.status, body, "application/json; charset=utf-8",
          result.status === 429 ? { "retry-after": "60" } : {});
      }
      if (!["GET", "HEAD"].includes(request.method)) return send(405, '{"message":"GET required."}');
      const requestedFile = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = !requestedFile.includes(".") && publicFiles.has(`${requestedFile}.html`)
        ? `${requestedFile}.html`
        : requestedFile;
      // Exact allowlist: no directory listing, private CSV, env files, worker
      // configuration, databases, source maps, or arbitrary repository paths.
      const managedImage = /^assets\/images\/(?:[^/.][^/]*\/)*[^/.][^/]*\.(?:webp|jpe?g|png|avif)$/i.test(file);
      if (!publicFiles.has(file) && !managedImage) return send(404, '{"message":"Not found."}');
      const path = resolve(root, file), actual = await realpath(path);
      if (actual !== path || !actual.startsWith(resolve(root) + sep)) return send(404, '{"message":"Not found."}');
      const body = request.method === "HEAD" ? "" : await readFile(path);
      return send(200, body, types[file.split(".").pop()] || "application/octet-stream");
    } catch {
      // No request URLs, names, bodies, tokens, or upstream error bodies in logs.
      if (!response.headersSent) send(502, '{"message":"Cannot reach the preview. Please try again."}');
      else response.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const staticOnly = process.argv.includes("--static-only");
    const upstream = staticOnly ? undefined : previewOrigin(process.env.RSVP_PREVIEW_ORIGIN);
    const port = Number(process.env.PORT || 4173);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be between 1024 and 65535.");
    const server = createPreviewServer({ upstream });
    server.on("error", () => { console.error("Could not start the local preview server. Check whether the port is in use."); process.exitCode = 1; });
    server.listen(port, "127.0.0.1", () => {
      console.log(`Local site: http://localhost:${port}/rsvp`);
      console.log(upstream ? `RSVP API: ${upstream} (preview only; redirects blocked)` : "RSVP API disabled (static-only test mode).");
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
