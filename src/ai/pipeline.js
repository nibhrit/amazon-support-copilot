// Orchestrates the PRD's AI workflow:
//   classify → branch on confidence + resolvability → resolve OR brief
// Loop guardrail: when the same issue type arrives twice, the UI passes
// loopDetected=true and we skip re-classification entirely.

import { callTask } from './client.js'

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

export function resolvabilityOf(category) {
  return RESOLVABILITY[category] || 'escalate'
}

// conversation (optional): { issueText, classification, attemptedResolution, lastMode }
// — the running state of this chat, so mid-conversation messages are read as
// replies (follow-ups, escalation requests, thanks) instead of fresh issues.
export async function runPipeline({ orderContext, issueText, priorContext, loop, loopCategories, conversation }) {
  // Loop guardrail, direct form: the user told us the resolution didn't work —
  // don't re-classify, go straight to the escalation brief.
  if (loop) {
    const output = await callTask('brief', {
      orderContext,
      issueText,
      classification: loop.classification,
      attemptedResolution: loop.attemptedResolution,
      loopDetected: true,
    })
    return { mode: 'brief', classification: loop.classification, output, loopDetected: true, effectiveIssueText: issueText }
  }

  const classification = await callTask('classify', { orderContext, issueText, priorContext, conversation })
  const intent = classification.intent || 'new_issue'

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
      const output = await callTask('brief', {
        orderContext,
        issueText: merged,
        classification: cls,
        attemptedResolution: conversation.attemptedResolution,
        loopDetected: Boolean(conversation.attemptedResolution),
      })
      return { mode: 'brief', classification: cls, output, loopDetected: Boolean(conversation.attemptedResolution), effectiveIssueText: merged }
    }

    // Follow-up detail extends the issue rather than replacing it.
    if (intent === 'same_issue_followup' && conversation.issueText) {
      issueText = `${conversation.issueText}\nFollow-up: ${issueText}`
    }
  }

  const resolvability = resolvabilityOf(classification.category)

  if (resolvability === 'clarify') {
    return { mode: 'clarify', classification, output: null, effectiveIssueText: issueText }
  }

  // Loop guardrail, typed form: the same issue type is coming around again —
  // skip the resolution attempt and escalate with full context.
  if (loopCategories && loopCategories.has(classification.category)) {
    const output = await callTask('brief', {
      orderContext,
      issueText,
      classification,
      attemptedResolution: conversation?.attemptedResolution,
      loopDetected: true,
    })
    return { mode: 'brief', classification, output, loopDetected: true, effectiveIssueText: issueText }
  }

  if (classification.confidence === 'LOW' || resolvability === 'escalate') {
    const output = await callTask('brief', { orderContext, issueText, classification })
    return { mode: 'brief', classification, output, effectiveIssueText: issueText }
  }

  const output = await callTask('resolve', { orderContext, issueText, classification })
  return { mode: 'resolution', classification, output, effectiveIssueText: issueText }
}

// Second, non-blocking call: the LLM judge for the eval panel.
export async function runJudge({ orderContext, issueText, classification, output, mode }) {
  return callTask('judge', { orderContext, issueText, classification, output, mode })
}
