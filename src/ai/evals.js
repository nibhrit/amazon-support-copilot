// Hybrid eval layer.
// Deterministic checks (this file) verify everything code can verify exactly:
// citation grounding, authority limits, structural completeness, hard
// calibration rules. The LLM judge covers only what needs judgment
// (calibration nuance, hallucination). User confirmation settles
// classification accuracy — the user is the only ground truth at runtime.

import policyData from '../data/policies.json' with { type: 'json' }

const POLICIES = new Map(policyData.policies.map((p) => [p.policy_id, p]))

// PRD hard rule: these categories must never be HIGH confidence.
const NEVER_HIGH = new Set(['third_party_seller_dispute', 'account_suspension_payment_issue'])

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

export function checkCalibrationHardRule(classification) {
  if (NEVER_HIGH.has(classification.category) && classification.confidence === 'HIGH') {
    return { pass: false, note: `Hard rule violated: ${classification.category} may never be HIGH confidence.` }
  }
  return null // no verdict from code — defer to the judge
}

export function checkResolution(output) {
  const notes = []
  let pass = true

  const cited = output.policy_cited || {}
  const policy = POLICIES.get(cited.policy_id)
  let citationGrounded = true
  if (!policy) {
    pass = false
    citationGrounded = false
    notes.push(`Cited policy_id "${cited.policy_id}" does not exist in the policy data.`)
  } else if (!norm(policy.policy_text).includes(norm(cited.quote))) {
    pass = false
    citationGrounded = false
    notes.push(`Quote is not a verbatim substring of ${cited.policy_id} — paraphrased or invented.`)
  } else {
    notes.push(`Citation verified: quote found verbatim in ${cited.policy_id}.`)
  }

  if (policy) {
    if (policy.resolution_authority === 'human_only') {
      pass = false
      notes.push(`Authority exceeded: ${cited.policy_id} is human_only but AI attempted a resolution.`)
    } else if (policy.resolution_authority === 'ai_partial' && output.resolution_type === 'full') {
      pass = false
      notes.push(`Authority exceeded: ${cited.policy_id} allows partial resolution only, but AI claimed full.`)
    }
  }

  if (!Array.isArray(output.resolution_steps) || output.resolution_steps.length === 0) {
    pass = false
    notes.push('No resolution steps provided.')
  }
  if (!Array.isArray(output.next_steps) || output.next_steps.length === 0) {
    pass = false
    notes.push('No next steps provided.')
  }
  if (output.resolution_type === 'partial' && (output.needs_human_review || []).length === 0) {
    pass = false
    notes.push('Partial resolution must state what needs human review.')
  }

  // Brevity limits (added after user testing: frustrated users don't read
  // essays). Slightly looser than the prompt's targets to allow tolerance.
  const steps = output.resolution_steps || []
  if (steps.length > 4) {
    pass = false
    notes.push(`Too many steps (${steps.length} > 4) — frustrated users won't read them.`)
  }
  if (steps.some((s) => s.length > 120)) {
    pass = false
    notes.push('A step exceeds 120 chars — not scannable.')
  }
  if (String(output.issue_summary || '').length > 180) {
    pass = false
    notes.push('Summary exceeds 180 chars.')
  }
  if ((output.next_steps || []).length > 3) {
    pass = false
    notes.push(`Too many next-steps (${output.next_steps.length} > 3).`)
  }
  if (pass) {
    notes.push('Brevity limits respected (≤4 steps, scannable lines).')
  }

  return { pass, notes, citationGrounded }
}

export function checkBrief(output) {
  const notes = []
  let pass = true
  for (const field of ['issue_type', 'user_reported', 'attempted_resolution', 'user_request', 'suggested_owner', 'urgency']) {
    if (!String(output[field] || '').trim()) {
      pass = false
      notes.push(`Missing required brief field: ${field}.`)
    }
  }
  if (pass) notes.push('All fields a human agent needs are present.')
  return { pass, notes }
}

// Assemble the eval panel rows for one response.
// mode: 'resolution' | 'brief' | 'clarify'
// judge: output of the judge call (may be null while loading / on clarify)
// userVerdict: null (pending) | true (confirmed) | false (rejected)
export function buildEvalPanel({ mode, classification, output, judge, userVerdict }) {
  const rows = []

  rows.push({
    key: 'classification_accuracy',
    label: 'Classification accuracy',
    status: userVerdict === null ? 'pending' : userVerdict ? 'pass' : 'fail',
    source: 'user',
    note: userVerdict === null
      ? 'Awaiting user confirmation — the user is the ground truth here.'
      : userVerdict ? 'User confirmed this is their issue.' : 'User rejected the classification.',
  })

  const hardRule = checkCalibrationHardRule(classification)
  rows.push({
    key: 'confidence_calibration',
    label: 'Confidence calibration',
    status: hardRule ? 'fail' : judge ? (judge.calibration_pass ? 'pass' : 'fail') : 'pending',
    source: hardRule ? 'code' : 'judge',
    note: hardRule ? hardRule.note : judge ? judge.calibration_note : 'Judge evaluating…',
  })

  if (mode === 'resolution') {
    const res = checkResolution(output)
    rows.push({
      key: 'resolution_quality',
      label: 'Resolution quality',
      status: res.pass ? 'pass' : 'fail',
      source: 'code',
      note: res.notes.join(' '),
    })
    rows.push({
      key: 'hallucination_free',
      label: 'Hallucination-free',
      status: !res.citationGrounded ? 'fail' : judge ? (judge.hallucination_pass ? 'pass' : 'fail') : 'pending',
      source: !res.citationGrounded ? 'code' : 'judge',
      note: !res.citationGrounded
        ? 'Policy citation failed mechanical grounding check.'
        : judge ? judge.hallucination_note : 'Judge evaluating…',
    })
    rows.push({ key: 'brief_completeness', label: 'Brief completeness', status: 'na', source: 'code', note: 'No escalation brief in this response.' })
  }

  if (mode === 'brief') {
    const brief = checkBrief(output)
    rows.push({ key: 'resolution_quality', label: 'Resolution quality', status: 'na', source: 'code', note: 'Escalated — no resolution attempted in this response.' })
    rows.push({
      key: 'hallucination_free',
      label: 'Hallucination-free',
      status: judge ? (judge.hallucination_pass ? 'pass' : 'fail') : 'pending',
      source: 'judge',
      note: judge ? judge.hallucination_note : 'Judge evaluating…',
    })
    rows.push({
      key: 'brief_completeness',
      label: 'Brief completeness',
      status: brief.pass ? 'pass' : 'fail',
      source: 'code',
      note: brief.notes.join(' '),
    })
  }

  return rows
}
