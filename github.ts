import { Type, type Static, type TSchema } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { object, parse, text } from "./contracts.ts";
import { command, delay } from "./process.ts";
import { realpath } from "node:fs/promises";

const repoName = Type.String({ pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" });
const sha = Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" });
export const publishSchema = object({ repository: repoName, baseBranch: text(200), title: text(200), body: text(40000) });
export const githubSchema = object({
  version: Type.Literal(1), reviewId: text(100), root: text(4000), repository: repoName, baseBranch: text(200), baseSha: sha, branch: text(200), head: sha, previousHead: Type.Union([sha, Type.Null()]),
  phase: StringEnum(["publishing", "awaiting_review", "needs_fixes", "clean", "paused"] as const),
  pr: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), author: text(200),
  requestId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), requestAt: Type.Union([text(100), Type.Null()]),
  reason: text(4000), feedback: Type.Array(object({ id: text(100), url: text(1000), body: text(4000) }), { maxItems: 100 }),
});
export type GithubState = Static<typeof githubSchema>;
export type PublishInput = Static<typeof publishSchema>;
const userSchema = Type.Object({ login: Type.String(), type: Type.String() });
const reviewSchema = Type.Object({ id: Type.Integer(), user: userSchema, commit_id: Type.String(), state: Type.String(), body: Type.String(), submitted_at: Type.String() });
const commentSchema = Type.Object({ id: Type.Integer(), user: userSchema, body: Type.String(), created_at: Type.String() });
const inlineSchema = Type.Object({ id: Type.Integer(), user: userSchema, body: Type.String(), created_at: Type.String(), pull_request_review_id: Type.Integer(), original_commit_id: Type.String() });
const reactionSchema = Type.Object({ user: userSchema, content: Type.String(), created_at: Type.String() });
const prSchema = Type.Object({ number: Type.Integer(), state: Type.String(), head: Type.Object({ sha, ref: Type.String(), repo: Type.Object({ full_name: Type.String() }) }), base: Type.Object({ sha, ref: Type.String() }) });
const repositorySchema = Type.Object({ full_name: Type.String(), default_branch: Type.String() });
const requestBody = (state: GithubState) => `@codex review\n\nPlease review commit \`${state.head}\`.\n\n<!-- astra-advisor-review:${state.reviewId}:${state.head} -->`;
const bot = (user: Static<typeof userSchema>) => user.login === "chatgpt-codex-connector[bot]" && user.type === "Bot";
const after = (date: string, boundary: string) => Number.isFinite(Date.parse(date)) && Date.parse(date) >= Date.parse(boundary);
const cleanText = (body: string, head: string) => {
  const prefix = /^Codex Review:\s*Didn't find any major issues\./i.test(body.trimStart());
  const commit = /\*\*Reviewed commit:\*\*\s*`([a-f0-9]{7,64})`/i.exec(body)?.[1];
  return prefix && !!commit && head.startsWith(commit);
};
export function classifyGithub(state: GithubState, reviews: Static<typeof reviewSchema>[], comments: Static<typeof commentSchema>[], inline: Static<typeof inlineSchema>[], reactions: Static<typeof reactionSchema>[]): Pick<GithubState, "phase" | "reason" | "feedback"> {
  if (!state.requestId || !state.requestAt) return { phase: "paused", reason: "No recorded review request; cannot infer approval.", feedback: [] };
  const currentReviews = reviews.filter(r => bot(r.user) && r.commit_id === state.head && after(r.submitted_at, state.requestAt!));
  const reviewIds = new Set(currentReviews.map(r => r.id));
  const findings = inline.filter(c => bot(c.user) && c.original_commit_id === state.head && reviewIds.has(c.pull_request_review_id));
  const changes = currentReviews.filter(r => r.state === "CHANGES_REQUESTED");
  if (findings.length || changes.length) {
    if (findings.length + changes.length > 100) throw new Error("More than 100 findings; manual review required rather than truncating a clean decision.");
    return { phase: "needs_fixes", reason: "Codex reported findings for the requested commit. Sol High should inspect them, fix confirmed issues, test, commit and republish for another review.", feedback: [
      ...findings.map(c => ({ id: `comment-${c.id}`, url: `https://github.com/${state.repository}/pull/${state.pr}#discussion_r${c.id}`, body: c.body.slice(0, 4000) || "Empty inline comment; inspect its link." })),
      ...changes.map(r => ({ id: `review-${r.id}`, url: `https://github.com/${state.repository}/pull/${state.pr}#pullrequestreview-${r.id}`, body: r.body.slice(0, 4000) || "Changes requested; inspect the review." })),
    ] };
  }
  const failed = comments.find(c => bot(c.user) && after(c.created_at, state.requestAt!) && /^(?:Codex|You have reached|You've reached)[\s\S]{0,150}(?:usage limit|unable to review|rate limit|not configured)/i.test(c.body));
  if (failed) return { phase: "paused", reason: "Codex reported an availability/usage problem. No approval is inferred; inspect GitHub and retry waiting after resolving it.", feedback: [{ id: `issue-${failed.id}`, url: `https://github.com/${state.repository}/pull/${state.pr}#issuecomment-${failed.id}`, body: failed.body.slice(0, 4000) }] };
  const thumbsUp = reactions.some(r => bot(r.user) && r.content === "+1" && after(r.created_at, state.requestAt!));
  const explicit = comments.some(c => bot(c.user) && after(c.created_at, state.requestAt!) && cleanText(c.body, state.head));
  if (thumbsUp || explicit) return { phase: "clean", reason: `Codex explicitly reported no major findings for ${state.head}. This is review evidence, not authorization to merge.`, feedback: [] };
  return { phase: "awaiting_review", reason: "Waiting for an explicit Codex clean result or findings for the requested commit. No response, a completed summary, or an eyes reaction is not approval.", feedback: [] };
}

export class GithubClient {
  constructor(readonly root: string, readonly signal: AbortSignal, readonly run: typeof command) {}
  async api<T extends TSchema>(endpoint: string, schema: T, method = "GET", input: object | null = null): Promise<Static<T>> {
    const args = ["api", "--method", method, endpoint];
    if (input) args.push("--input", "-");
    return parse(schema, JSON.parse(await this.run("gh", args, this.root, this.signal, input ? JSON.stringify(input) : "")));
  }
  async list<T extends TSchema>(endpoint: string, schema: T): Promise<Static<T>[]> {
    const values: Static<T>[] = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await this.api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`, Type.Array(schema));
      values.push(...rows);
      if (rows.length < 100) return values;
    }
    throw new Error("GitHub pagination limit reached; cannot establish a complete review snapshot.");
  }
  async git(args: string[]) { return (await this.run("git", args, this.root, this.signal)).trim(); }
  async identity(input: PublishInput) {
    if (await realpath(await this.git(["rev-parse", "--show-toplevel"])) !== await realpath(this.root)) throw new Error("Publication requires the repository root as the workspace.");
    const repository = await this.api(`repos/${input.repository}`, repositorySchema);
    if (repository.full_name.toLowerCase() !== input.repository.toLowerCase()) throw new Error("Repository identity mismatch.");
    for (const args of [["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
      const remote = await this.git(args);
      const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
      if (!match || match[1].toLowerCase() !== input.repository.toLowerCase()) throw new Error("Origin fetch/push URLs must name the explicit github.com repository; no alternate or multiple push targets.");
    }
    const branch = await this.git(["symbolic-ref", "--short", "HEAD"]);
    if ([input.baseBranch, repository.default_branch, "main", "master"].includes(branch)) throw new Error("Publish from a feature branch, never the default/base branch.");
    await this.git(["check-ref-format", "--branch", branch]);
    await this.git(["check-ref-format", "--branch", input.baseBranch]);
    if (await this.git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Commit the intended changes first; publication never stages files or includes a dirty worktree.");
    const head = await this.git(["rev-parse", "HEAD"]);
    const base = await this.api(`repos/${input.repository}/commits/${encodeURIComponent(input.baseBranch)}`, Type.Object({ sha }));
    const author = await this.api("user", Type.Object({ login: text(200) }));
    return { branch, head, baseSha: base.sha, author: author.login };
  }
  async publish(input: PublishInput, initial: GithubState, save: (state: GithubState) => void): Promise<GithubState> {
    let state = initial;
    const stable = async () => {
      const actual = await this.identity(input);
      if (actual.branch !== state.branch || actual.head !== state.head || actual.baseSha !== state.baseSha || actual.author !== state.author) throw new Error("Local/remote publication identity changed; stop rather than publishing different evidence.");
    };
    await stable();
    if (state.pr) {
      const existing = await this.api(`repos/${state.repository}/pulls/${state.pr}`, prSchema);
      if (existing.state !== "open" || existing.head.ref !== state.branch || existing.head.repo.full_name.toLowerCase() !== state.repository.toLowerCase() || existing.base.ref !== state.baseBranch || existing.base.sha !== state.baseSha) throw new Error("PR target or base changed; user decision required.");
      if (state.previousHead && ![state.previousHead, state.head].includes(existing.head.sha)) throw new Error("Remote PR head changed outside this publication; refusing to overwrite it.");
      const remote = await this.git(["ls-remote", "origin", `refs/heads/${state.branch}`]);
      const old = remote.split(/\s/)[0];
      if (state.previousHead && old !== state.previousHead && old !== state.head) throw new Error("Remote branch changed outside this publication.");
      if (old && old !== state.head) await this.git(["merge-base", "--is-ancestor", old, state.head]);
    }
    await this.git(["push", "origin", `${state.head}:refs/heads/${state.branch}`]);
    await stable();
    const body = input.body.includes("> AGENT GENERATED") ? input.body : `${input.body}\n\n> AGENT GENERATED`;
    if (!state.pr) {
      const owner = state.repository.split("/")[0];
      const matches = await this.list(`repos/${state.repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${state.branch}`)}&base=${encodeURIComponent(state.baseBranch)}`, prSchema);
      if (matches.length > 1) throw new Error("Multiple matching PRs; user decision required.");
      const pr = matches[0] ?? await this.api(`repos/${state.repository}/pulls`, prSchema, "POST", { title: input.title, body, head: state.branch, base: state.baseBranch });
      state = { ...state, pr: pr.number }; save(state);
    }
    const pr = await this.api(`repos/${state.repository}/pulls/${state.pr}`, prSchema, "PATCH", { title: input.title, body });
    if (pr.head.sha !== state.head || pr.head.ref !== state.branch || pr.head.repo.full_name.toLowerCase() !== state.repository.toLowerCase() || pr.base.ref !== state.baseBranch || pr.base.sha !== state.baseSha || pr.state !== "open") throw new Error("PR does not match the reviewed publication target.");
    const marker = `<!-- astra-advisor-review:${state.reviewId}:${state.head} -->`;
    const existing = (await this.list(`repos/${state.repository}/issues/${state.pr}/comments`, commentSchema)).filter(c => c.user.login === state.author && c.body.includes(marker));
    if (existing.length > 1) throw new Error("Duplicate request markers; inspect GitHub before continuing.");
    const request = existing[0] ?? await this.api(`repos/${state.repository}/issues/${state.pr}/comments`, commentSchema, "POST", { body: requestBody(state) });
    if (request.body !== requestBody(state) || request.user.login !== state.author) throw new Error("The recorded review request was edited or has the wrong author; inspect GitHub before continuing.");
    if (!Number.isFinite(Date.parse(request.created_at))) throw new Error("Invalid GitHub request timestamp.");
    state = { ...state, phase: "awaiting_review", requestId: request.id, requestAt: request.created_at, reason: "Codex review requested; wait for feedback before claiming completion.", feedback: [] }; save(state);
    return state;
  }
  async matches(state: GithubState, pr: Static<typeof prSchema>): Promise<boolean> {
    const localHead = await this.git(["rev-parse", "HEAD"]);
    const localBranch = await this.git(["symbolic-ref", "--short", "HEAD"]);
    return pr.state === "open" && pr.head.sha === state.head && pr.head.ref === state.branch && pr.head.repo.full_name.toLowerCase() === state.repository.toLowerCase() && pr.base.ref === state.baseBranch && pr.base.sha === state.baseSha && localHead === state.head && localBranch === state.branch && !await this.git(["status", "--porcelain=v1", "--untracked-files=all"]);
  }
  async poll(state: GithubState): Promise<GithubState> {
    if (!state.pr || !state.requestId || !state.requestAt) throw new Error("No complete GitHub review request is recorded; retry publication to reconcile it.");
    const before = await this.api(`repos/${state.repository}/pulls/${state.pr}`, prSchema);
    if (!await this.matches(state, before)) return { ...state, phase: "paused", reason: "PR/local head, base, branch or worktree changed outside this review request. Do not reuse approval; inspect the mismatch.", feedback: state.feedback };
    const reviews = await this.list(`repos/${state.repository}/pulls/${state.pr}/reviews`, reviewSchema);
    const comments = await this.list(`repos/${state.repository}/issues/${state.pr}/comments`, commentSchema);
    const request = comments.find(c => c.id === state.requestId);
    if (!request || request.user.login !== state.author || request.body !== requestBody(state) || request.created_at !== state.requestAt) return { ...state, phase: "paused", reason: "The exact recorded review request is missing or changed; no reaction/comment can establish clearance.", feedback: [] };
    const inline = await this.list(`repos/${state.repository}/pulls/${state.pr}/comments`, inlineSchema);
    const reactions = await this.list(`repos/${state.repository}/issues/comments/${state.requestId}/reactions`, reactionSchema);
    const afterPr = await this.api(`repos/${state.repository}/pulls/${state.pr}`, prSchema);
    if (!await this.matches(state, afterPr)) return { ...state, phase: "paused", reason: "PR or local target changed while collecting review evidence.", feedback: [] };
    return { ...state, ...classifyGithub(state, reviews, comments, inline, reactions) };
  }
}
export async function waitGithub(client: GithubClient, state: GithubState, seconds: number, save: (state: GithubState) => void): Promise<GithubState> {
  const deadline = Date.now() + seconds * 1000;
  do {
    state = await client.poll(state); save(state);
    if (state.phase !== "awaiting_review" || Date.now() >= deadline) return state;
    await delay(Math.min(30000, Math.max(1, deadline - Date.now())), client.signal);
  } while (true);
}
