// Thin client for the /api/claude proxy. The browser never sees the API key
// or the prompts — it sends task + user input, gets structured JSON back.

export async function callTask(task, input) {
  const resp = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, input }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(data.error || `API error (${resp.status})`)
  }
  return data.result
}
