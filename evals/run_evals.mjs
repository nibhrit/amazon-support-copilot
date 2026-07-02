// CLI eval harness — runs the real prompts against the real API and asserts
// the PRD's expectations. Usage:  node evals/run_evals.mjs [--full]
//   default: classification-only for all cases (cheap, fast)
//   --full:  also runs resolve/brief + deterministic checks + LLM judge
//            for two representative cases

import 'dotenv/config'
import fs from 'node:fs'
import { callClaude } from '../api/_lib/claude.js'
import { checkResolution, checkBrief, checkCalibrationHardRule } from '../src/ai/evals.js'

const RESOLVABILITY = {
  standard_return_within_window: 'full',
  standard_refund_item_returned: 'full',
  delivery_delay_within_estimate: 'full',
  delivery_delay_past_estimate: 'partial',
  not_delivered_marked_delivered: 'partial',
  wrong_item_received: 'partial',
  damaged_item: 'partial',
  third_party_seller_dispute: 'escalate',
  account_suspension_payment_issue: 'escalate',
  item_outside_return_window: 'escalate',
  subscription_prime_billing_issue: 'escalate',
  unclear: 'clarify',
}

const branchOf = (c) => {
  const r = RESOLVABILITY[c.category]
  if (r === 'clarify') return 'clarify'
  if (c.confidence === 'LOW' || r === 'escalate') return 'brief'
  return 'resolution'
}

const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8'))
const full = process.argv.includes('--full')
let passCount = 0
let failCount = 0

const report = (ok, label, detail) => {
  ok ? passCount++ : failCount++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log(`Running classification evals on ${cases.length} cases…\n`)

const results = {}
for (const c of cases) {
  console.log(`[${c.id}] "${c.issueText.slice(0, 70)}…"`)
  const cls = await callClaude('classify', { orderContext: c.orderContext, issueText: c.issueText })
  results[c.id] = cls
  console.log(`  → ${cls.category} / ${cls.confidence}${cls.clarifying_question ? ` / Q: ${cls.clarifying_question}` : ''}`)

  report(cls.category === c.expect.category, 'category', cls.category === c.expect.category ? '' : `expected ${c.expect.category}, got ${cls.category}`)
  if (c.expect.maxConfidenceViolation) {
    report(cls.confidence !== c.expect.maxConfidenceViolation, `confidence cap (never ${c.expect.maxConfidenceViolation})`, `got ${cls.confidence}`)
    report(checkCalibrationHardRule(cls) === null, 'hard calibration rule')
  }
  report(branchOf(cls) === c.expect.branch, 'branch', `expected ${c.expect.branch}, got ${branchOf(cls)}`)
  if (cls.category === 'unclear') {
    report(Boolean(cls.clarifying_question), 'asks one clarifying question')
  }
  console.log()
}

if (full) {
  console.log('--- FULL PIPELINE: resolution case (clear_return) ---')
  const rc = cases.find((c) => c.id === 'clear_return')
  const rcls = results[rc.id]
  const resolution = await callClaude('resolve', { orderContext: rc.orderContext, issueText: rc.issueText, classification: rcls })
  console.log(JSON.stringify(resolution, null, 2))
  const det = checkResolution(resolution)
  report(det.pass, 'deterministic resolution checks', det.notes.join(' | '))

  const judge1 = await callClaude('judge', { orderContext: rc.orderContext, issueText: rc.issueText, classification: rcls, output: resolution, mode: 'resolution' })
  console.log('judge:', JSON.stringify(judge1))
  report(judge1.hallucination_pass === true, 'judge: hallucination-free', judge1.hallucination_note)
  report(judge1.calibration_pass === true, 'judge: calibration', judge1.calibration_note)

  console.log('\n--- FULL PIPELINE: escalation case (seller_dispute) ---')
  const bc = cases.find((c) => c.id === 'seller_dispute')
  const bcls = results[bc.id]
  const brief = await callClaude('brief', { orderContext: bc.orderContext, issueText: bc.issueText, classification: bcls })
  console.log(JSON.stringify(brief, null, 2))
  const bdet = checkBrief(brief)
  report(bdet.pass, 'deterministic brief checks', bdet.notes.join(' | '))
  report(brief.suggested_owner === bc.expect.owner, 'suggested owner', `expected ${bc.expect.owner}, got ${brief.suggested_owner}`)

  const judge2 = await callClaude('judge', { orderContext: bc.orderContext, issueText: bc.issueText, classification: bcls, output: brief, mode: 'brief' })
  console.log('judge:', JSON.stringify(judge2))
  report(judge2.hallucination_pass === true, 'judge: brief hallucination-free', judge2.hallucination_note)
}

console.log(`\n==== ${passCount} passed, ${failCount} failed ====`)
process.exit(failCount > 0 ? 1 : 0)
