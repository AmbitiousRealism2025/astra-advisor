import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { assess, parse, reportSchema } from "./contracts.ts";
import { atomicJSON, jobSchema, jsonFile, outputSchema } from "./tmux.ts";
import { openWorkspace } from "./workspace.ts";
import { addUsage, emptyUsage, inspectSchema, reviewerPolicy, ReviewerTools } from "./reviewer.ts";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("astra-review-job", { description: "Owned Astra review job file; internal tmux worker only.", type: "string" });
  let tools: ReviewerTools | null = null;
  let job: ReturnType<typeof parse<typeof jobSchema>> | null = null;
  let jobFile = "";
  let turns = 0;
  let submitted = false;
  const usage = emptyUsage();
  const abort = new AbortController();
  pi.on("session_start", async (_event, ctx) => {
    const value = pi.getFlag("astra-review-job");
    if (typeof value !== "string" || !value) throw new Error("Missing owned review job.");
    jobFile = value;
    job = parse(jobSchema, await jsonFile(value));
    const workspace = await openWorkspace(ctx.cwd, job.base, abort.signal);
    if (workspace.root !== job.root) throw new Error("Reviewer root differs from the requested root.");
    tools = new ReviewerTools(workspace);
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (!job || !tools || ctx.model?.id !== "gpt-6-astra" || ctx.model.provider !== "openai-codex" || pi.getThinkingLevel() !== "medium") {
      ctx.abort(); throw new Error("Reviewer initialization/model failed; no fallback allowed.");
    }
    return { systemPrompt: reviewerPolicy, message: { customType: "astra-tmux-review-brief", content: JSON.stringify(job), display: true } };
  });
  pi.on("turn_start", (_event, ctx) => { if (++turns > 12) ctx.abort(); });
  pi.on("context", (event, ctx) => { if (JSON.stringify(event.messages).length > 600000) ctx.abort(); });
  pi.on("session_shutdown", () => abort.abort());
  pi.on("message_end", event => { if (event.message.role === "assistant") addUsage(usage, event.message.usage); });
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "review_submit") return;
    const assistant = ctx.sessionManager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "assistant");
    if (!assistant || assistant.type !== "message" || assistant.message.role !== "assistant" || assistant.message.content.filter(c => c.type === "toolCall").length !== 1) return { block: true, reason: "Submit alone after inspections complete." };
  });
  pi.registerTool({
    name: "review_inspect", label: "Read-only review inspection", parameters: inspectSchema,
    description: "Read/list/search/diff/status/log inside the permitted workspace. No shell or writes. path is relative (empty for root list/search or status/log). query is empty except search. offset/limit apply to read; otherwise use 1/300. Limits and exclusions are enforced.",
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (!tools || submitted) throw new Error("Reviewer is not accepting inspections.");
      return { content: [{ type: "text", text: await tools.inspect(args) }], details: {} };
    },
  });
  pi.registerTool({
    name: "review_submit", label: "Submit review", parameters: reportSchema,
    description: "Submit structured findings alone, carrying all previous finding IDs. No unresolved blockers/gaps means clean evidence, not certification.",
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (!tools || !job || submitted) throw new Error("No active review job.");
      const report = tools.report(args);
      assess(report, job.previous);
      const snapshot = await tools.workspace.snapshot(job.packet.files);
      if (snapshot.excluded.length || snapshot.fingerprint !== job.fingerprint || !await tools.workspace.unchanged()) throw new Error("Evidence excluded, unavailable or changed during review; no stable report can be submitted.");
      const result = parse(outputSchema, { jobId: job.jobId, report, fingerprint: snapshot.fingerprint, inspected: [...tools.workspace.inspected].map(([path, hash]) => ({ path, hash })), usage });
      await atomicJSON(join(dirname(jobFile), "report.json"), result);
      submitted = true;
      return { content: [{ type: "text", text: JSON.stringify(report) }], details: result, terminate: true };
    },
  });
}
