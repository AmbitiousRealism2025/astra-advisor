import { execFile } from "node:child_process";

export async function command(binary: string, args: string[], cwd: string, signal: AbortSignal, input = ""): Promise<string> {
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const child = execFile(binary, args, { cwd, signal, timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", env: { ...env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" } }, (error, stdout) => {
      if (error) reject(new Error(`${binary} operation failed or timed out (${typeof error.code === "number" ? error.code : "process error"}). Check authentication, permissions and connectivity; a remote write may already have succeeded.`));
      else accept(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); accept(); }, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(new Error("Cancelled")); };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
