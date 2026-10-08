/** Client for the dev-server file API in `vite/fileApiPlugin.ts`. Paths are relative to its root. */

export interface DirListing {
  root: string;
  rootName: string;
  dir: string;
  folders: string[];
  files: string[];
}

export class FileExistsError extends Error {
  constructor() {
    super("File already exists.");
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the editor's dev server.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 409) throw new FileExistsError();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body as T;
}

export function listDir(dir: string): Promise<DirListing> {
  return request(`/api/plume/list?dir=${encodeURIComponent(dir)}`);
}

export async function fetchRoot(): Promise<{ root: string; rootName: string }> {
  const { root, rootName } = await listDir("");
  return { root, rootName };
}

export function loadJson(path: string): Promise<unknown> {
  return request(`/api/plume/load?path=${encodeURIComponent(path)}`);
}

/** Throws `FileExistsError` if the file exists and `overwrite` is false. */
export async function saveJson(path: string, json: unknown, overwrite: boolean): Promise<void> {
  await request("/api/plume/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, json, overwrite }),
  });
}

export async function makeDir(dir: string): Promise<void> {
  await request("/api/plume/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });
}
