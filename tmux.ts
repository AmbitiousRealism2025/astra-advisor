import { Type, type Static } from "typebox";
import { uuidv7 } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { object, packetSchema, parse, reportSchema, stateSchema, text, tmuxSchema, type ReviewState } from "./contracts.ts";
import { command, delay } from "./process.ts";

const number = Type.Number({ minimum: 0 });
export const usageSchema = object({ input: number, output: number, cacheRead: number, cacheWrite: number, totalTokens: number, cost: object({ input: number, output: number, cacheRead: number, cacheWrite: number, total: number }) });
export const jobSchema = object({ jobId: text(100), cycleId: text(100), round: Type.Integer({ minimum: 1 }), root: text(4000), base: text(100), fingerprint: text(100), packet: packetSchema, previous: Type.Union([reportSchema, Type.Null()]) });
export const outputSchema = object({ jobId: text(100), report: reportSchema, fingerprint: text(100), inspected: stateSchema.properties.inspected, usage: usageSchema });
const exitSchema = object({ jobId: text(100), code: Type.Integer(), reason: Type.String({ maxLength: 4000 }) });
export type TmuxDescriptor = Static<typeof tmuxSchema>;
export type ReviewJob = Static<typeof jobSchema>;
export async function atomicJSON(path: string, value: object) {
  const temporary = `${path}.${uuidv7()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}
export async function jsonFile(path: string): Promise<unknown> {
  if ((await stat(path)).size > 1024 * 1024) throw new Error("Review artifact exceeds 1MiB.");
  return JSON.parse(await readFile(path, "utf8"));
}
function directory(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid review cycle identity.");
  return join(getAgentDir(), "astra-advisor", "reviews", id);
}
function checked(id: string, descriptor: TmuxDescriptor) {
  if (descriptor.directory !== directory(id) || descriptor.name !== `astra-advisor-${id}` || descriptor.sessionFile !== join(directory(id), "reviewer.jsonl") || descriptor.jobDirectory !== join(directory(id), descriptor.jobId) || !/^[a-f0-9-]{36}$/.test(descriptor.jobId)) throw new Error("Review descriptor does not match its owned cycle.");
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function pane(name: string, root: string, signal: AbortSignal): Promise<string> {
  const panes = (await command("tmux", ["list-panes", "-s", "-t", `=${name}`, "-F", "#{pane_id}"], root, signal)).trim().split("\n");
  if (panes.length !== 1 || !/^%[0-9]+$/.test(panes[0])) throw new Error("Expected exactly one owned reviewer pane.");
  return panes[0];
}
export async function startTmux(state: ReviewState, signal: AbortSignal, prepared: (descriptor: TmuxDescriptor) => void): Promise<TmuxDescriptor> {
  const dir = directory(state.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const jobId = uuidv7();
  const descriptor = { name: `astra-advisor-${state.id}`, directory: dir, sessionFile: join(dir, "reviewer.jsonl"), jobDirectory: join(dir, jobId), jobId };
  await mkdir(descriptor.jobDirectory, { mode: 0o700 });
  const job: ReviewJob = { jobId, cycleId: state.id, round: state.round, root: state.root, base: state.base, fingerprint: state.fingerprint, packet: state.packet, previous: state.round === 1 ? null : state.report };
  await atomicJSON(join(descriptor.jobDirectory, "job.json"), job);
  await atomicJSON(join(descriptor.jobDirectory, "launch.json"), { jobId, sessionFile: descriptor.sessionFile, root: state.root, tools: fileURLToPath(new URL("./tmux-review-tools.ts", import.meta.url)) });
  prepared(descriptor);
  let exists = false;
  try { await command("tmux", ["has-session", "-t", `=${descriptor.name}`], state.root, signal); exists = true; } catch { signal.throwIfAborted(); }
  if (exists) {
    const owner = (await command("tmux", ["show-options", "-v", "-t", `=${descriptor.name}:`, "@astra-advisor-cycle"], state.root, signal)).trim();
    const dead = (await command("tmux", ["display-message", "-p", "-t", await pane(descriptor.name, state.root, signal), "#{pane_dead}"], state.root, signal)).trim();
    if (owner !== state.id || dead !== "1") throw new Error("tmux session is not an idle reviewer owned by this cycle; it will not be replaced.");
  } else {
    await command("tmux", ["new-session", "-d", "-s", descriptor.name, "-c", state.root, "sleep 86400"], state.root, signal);
    await command("tmux", ["set-option", "-t", `=${descriptor.name}:`, "@astra-advisor-cycle", state.id], state.root, signal);
    await command("tmux", ["set-window-option", "-t", await pane(descriptor.name, state.root, signal), "remain-on-exit", "on"], state.root, signal);
  }
  await command("tmux", ["set-environment", "-t", `=${descriptor.name}`, "PATH", process.env.PATH ?? "/usr/bin:/bin"], state.root, signal);
  await command("tmux", ["set-environment", "-t", `=${descriptor.name}`, "PI_CODING_AGENT_DIR", getAgentDir()], state.root, signal);
  const worker = fileURLToPath(new URL("./tmux-worker.mjs", import.meta.url));
  await command("tmux", ["respawn-pane", ...(exists ? [] : ["-k"]), "-t", await pane(descriptor.name, state.root, signal), "-c", state.root, `exec node ${quote(worker)} ${quote(descriptor.jobDirectory)}`], state.root, signal);
  return descriptor;
}
export async function cancelTmux(state: ReviewState) {
  if (!state.tmux) return;
  checked(state.id, state.tmux);
  await writeFile(join(state.tmux.jobDirectory, "cancel"), "cancel\n", { mode: 0o600 });
}
export async function closeTmux(state: ReviewState) {
  if (!state.tmux) return;
  checked(state.id, state.tmux);
  const signal = new AbortController().signal;
  try {
    const owner = (await command("tmux", ["show-options", "-v", "-t", `=${state.tmux.name}:`, "@astra-advisor-cycle"], state.root, signal)).trim();
    if (owner !== state.id) throw new Error("tmux ownership changed; refusing to close it.");
    const dead = (await command("tmux", ["display-message", "-p", "-t", await pane(state.tmux.name, state.root, signal), "#{pane_dead}"], state.root, signal)).trim();
    if (dead !== "1") { await cancelTmux(state); await delay(4000, signal); }
    await command("tmux", ["kill-session", "-t", `=${state.tmux.name}`], state.root, signal);
  } catch (error) {
    try { await command("tmux", ["has-session", "-t", `=${state.tmux.name}`], state.root, signal); } catch { return; }
    throw error;
  }
}
export async function waitTmux(state: ReviewState, seconds: number, signal: AbortSignal) {
  if (!state.tmux) throw new Error("No tmux reviewer is associated with this cycle.");
  checked(state.id, state.tmux);
  const deadline = Date.now() + seconds * 1000;
  do {
    signal.throwIfAborted();
    let exit;
    try { exit = parse(exitSchema, await jsonFile(join(state.tmux.jobDirectory, "exit.json"))); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (exit) {
      if (exit.jobId !== state.tmux.jobId || exit.code !== 0) throw new Error(`tmux reviewer did not complete successfully: ${exit.reason || "nonzero exit"}`);
      const output = parse(outputSchema, await jsonFile(join(state.tmux.jobDirectory, "report.json")));
      if (output.jobId !== state.tmux.jobId) throw new Error("Stale or mismatched review artifact.");
      return output;
    }
    const dead = (await command("tmux", ["display-message", "-p", "-t", await pane(state.tmux.name, state.root, signal), "#{pane_dead}"], state.root, signal)).trim();
    if (dead === "1") throw new Error("tmux reviewer exited without a valid completion artifact.");
    if (Date.now() >= deadline) return null;
    await delay(Math.min(1000, Math.max(1, deadline - Date.now())), signal);
  } while (true);
}
