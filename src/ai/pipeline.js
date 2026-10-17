// Orchestrates the PRD's AI workflow:
//   classify → branch on confidence + resolvability → resolve OR brief
// Loop guardrail: when the same issue type arrives twice, the UI passes
// loopDetected=true and we skip re-classification entirely.
//
// `call` defaults to the browser client (/api/claude). The eval harness passes
// its own, so it exercises this exact routing rather than a copy of it.

import { callTask } from './client.js'
import policyData from '../data/policies.json' with { type: 'json' }

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

export const CATEGORY_LABELS = {
  standard_return_within_window: 'Standard return within window',
  standard_refund_item_returned: 'Standard refund (item returned)',
  delivery_delay_within_estimate: 'Delivery delay (date not passed)',
  delivery_delay_past_estimate: 'Delivery delay (date passed)',
  not_delivered_marked_delivered: 'Not delivered, marked delivered',
  wrong_item_received: 'Wrong item received',
  damaged_item: 'Damaged item',
  third_party_seller_dispute: 'Third-party seller dispute',
  account_suspension_payment_issue: 'Account / payment issue',
  item_outside_return_window: 'Outside return window',
  subscription_prime_billing_issue: 'Prime / subscription billing',
  unclear: 'Unclear — needs clarification',
}

const POLICY_AUTHORITY = new Map(policyData.policies.map((p) => [p.policy_id, p.resolution_authority]))

// Shown on every handoff in these categories, whatever the model writes.
const SAFETY_NOTES = {
  account_suspension_payment_issue: "Amazon never asks for your OTP or password. Don't share it.",
}

// Rules on confidence enforced in code, not left to the prompt. The model once
// sidestepped "never HIGH for seller disputes" by choosing a different category,
// so the seller rule keys off the order, not the label.
const NEVER_HIGH = new Set(['third_party_seller_dispute', 'account_suspension_payment_issue'])
function applyConfidenceCap(classification, orderContext) {
  if (classification.confidence !== 'HIGH') return classification
  const sellerOrder = /third-party seller/i.test(orderContext?.orderFacts || '')
  if (!sellerOrder && !NEVER_HIGH.has(classification.category)) return classification
  const why = sellerOrder ? 'third-party seller order' : 'this category always needs human judgment'
  return {
    ...classification,
    confidence: 'MEDIUM',
    cappedFrom: 'HIGH',
    reasoning: `${classification.reasoning} [Confidence capped at MEDIUM: ${why}.]`,
  }
}

export function resolvabilityOf(category) {
  return RESOLVABILITY[category] || 'escalate'
}

// conversation (optional): { issueText, classification, attemptedResolution, lastMode, humanRequested }
// — the running state of this chat, so mid-conversation messages are read as
// replies (follow-ups, escalation requests, thanks) instead of fresh issues.
export async function runPipeline(args, call = callTask) {
  const result = await route(args, call)
  const note = result.mode === 'brief' ? SAFETY_NOTES[result.classification?.category] : null
  return note ? { ...result, safetyNote: note } : result
}

async function route({ orderContext, issueText, priorContext, loop, loopCategories, conversation }, call) {
  // Loop guardrail, direct form: the user told us the resolution didn't work —
  // don't re-classify, go straight to the escalation brief.
  if (loop) {
    const output = await call('brief', {
      orderContext,
      issueText,
      classification: loop.classification,
      attemptedResolution: loop.attemptedResolution,
      loopDetected: true,
    })
    return { mode: 'brief', classification: loop.classification, output, loopDetected: true, effectiveIssueText: issueText }
  }

  const raw = await call('classify', { orderContext, issueText, priorContext, conversation })
  const classification = applyConfidenceCap(raw, orderContext)
  const intent = classification.intent || 'new_issue'
  // Sticky for the rest of the conversation: once the user asks for a person,
  // they get one as soon as the problem is clear.
  const humanRequested = Boolean(conversation?.humanRequested) || intent === 'escalation_request'

  if (conversation) {
    // "thanks, that solved it" — no pipeline run needed.
    if (intent === 'closing' && conversation.classification) {
      return { mode: 'ack', classification, output: null, effectiveIssueText: conversation.issueText }
    }

    // "escalate this / get me a human" — go straight to the brief with the
    // full accumulated context. Never re-interrogate the user.
    if (intent === 'escalation_request' && conversation.classification) {
      const cls = conversation.classification
      const merged = conversation.issueText
        ? `${conversation.issueText}\nFollow-up: ${issueText}`
        : issueText
      const output = await call('brief', {
        orderContext,
        issueText: merged,
        classification: cls,
        attemptedResolution: conversation.attemptedResolution,
        loopDetected: Boolean(conversation.attemptedResolution),
      })
      return { mode: 'brief', classification: cls, output, loopDetected: Boolean(conversation.attemptedResolution), effectiveIssueText: merged, humanRequested: true }
    }

    // Follow-up detail extends the issue rather than replacing it.
    if (intent === 'same_issue_followup' && conversation.issueText) {
      issueText = `${conversation.issueText}\nFollow-up: ${issueText}`
    }
  }

  const resolvability = resolvabilityOf(classification.category)

  if (resolvability === 'clarify') {
    return { mode: 'clarify', classification, output: null, effectiveIssueText: issueText, humanRequested }
  }

  // Loop guardrail, typed form: the same issue type is coming around again —
  // skip the resolution attempt and escalate with full context.
  if (loopCategories && loopCategories.has(classification.category)) {
    const output = await call('brief', {
      orderContext,
      issueText,
      classification,
      attemptedResolution: conversation?.attemptedResolution,
      loopDetected: true,
    })
    return { mode: 'brief', classification, output, loopDetected: true, effectiveIssueText: issueText, humanRequested }
  }

  if (humanRequested || classification.confidence === 'LOW' || resolvability === 'escalate') {
    const output = await call('brief', { orderContext, issueText, classification })
    return { mode: 'brief', classification, output, effectiveIssueText: issueText, humanRequested }
  }

  const output = await call('resolve', { orderContext, issueText, classification })

  // The matched policy decides authority, not just the category: a human-only
  // policy (e.g. multi-pack pricing review) means a person decides.
  if (POLICY_AUTHORITY.get(output.policy_cited?.policy_id) === 'human_only') {
    const brief = await call('brief', { orderContext, issueText, classification })
    return { mode: 'brief', classification, output: brief, effectiveIssueText: issueText, humanRequested, handoffPolicy: output.policy_cited.policy_id }
  }

  return { mode: 'resolution', classification, output, effectiveIssueText: issueText, humanRequested }
}

// Second, non-blocking call: the LLM judge for the eval panel.
export async function runJudge({ orderContext, issueText, classification, output, mode }, call = callTask) {
  return call('judge', { orderContext, issueText, classification, output, mode })
}

// ---- Chat session state (shared by ChatPage and the eval harness) ----

export function conversationFrom(activeIssue) {
  if (!activeIssue) return null
  const { issueText, classification, attemptedResolution, lastMode, humanRequested } = activeIssue
  return { issueText, classification, attemptedResolution, lastMode, humanRequested }
}

export function loopCategoriesFrom(categoryCounts) {
  return new Set(Object.keys(categoryCounts).filter((k) => categoryCounts[k] >= 1))
}

// State after a pipeline result (not called for 'ack', which changes nothing).
export function nextSessionState(session, result) {
  const clarify = result.mode === 'clarify'
  return {
    priorContext: clarify ? session.priorContext : null,
    categoryCounts: clarify ? session.categoryCounts : {
      ...session.categoryCounts,
      [result.classification.category]: (session.categoryCounts[result.classification.category] || 0) + 1,
    },
    activeIssue: {
      issueText: result.effectiveIssueText,
      classification: clarify ? session.activeIssue?.classification || null : result.classification,
      attemptedResolution: result.mode === 'resolution' ? result.output : session.activeIssue?.attemptedResolution || null,
      lastMode: result.mode,
      humanRequested: Boolean(result.humanRequested || session.activeIssue?.humanRequested),
    },
  }
}
