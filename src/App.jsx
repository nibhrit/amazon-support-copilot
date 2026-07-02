import { useState } from 'react'
import IssueForm from './components/IssueForm'
import ResponseCard from './components/ResponseCard'
import { runPipeline, runJudge } from './ai/pipeline'

const EMPTY_FORM = { orderId: '', product: '', issueDate: '', issueText: '' }
let nextId = 1

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [exchanges, setExchanges] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Loop-detection session state: how many times each issue type has come up.
  const [categoryCounts, setCategoryCounts] = useState({})
  // Set when the user rejects a classification — carried into the next classify call.
  const [priorContext, setPriorContext] = useState(null)

  const patchExchange = (id, patch) =>
    setExchanges((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  async function fireJudge(id, { orderContext, issueText, classification, output, mode }) {
    try {
      const judge = await runJudge({ orderContext, issueText, classification, output, mode })
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

  async function submit(pipelineArgs) {
    setBusy(true)
    setError(null)
    try {
      const result = await runPipeline(pipelineArgs)
      const id = nextId++
      const exchange = {
        id,
        input: { orderContext: pipelineArgs.orderContext, issueText: pipelineArgs.issueText },
        ...result,
        judge: null,
        userVerdict: null,
      }
      setExchanges((xs) => [...xs, exchange])

      if (result.mode !== 'clarify') {
        setCategoryCounts((c) => ({ ...c, [result.classification.category]: (c[result.classification.category] || 0) + 1 }))
        setPriorContext(null)
        fireJudge(id, {
          orderContext: pipelineArgs.orderContext,
          issueText: pipelineArgs.issueText,
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

  function handleSubmit() {
    const { orderId, product, issueDate, issueText } = form
    // Loop guardrail (typed path): categories already seen once get escalated,
    // not re-run through the same resolution flow.
    const loopCategories = new Set(Object.keys(categoryCounts).filter((k) => categoryCounts[k] >= 1))
    submit({
      orderContext: { orderId, product, issueDate },
      issueText,
      priorContext,
      loopCategories,
    })
  }

  function handleReject(exchange) {
    patchExchange(exchange.id, { userVerdict: false })
    setPriorContext({
      rejectedCategory: exchange.classification.category,
      previousIssueText: exchange.input.issueText,
    })
    setForm((f) => ({ ...f, issueText: exchange.input.issueText }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleStillNotResolved(exchange) {
    // Loop guardrail (button path): skip re-classification entirely.
    submit({
      orderContext: exchange.input.orderContext,
      issueText: exchange.input.issueText,
      loop: {
        classification: exchange.classification,
        attemptedResolution: exchange.output,
      },
    })
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-amber-100 text-amber-900 text-xs text-center py-1.5 px-3">
        Work sample built by Nibhrit Mohanty — Not official Amazon content. All policies are simulated.
      </div>

      <header className="bg-[#131921] text-white px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-bold text-lg">Amazon Support Resolution Co-pilot</h1>
          <p className="text-xs text-gray-300">
            Understands your issue in plain language · knows when it can't resolve · hands off with full context
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <IssueForm form={form} setForm={setForm} onSubmit={handleSubmit} busy={busy} />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            Something went wrong: {error}
          </div>
        )}

        {[...exchanges].reverse().map((x) => (
          <ResponseCard
            key={x.id}
            exchange={x}
            busy={busy}
            onConfirm={() => patchExchange(x.id, { userVerdict: true })}
            onReject={() => handleReject(x)}
            onStillNotResolved={() => handleStillNotResolved(x)}
          />
        ))}

        {busy && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-500 animate-pulse">
            Classifying your issue and checking policies…
          </div>
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-4 pb-8 text-center text-xs text-gray-400">
        Portfolio prototype · React + Claude API · evals visible on every response
      </footer>
    </div>
  )
}
