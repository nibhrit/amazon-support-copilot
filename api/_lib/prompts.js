// Prompt builders + output schemas for the three product prompts and the eval judge.
// All outputs are forced through tool-use JSON schemas — the model cannot return
// free text, so the UI always gets parseable structure.

import policyData from '../../src/data/policies.json' with { type: 'json' }

export const CATEGORIES = {
  standard_return_within_window: { label: 'Standard return within window', resolvability: 'full' },
  standard_refund_item_returned: { label: 'Standard refund (item returned)', resolvability: 'full' },
  delivery_delay_within_estimate: { label: 'Delivery delay (estimated date not passed)', resolvability: 'full' },
  delivery_delay_past_estimate: { label: 'Delivery delay (estimated date passed)', resolvability: 'partial' },
  not_delivered_marked_delivered: { label: 'Item not delivered but marked delivered', resolvability: 'partial' },
  wrong_item_received: { label: 'Wrong item received', resolvability: 'partial' },
  damaged_item: { label: 'Damaged item', resolvability: 'partial' },
  third_party_seller_dispute: { label: 'Third-party seller dispute', resolvability: 'escalate' },
  account_suspension_payment_issue: { label: 'Account suspension / payment issue', resolvability: 'escalate' },
  item_outside_return_window: { label: 'Item outside return window', resolvability: 'escalate' },
  subscription_prime_billing_issue: { label: 'Subscription / Prime billing issue', resolvability: 'escalate' },
  unclear: { label: 'Unclear — needs clarification', resolvability: 'clarify' },
}

const CATEGORY_LIST = Object.entries(CATEGORIES)
  .map(([key, v]) => `- ${key} (${v.label}) — resolvability: ${v.resolvability}`)
  .join('\n')

const POLICY_CONTEXT = JSON.stringify(policyData.policies, null, 1)

const SHARED_RULES = `You are the AI triage layer of "Amazon Support Resolution Co-pilot", a portfolio prototype (NOT an official Amazon product). You help shoppers in India with order issues.

Non-negotiable rules:
- Only cite information present in the policy data provided. Do not invent order details, dates, amounts, or policy terms. If you are uncertain, say so.
- Every policy reference must be citable by policy_id from the provided data.
- Never fabricate what the user did not tell you. When summarising the user's issue, stay strictly within their words.`

function orderContextBlock(input) {
  const oc = input.orderContext || {}
  return `ORDER CONTEXT (simulated order record — stands in for the Amazon order API):
- Order ID / description: ${oc.orderId || 'not provided'}
- Product: ${oc.product || 'not provided'}
- Date of issue: ${oc.issueDate || 'not provided'}
- Order facts: ${oc.orderFacts || 'not provided'}

USER'S ISSUE (verbatim):
"""${input.issueText}"""`
}

// ---------- 1. CLASSIFIER ----------

export function classifyPrompt(input) {
  const prior = input.priorContext
    ? `\nPRIOR ATTEMPT CONTEXT (the user already described this once and rejected the classification "${input.priorContext.rejectedCategory}"; their earlier description was: """${input.priorContext.previousIssueText}"""). Take both descriptions together and do NOT repeat the rejected classification unless the new description clearly confirms it.`
    : ''
  const convo = input.conversation
    ? `\nCONVERSATION SO FAR (ongoing chat session about this order — the new message below is a REPLY in this conversation, not necessarily a fresh issue):
- Issue described so far: """${input.conversation.issueText || 'none yet'}"""
- Current classification: ${input.conversation.classification ? `${input.conversation.classification.category} (${input.conversation.classification.confidence})` : 'none yet'}
- Co-pilot's last action: ${input.conversation.lastMode === 'resolution' ? 'gave resolution steps' : input.conversation.lastMode === 'brief' ? 'produced an escalation brief' : input.conversation.lastMode === 'clarify' ? 'asked a clarifying question' : 'none'}`
    : ''
  return {
    system: `${SHARED_RULES}

Task: read the user's newest message and decide two things.

STEP 1 — intent of the newest message (in the context of the conversation, if any):
- "new_issue" — describes a problem (first description, or a clearly different problem than the conversation so far)
- "same_issue_followup" — adds detail, answers a question, reports that suggested steps did not work, or otherwise continues the SAME problem (pronouns like "it"/"that", words like "still", "didn't work")
- "escalation_request" — asks for a human, agent, escalation, complaint, or to "send it" (e.g. "talk to someone", "connect me to support", "escalate this")
- "closing" — thanks, confirms the problem is solved, or says goodbye
If there is no conversation yet, intent can only be "new_issue" (or "escalation_request" if they ask for a human before describing anything).

STEP 2 — classify the ISSUE (for same_issue_followup, classify the conversation's issue INCLUDING the new detail; for escalation_request/closing, keep the conversation's existing category if there is one, else "unclear"):

CATEGORIES:
${CATEGORY_LIST}

Confidence calibration rules (strict):
- HIGH only when the issue unambiguously matches one category and contains enough detail to act on.
- NEVER output HIGH for third_party_seller_dispute or account_suspension_payment_issue — these always need human judgment.
- Unusual keywords, mixed signals, or issues that straddle two categories → MEDIUM at most.
- If intent is new_issue but the input is too vague to classify responsibly, use category "unclear" with confidence LOW and ask ONE clarifying question. Do not guess.
- If you are uncertain, say so in the reasoning. An honest MEDIUM beats a wrong HIGH.`,
    messages: [{ role: 'user', content: orderContextBlock(input) + convo + prior }],
    maxTokens: 500,
    schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['new_issue', 'same_issue_followup', 'escalation_request', 'closing'] },
        category: { type: 'string', enum: Object.keys(CATEGORIES) },
        confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
        reasoning: { type: 'string', description: '2-3 sentences: intent, why this category and this confidence, citing the user\'s own words' },
        clarifying_question: { type: ['string', 'null'], description: 'Only when category is unclear: the ONE question to ask. Otherwise null.' },
      },
      required: ['intent', 'category', 'confidence', 'reasoning', 'clarifying_question'],
    },
  }
}

// ---------- 2. RESOLUTION ----------

export function resolvePrompt(input) {
  return {
    system: `${SHARED_RULES}

Task: generate a resolution for an issue already classified as "${input.classification.category}" with ${input.classification.confidence} confidence.

POLICY DATA (the ONLY source you may cite):
${POLICY_CONTEXT}

Rules:
- Choose the single most relevant policy and cite it by policy_id. The "quote" field must be a VERBATIM substring copied from that policy's policy_text — no paraphrasing (it is checked mechanically). Keep the quote to the shortest relevant phrase.
- Respect resolution_authority in the policy data: if the matched policy says "ai_partial", you must state what you can handle vs what needs human review. You have no discretion to exceed it.
- resolution_steps must be concrete actions the user can take inside the Amazon app right now — numbered, specific, no "contact customer care" hand-waving. Describe app actions generically ("open Your Orders", "choose the return option", "raise a delivery investigation from the order page") — do NOT invent exact button or menu labels.
- If confidence is MEDIUM, say in ONE short clause what you're unsure about.
- Do not invent order details (prices, dates, carriers) the user did not provide.

BREVITY — the user is frustrated and on a phone. These limits are enforced mechanically:
- issue_summary: ONE sentence, max 20 words.
- resolution_steps: MAX 4 steps. Each step is one short action, max 12 words. Merge trivial steps.
- next_steps: MAX 3, each one short line.
- needs_human_review: each item one short line.
- Never repeat the product name, order number, or dates the user already sees on screen. No filler phrases ("please note", "kindly", "as per policy").`,
    messages: [{ role: 'user', content: orderContextBlock(input) }],
    maxTokens: 700,
    schema: {
      type: 'object',
      properties: {
        issue_summary: { type: 'string', description: 'One sentence, strictly from the user\'s own account' },
        resolution_type: { type: 'string', enum: ['full', 'partial'], description: 'full = AI can resolve end-to-end; partial = some of it needs human review' },
        resolution_steps: { type: 'array', items: { type: 'string' }, description: 'Numbered, concrete in-app actions' },
        policy_cited: {
          type: 'object',
          properties: {
            policy_id: { type: 'string' },
            quote: { type: 'string', description: 'Verbatim substring of that policy\'s policy_text' },
          },
          required: ['policy_id', 'quote'],
        },
        needs_human_review: { type: 'array', items: { type: 'string' }, description: 'What a human must still handle and why. Empty array when resolution_type is full.' },
        next_steps: { type: 'array', items: { type: 'string' }, description: 'What happens after the user acts, in order' },
      },
      required: ['issue_summary', 'resolution_type', 'resolution_steps', 'policy_cited', 'needs_human_review', 'next_steps'],
    },
  }
}

// ---------- 3. ESCALATION BRIEF ----------

export function briefPrompt(input) {
  const attempted = input.attemptedResolution
    ? `\nRESOLUTION ALREADY ATTEMPTED BY THE AI:\n${JSON.stringify(input.attemptedResolution, null, 1)}`
    : '\nNo resolution was attempted (issue triaged directly to escalation).'
  const loop = input.loopDetected
    ? '\nIMPORTANT: the user submitted the same issue type twice — the first pass did not solve it. Mark urgency accordingly and say in attempted_resolution that the AI flow was already tried once.'
    : ''
  return {
    system: `${SHARED_RULES}

Task: write a structured escalation brief so a human agent can start with FULL context — the user must never have to repeat themselves.

The issue was classified as "${input.classification.category}" with ${input.classification.confidence} confidence.

POLICY DATA (for referencing why AI could not resolve):
${POLICY_CONTEXT}

Rules:
- user_reported must be a faithful summary of what the user actually said — no additions, no assumptions.
- Do not invent order numbers, amounts, or dates not present in the input. If the user did not provide something an agent will need, list it in missing_info instead of guessing.
- suggested_owner mapping: returns/refund/delivery/damaged issues → "Returns team"; third-party seller issues → "Seller disputes"; account, payment, or billing issues → "Account team".
- urgency: "Time-sensitive" when a window/deadline is at risk; "High-value order" when the user indicates a high order value; otherwise "Standard".
- BREVITY: this brief is scanned by a busy agent. Every field: 1-2 short sentences max. missing_info: max 4 items, short phrases not sentences. Complete beats long — include every fact, waste no words.`,
    messages: [{ role: 'user', content: orderContextBlock(input) + attempted + loop }],
    maxTokens: 800,
    schema: {
      type: 'object',
      properties: {
        issue_type: { type: 'string' },
        user_reported: { type: 'string', description: 'Faithful summary of what the user told the AI' },
        attempted_resolution: { type: 'string', description: 'What was attempted and why it failed, or why AI could not attempt it' },
        user_request: { type: 'string', description: 'What the user is asking for' },
        missing_info: { type: 'array', items: { type: 'string' }, description: 'Facts an agent will need that the user did not provide' },
        suggested_owner: { type: 'string', enum: ['Returns team', 'Seller disputes', 'Account team'] },
        urgency: { type: 'string', enum: ['Standard', 'Time-sensitive', 'High-value order'] },
      },
      required: ['issue_type', 'user_reported', 'attempted_resolution', 'user_request', 'missing_info', 'suggested_owner', 'urgency'],
    },
  }
}

// ---------- 4. EVAL JUDGE (internal, not a product prompt) ----------

export function judgePrompt(input) {
  return {
    system: `You are a strict QA evaluator for an AI support co-pilot. You judge ONLY the two dimensions below; other dimensions are checked by code. Be harsh — a borderline case fails.

Dimension 1 — confidence_calibration: was the stated confidence appropriate for the input? HIGH requires an unambiguous, actionable issue. Vague or mixed-signal input at HIGH confidence = fail. A cautious MEDIUM on a clear-cut case is a pass (honesty is not penalised).

Dimension 2 — hallucination_free: does the output invent USER-SPECIFIC facts — order details, amounts, dates, payment methods, or claims about what the user said — that are not in the user's input or order context? Does it state policy terms that are NOT in the policy data below? Those = fail.
NOT hallucination (do not penalise): restating policy terms that appear in the policy data below; citing policy IDs from that data; generic app navigation instructions (menus, button names, where to tap).

POLICY DATA (ground truth for policy claims):
${POLICY_CONTEXT}`,
    messages: [{
      role: 'user',
      content: `USER INPUT:
${orderContextBlock(input)}

CLASSIFICATION: ${JSON.stringify(input.classification)}

AI OUTPUT UNDER EVALUATION (${input.mode}):
${JSON.stringify(input.output, null, 1)}`,
    }],
    maxTokens: 600,
    // Deliberately flat schema: the judge runs on Haiku, and small models
    // reliably fill flat tool schemas but mangle nested objects.
    schema: {
      type: 'object',
      properties: {
        calibration_pass: { type: 'boolean' },
        calibration_note: { type: 'string', description: 'One sentence verdict on confidence calibration' },
        hallucination_pass: { type: 'boolean', description: 'true = output is hallucination-free' },
        hallucination_note: { type: 'string', description: 'One sentence verdict on hallucination' },
      },
      required: ['calibration_pass', 'calibration_note', 'hallucination_pass', 'hallucination_note'],
    },
  }
}
