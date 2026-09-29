#!/usr/bin/env node
// Minimal static server with gzip for Lighthouse CI, so transfer sizes look like a real
// host's (vite preview and lhci's built-in server send files uncompressed).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createGzip } from "node:zlib";

const root = resolve(process.argv[2] ?? "apps/web/dist");
const port = Number(process.argv[3] ?? 4174);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) {
    response.writeHead(404).end("not found");
    return;
  }
  const type = types[extname(path)] ?? "application/octet-stream";
  const gzip = /\bgzip\b/.test(request.headers["accept-encoding"] ?? "") && extname(path) in types;
  const immutable = path.includes(`${join(root, "assets")}`);
  response.setHeader("content-type", type);
  response.setHeader(
    "cache-control",
    immutable ? "public, max-age=31536000, immutable" : "no-cache",
  );
  if (gzip) {
    response.setHeader("content-encoding", "gzip");
    response.setHeader("vary", "accept-encoding");
    response.writeHead(200);
    createReadStream(path).pipe(createGzip()).pipe(response);
  } else {
    response.writeHead(200);
    createReadStream(path).pipe(response);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}/`);
});
