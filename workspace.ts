import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const blocked = /^(?:\.git|\.pi|\.bb|\.pibb|\.ssh|\.aws|\.gnupg|node_modules|\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa.*|id_ed25519.*)$/i;
const sensitiveExtension = /\.(?:pem|key|p12|pfx|keystore)$/i;
const maxFile = 1024 * 1024;
type FileData = { bytes: Buffer; mode: number } | null;
function fingerprint(file: FileData): string {
  return digest(file === null ? "ABSENT" : JSON.stringify({ mode: file.mode & 0o111, content: digest(file.bytes) }));
}
function text(file: FileData): string {
  if (file === null) return "[FILE ABSENT]";
  if (file.bytes.includes(0)) throw new Error("Binary files cannot be inspected as text.");
  return file.bytes.toString("utf8");
}
export function safeRelative(path: string): string {
  if (!path || path.length > 500 || isAbsolute(path) || path.includes("\\") || path.includes("\0")) throw new Error("Use a workspace-relative path.");
  const parts = path.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || blocked.test(p) || sensitiveExtension.test(p))) throw new Error("Path is excluded from Astra review (secret, metadata, dependency, or traversal path).");
  return parts.join("/");
}
export function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function bounded(text: string, maxBytes = 24000): string {
  const lines = text.split("\n");
  const prefix = lines.slice(0, 1500).join("\n");
  const bytes = Buffer.from(prefix);
  return bytes.length > maxBytes || lines.length > 1500
    ? bytes.subarray(0, maxBytes).toString("utf8") + "\n[TRUNCATED: request a narrower path or line range; omitted evidence is not reviewed.]"
    : text;
}

export class ReviewWorkspace {
  readonly inspected = new Map<string, string>();
  constructor(readonly root: string, readonly base: string, readonly signal: AbortSignal) {}

  async git(args: string[]): Promise<string> {
    this.signal.throwIfAborted();
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "PAGER"));
    return new Promise((accept, reject) => {
      execFile("git", ["--no-pager", "--no-optional-locks", "--no-replace-objects", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", ...args], {
        cwd: this.root, env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
        signal: this.signal, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
      }, (error, stdout) => error ? reject(new Error("Read-only Git inspection failed, exceeded its bound, or was cancelled.")) : accept(stdout));
    });
  }

  async path(path: string): Promise<string> {
    const safe = safeRelative(path);
    let current = this.root;
    for (const part of safe.split("/")) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Symlinks are excluded from Astra review.");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
    }
    const rel = relative(this.root, resolve(current));
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path leaves the review root.");
    return current;
  }

  async file(path: string): Promise<FileData> {
    this.signal.throwIfAborted();
    const target = await this.path(path);
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxFile) throw new Error("Only regular files up to 1MiB can be inspected.");
      const canonical = await realpath(target);
      if (canonical !== target) throw new Error("File path changed or traverses a symlink.");
      const bytes = Buffer.alloc(maxFile + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > maxFile) throw new Error("File grew beyond the inspection limit.");
      const content = bytes.subarray(0, bytesRead);
      this.signal.throwIfAborted();
      return { bytes: content, mode: stat.mode };
    } finally { await handle.close(); }
  }

  async contents(path: string): Promise<string> {
    return text(await this.file(path));
  }

  async fingerprint(path: string): Promise<string> { return fingerprint(await this.file(path)); }

  async read(path: string, offset: number, limit: number): Promise<string> {
    const file = await this.file(path);
    const content = text(file);
    this.inspected.set(path, fingerprint(file));
    return bounded(content.split("\n").slice(offset - 1, offset - 1 + limit).map((line, i) => `${offset + i}: ${line}`).join("\n"));
  }

  async files(directory = ""): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = [];
    let count = 0;
    let truncated = false;
    const walk = async (dir: string, depth: number) => {
      this.signal.throwIfAborted();
      if (depth > 15 || count > 3000) { truncated = true; return; }
      const target = dir ? await this.path(dir) : this.root;
      const entries = await readdir(target, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++count > 3000) { truncated = true; break; }
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        try { safeRelative(path); } catch { continue; }
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile()) paths.push(path);
      }
    };
    await walk(directory, 0);
    return { paths, truncated };
  }

  async search(directory: string, query: string): Promise<string> {
    const listing = await this.files(directory);
    const hits: string[] = [];
    let skipped = 0;
    let bytes = 0;
    for (const path of listing.paths.slice(0, 200)) {
      if (bytes >= 8 * maxFile || this.inspected.size >= 1000) break;
      this.signal.throwIfAborted();
      try {
        const file = await this.file(path);
        const content = text(file);
        bytes += Buffer.byteLength(content);
        this.inspected.set(path, fingerprint(file));
        content.split("\n").forEach((line, i) => { if (line.includes(query) && hits.length < 100) hits.push(`${path}:${i + 1}: ${line.slice(0, 1000)}`); });
      } catch { this.signal.throwIfAborted(); skipped++; }
    }
    return bounded(JSON.stringify({ hits, skipped, limited: listing.truncated || listing.paths.length > 200 || hits.length >= 100 || bytes >= 8 * maxFile || this.inspected.size >= 1000 }));
  }

  async changed(): Promise<string[]> {
    if (this.base === "none") return [];
    const tracked = await this.git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--relative", "--name-only", "-z", this.base, "--", "."]);
    const untracked = await this.git(["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
    const paths = [...new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean))].sort();
    if (paths.length > 300) throw new Error("More than 300 changed/untracked files; narrow the workspace before review.");
    return paths;
  }

  async snapshot(files: string[]): Promise<{ fingerprint: string; changed: string[]; excluded: string[] }> {
    const changed = await this.changed();
    const rows: string[] = [];
    const excluded: string[] = [];
    let total = 0;
    for (const path of [...new Set([...files, ...changed])].sort()) {
      try {
        if (total >= 8 * maxFile) throw new Error("Review snapshot exceeds 8MiB.");
        const file = await this.file(path);
        total += file?.bytes.length ?? 0;
        if (total > 8 * maxFile) throw new Error("Review snapshot exceeds 8MiB.");
        rows.push(`${path}:${fingerprint(file)}`);
      } catch (error) {
        this.signal.throwIfAborted();
        excluded.push(path);
        rows.push(`${path}:EXCLUDED`);
      }
    }
    return { fingerprint: digest(JSON.stringify({ root: this.root, base: this.base, rows })), changed, excluded };
  }

  async diff(path: string): Promise<string> {
    await this.path(path);
    if (this.base === "none") return "No Git baseline is available. Read files and assess the supplied evidence; do not claim diff verification.";
    return bounded(await this.git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--relative", "--unified=4", this.base, "--", path]));
  }

  async unchanged(): Promise<boolean> {
    for (const [path, hash] of this.inspected) if (await this.fingerprint(path) !== hash) return false;
    return true;
  }
}

export async function openWorkspace(root: string, base: string, signal: AbortSignal): Promise<ReviewWorkspace> {
  const canonical = await realpath(root);
  const workspace = new ReviewWorkspace(canonical, base, signal);
  if (base === "none") {
    let inGit = false;
    try { inGit = (await workspace.git(["rev-parse", "--is-inside-work-tree"])).trim() === "true"; }
    catch { signal.throwIfAborted(); }
    if (inGit) throw new Error("This is a Git workspace. Supply HEAD or a full commit hash instead of none.");
    return workspace;
  }
  if (!/^(HEAD|[a-f0-9]{40}|[a-f0-9]{64})$/.test(base)) throw new Error("Invalid Git baseline.");
  const hash = (await workspace.git(["rev-parse", "--verify", `${base}^{commit}`])).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw new Error("Could not pin Git baseline.");
  return new ReviewWorkspace(canonical, hash, signal);
}
