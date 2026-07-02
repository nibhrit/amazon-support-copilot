// Vercel serverless function — the only place the API key exists.
// The browser sends {task, input}; prompts are built server-side so the
// endpoint can't be repurposed as a general Claude proxy.

import { callClaude } from './_lib/claude.js'

const VALID_TASKS = new Set(['classify', 'resolve', 'brief', 'judge'])
const MAX_ISSUE_CHARS = 2000
const MAX_FIELD_CHARS = 200

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' })
  }

  const { task, input } = req.body || {}
  if (!VALID_TASKS.has(task)) {
    return res.status(400).json({ error: `task must be one of: ${[...VALID_TASKS].join(', ')}` })
  }
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'input object required' })
  }

  // Abuse caps: the key is safe server-side, but the wallet needs bounds too.
  if (typeof input.issueText !== 'string' || !input.issueText.trim()) {
    return res.status(400).json({ error: 'input.issueText (non-empty string) required' })
  }
  if (input.issueText.length > MAX_ISSUE_CHARS) {
    return res.status(400).json({ error: `issueText too long (max ${MAX_ISSUE_CHARS} chars)` })
  }
  const oc = input.orderContext || {}
  for (const k of ['orderId', 'product', 'issueDate']) {
    if (oc[k] && String(oc[k]).length > MAX_FIELD_CHARS) {
      return res.status(400).json({ error: `orderContext.${k} too long (max ${MAX_FIELD_CHARS} chars)` })
    }
  }

  try {
    const result = await callClaude(task, input)
    return res.status(200).json({ result })
  } catch (err) {
    console.error(`[api/claude] ${task} failed:`, err)
    return res.status(502).json({ error: 'AI call failed', detail: err.message })
  }
}
