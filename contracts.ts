import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { StringEnum } from "@earendil-works/pi-ai";

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const strings = (maxItems: number, maxLength: number) => Type.Array(text(maxLength), { maxItems });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const findingSchema = object({
  id: Type.String({ pattern: "^A[1-9][0-9]{0,2}$" }),
  severity: StringEnum(["blocking", "non_blocking"] as const),
  disposition: StringEnum(["fix_now", "separate_task"] as const),
  status: StringEnum(["open", "resolved", "disputed", "deferred"] as const),
  title: text(200), evidence: text(1500), resolution: text(1500),
});
export const reportSchema = object({
  summary: text(3000),
  findings: Type.Array(findingSchema, { maxItems: 20 }),
  evidenceGaps: strings(12, 1000),
});
export const packetSchema = object({
  goal: text(4000), invariants: strings(20, 1000),
  files: Type.Array(text(500), { minItems: 1, maxItems: 100, uniqueItems: true }),
  base: Type.String({ pattern: "^(HEAD|none|[a-f0-9]{40}|[a-f0-9]{64})$", description: "HEAD, a full commit hash, or none for a non-Git directory. Frozen to a commit for the cycle." }),
  diffSummary: text(6000),
  tests: Type.Array(object({ command: text(1000), result: text(3000) }), { maxItems: 20 }),
  limitations: strings(20, 1000), restrictions: text(6000),
  risk: Type.Array(StringEnum(["protocol", "persistence", "authentication", "packages", "lifecycle", "release", "low_risk", "other"] as const), { minItems: 1, maxItems: 8, uniqueItems: true }),
  executor: StringEnum(["sol", "luna"] as const),
  resolutions: Type.Array(object({ id: text(10), action: StringEnum(["fixed", "evidence", "disputed", "defer"] as const), detail: text(2000) }), { maxItems: 20 }),
});
export const verifySchema = object({ action: StringEnum(["start", "recheck"] as const), packet: packetSchema });
export const stateSchema = object({
  version: Type.Literal(1), id: text(100), round: Type.Integer({ minimum: 1, maximum: 3 }),
  status: StringEnum(["reviewing", "needs_fixes", "passed", "incomplete"] as const),
  reason: text(4000), root: text(4000), base: text(100), fingerprint: text(100), progress: text(100),
  packet: packetSchema, report: reportSchema,
  inspected: Type.Array(object({ path: text(500), hash: text(100) }), { maxItems: 1000 }),
});
export type Packet = Static<typeof packetSchema>;
export type Report = Static<typeof reportSchema>;
export type ReviewState = Static<typeof stateSchema>;

export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Check(schema, value)) throw new Error("Invalid structured review data; required fields, bounds, or enum values did not match the schema.");
  return value;
}

export function assess(report: Report, previous: Report | null, round: number): Pick<ReviewState, "status" | "reason"> {
  const ids = new Set(report.findings.map(f => f.id));
  if (ids.size !== report.findings.length) throw new Error("Duplicate finding IDs.");
  for (const old of previous?.findings ?? []) {
    const current = report.findings.find(f => f.id === old.id);
    if (!current) throw new Error(`Re-review omitted ${old.id}; carry forward every finding and update its status with evidence.`);
    if (old.severity === "blocking" && current.severity !== "blocking") throw new Error(`Do not downgrade ${old.id}; resolve it with evidence or escalate it.`);
  }
  if (report.findings.some(f => f.status === "disputed")) return { status: "incomplete", reason: "A finding is disputed. Sol Medium must present both positions and ask for a decision." };
  const blockers = report.findings.filter(f => f.severity === "blocking" && f.status !== "resolved");
  if (blockers.some(f => f.disposition === "separate_task" || f.status === "deferred")) return { status: "incomplete", reason: "A necessary fix exceeds scope or is deferred. User decision required; deferral is not a pass." };
  if (!blockers.length && !report.evidenceGaps.length) return { status: "passed", reason: "No blocking findings in the inspected evidence. Non-blocking follow-ups may remain; this is not certification." };
  if (round >= 3) return { status: "incomplete", reason: "Initial review plus two corrective re-reviews exhausted. Report unresolved findings and evidence gaps to the user." };
  return { status: "needs_fixes", reason: blockers.length ? "Address confirmed blockers, run affected checks, then call astra_verify recheck." : "Provide the missing evidence or run requested checks, then call astra_verify recheck." };
}

export function summary(state: ReviewState | null): string {
  if (!state) return "Astra review: not run. Do not claim verification passed.";
  return `Astra review ${state.status} (round ${state.round}/3, ${state.id}): ${state.reason}`;
}
