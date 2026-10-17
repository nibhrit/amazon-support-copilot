// Single gateway for all Claude calls. Forced tool-use means the model's only
// possible output is JSON matching the task's schema.

import Anthropic from '@anthropic-ai/sdk'
import { classifyPrompt, resolvePrompt, briefPrompt, judgePrompt } from './prompts.js'

const PROMPTS = {
  classify: classifyPrompt,
  resolve: resolvePrompt,
  brief: briefPrompt,
  judge: judgePrompt,
}

// Product prompts run on Sonnet (quality matters, user-facing).
// The eval judge runs on Haiku — a focused pass/fail rubric doesn't need the
// big model, and it keeps the eval panel fast and cheap.
export const MODELS = {
  classify: 'claude-sonnet-4-6',
  resolve: 'claude-sonnet-4-6',
  brief: 'claude-sonnet-4-6',
  judge: 'claude-haiku-4-5-20251001',
}

function buildRequest(task, input) {
  const build = PROMPTS[task]
  if (!build) throw new Error(`Unknown task: ${task}`)
  const { system, messages, maxTokens, schema } = build(input)
  return {
    model: MODELS[task],
    max_tokens: maxTokens,
    system,
    messages,
    tools: [{
      name: 'emit_result',
      description: 'Emit the structured result. This is the only valid way to respond.',
      input_schema: schema,
    }],
    tool_choice: { type: 'tool', name: 'emit_result' },
  }
}

// opts.onUsage (optional) receives { task, model, usage } after each call.
// The eval harness uses it to meter real spend; the API route doesn't pass it.
export async function callClaude(task, input, opts = {}) {
  const request = buildRequest(task, input)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const resp = await client.messages.create(request)
  opts.onUsage?.({ task, model: request.model, usage: resp.usage })

  const block = resp.content.find((b) => b.type === 'tool_use')
  if (!block) throw new Error('Model returned no structured output')
  return block.input
}

// Exact input-token count for the same request, without generating anything.
// The count_tokens endpoint is free, so the harness can price a run up front.
export async function countClaudeTokens(task, input) {
  const { max_tokens: maxOutputTokens, ...request } = buildRequest(task, input)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { input_tokens: inputTokens } = await client.messages.countTokens(request)
  return { model: request.model, inputTokens, maxOutputTokens }
}
