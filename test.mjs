import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import astraAdvisor from './index.ts';
import { assess, parse, reportSchema } from './contracts.ts';
import { openWorkspace } from './workspace.ts';
import { emptyUsage, ReviewerTools } from './reviewer.ts';
import { closeTmux } from './tmux.ts';
import { classifyGithub, GithubClient, githubSchema } from './github.ts';
import { command } from './process.ts';

const A = 'a'.repeat(40), B = 'b'.repeat(40), BASE = 'c'.repeat(40);
const bot = { login: 'chatgpt-codex-connector[bot]', type: 'Bot' };
const user = { login: 'owner', type: 'User' };
const at = '2026-09-06T10:00:00Z', later = '2026-09-06T10:01:00Z';
const clean = () => ({ summary: 'No blocking findings.', findings: [], evidenceGaps: [] });
const finding = status => ({ id: 'A1', severity: 'blocking', disposition: 'fix_now', status, title: 'Unsafe failure path', evidence: 'src/main.ts returns unsafe', resolution: 'Handle failure and test it' });
const report = status => ({ summary: 'Failure-path review', findings: [finding(status)], evidenceGaps: [] });
const packet = () => ({ goal: 'Handle failure safely', invariants: ['Return safe error'], files: ['src/main.ts'], base: 'none', diffSummary: 'Changed handling', tests: [{ command: 'test command', result: '1 passed (executor reported)' }], limitations: ['Fixture has no Git baseline'], restrictions: 'Read-only reviewer; no secrets or deployment.', risk: ['lifecycle'], resolutions: [] });
const remoteState = () => ({ version: 1, reviewId: '01999999-9999-7999-8999-999999999999', root: '/fixture', repository: 'owner/repo', baseBranch: 'main', baseSha: BASE, branch: 'feature', head: A, previousHead: null, phase: 'awaiting_review', pr: 3, author: 'owner', requestId: 7, requestAt: at, reason: 'Waiting', feedback: [] });
function setup(root) {
  const hooks = {}, tools = {}, commands = {}, branch = [], switches = [], messages = [], prompts = [];
  let thinking;
  const ctx = { cwd: root, hasUI: false, abort() {}, waitForIdle: async () => {}, sessionManager: { getBranch: () => branch }, modelRegistry: { find: (provider, id) => ({ provider, id }), hasConfiguredAuth: () => true, complete: async () => ({ role: 'assistant', content: [{ type: 'text', text: 'Planning advice' }], usage: emptyUsage(), stopReason: 'stop' }) } };
  astraAdvisor({ on: (name, handler) => { hooks[name] = handler; }, registerTool: tool => { tools[tool.name] = tool; }, registerCommand: (name, handler) => { commands[name] = handler; }, setModel: async model => { switches.push(model.id); return true; }, setThinkingLevel: level => { thinking = level; }, getThinkingLevel: () => thinking, appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data: structuredClone(data) }), sendMessage: message => messages.push(message), sendUserMessage: prompt => prompts.push(prompt) });
  return { hooks, tools, ctx, branch, switches, messages, prompts, thinking: () => thinking, command: args => commands['astra-advisor'].handler(args, ctx), call: (name, args, signal) => tools[name].execute('id', args, signal, undefined, ctx), review: () => branch.findLast(e => e.customType === 'astra-advisor-review-v2')?.data, github: () => branch.findLast(e => e.customType === 'astra-advisor-github-v1')?.data };
}
async function fakePi(root) {
  const dir = join(root, 'bin'); await mkdir(dir);
  const script = `#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const args=process.argv.slice(2),jobPath=args[args.indexOf('--astra-review-job')+1],job=JSON.parse(fs.readFileSync(jobPath,'utf8')),dir=path.dirname(jobPath),session=args[args.indexOf('--session')+1];
fs.appendFileSync(session,JSON.stringify({round:job.round,args})+'\\n');
if(fs.readFileSync(path.join(job.root,'src/main.ts'),'utf8').includes('hang')){setInterval(()=>{},1000);}else{
const unsafe=fs.readFileSync(path.join(job.root,'src/main.ts'),'utf8').includes('unsafe');
const previous=job.previous?.findings??[];
const findings=unsafe?[${JSON.stringify(finding('open'))}]:previous.map(f=>({...f,status:'resolved'}));
const out={jobId:job.jobId,report:{summary:'Fixture review',findings,evidenceGaps:[]},fingerprint:job.fingerprint,inspected:[],usage:${JSON.stringify(emptyUsage())}};
fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(out));
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'fixture complete'}]}}));
}
`;
  await writeFile(join(dir, 'pi'), script); await chmod(join(dir, 'pi'), 0o700);
  return dir;
}
export async function runTests() {
  const passed = [];
  async function test(name, run) {
    const root = await mkdtemp(join(tmpdir(), 'astra-pipeline-test-'));
    const originalPath = process.env.PATH;
    const owned = [];
    try { await mkdir(join(root, 'src')); await writeFile(join(root, 'src/main.ts'), 'safe'); await run(root, owned); passed.push(name); }
    finally {
      process.env.PATH = originalPath;
      for (const state of owned) if (state?.tmux) await closeTmux(state).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  }
  await test('activation, task forwarding, plain GUI marker and non-triggering examples', async root => {
    const s = setup(root); await s.command(''); assert.match(s.messages.at(-1).content, /Astra Advisor active/);
    await s.command('Fix tests'); assert.deepEqual(s.prompts, ['Fix tests']); await s.command('off'); await s.command('status'); assert.match(s.messages.at(-1).content, /inactive/);
    for (const prompt of ['Use /astra-advisor to fix tests', '/astra-advisor fix tests']) { const s = setup(root); const out = await s.hooks.before_agent_start({ prompt, systemPrompt: 'Preserve restrictions' }, s.ctx); assert.match(out.message.content, /Astra Advisor active/); assert.match(out.systemPrompt, /^Preserve restrictions/); }
    for (const prompt of ['Explain /astra-advisor', 'Use /astra-advisor-other', '```\n/astra-advisor\n```', '> Use /astra-advisor']) { const s = setup(root); await s.hooks.before_agent_start({ prompt, systemPrompt: '' }, s.ctx); assert.deepEqual(s.switches, []); }
  });
  await test('legacy and corrupt state cannot authorize publication; explicit reset survives restore', async root => {
    const s = setup(root); await s.command(''); s.branch.push({ type: 'custom', customType: 'astra-advisor-review-v1', data: { status: 'passed' } }); s.hooks.session_start({}, s.ctx);
    await assert.rejects(s.command(''), /reset-review/); await s.command('reset-review'); await s.command(''); s.hooks.session_start({}, s.ctx); await s.command('status'); assert.match(s.messages.at(-1).content, /active/); assert.match(s.messages.at(-1).content, /not run/);
    s.branch.push({ type: 'custom', customType: 'astra-advisor-github-v1', data: { phase: 'clean' } }); s.hooks.session_start({}, s.ctx); await assert.rejects(s.command(''), /reset-review/);
  });
  await test('planning remains tool-free Astra High and does not change main model', async root => {
    const s = setup(root); await s.command(''); s.ctx.modelRegistry.complete = async (model, context, options) => { assert.equal(model.id, 'gpt-6-astra'); assert.equal(context.tools, undefined); assert.equal(context.messages.length, 1); assert.equal(options.reasoningEffort, 'high'); return { content: [{ type: 'text', text: 'Advice' }], usage: emptyUsage(), stopReason: 'stop' }; };
    await s.call('consult_astra', { question: 'Plan?', context: 'No secrets' }); assert.equal(s.switches.length, 1);
    const abort = new AbortController(); abort.abort(); await assert.rejects(s.call('consult_astra', { question: 'Plan?', context: 'Brief' }, abort.signal));
  });
  await test('review assessment retains findings, permits more than three rounds, and does not defer blockers into a pass', async () => {
    assert.equal(assess(report('open'), null).status, 'needs_fixes'); assert.equal(assess(report('resolved'), report('open')).status, 'passed');
    assert.throws(() => assess(clean(), report('open')), /omitted/);
    assert.throws(() => assess({ ...report('open'), findings: [finding('open'), finding('open')] }, null), /Duplicate/);
    assert.equal(assess({ ...clean(), evidenceGaps: ['Missing test'] }, null).status, 'needs_fixes');
    assert.equal(assess({ ...report('open'), findings: [{ ...finding('deferred'), disposition: 'separate_task' }] }, null).status, 'incomplete');
    assert.equal(assess({ ...report('open'), findings: [{ ...finding('deferred'), severity: 'non_blocking', disposition: 'separate_task' }] }, null).status, 'passed');
    assert.throws(() => parse(reportSchema, { ...clean(), findings: [{ ...finding('open'), severity: 'tiny' }] }));
  });
  await test('private reviewer denies traversal, symlinks, binary/oversized files, invalid operations and unsupported reports', async root => {
    const w = await openWorkspace(root, 'none', new AbortController().signal); const tools = new ReviewerTools(w);
    const input = path => ({ operation: 'read', path, query: '', offset: 1, limit: 300 });
    assert.throws(() => tools.report(clean()), /Inspect actual/);
    for (const path of ['../escape', '/etc/passwd', '.env', '.git/config', '.pi/auth.json', 'private.pem']) await assert.rejects(tools.inspect(input(path)));
    await symlink(join(root, 'src'), join(root, 'linked')); await assert.rejects(tools.inspect(input('linked/main.ts')), /Symlinks/);
    await writeFile(join(root, 'binary'), Buffer.from([0, 1])); await assert.rejects(tools.inspect(input('binary')), /Binary/);
    await writeFile(join(root, 'large'), Buffer.alloc(1048577, 65)); await assert.rejects(tools.inspect(input('large')), /1MiB/);
    await assert.rejects(tools.inspect({ ...input('src/main.ts'), operation: 'bash' }));
    await tools.inspect(input('src/main.ts')); assert.deepEqual(tools.report(clean()), clean());
  });
  await test('real tmux lifecycle preserves one session file across four correction rounds and fixes route to Sol High', async (root, owned) => {
    process.env.PATH = `${await fakePi(root)}:${process.env.PATH}`;
    const s = setup(root); await s.command(''); let descriptor;
    for (let round = 1; round <= 4; round++) {
      await writeFile(join(root, 'src/main.ts'), round < 4 ? `unsafe revision ${round}` : 'safe');
      await s.call('astra_verify', { action: round === 1 ? 'start' : 'recheck', packet: { ...packet(), resolutions: round === 1 ? [] : [{ id: 'A1', action: 'fixed', detail: 'Corrected and reran tests' }] } });
      owned.push(s.review());
      if (descriptor) { assert.equal(s.review().tmux.sessionFile, descriptor.sessionFile); assert.equal(s.review().tmux.name, descriptor.name); }
      descriptor = s.review().tmux;
      const result = await s.call('astra_review_wait', { seconds: 15 });
      assert.equal(result.details.review.status, round < 4 ? 'needs_fixes' : 'passed'); assert.equal(s.thinking(), round < 4 ? 'high' : 'medium'); assert.equal(s.switches.at(-1), 'gpt-5.6-sol');
    }
    const lines = (await readFile(descriptor.sessionFile, 'utf8')).trim().split('\n').map(JSON.parse); assert.equal(lines.length, 4);
    for (const line of lines) { assert.equal(line.args[line.args.indexOf('--thinking') + 1], 'medium'); assert.ok(line.args.includes('--no-extensions')); assert.ok(line.args.includes('--no-context-files')); assert.equal(line.args[line.args.indexOf('--tools') + 1], 'review_inspect,review_submit'); assert.ok(!line.args.includes('--no-session')); }
  });
  await test('unchanged evidence pauses without launching another tmux round', async (root, owned) => {
    process.env.PATH = `${await fakePi(root)}:${process.env.PATH}`; await writeFile(join(root, 'src/main.ts'), 'unsafe');
    const s = setup(root); await s.command(''); await s.call('astra_verify', { action: 'start', packet: packet() }); owned.push(s.review()); await s.call('astra_review_wait', { seconds: 15 }); const before = s.review().tmux.jobId;
    await s.call('astra_verify', { action: 'recheck', packet: { ...packet(), resolutions: [{ id: 'A1', action: 'fixed', detail: 'No actual change' }] } }); assert.equal(s.review().status, 'incomplete'); assert.equal(s.review().tmux.jobId, before);
  });
  await test('cancellation terminates the owned tmux job without granting approval', async (root, owned) => {
    process.env.PATH = `${await fakePi(root)}:${process.env.PATH}`; await writeFile(join(root, 'src/main.ts'), 'hang');
    const s = setup(root); await s.command(''); await s.call('astra_verify', { action: 'start', packet: packet() }); owned.push(s.review());
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 200);
    try { await s.call('astra_review_wait', { seconds: 15 }, abort.signal); } finally { clearTimeout(timer); }
    assert.equal(s.review().status, 'incomplete');
  });
  await test('stale local approval and mismatched report nonce are rejected', async (root, owned) => {
    process.env.PATH = `${await fakePi(root)}:${process.env.PATH}`; const s = setup(root); await s.command('');
    await s.call('astra_verify', { action: 'start', packet: packet() }); owned.push(s.review()); await s.call('astra_review_wait', { seconds: 15 });
    const reportPath = join(s.review().tmux.jobDirectory, 'report.json');
    const output = JSON.parse(await readFile(reportPath, 'utf8')); await writeFile(reportPath, JSON.stringify({ ...output, jobId: 'wrong-job' }));
    s.branch.push({ type: 'custom', customType: 'astra-advisor-review-v2', data: { ...s.review(), status: 'reviewing' } }); s.hooks.session_start({}, s.ctx);
    await s.call('astra_review_wait', { seconds: 0 }); assert.match(s.review().reason, /mismatched/); assert.equal(s.review().status, 'incomplete');
    await s.command('reset-review'); await s.call('astra_verify', { action: 'start', packet: packet() }); owned.push(s.review()); await s.call('astra_review_wait', { seconds: 15 });
    await writeFile(join(root, 'src/main.ts'), 'changed'); await s.call('advisor_route', { role: 'coordinator', reason: 'final' }); assert.equal(s.review().status, 'incomplete');
  });
  await test('only trusted commit-bound clean feedback or request thumbs-up counts as clean', async () => {
    const s = remoteState(); const body = `Codex Review: Didn't find any major issues. Breezy!\n\n**Reviewed commit:** \`${A.slice(0, 10)}\``;
    const comment = { id: 10, user: bot, body, created_at: later };
    assert.equal(classifyGithub(s, [], [comment], [], []).phase, 'clean');
    assert.equal(classifyGithub(s, [], [{ ...comment, user }], [], []).phase, 'awaiting_review');
    assert.equal(classifyGithub(s, [], [{ ...comment, created_at: '2026-01-01T00:00:00Z' }], [], []).phase, 'awaiting_review');
    assert.equal(classifyGithub(s, [], [{ ...comment, body: body.replace(A.slice(0,10), B.slice(0,10)) }], [], []).phase, 'awaiting_review');
    for (const content of ['eyes', 'heart', '+1']) assert.equal(classifyGithub(s, [], [], [], [{ user: bot, content, created_at: later }]).phase, content === '+1' ? 'clean' : 'awaiting_review');
    assert.equal(classifyGithub(s, [], [{ ...comment, body: 'Codex Review Summary: Completed' }], [], []).phase, 'awaiting_review');
  });
  await test('findings beat clean signals and old-commit reviews cannot be used', async () => {
    const s = remoteState(); const review = { id: 4, user: bot, commit_id: A, state: 'COMMENTED', body: 'Suggestions', submitted_at: later };
    const inline = { id: 5, user: bot, original_commit_id: A, pull_request_review_id: 4, created_at: later, body: 'Fix this failure path' };
    const out = classifyGithub(s, [review], [], [inline], [{ user: bot, content: '+1', created_at: later }]); assert.equal(out.phase, 'needs_fixes'); assert.equal(out.feedback[0].id, 'comment-5');
    assert.equal(classifyGithub(s, [{ ...review, commit_id: B }], [], [inline], []).phase, 'awaiting_review');
    assert.equal(classifyGithub(s, [{ ...review, state: 'CHANGES_REQUESTED' }], [], [], []).phase, 'needs_fixes');
  });
  await test('GitHub API failures, pagination bounds and changed heads never imply approval', async root => {
    const failing = new GithubClient(root, new AbortController().signal, async () => { throw new Error('offline'); }); await assert.rejects(failing.poll(remoteState()), /offline/);
    const client = new GithubClient(root, new AbortController().signal, async () => JSON.stringify(Array.from({length:100}, () => ({ id: 1 }))));
    const { Type } = await import('typebox'); await assert.rejects(client.list('items', Type.Object({id:Type.Integer()})), /pagination/);
    const changed = new GithubClient(root, new AbortController().signal, async (binary, args) => binary === 'git' ? args.includes('HEAD') ? A : 'feature' : JSON.stringify({ number:3,state:'open',head:{sha:B,ref:'feature',repo:{full_name:'owner/repo'}},base:{sha:BASE,ref:'main'} }));
    assert.equal((await changed.poll(remoteState())).phase, 'paused');
  });
  await test('fixed Git inspection ignores hostile external diff configuration', async root => {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio:['ignore','pipe','pipe'] });
    git('init','-q'); git('config','user.name','Test'); git('config','user.email','test@example.invalid'); git('add','.'); git('commit','-qm','baseline'); git('config','diff.external','touch SHOULD_NOT_EXIST');
    await writeFile(join(root,'src/main.ts'),'changed'); const w = await openWorkspace(root,'HEAD',new AbortController().signal); assert.match(await w.diff('src/main.ts'),/changed/); await assert.rejects(readFile(join(root,'SHOULD_NOT_EXIST')),/ENOENT/); await assert.rejects(openWorkspace(root,'none',new AbortController().signal),/Git workspace/);
  });
  await test('publication is retry-safe, never force-pushes and preserves one request per head', async root => {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
    git('init','-q','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.invalid'); git('add','.'); git('commit','-qm','base'); const baseSha=git('rev-parse','HEAD'); git('switch','-qc','feature'); await writeFile(join(root,'src/main.ts'),'new safe'); git('add','.'); git('commit','-qm','fix'); const head=git('rev-parse','HEAD'); git('remote','add','origin','https://github.com/owner/repo.git');
    let pr=null, posts=0, creates=0; const comments=[]; const pushArgs=[];
    const run=async (binary,args,cwd,signal,input='') => {
      if(binary==='git'){ if(args[0]==='push'){pushArgs.push(args); return '';} if(args[0]==='ls-remote')return `${head}\trefs/heads/feature`; return command(binary,args,cwd,signal,input); }
      const method=args[2], endpoint=args[3], body=input?JSON.parse(input):null;
      if(endpoint==='user')return JSON.stringify({login:'owner'});
      if(endpoint==='repos/owner/repo')return JSON.stringify({full_name:'owner/repo',default_branch:'main'});
      if(endpoint.includes('/commits/'))return JSON.stringify({sha:baseSha});
      if(endpoint.startsWith('repos/owner/repo/pulls?'))return JSON.stringify(pr?[pr]:[]);
      if(endpoint==='repos/owner/repo/pulls'&&method==='POST'){creates++;pr={number:3,state:'open',head:{sha:head,ref:'feature',repo:{full_name:'owner/repo'}},base:{sha:baseSha,ref:'main'}};return JSON.stringify(pr);}
      if(endpoint==='repos/owner/repo/pulls/3')return JSON.stringify(pr);
      if(endpoint.includes('/issues/3/comments')){if(method==='POST'){posts++;const c={id:7,user,body:body.body,created_at:at};comments.push(c);return JSON.stringify(c);}return JSON.stringify(comments);}
      throw new Error('Unexpected API operation '+endpoint);
    };
    const client=new GithubClient(root,new AbortController().signal,run), input={repository:'owner/repo',baseBranch:'main',title:'Fix failure',body:'Verified change'};
    const identity=await client.identity(input); assert.equal(identity.head,head);
    let saved={...remoteState(),root,head,baseSha,phase:'publishing',pr:null,requestId:null,requestAt:null}; parse(githubSchema,saved);
    saved=await client.publish(input,saved,s=>{saved=s;});
    const retry={...saved,phase:'publishing',requestId:null,requestAt:null}; await client.publish(input,retry,s=>{saved=s;});
    assert.equal(posts,1);assert.equal(creates,1);assert.ok(pushArgs.every(args=>!args.some(a=>a.includes('force'))));assert.equal(saved.phase,'awaiting_review');
    git('switch','-q','main');await assert.rejects(client.identity(input),/feature branch/);
  });
  await test('binary artifacts are fingerprinted but not disclosed as text; deletion differs from the absent sentinel', async root => {
    const w = await openWorkspace(root, 'none', new AbortController().signal);
    await writeFile(join(root, 'artifact.pdf'), Buffer.from([0, 1, 2]));
    const first = await w.snapshot(['artifact.pdf']); assert.deepEqual(first.excluded, []); await assert.rejects(w.read('artifact.pdf', 1, 10), /Binary/);
    await writeFile(join(root, 'artifact.pdf'), Buffer.from([0, 1, 3])); assert.notEqual((await w.snapshot(['artifact.pdf'])).fingerprint, first.fingerprint);
    const absent = await w.snapshot(['missing']); await writeFile(join(root, 'missing'), '[FILE ABSENT]'); assert.notEqual((await w.snapshot(['missing'])).fingerprint, absent.fingerprint);
    await writeFile(join(root, 'src/main.ts'), 'const marker = "[FILE ABSENT]";'); await new ReviewerTools(w).inspect({ operation: 'read', path: 'src/main.ts', query: '', offset: 1, limit: 300 });
  });
  await test('live-shaped REST reactions pass through poll; exact-request association and findings dominate', async root => {
    const state = remoteState();
    const pr = {number:3,state:'open',head:{sha:A,ref:'feature',repo:{full_name:'owner/repo'}},base:{sha:BASE,ref:'main'}};
    const request = {id:7,user,created_at:at,body:`@codex review\n\nPlease review commit \`${A}\`.\n\n<!-- astra-advisor-review:${state.reviewId}:${A} -->`};
    let reaction = {id:123,node_id:'fixture',user:bot,content:'eyes',created_at:later}, inline = [], reviews = [], edited = false;
    const run = async(binary,args) => {
      if(binary==='git')return args[0]==='status'?'':args[0]==='symbolic-ref'?'feature':A;
      const endpoint=args[3];
      if(endpoint.includes('/reactions'))return JSON.stringify([reaction]);
      if(endpoint.includes('/reviews?'))return JSON.stringify(reviews);
      if(endpoint.includes('/issues/3/comments'))return JSON.stringify([{...request,body:edited?'edited request':request.body}]);
      if(endpoint.includes('/pulls/3/comments'))return JSON.stringify(inline);
      return JSON.stringify(pr);
    };
    const client = new GithubClient(root,new AbortController().signal,run);
    assert.equal((await client.poll(state)).phase,'awaiting_review');
    reaction={...reaction,content:'+1'};assert.equal((await client.poll(state)).phase,'clean');
    edited=true;assert.equal((await client.poll(state)).phase,'paused');edited=false;
    reviews=[{id:4,user:bot,commit_id:A,state:'COMMENTED',body:'Suggestions',submitted_at:later}];
    inline=[{id:5,user:bot,original_commit_id:A,pull_request_review_id:4,created_at:later,body:'Fix current bug'}];
    assert.equal((await client.poll(state)).phase,'needs_fixes');
  });
  await test('committing reviewed bytes preserves clearance; executable-only commits invalidate first publication and dependency evidence', async(root,owned)=>{
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    await writeFile(join(root,'run.sh'),'echo original\n');await chmod(join(root,'run.sh'),0o755);git('add','.');git('commit','-qm','baseline');git('switch','-qc','feature');
    await writeFile(join(root,'run.sh'),'echo reviewed\n');process.env.PATH=`${await fakePi(root)}:${process.env.PATH}`;
    const s=setup(root);await s.command('');await s.call('astra_verify',{action:'start',packet:{...packet(),base:'HEAD',files:['src/main.ts','run.sh']}});owned.push(s.review());await s.call('astra_review_wait',{seconds:15});assert.equal(s.review().status,'passed');
    git('add','.');git('commit','-qm','reviewed change');await s.call('advisor_route',{role:'coordinator',reason:'Check post-commit freshness'});assert.equal(s.review().status,'passed');
    const w=await openWorkspace(root,s.review().base,new AbortController().signal);await w.read('run.sh',1,10);assert.equal(await w.unchanged(),true);
    await chmod(join(root,'run.sh'),0o644);git('add','run.sh');git('commit','-qm','unreviewed mode change');assert.equal(await w.unchanged(),false);
    await assert.rejects(s.call('advisor_publish',{repository:'owner/repo',baseBranch:'main',title:'Fix',body:'Test'}),/fresh clean/);assert.equal(s.review().status,'incomplete');
  });
  await test('all pipeline operations require isolated tool batches', async root => {
    const s=setup(root);s.branch.push({type:'message',message:{role:'assistant',content:[{type:'toolCall'},{type:'toolCall'}]}});
    for(const toolName of ['advisor_route','astra_verify','astra_review_wait','advisor_publish','advisor_github_wait'])assert.equal(s.hooks.tool_call({toolName},s.ctx).block,true);
  });
  return passed;
}
