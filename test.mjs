import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import astraAdvisor from './index.ts';
import { assess, parse, reportSchema } from './contracts.ts';
import { ReviewWorkspace, openWorkspace, safeRelative } from './workspace.ts';
import { emptyUsage } from './reviewer.ts';

const cleanReport = () => ({ summary: 'No blockers in inspected evidence.', findings: [], evidenceGaps: [] });
const blocker = (status = 'open') => ({ id: 'A1', severity: 'blocking', disposition: 'fix_now', status, title: 'Missing failure handling', evidence: 'src/main.ts:1 returns without checking failure.', resolution: 'Handle failure and add a focused test.' });
const reportWith = status => ({ summary: 'Review finding.', findings: [blocker(status)], evidenceGaps: [] });
const usage = () => ({ ...emptyUsage(), input: 10, output: 5, totalTokens: 15 });
const response = calls => ({ role: 'assistant', api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6-astra', content: calls, usage: usage(), stopReason: 'toolUse', timestamp: 1 });
const inspect = (operation = 'read', path = 'src/main.ts', query = '') => ({ type: 'toolCall', id: 'inspect-1', name: 'review_inspect', arguments: { operation, path, query, offset: 1, limit: 300 } });
const submit = report => ({ type: 'toolCall', id: 'submit-1', name: 'review_submit', arguments: report });
function setup(root) {
  const hooks = {}, tools = {}, commands = {}, branch = [], switches = [], messages = [], prompts = [], requests = [];
  let thinking, complete = async () => { throw new Error('Unexpected inference request'); };
  const ctx = {
    cwd: root, hasUI: false, waitForIdle: async () => {},
    sessionManager: { getBranch: () => branch },
    modelRegistry: {
      find: (provider, id) => ({ provider, id }), hasConfiguredAuth: () => true,
      complete: (...args) => { requests.push(args); return complete(...args); },
    },
  };
  astraAdvisor({
    on: (name, handler) => { hooks[name] = handler; },
    registerTool: tool => { tools[tool.name] = tool; },
    registerCommand: (name, command) => { commands[name] = command; },
    setModel: async model => { switches.push(model.id); return true; },
    setThinkingLevel: level => { thinking = level; }, getThinkingLevel: () => thinking,
    appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data: structuredClone(data) }),
    sendMessage: message => messages.push(message), sendUserMessage: prompt => prompts.push(prompt),
  });
  return { hooks, tools, ctx, branch, switches, messages, prompts, requests, thinking: () => thinking,
    command: args => commands['astra-advisor'].handler(args, ctx),
    complete: fn => { complete = fn; },
    scripted: replies => { complete = async () => { const reply = replies.shift(); assert.ok(reply, 'No scripted response left'); return typeof reply === 'function' ? reply() : reply; }; },
    call: (name, args, signal) => tools[name].execute('id', args, signal, undefined, ctx),
  };
}
function packet() {
  return { goal: 'Handle failure safely', invariants: ['Return a safe error on failure'], files: ['src/main.ts'], base: 'none', diffSummary: 'Changed error handling',
    tests: [{ command: 'test command', result: '1 passed (executor reported)' }], limitations: ['No Git baseline for this fixture'], restrictions: 'No deployment, no secrets, read-only reviewer.', risk: ['lifecycle'], executor: 'sol', resolutions: [] };
}
export async function runTests() {
  const passed = [];
  const test = async (name, run) => {
    const root = await mkdtemp(join(tmpdir(), 'astra-tests-'));
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src/main.ts'), 'export const safe = false;\n');
      await run(root);
      passed.push(name);
    } finally { await rm(root, { recursive: true, force: true }); }
  };
  await test('bare invocation, task forwarding, plain GUI invocation, status/off and non-triggering examples', async root => {
    const s = setup(root);
    await s.command('');
    assert.match(s.messages.at(-1).content, /Astra Advisor active/);
    assert.equal(s.messages.at(-1).display, true);
    await s.command('Fix tests');
    assert.deepEqual(s.prompts, ['Fix tests']);
    await s.command('off'); await s.command('status');
    assert.match(s.messages.at(-1).content, /inactive/);
    for (const prompt of ['Use /astra-advisor to fix tests', '/astra-advisor fix tests']) {
      const s = setup(root);
      const out = await s.hooks.before_agent_start({ prompt, systemPrompt: 'Original restrictions' }, s.ctx);
      assert.match(out.message.content, /Astra Advisor active/);
      assert.match(out.systemPrompt, /^Original restrictions/);
    }
    for (const prompt of ['Explain /astra-advisor', 'Use /astra-advisor-other', '```\n/astra-advisor\n```', '> Use /astra-advisor']) {
      const s = setup(root);
      await s.hooks.before_agent_start({ prompt, systemPrompt: '' }, s.ctx);
      assert.deepEqual(s.switches, []);
    }
  });
  await test('disabled tools and active-branch restoration', async root => {
    const s = setup(root);
    await assert.rejects(s.call('astra_verify', { action: 'start', packet: packet() }), /Enable/);
    await s.command('');
    s.branch.length = 0; s.hooks.session_tree({}, s.ctx);
    await assert.rejects(s.call('advisor_route', { role: 'sol', reason: 'work' }), /Enable/);
  });
  await test('tool-free planning keeps session model and forwards cancellation', async root => {
    const s = setup(root); await s.command('');
    s.complete(async (model, context, options) => {
      assert.equal(model.id, 'gpt-6-astra'); assert.equal(context.tools, undefined);
      assert.equal(context.messages.length, 1); assert.equal(options.reasoningEffort, 'high');
      assert.ok(options.signal instanceof AbortSignal);
      return { ...response([]), content: [{ type: 'text', text: 'Plan' }], stopReason: 'stop' };
    });
    const result = await s.call('consult_astra', { question: 'Plan?', context: 'No secrets.' });
    assert.equal(result.usage.input, 10); assert.equal(s.switches.length, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(s.call('consult_astra', { question: 'Plan?', context: 'Brief' }, controller.signal), /abort/i);
  });
  await test('clean read-only review passes, accounts all usage, and returns to Sol Medium', async root => {
    const s = setup(root); await s.command('');
    s.scripted([response([inspect()]), response([submit(cleanReport())])]);
    const out = await s.call('astra_verify', { action: 'start', packet: packet() });
    assert.equal(out.details.status, 'passed'); assert.equal(out.usage.totalTokens, 30);
    assert.equal(s.switches.at(-1), 'gpt-5.6-sol'); assert.equal(s.thinking(), 'medium');
    const [, context, options] = s.requests[0];
    assert.deepEqual(context.tools.map(t => t.name), ['review_inspect', 'review_submit']);
    assert.equal(options.reasoningEffort, 'high');
    assert.equal(out.details.inspected[0].path, 'src/main.ts');
    await assert.rejects(s.call('astra_verify', { action: 'start', packet: packet() }), /user/);
    await assert.rejects(s.call('astra_verify', { action: 'recheck', packet: packet() }), /needs_fixes/);
  });
  await test('blocker -> executor High -> corrected recheck -> Sol Medium', async root => {
    const s = setup(root); await s.command('');
    const p = { ...packet(), executor: 'luna' };
    s.scripted([response([inspect()]), response([submit(reportWith('open'))])]);
    const first = await s.call('astra_verify', { action: 'start', packet: p });
    assert.equal(first.details.status, 'needs_fixes'); assert.equal(s.switches.at(-1), 'gpt-5.6-luna'); assert.equal(s.thinking(), 'high');
    await writeFile(join(root, 'src/main.ts'), 'export const safe = true;\n');
    s.scripted([response([inspect()]), response([submit(reportWith('resolved'))])]);
    const next = await s.call('astra_verify', { action: 'recheck', packet: { ...p, resolutions: [{ id: 'A1', action: 'fixed', detail: 'Handled failure and reran test' }] } });
    assert.equal(next.details.status, 'passed'); assert.equal(next.details.round, 2); assert.equal(s.thinking(), 'medium');
  });
  await test('unchanged evidence exits without another model call', async root => {
    const s = setup(root); await s.command('');
    s.scripted([response([inspect()]), response([submit(reportWith('open'))])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    const n = s.requests.length;
    const out = await s.call('astra_verify', { action: 'recheck', packet: { ...packet(), resolutions: [{ id: 'A1', action: 'fixed', detail: 'Claimed a fix without changed evidence' }] } });
    assert.equal(out.details.status, 'incomplete'); assert.match(out.details.reason, /No changed/); assert.equal(s.requests.length, n);
    assert.equal(s.thinking(), 'medium');
  });
  await test('three-round hard limit and user-only reset', async root => {
    const s = setup(root); await s.command('');
    let out;
    for (let round = 1; round <= 3; round++) {
      await writeFile(join(root, 'src/main.ts'), `export const revision = ${round};\n`);
      s.scripted([response([inspect()]), response([submit(reportWith('open'))])]);
      out = await s.call('astra_verify', { action: round === 1 ? 'start' : 'recheck', packet: { ...packet(), resolutions: round === 1 ? [] : [{ id: 'A1', action: 'fixed', detail: 'Attempted correction' }] } });
    }
    assert.equal(out.details.round, 3); assert.equal(out.details.status, 'incomplete'); assert.match(out.details.reason, /exhausted/);
    await assert.rejects(s.call('astra_verify', { action: 'recheck', packet: packet() }), /rounds remaining/);
    await s.command('reset-review');
    s.scripted([response([inspect()]), response([submit(cleanReport())])]);
    assert.equal((await s.call('astra_verify', { action: 'start', packet: packet() })).details.round, 1);
  });
  await test('disagreement returns incomplete with executor response preserved', async root => {
    const s = setup(root); await s.command('');
    s.scripted([response([inspect()]), response([submit(reportWith('open'))])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    const out = await s.call('astra_verify', { action: 'recheck', packet: { ...packet(), tests: [{ command: 'new regression check', result: 'proves this requirement is already met' }], resolutions: [{ id: 'A1', action: 'disputed', detail: 'Invariant already holds; see regression check' }] } });
    assert.equal(out.details.status, 'incomplete'); assert.match(out.details.reason, /disputes/); assert.equal(out.details.packet.resolutions[0].action, 'disputed');
  });
  await test('missing evidence and follow-up classification cannot hide blockers', async () => {
    assert.equal(assess({ ...cleanReport(), evidenceGaps: ['Missing failure test'] }, null, 1).status, 'needs_fixes');
    assert.equal(assess({ ...cleanReport(), evidenceGaps: ['Missing failure test'] }, null, 3).status, 'incomplete');
    assert.equal(assess({ ...cleanReport(), findings: [{ ...blocker(), disposition: 'separate_task', status: 'deferred' }] }, null, 1).status, 'incomplete');
    assert.equal(assess({ ...cleanReport(), findings: [{ ...blocker(), severity: 'non_blocking', disposition: 'separate_task', status: 'deferred' }] }, null, 1).status, 'passed');
    assert.throws(() => assess(cleanReport(), reportWith('open'), 2), /omitted/);
    assert.throws(() => assess({ ...reportWith('open'), findings: [blocker(), blocker()] }, null, 1), /Duplicate/);
    assert.throws(() => parse(reportSchema, { summary: 'ok', findings: [{ ...blocker(), severity: 'tiny' }], evidenceGaps: [] }), /Invalid/);
  });
  await test('stale pass invalidated before synthesis', async root => {
    const s = setup(root); await s.command('');
    s.scripted([response([inspect()]), response([submit(cleanReport())])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    await writeFile(join(root, 'src/main.ts'), 'changed after review');
    const out = await s.call('advisor_route', { role: 'coordinator', reason: 'final' });
    assert.equal(out.details.review.status, 'incomplete'); assert.match(out.details.review.reason, /stale/);
  });
  await test('review-time mutation, provider failure and malformed output never pass', async root => {
    for (const final of ['mutation', 'error', 'malformed']) {
      const s = setup(root); await s.command('');
      s.scripted([response([inspect()]), async () => {
        if (final === 'mutation') await writeFile(join(root, 'src/main.ts'), 'mutation made during review');
        if (final === 'error') throw new Error('provider offline');
        return final === 'malformed' ? { ...response([]), content: [{ type: 'text', text: 'Looks good' }], stopReason: 'stop' } : response([submit(cleanReport())]);
      }]);
      const out = await s.call('astra_verify', { action: 'start', packet: packet() });
      assert.equal(out.details.status, 'incomplete'); assert.equal(s.thinking(), 'medium');
      assert.ok(out.usage.totalTokens >= 15);
    }
  });
  await test('cancellation unlocks busy state and records incomplete', async root => {
    const s = setup(root); await s.command('');
    const controller = new AbortController();
    s.complete(async () => { controller.abort(); return response([inspect()]); });
    const out = await s.call('astra_verify', { action: 'start', packet: packet() }, controller.signal);
    assert.equal(out.details.status, 'incomplete'); assert.match(out.details.reason, /cancelled/);
    await s.call('advisor_route', { role: 'coordinator', reason: 'cancelled' });
  });
  await test('interrupted persisted review stays incomplete after restore and retains round', async root => {
    const s = setup(root); await s.command('');
    s.scripted([response([inspect()]), response([submit(cleanReport())])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    const state = s.branch.find(e => e.customType === 'astra-advisor-review-v1').data;
    s.branch.push({ type: 'custom', customType: 'astra-advisor-review-v1', data: { ...state, status: 'reviewing', round: 2 } });
    s.hooks.session_start({}, s.ctx);
    await s.command('status'); assert.match(s.messages.at(-1).content, /incomplete.*round 2\/3/s);
  });
  await test('corrupt latest state requires explicit reset and reset survives reload', async root => {
    const s = setup(root); await s.command('');
    s.branch.push({ type: 'custom', customType: 'astra-advisor-review-v1', data: { status: 'passed' } });
    s.hooks.session_start({}, s.ctx);
    await assert.rejects(s.command(''), /state is invalid/);
    await s.command('reset-review'); await s.command('');
    s.hooks.session_start({}, s.ctx);
    await s.command('status'); assert.match(s.messages.at(-1).content, /active/); assert.match(s.messages.at(-1).content, /not run/);
  });
  await test('mixed batches cannot route or verify', async root => {
    const s = setup(root);
    s.branch.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall' }, { type: 'toolCall' }] } });
    for (const toolName of ['advisor_route', 'astra_verify']) assert.equal(s.hooks.tool_call({ toolName }, s.ctx).block, true);
  });
  await test('workspace paths block traversal, secrets, symlinks, binary and oversize reads', async root => {
    const workspace = await openWorkspace(root, 'none', new AbortController().signal);
    for (const path of ['../escape', '/etc/passwd', '.env', '.env.local', '.git/config', 'src/../secret', 'private.pem', 'src\\main.ts']) assert.throws(() => safeRelative(path));
    await symlink(join(root, 'src'), join(root, 'linked'));
    await assert.rejects(workspace.read('linked/main.ts', 1, 20), /Symlinks/);
    await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
    await assert.rejects(workspace.read('binary', 1, 20), /Binary/);
    await writeFile(join(root, 'large'), Buffer.alloc(1024 * 1024 + 1, 65));
    await assert.rejects(workspace.read('large', 1, 20), /1MiB/);
    assert.match(await workspace.read('src/main.ts', 1, 20), /safe/);
  });
  await test('reviewer rejects forbidden tools and malformed arguments without executing them', async root => {
    const s = setup(root); await s.command('');
    const forbidden = { type: 'toolCall', id: 'bad', name: 'bash', arguments: { command: 'touch forbidden-marker' } };
    s.scripted([response([forbidden]), response([inspect('read', '.env')]), response([inspect()]), response([submit(cleanReport())])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    assert.match(JSON.stringify(s.requests[1][1].messages), /Tool is not permitted/);
    assert.match(JSON.stringify(s.requests[2][1].messages), /excluded from Astra review/);
    await assert.rejects(readFile(join(root, 'forbidden-marker')), /ENOENT/);
  });
  await test('missing structured submission cannot exceed the model-response limit', async root => {
    const s = setup(root); await s.command('');
    s.complete(async () => response([inspect()]));
    const out = await s.call('astra_verify', { action: 'start', packet: packet() });
    assert.equal(out.details.status, 'incomplete'); assert.equal(s.requests.length, 12); assert.match(out.details.reason, /12-response/);
    assert.equal(out.usage.totalTokens, 180);
  });
  await test('read dependencies are freshness checked even outside the declared file list', async root => {
    await writeFile(join(root, 'contract.ts'), 'stable invariant');
    const s = setup(root); await s.command('');
    s.scripted([response([inspect('read', 'contract.ts'), inspect()]), response([submit(cleanReport())])]);
    await s.call('astra_verify', { action: 'start', packet: packet() });
    await writeFile(join(root, 'contract.ts'), 'different invariant');
    await s.command('status'); assert.match(s.messages.at(-1).content, /incomplete.*stale/s);
  });
  await test('fixed Git commands inspect staged/unstaged/untracked evidence without external diff execution', async root => {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    git('add', '.'); git('commit', '-qm', 'baseline');
    git('config', 'diff.external', 'touch SHOULD_NOT_EXIST');
    await writeFile(join(root, 'src/main.ts'), 'staged change'); git('add', '.');
    await writeFile(join(root, 'src/main.ts'), 'unstaged change');
    await writeFile(join(root, 'new-file.ts'), 'new file');
    await assert.rejects(openWorkspace(root, 'none', new AbortController().signal), /Git workspace/);
    const workspace = await openWorkspace(root, 'HEAD', new AbortController().signal);
    assert.match(workspace.base, /^[a-f0-9]{40}$/);
    assert.deepEqual(await workspace.changed(), ['new-file.ts', 'src/main.ts']);
    assert.match(await workspace.diff('src/main.ts'), /unstaged change/);
    await assert.rejects(readFile(join(root, 'SHOULD_NOT_EXIST')), /ENOENT/);
    const before = await workspace.snapshot(['src/main.ts']);
    await writeFile(join(root, 'new-file.ts'), 'changed untracked file');
    assert.notEqual((await workspace.snapshot(['src/main.ts'])).fingerprint, before.fingerprint);
  });
  return passed;
}
