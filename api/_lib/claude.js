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
const MODELS = {
  classify: 'claude-sonnet-4-6',
  resolve: 'claude-sonnet-4-6',
  brief: 'claude-sonnet-4-6',
  judge: 'claude-haiku-4-5-20251001',
}

export async function callClaude(task, input) {
  const build = PROMPTS[task]
  if (!build) throw new Error(`Unknown task: ${task}`)
  const { system, messages, maxTokens, schema } = build(input)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const resp = await client.messages.create({
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
  })

  const block = resp.content.find((b) => b.type === 'tool_use')
  if (!block) throw new Error('Model returned no structured output')
  return block.input
}
