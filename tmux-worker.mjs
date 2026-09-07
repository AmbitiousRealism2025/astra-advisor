import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(directory, 'launch.json'), 'utf8'));
if (!/^[a-f0-9-]{36}$/.test(config.jobId) || ![config.root, config.tools, config.sessionFile].every(v => typeof v === 'string' && v.startsWith('/'))) throw new Error('Invalid launch configuration');
if (dirname(config.sessionFile) !== dirname(directory)) throw new Error('Session file is outside the owned cycle');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BB_') && !['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_MODEL', 'PI_REASONING_LEVEL', 'PI_BB_TOOLS_FILE'].includes(key)));
const args = ['--model', 'openai-codex/gpt-6-astra', '--thinking', 'medium', '--session', config.sessionFile, '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--tools', 'review_inspect,review_submit', '-e', config.tools, '--astra-review-job', join(directory, 'job.json'), '--mode', 'json', '--print', 'Review the current injected job. Inspect the changes, then submit a structured report.'];
console.log(`Astra Medium review ${config.jobId}\nPersistent Pi session: ${config.sessionFile}`);
const log = createWriteStream(join(directory, 'events.jsonl'), { flags: 'wx', mode: 0o600 });
const child = spawn('pi', args, { cwd: config.root, env: { ...env, PI_OFFLINE: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let bytes = 0;
let buffer = '';
let reason = '';
let stopping = false;
let killTimer;
const stop = why => {
  if (stopping) return;
  stopping = true; reason = why;
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
  }
};
process.on('SIGTERM', () => stop('Reviewer cancelled'));
process.on('SIGINT', () => stop('Reviewer cancelled'));
log.on('error', () => stop('Could not persist reviewer output'));
child.stdout.on('data', chunk => {
  bytes += chunk.length;
  if (bytes > 8 * 1024 * 1024) { stop('Reviewer output exceeded 8MiB'); return; }
  if (!log.write(chunk)) { child.stdout.pause(); log.once('drain', () => child.stdout.resume()); }
  buffer += chunk.toString('utf8');
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    try {
      const event = JSON.parse(line);
      if (event.type === 'tool_execution_start') console.log(`Inspecting: ${event.toolName} ${event.args?.operation ?? ''} ${event.args?.path ?? ''}`);
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        for (const block of event.message.content ?? []) if (block.type === 'text') console.log(block.text);
      }
      if (event.type === 'tool_execution_end' && event.toolName === 'review_submit') console.log(JSON.stringify(event.result, null, 2));
    } catch {}
  }
});
child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) stop('Reviewer output exceeded 8MiB'); else console.error(chunk.toString('utf8')); });
const timer = setInterval(() => { access(join(directory, 'cancel')).then(() => stop('Reviewer cancelled')).catch(() => {}); }, 500);
const code = await new Promise(resolveCode => {
  child.on('error', () => { reason = 'Could not start Pi reviewer'; resolveCode(1); });
  child.on('close', code => resolveCode(code ?? 1));
});
clearInterval(timer); clearTimeout(killTimer);
await new Promise(resolveLog => log.end(resolveLog));
try { await access(join(directory, 'report.json')); } catch { if (!reason) reason = 'Pi exited without a structured report. Inspect events.jsonl for provider, context or turn-limit failures.'; }
const result = { jobId: config.jobId, code: stopping || reason ? 1 : code, reason };
await writeFile(join(directory, 'exit.json.tmp'), JSON.stringify(result), { mode: 0o600 });
await rename(join(directory, 'exit.json.tmp'), join(directory, 'exit.json'));
console.log(`\nReview process exited ${result.code}. ${reason || 'This tmux pane remains available for inspection; the next round resumes the same Pi session.'}`);
process.exitCode = result.code;
