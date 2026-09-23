// Rescue-plan response JSON Schema — shared by the Gemini structured-output
// request (generationConfig.responseSchema) and the app-code validator.
// Field format verified 2026-09-23 against the live API (the docs' newer
// responseFormat.text form was rejected with INVALID_ARGUMENT; this is the
// pair the official JSON-mode reference documents and the API accepts).
// Spec ref: spec.md > AI adapter (conceptual response schema).
//
// NOTE: schema-conformance only guarantees syntactic JSON (Google's own docs
// say to validate semantics in application code — see validatePlan.js).

// The only three priority buckets (spec > AI adapter).
export const PRIORITIES = Object.freeze(['fix_now', 'fix_next', 'improve_later']);

export const PLAN_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One-line summary of the scan for the rescue plan header, including how many issues were found.',
    },
    results: {
      type: 'array',
      description:
        'Exactly one entry per input finding — no more, no fewer. Each findingId must be copied exactly from the input.',
      items: {
        type: 'object',
        properties: {
          findingId: {
            type: 'string',
            description: 'An id copied EXACTLY from the input findings (e.g. "f_1"). Never invent, guess, or renumber ids.',
          },
          priority: {
            type: 'string',
            enum: [...PRIORITIES],
            description:
              'fix_now = blocking visitors or breaking trust, fix fast; fix_next = important improvements; improve_later = polish.',
          },
          problemTitle: { type: 'string', description: 'Short human-readable title of the problem.' },
          explanation: {
            type: 'string',
            description: 'Plain-English explanation of what the scanner observed, based ONLY on the evidence provided.',
          },
          whyItMatters: { type: 'string', description: 'Why this matters for visitors, search visibility, or accessibility.' },
          developerTask: { type: 'string', description: 'A concrete, actionable task a developer can execute.' },
          acceptanceCriteria: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional. Verifiable checklist items for completing the task. Omit if none apply.',
          },
        },
        required: ['findingId', 'priority', 'problemTitle', 'explanation', 'whyItMatters', 'developerTask'],
      },
    },
  },
  required: ['summary', 'results'],
});

// Deterministic no-findings behavior (Slice 3 decision): the scanner found
// nothing → this exact plan, with no AI request. results: [] means all three
// priority groups render empty on the results screen.
export const NO_FINDINGS_SUMMARY =
  'The scanner found no issues on this page, so there is nothing to prioritize.';
