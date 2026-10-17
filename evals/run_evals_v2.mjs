// Eval harness v2. Runs the REAL product routing (src/ai/pipeline.js) against
// the reviewed case set, with a hard dollar cap because the API balance is small.
//
//   node evals/run_evals_v2.mjs --mock                     free: fake model, tests harness + routing
//   node evals/run_evals_v2.mjs --estimate --split all     free: exact input tokens via count_tokens
//   node evals/run_evals_v2.mjs --split dev --budget 0.75  real run; stops before the cap
//
// Other flags: --legacy (add the 8 original cases)  --only id1,id2  --runs N  --no-judge
// Results are written to evals/results/ (gitignored).

import 'dotenv/config'
import fs from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { callClaude, countClaudeTokens, MODELS } from '../api/_lib/claude.js'
import {
  runPipeline, runJudge, resolvabilityOf,
  conversationFrom, loopCategoriesFrom, nextSessionState,
} from '../src/ai/pipeline.js'
import { checkResolution, checkBrief, checkCalibrationHardRule } from '../src/ai/evals.js'
import policyData from '../src/data/policies.json' with { type: 'json' }

// $ per million tokens, Anthropic first-party rates (checked 2026-10-17).
const PRICE = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}
for (const m of Object.values(MODELS)) if (!PRICE[m]) throw new Error(`No price for ${m}: update PRICE before running`)

const costOf = (model, u) => {
  const p = PRICE[model]
  const input = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0)
  return (input * p.in + (u.output_tokens || 0) * p.out) / 1e6
}
const usd = (n) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`

// ---- args ----
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const MODE = flag('mock') ? 'mock' : flag('estimate') ? 'estimate' : 'live'
const SPLIT = opt('split', 'dev')
const BUDGET = Number(opt('budget', '0.50'))
const RUNS = Number(opt('runs', '1'))
const ONLY = opt('only', '') ? new Set(opt('only', '').split(',')) : null
const JUDGE = !flag('no-judge')

// ---- cases ----
const v2 = JSON.parse(fs.readFileSync(new URL('./cases_v2.json', import.meta.url), 'utf8'))
const legacy = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).map((c) => ({
  id: `legacy_${c.id}`, split: 'dev', group: 'legacy', issueText: c.issueText, orderContext: c.orderContext,
  expect: { categories: [c.expect.category], branch: c.expect.branch, neverHigh: c.expect.maxConfidenceViolation === 'HIGH', owner: c.expect.owner },
}))
const pool = [...v2, ...(flag('legacy') || ONLY ? legacy : [])]
const cases = ONLY ? pool.filter((c) => ONLY.has(c.id)) : pool.filter((c) => SPLIT === 'all' || c.split === SPLIT)
if (!cases.length) throw new Error('No cases selected')
const gating = (c) => c.expect.gating !== false

const expectedBranch = (c) => {
  if (c.expect.branch) return c.expect.branch
  const r = resolvabilityOf(c.expect.categories[0])
  return r === 'clarify' ? 'clarify' : r === 'escalate' ? 'brief' : 'resolution'
}

// ---- mock model: a PERFECT classifier. Any failure in mock mode is a routing
// or harness bug, because the model side always gets the label right. ----
const policyById = new Map(policyData.policies.map((p) => [p.policy_id, p]))
function mockCall(c) {
  const e = c.expect
  return async (task, input) => {
    if (task === 'classify') {
      const firstOfMany = c.turns && !input.conversation
      const category = firstOfMany ? 'unclear' : e.categories[0]
      return {
        intent: input.conversation ? 'same_issue_followup' : firstOfMany ? 'escalation_request' : 'new_issue',
        category,
        confidence: e.neverHigh ? 'MEDIUM' : category === 'unclear' ? 'LOW' : 'HIGH',
        reasoning: 'mock',
        clarifying_question: category === 'unclear' ? 'What went wrong with your order?' : null,
        other_issue: null,
      }
    }
    if (task === 'resolve') {
      // Cite the case's expected policy; for cases that should hand off, cite the
      // category's human-only policy (as the real model did for the multi-pack case).
      const cat = input.classification.category
      const p = (e.policy && policyById.get(e.policy[0]))
        || (expectedBranch(c) === 'brief' && policyData.policies.find((x) => x.category === cat && x.resolution_authority === 'human_only'))
        || policyData.policies.find((x) => x.category === cat)
      const full = p.resolution_authority === 'ai_full'
      return {
        issue_summary: 'Mock summary.',
        resolution_type: full ? 'full' : 'partial',
        resolution_steps: ['Open Your Orders.', 'Choose the option for this item.'],
        policy_cited: { policy_id: p.policy_id, quote: p.policy_text.slice(0, 40) },
        needs_human_review: full ? [] : ['A human must confirm the outcome.'],
        next_steps: ['You will get an update.'],
      }
    }
    if (task === 'brief') {
      return {
        issue_type: input.classification.category, user_reported: 'Mock.', attempted_resolution: 'None.',
        user_request: 'Help.', missing_info: [], suggested_owner: e.owner || 'Returns team', urgency: 'Standard',
      }
    }
    return { calibration_pass: true, calibration_note: 'mock', hallucination_pass: true, hallucination_note: 'mock' }
  }
}

// ---- live model with spend metering ----
let spent = 0
const spendByModel = {}
const liveCall = (task, input) => callClaude(task, input, {
  onUsage: ({ model, usage }) => {
    const cost = costOf(model, usage)
    spent += cost
    const s = (spendByModel[model] ||= { calls: 0, input: 0, output: 0, cost: 0 })
    s.calls++; s.input += usage.input_tokens || 0; s.output += usage.output_tokens || 0; s.cost += cost
  },
})

// ---- run one case through the real pipeline, turn by turn ----
async function runCase(c, call) {
  let session = { categoryCounts: {}, priorContext: null, activeIssue: null }
  const transcript = []
  let result
  for (const text of c.turns || [c.issueText]) {
    result = await runPipeline({
      orderContext: c.orderContext,
      issueText: text,
      priorContext: session.priorContext,
      loopCategories: loopCategoriesFrom(session.categoryCounts),
      conversation: conversationFrom(session.activeIssue),
    }, call)
    transcript.push({ user: text, mode: result.mode, classification: result.classification, output: result.output })
    if (result.mode !== 'ack') session = { ...session, ...nextSessionState(session, result) }
  }
  let judge = null
  if (JUDGE && (result.mode === 'resolution' || result.mode === 'brief')) {
    judge = await runJudge({
      orderContext: c.orderContext, issueText: result.effectiveIssueText,
      classification: result.classification, output: result.output, mode: result.mode,
    }, call)
  }
  return { result, judge, transcript }
}

// ---- score against the answer key; each check maps to a PRD rubric dimension ----
const NEVER_HIGH_CATS = ['third_party_seller_dispute', 'account_suspension_payment_issue']
function score(c, { result, judge }) {
  const e = c.expect
  const cls = result.classification || {}
  const out = result.output
  const checks = []
  const add = (dim, name, pass, detail = '') => checks.push({ dim, name, pass: Boolean(pass), detail })

  add('classification', 'category', e.categories.includes(cls.category), `expected ${e.categories.join(' or ')}, got ${cls.category}`)
  if (e.branch) add('routing', 'branch', result.mode === e.branch, `expected ${e.branch}, got ${result.mode}`)
  if (e.neverHigh) add('calibration', 'confidence at most MEDIUM', cls.confidence !== 'HIGH', `got ${cls.confidence}`)
  else if (NEVER_HIGH_CATS.includes(cls.category)) {
    const hard = checkCalibrationHardRule(cls)
    add('calibration', 'hard rule: seller/account never HIGH', !hard, hard?.note)
  }
  if (result.mode === 'clarify') add('routing', 'asks one clarifying question', Boolean(cls.clarifying_question))
  if (result.mode === 'resolution') {
    const r = checkResolution(out)
    add('resolution', 'grounded citation, within authority, brief enough', r.pass, r.notes.join(' '))
    if (e.policy) add('resolution', 'cites an expected policy', e.policy.includes(out.policy_cited?.policy_id), `expected ${e.policy.join(' or ')}, got ${out.policy_cited?.policy_id}`)
    if (e.resolutionType) add('resolution', 'resolution type', out.resolution_type === e.resolutionType, `expected ${e.resolutionType}, got ${out.resolution_type}`)
  }
  if (result.mode === 'brief') {
    const b = checkBrief(out)
    add('brief', 'all agent fields present', b.pass, b.notes.join(' '))
    if (e.owner) add('brief', 'owner', out.suggested_owner === e.owner, `expected ${e.owner}, got ${out.suggested_owner}`)
  }
  const outText = out ? JSON.stringify(out).toLowerCase() : ''
  for (const s of e.mustNotContain || []) add('safety', `never says "${s}"`, !outText.includes(s.toLowerCase()))
  if (e.mustShow) add('safety', 'shows the safety line', JSON.stringify(result).toLowerCase().includes(e.mustShow.toLowerCase()), e.needsProductChange ? 'not built yet' : '')
  if (judge) {
    add('hallucination', 'judge: no invented facts', judge.hallucination_pass === true, judge.hallucination_note)
    add('calibration', 'judge: confidence appropriate', judge.calibration_pass === true, judge.calibration_note)
  }
  return checks
}

// ---- estimate mode: exact input tokens (free), output tokens bounded ----
// Typical output sizes are a rough guess; the worst case uses each task's max_tokens.
const TYPICAL_OUT = { classify: 200, resolve: 350, brief: 400, judge: 150 }
const SAMPLE_OUTPUT = {
  resolution: { issue_summary: 'User wants to return shoes bought 5 days ago as they are too small.', resolution_type: 'full', resolution_steps: ['1. Open Your Orders and select the order.', '2. Choose the return option and select size/fit as the reason.', '3. Select refund to the original payment method and confirm free pickup.', '4. Keep the item unused in original packaging for the pickup agent.'], policy_cited: { policy_id: 'RET-002', quote: 'Fashion and Shoes — 30 days' }, needs_human_review: [], next_steps: ['A free pickup is scheduled.', 'The pickup agent does a doorstep quality check.', 'The refund starts after a successful pickup.'] },
  brief: { issue_type: 'third_party_seller_dispute', user_reported: 'User bought an SSD from a third-party seller and believes it is counterfeit, citing half the advertised capacity. The seller has not replied for a week.', attempted_resolution: 'No resolution attempted; A-to-z claims for seller-fulfilled orders need a claims specialist (TPS-001).', user_request: 'Resolution for a suspected counterfeit item from an unresponsive seller.', missing_info: ['Delivery date', 'Payment method', 'Order value', 'Whether an A-to-z claim was filed'], suggested_owner: 'Seller disputes', urgency: 'Time-sensitive' },
}
async function estimate() {
  const totals = {}
  for (const c of cases) {
    const turns = c.turns || [c.issueText]
    const calls = []
    for (let i = 0; i < turns.length; i++) {
      const conversation = i === 0 ? null : { issueText: turns[i - 1], classification: null, attemptedResolution: null, lastMode: 'clarify' }
      calls.push(['classify', await countClaudeTokens('classify', { orderContext: c.orderContext, issueText: turns[i], priorContext: null, conversation })])
    }
    const branch = expectedBranch(c)
    const classification = { category: c.expect.categories[0], confidence: 'MEDIUM' }
    const issueText = turns.join('\nFollow-up: ')
    if (branch === 'resolution' || branch === 'brief') {
      const task = branch === 'resolution' ? 'resolve' : 'brief'
      calls.push([task, await countClaudeTokens(task, { orderContext: c.orderContext, issueText, classification })])
      if (JUDGE) calls.push(['judge', await countClaudeTokens('judge', { orderContext: c.orderContext, issueText, classification, output: SAMPLE_OUTPUT[branch], mode: branch })])
    }
    const bucket = c.group === 'legacy' ? 'legacy' : c.split
    const t = (totals[bucket] ||= { cases: 0, calls: 0, inputTokens: 0, typical: 0, worst: 0 })
    t.cases++
    for (const [task, n] of calls) {
      const p = PRICE[n.model]
      t.calls++; t.inputTokens += n.inputTokens
      t.typical += (n.inputTokens * p.in + TYPICAL_OUT[task] * p.out) / 1e6
      t.worst += (n.inputTokens * p.in + n.maxOutputTokens * p.out) / 1e6
    }
    process.stdout.write('.')
  }
  console.log('\n\nProjected cost of ONE run (input tokens exact via count_tokens; output estimated):')
  let all = { typical: 0, worst: 0 }
  for (const [bucket, t] of Object.entries(totals)) {
    console.log(`  ${bucket.padEnd(8)} ${String(t.cases).padStart(2)} cases, ${t.calls} calls, ${t.inputTokens} input tokens → typical ${usd(t.typical)}, worst case ${usd(t.worst)}`)
    all.typical += t.typical; all.worst += t.worst
  }
  console.log(`  ${'total'.padEnd(8)} typical ${usd(all.typical)}, worst case ${usd(all.worst)}`)
}

// ---- main ----
console.log(`Mode: ${MODE} | cases: ${cases.length} (split ${ONLY ? 'custom' : SPLIT}${flag('legacy') ? ' + legacy' : ''}) | runs: ${RUNS} | judge: ${JUDGE ? 'on' : 'off'}${MODE === 'live' ? ` | budget cap ${usd(BUDGET)}` : ''}\n`)
if (MODE === 'estimate') {
  await estimate()
  process.exit(0)
}

const results = []
let stoppedBeforeBudget = null
let fatal = null
const FIRST_CASE_GUESS = 0.05 // USD, until we have an observed average

outer: for (const c of cases) {
  for (let run = 1; run <= RUNS; run++) {
    if (MODE === 'live') {
      const done = results.filter((r) => !r.error).length
      const next = (done ? spent / done : FIRST_CASE_GUESS) * 1.5 // 50% safety margin
      if (spent + next > BUDGET) { stoppedBeforeBudget = c.id; break outer }
    }
    const before = spent
    const base = { id: c.id, split: c.split, group: c.group, gating: gating(c), run }
    try {
      const out = await runCase(c, MODE === 'mock' ? mockCall(c) : liveCall)
      const checks = score(c, out)
      const r = { ...base, pass: checks.every((k) => k.pass), checks, mode: out.result.mode, classification: out.result.classification, judge: out.judge, transcript: out.transcript, cost: spent - before }
      results.push(r)
      const fails = checks.filter((k) => !k.pass)
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${c.id}${RUNS > 1 ? ` (run ${run})` : ''}  [${r.mode}, ${r.classification?.category}/${r.classification?.confidence}]${MODE === 'live' ? `  ${usd(r.cost)}` : ''}${r.gating ? '' : '  (non-scoring probe)'}`)
      for (const f of fails) console.log(`        ✗ ${f.dim}: ${f.name} — ${String(f.detail).slice(0, 160)}`)
    } catch (err) {
      results.push({ ...base, pass: false, error: err.message, cost: spent - before })
      console.log(`ERROR ${c.id}: ${err.message}`)
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.BadRequestError) {
        fatal = err.message
        break outer
      }
    }
  }
}

// ---- summary ----
const scored = results.filter((r) => r.gating && !r.error)
const probes = results.filter((r) => !r.gating)
console.log('\n================ SUMMARY ================')
for (const split of ['dev', 'heldout']) {
  const s = scored.filter((r) => r.split === split)
  if (s.length) console.log(`${split.padEnd(8)} cases passed: ${s.filter((r) => r.pass).length} / ${s.length}`)
}
if (probes.length) console.log(`non-scoring probes: ${probes.map((r) => `${r.id} ${r.pass ? 'PASS' : 'FAIL'}`).join(', ')}`)
const dims = {}
for (const r of scored) for (const k of r.checks) {
  const d = (dims[k.dim] ||= { pass: 0, total: 0 })
  d.total++; if (k.pass) d.pass++
}
console.log('\nChecks by dimension:')
for (const [d, v] of Object.entries(dims)) console.log(`  ${d.padEnd(15)} ${v.pass} / ${v.total}`)
const errors = results.filter((r) => r.error)
if (errors.length) console.log(`\nErrors: ${errors.map((r) => r.id).join(', ')}`)
if (fatal) console.log(`\nSTOPPED on a non-retryable API error: ${fatal}`)
if (stoppedBeforeBudget) {
  const remaining = cases.slice(cases.findIndex((c) => c.id === stoppedBeforeBudget)).map((c) => c.id)
  console.log(`\nSTOPPED before the ${usd(BUDGET)} cap. Not run (${remaining.length}): ${remaining.join(', ')}`)
}
if (MODE === 'live') {
  console.log(`\nSpend this run: ${usd(spent)}`)
  for (const [m, s] of Object.entries(spendByModel)) console.log(`  ${m}: ${s.calls} calls, ${s.input} in / ${s.output} out tokens, ${usd(s.cost)}`)
}

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}-${MODE}-${ONLY ? 'custom' : SPLIT}.json`, import.meta.url)
fs.writeFileSync(file, JSON.stringify({ mode: MODE, split: SPLIT, runs: RUNS, budget: BUDGET, spent, spendByModel, stoppedBeforeBudget, fatal, results }, null, 2))
console.log(`\nSaved: evals/results/${file.pathname.split('/').pop()}`)
