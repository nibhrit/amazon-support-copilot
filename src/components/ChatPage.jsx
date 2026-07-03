import { useState, useRef, useEffect } from 'react'
import { getOrder, orderToContext } from '../lib/orderLogic'
import { runPipeline, runJudge } from '../ai/pipeline'
import ResponseCard from './ResponseCard'

let nextExchangeId = 1

// Amazon's bot has preloaded options that trap you in templates. Ours are the
// same familiar chips — but they just feed natural language into the pipeline,
// so "none of these match" stops being a dead end.
const QUICK_CHIPS = [
  'I want to return this item',
  "It says delivered but I never received it",
  'I received a wrong or damaged item',
  "Where is my refund?",
  'I have a problem with the seller',
  'My delivery is late',
]

// activeIssue is the conversation's running state: the accumulated issue text,
// its latest classification, and what the co-pilot last did. Every new message
// is interpreted against it, so replies read as replies — not fresh issues.
const EMPTY_SESSION = { messages: [], categoryCounts: {}, priorContext: null, activeIssue: null }

const ACK_TEXT = "Glad that's sorted! 🎉 If anything else comes up with this order — or any other — just tell me."

export default function ChatPage({ orderId, nav, session = EMPTY_SESSION, updateSession }) {
  const order = orderId ? getOrder(orderId) : null
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const { messages, categoryCounts, priorContext, activeIssue } = session

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.length, busy])

  const orderContext = order
    ? orderToContext(order)
    : { orderId: '', product: '', issueDate: new Date().toISOString().slice(0, 10), orderFacts: 'no order selected' }

  const patchExchange = (id, patch) =>
    updateSession((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.type === 'ai' && m.exchange.id === id ? { ...m, exchange: { ...m.exchange, ...patch } } : m),
    }))

  async function fireJudge(id, args) {
    try {
      const judge = await runJudge(args)
      patchExchange(id, { judge })
    } catch {
      patchExchange(id, {
        judge: {
          calibration_pass: false, calibration_note: 'Judge call failed — no verdict.',
          hallucination_pass: false, hallucination_note: 'Judge call failed — no verdict.',
        },
      })
    }
  }

  async function run(pipelineArgs, userText) {
    setBusy(true)
    setError(null)
    if (userText) updateSession((s) => ({ ...s, messages: [...s.messages, { type: 'user', text: userText }] }))
    try {
      const result = await runPipeline(pipelineArgs)

      if (result.mode === 'ack') {
        updateSession((s) => ({ ...s, messages: [...s.messages, { type: 'bot', text: ACK_TEXT }] }))
        return
      }

      const id = nextExchangeId++
      const exchange = {
        id,
        input: { orderContext: pipelineArgs.orderContext, issueText: result.effectiveIssueText },
        ...result,
        judge: null,
        userVerdict: null,
        briefSent: false,
      }
      updateSession((s) => ({
        ...s,
        messages: [...s.messages, { type: 'ai', exchange }],
        priorContext: result.mode === 'clarify' ? s.priorContext : null,
        categoryCounts: result.mode === 'clarify' ? s.categoryCounts : {
          ...s.categoryCounts,
          [result.classification.category]: (s.categoryCounts[result.classification.category] || 0) + 1,
        },
        activeIssue: {
          issueText: result.effectiveIssueText,
          classification: result.mode === 'clarify' ? s.activeIssue?.classification || null : result.classification,
          attemptedResolution: result.mode === 'resolution' ? result.output : s.activeIssue?.attemptedResolution || null,
          lastMode: result.mode,
        },
      }))

      if (result.mode !== 'clarify') {
        fireJudge(id, {
          orderContext: pipelineArgs.orderContext,
          issueText: result.effectiveIssueText,
          classification: result.classification,
          output: result.output,
          mode: result.mode,
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function send(text) {
    const clean = text.trim()
    if (!clean || busy) return
    setDraft('')
    const conversation = activeIssue ? {
      issueText: activeIssue.issueText,
      classification: activeIssue.classification,
      attemptedResolution: activeIssue.attemptedResolution,
      lastMode: activeIssue.lastMode,
    } : null
    const loopCategories = new Set(Object.keys(categoryCounts).filter((k) => categoryCounts[k] >= 1))
    run({ orderContext, issueText: clean, priorContext, loopCategories, conversation }, clean)
  }

  function handleReject(exchange) {
    patchExchange(exchange.id, { userVerdict: false })
    updateSession((s) => ({
      ...s,
      priorContext: { rejectedCategory: exchange.classification.category, previousIssueText: exchange.input.issueText },
      // The classification was wrong — drop it so the re-description is read fresh.
      activeIssue: null,
    }))
  }

  function handleStillNotResolved(exchange) {
    run(
      {
        orderContext: exchange.input.orderContext,
        issueText: exchange.input.issueText,
        loop: { classification: exchange.classification, attemptedResolution: exchange.output },
      },
      "This didn't solve my problem.",
    )
  }

  function handleSendBrief(exchange) {
    patchExchange(exchange.id, { briefSent: true })
    const caseId = `SIM-${String(exchange.id).padStart(4, '0')}`
    updateSession((s) => ({
      ...s,
      messages: [...s.messages, {
        type: 'bot',
        text: `✅ Brief sent to the ${exchange.output.suggested_owner} (case ${caseId}). A specialist will contact you within 24 hours and will already have your full context — you won't repeat any of this. (simulated handoff)`,
      }],
    }))
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => nav({ name: 'customerService' })} className="text-sm text-blue-700 hover:underline mb-2">‹ Customer Service</button>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col" style={{ minHeight: '60vh' }}>
        <div className="bg-[#232f3e] text-white px-4 py-2.5">
          <p className="text-sm font-semibold">Support Co-pilot</p>
          <p className="text-[11px] text-gray-300">Explains what it can fix, and hands off with full context when it can't</p>
        </div>

        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          <div className="bg-gray-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-gray-800 max-w-[85%]">
            Hi Nibhrit 👋 Tell me what's wrong in your own words — no menus to fight through.
            {order && (
              <span className="mt-2 flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5">
                <span className="text-xl">{order.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-gray-900 truncate">{order.product}</span>
                  <span className="block text-[11px] text-gray-500">{order.statusLine} · Order # {order.id}</span>
                </span>
              </span>
            )}
          </div>

          {messages.map((m, i) => {
            if (m.type === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="bg-[#131921] text-white rounded-lg rounded-tr-none px-3 py-2 text-sm max-w-[85%]">{m.text}</div>
                </div>
              )
            }
            if (m.type === 'bot') {
              return (
                <div key={i} className="bg-gray-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-gray-800 max-w-[85%]">{m.text}</div>
              )
            }
            return (
              <ResponseCard
                key={i}
                exchange={m.exchange}
                busy={busy}
                onConfirm={() => patchExchange(m.exchange.id, { userVerdict: true })}
                onReject={() => handleReject(m.exchange)}
                onStillNotResolved={() => handleStillNotResolved(m.exchange)}
                onSendBrief={() => handleSendBrief(m.exchange)}
              />
            )
          })}

          {busy && (
            <div className="bg-gray-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-gray-500 max-w-[85%] animate-pulse">
              Checking your order against policy…
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-2">Something went wrong: {error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {messages.length === 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {QUICK_CHIPS.map((c) => (
              <button key={c} onClick={() => send(c)} disabled={busy}
                className="text-xs border border-gray-300 rounded-full px-3 py-1 text-gray-600 hover:border-amber-400 hover:text-gray-900 disabled:opacity-50">
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 p-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(draft)}
            maxLength={2000}
            placeholder="Describe your issue…"
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button onClick={() => send(draft)} disabled={busy || !draft.trim()}
            className="bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-full px-5 py-2 text-sm font-semibold">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
