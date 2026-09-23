// Plan validator — application-code checks run after parsing, regardless of
// what the API promised (spec > Plan validator). One failed check rejects the
// WHOLE plan (the caller maps that to ai_failed; nothing is partially kept).
//
// Returns { ok: true, plan } with only the contract fields, or
//         { ok: false, reason } — reason is short and safe to log.
//
// Rules enforced (spec + Slice 3 requirements):
//   1. structural shape of every field
//   2. priority ∈ fix_now | fix_next | improve_later
//   3. every findingId exists in the scanner input (no invented ids)
//   4. every input finding appears exactly once (no missing, no duplicates)

import { PRIORITIES } from './planSchema.js';

const RESULT_STRING_FIELDS = ['problemTitle', 'explanation', 'whyItMatters', 'developerTask'];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {*} plan          parsed AI output (untrusted)
 * @param {Array<{id:string}>} findings  the EXACT scanner findings sent to the AI
 */
export function validatePlan(plan, findings) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, reason: 'plan is not an object' };
  }
  if (!isNonEmptyString(plan.summary)) {
    return { ok: false, reason: 'summary missing or empty' };
  }
  if (!Array.isArray(plan.results)) {
    return { ok: false, reason: 'results is not an array' };
  }

  const inputIds = findings.map((f) => f.id);
  const inputSet = new Set(inputIds);

  // Per-result structural checks + invented-id check.
  const seen = new Map();
  for (let i = 0; i < plan.results.length; i += 1) {
    const r = plan.results[i];
    const label = `result ${i}`;
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, reason: `${label} is not an object` };
    }
    if (!isNonEmptyString(r.findingId)) {
      return { ok: false, reason: `${label} has no findingId` };
    }
    const id = r.findingId;
    if (!PRIORITIES.includes(r.priority)) {
      return { ok: false, reason: `${label} has invalid priority "${String(r.priority).slice(0, 30)}"` };
    }
    for (const field of RESULT_STRING_FIELDS) {
      if (!isNonEmptyString(r[field])) {
        return { ok: false, reason: `result ${id} has empty or missing ${field}` };
      }
    }
    // acceptanceCriteria is optional; null/absent = omitted, but if present
    // it must be an array of non-empty strings.
    if (r.acceptanceCriteria !== undefined && r.acceptanceCriteria !== null) {
      const ac = r.acceptanceCriteria;
      if (!Array.isArray(ac) || ac.some((c) => !isNonEmptyString(c))) {
        return { ok: false, reason: `result ${id} has malformed acceptanceCriteria` };
      }
    }
    if (!inputSet.has(id)) {
      return { ok: false, reason: `invented finding id "${id}"` };
    }
    seen.set(id, (seen.get(id) || 0) + 1);
  }

  // Duplicates.
  for (const [id, count] of seen) {
    if (count > 1) {
      return { ok: false, reason: `duplicate finding id "${id}"` };
    }
  }

  // Missing: every input finding must appear exactly once.
  for (const id of inputIds) {
    if (!seen.has(id)) {
      return { ok: false, reason: `missing finding id "${id}"` };
    }
  }

  // Return a clean projection — only contract fields reach the UI, any
  // extra keys the model added are dropped here.
  const results = plan.results.map((r) => ({
    findingId: r.findingId,
    priority: r.priority,
    problemTitle: r.problemTitle,
    explanation: r.explanation,
    whyItMatters: r.whyItMatters,
    developerTask: r.developerTask,
    ...(r.acceptanceCriteria !== undefined && r.acceptanceCriteria !== null && {
      acceptanceCriteria: r.acceptanceCriteria,
    }),
  }));

  return { ok: true, plan: { summary: plan.summary, results } };
}
