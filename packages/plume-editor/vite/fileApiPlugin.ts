/**
 * Dev-server file API for the editor's Save / Save As / Open.
 *
 * A browser page can't write to a folder it names, so the editor asks the Vite dev server
 * to do it. Every path the client sends is relative to `root` and must resolve inside it;
 * files must be `.json`. There is no auth — this only runs on the local dev server.
 *
 *   GET  /api/plume/list?dir=<rel>   → { root, dir, folders, files }
 *   GET  /api/plume/load?path=<rel>  → the file's JSON
 *   PUT  /api/plume/save             ← { path, json, overwrite } (409 if it exists and !overwrite)
 *   POST /api/plume/mkdir            ← { dir }
 */

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "Library", "Temp"]);

export function fileApiPlugin(root: string): Plugin {
  const rootAbs = path.resolve(root);

  function resolveInside(rel: unknown): string | undefined {
    if (typeof rel !== "string") return undefined;
    const abs = path.resolve(rootAbs, rel.replace(/^[\\/]+/, ""));
    const fromRoot = path.relative(rootAbs, abs);
    if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return undefined;
    return abs;
  }

  function toRel(abs: string): string {
    return path.relative(rootAbs, abs).split(path.sep).join("/");
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    if (!parsed || typeof parsed !== "object") throw new Error("Body must be a JSON object.");
    return parsed as Record<string, unknown>;
  }

  const rootInfo = { root: rootAbs.split(path.sep).join("/"), rootName: path.basename(rootAbs) };

  return {
    name: "plume-editor-file-api",
    configureServer(server) {
      server.middlewares.use("/api/plume/list", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const dirAbs = resolveInside(url.searchParams.get("dir") ?? "");
        if (!dirAbs) return send(res, 400, { error: "Folder is outside the editor root." });
        if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
          return send(res, 404, { error: "Folder not found." });
        }
        const folders: string[] = [];
        const files: string[] = [];
        for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) folders.push(entry.name);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
            files.push(entry.name);
        }
        const byName = (a: string, b: string): number =>
          a.localeCompare(b, undefined, { sensitivity: "base" });
        send(res, 200, {
          ...rootInfo,
          dir: toRel(dirAbs),
          folders: folders.sort(byName),
          files: files.sort(byName),
        });
      });

      server.middlewares.use("/api/plume/load", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const fileAbs = resolveInside(url.searchParams.get("path"));
        if (!fileAbs || !fileAbs.toLowerCase().endsWith(".json")) {
          return send(res, 400, { error: "Path must be a .json file inside the editor root." });
        }
        if (!fs.existsSync(fileAbs)) return send(res, 404, { error: "File not found." });
        try {
          send(res, 200, JSON.parse(fs.readFileSync(fileAbs, "utf-8")));
        } catch (err) {
          send(res, 422, {
            error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });

      server.middlewares.use("/api/plume/save", async (req, res) => {
        if (req.method !== "PUT") return send(res, 405, { error: "Use PUT." });
        try {
          const body = await readBody(req);
          const fileAbs = resolveInside(body["path"]);
          if (!fileAbs || !fileAbs.toLowerCase().endsWith(".json")) {
            return send(res, 400, { error: "Path must be a .json file inside the editor root." });
          }
          if (fs.existsSync(fileAbs) && body["overwrite"] !== true) {
            return send(res, 409, { error: "File already exists." });
          }
          fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
          fs.writeFileSync(fileAbs, JSON.stringify(body["json"], null, 2) + "\n", "utf-8");
          send(res, 200, { ...rootInfo, path: toRel(fileAbs) });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      server.middlewares.use("/api/plume/mkdir", async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
        try {
          const body = await readBody(req);
          const dirAbs = resolveInside(body["dir"]);
          if (!dirAbs) return send(res, 400, { error: "Folder is outside the editor root." });
          fs.mkdirSync(dirAbs, { recursive: true });
          send(res, 200, { ...rootInfo, dir: toRel(dirAbs) });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
