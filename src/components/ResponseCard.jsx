import { useState } from 'react'
import { buildEvalPanel } from '../ai/evals'
import { CATEGORY_LABELS } from '../ai/pipeline'
import EvalPanel from './EvalPanel'

function ConfidenceBadge({ confidence }) {
  const cls = confidence === 'HIGH' ? 'bg-green-600' : confidence === 'MEDIUM' ? 'bg-amber-500' : 'bg-red-600'
  return <span className={`${cls} text-white text-xs font-semibold rounded px-2 py-0.5`}>{confidence} confidence</span>
}

// Collapsed to a one-line chip by default — the grounding is a tap away, not
// in the frustrated user's face.
function PolicyCitation({ cited }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg text-sm">
      <button onClick={() => setOpen(!open)} className="w-full text-left px-3 py-1.5 text-xs font-semibold text-blue-800">
        📋 Backed by policy {cited.policy_id} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="px-3 pb-2">
          <p className="text-gray-700 italic">“{cited.quote}”</p>
          <p className="text-[11px] text-gray-500 mt-1">(simulated policy — verify at amazon.in)</p>
        </div>
      )}
    </div>
  )
}

function Collapsible({ label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-xs font-medium text-gray-500 hover:text-gray-800">
        {label} {open ? '▾' : '▸'}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

function ConfirmBar({ verdict, onConfirm, onReject }) {
  if (verdict !== null) {
    return (
      <p className="text-xs text-gray-500 mt-3">
        {verdict ? '✓ You confirmed this matches your issue.' : '↺ You chose to re-describe — type the correction below; your earlier description is kept.'}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100">
      <span className="text-sm text-gray-600">Did we understand your issue correctly?</span>
      <button onClick={onConfirm} className="text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1.5 font-medium">
        Yes, this is my issue
      </button>
      <button onClick={onReject} className="text-sm border border-gray-300 hover:border-gray-500 text-gray-700 rounded-lg px-3 py-1.5 font-medium">
        No, let me re-describe
      </button>
    </div>
  )
}

function briefToText(b) {
  return [
    `ESCALATION BRIEF`,
    `Issue type: ${b.issue_type}`,
    `What the user reported: ${b.user_reported}`,
    `Resolution attempted: ${b.attempted_resolution}`,
    `User is asking for: ${b.user_request}`,
    `Missing info an agent will need: ${(b.missing_info || []).join('; ') || 'none'}`,
    `Suggested owner: ${b.suggested_owner}`,
    `Urgency: ${b.urgency}`,
  ].join('\n')
}

export default function ResponseCard({ exchange, onConfirm, onReject, onStillNotResolved, onSendBrief, busy }) {
  const { mode, classification, output, judge, userVerdict, loopDetected, briefSent } = exchange

  if (mode === 'clarify') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs font-semibold bg-gray-800 text-white rounded px-2 py-0.5">Needs clarification</span>
          <ConfidenceBadge confidence={classification.confidence} />
        </div>
        <p className="text-gray-800">{classification.clarifying_question}</p>
        <p className="text-xs text-gray-500 mt-2">
          I'd rather ask than guess — reply below with the missing detail. Your earlier description is kept.
        </p>
      </div>
    )
  }

  const evalRows = buildEvalPanel({ mode, classification, output, judge, userVerdict })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-semibold bg-gray-800 text-white rounded px-2 py-0.5">
          {CATEGORY_LABELS[classification.category] || classification.category}
        </span>
        <ConfidenceBadge confidence={classification.confidence} />
        {loopDetected && (
          <span className="bg-red-100 text-red-800 border border-red-300 text-xs font-semibold rounded px-2 py-0.5">
            ⟳ Loop detected — escalated instead of repeating the flow
          </span>
        )}
      </div>

      {mode === 'resolution' && (
        <div className="space-y-3">
          <p className="text-gray-800 font-medium">{output.issue_summary}</p>
          {output.resolution_type === 'partial' && (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-900">
              I can start this — part of it needs a human (below).
            </p>
          )}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Do this now:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
              {output.resolution_steps.map((s, i) => <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>)}
            </ol>
            <p className="text-[11px] text-gray-400 mt-1">
              Steps refer to the real Amazon app — if they don't work, escalate below.
            </p>
          </div>
          {output.needs_human_review?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Needs human review:</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {output.needs_human_review.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          <PolicyCitation cited={output.policy_cited} />
          <Collapsible label="What happens next">
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {output.next_steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Collapsible>
          <button onClick={onStillNotResolved} disabled={busy}
            className="text-sm border border-red-300 text-red-700 hover:bg-red-50 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
            This didn't solve it — escalate to a human
          </button>
        </div>
      )}

      {mode === 'brief' && (
        <div className="space-y-3">
          <p className="text-sm bg-gray-100 rounded-lg p-2 text-gray-700">
            This needs a human. I've prepared your full case — you won't repeat yourself.
          </p>
          <Collapsible label="View what the agent will receive">
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
              {[
                ['Issue type', output.issue_type],
                ['What you told us', output.user_reported],
                ['Resolution attempted', output.attempted_resolution],
                ['What you\'re asking for', output.user_request],
              ].map(([k, v]) => (
                <div key={k} className="p-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{k}</p>
                  <p className="text-gray-800">{v}</p>
                </div>
              ))}
              {output.missing_info?.length > 0 && (
                <div className="p-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent will ask you for</p>
                  <ul className="list-disc list-inside text-gray-800">
                    {output.missing_info.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Collapsible>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200 rounded px-2 py-0.5">
              → {output.suggested_owner}
            </span>
            <span className={`text-xs font-semibold rounded px-2 py-0.5 border ${
              output.urgency === 'Standard' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
              {output.urgency}
            </span>
            {briefSent ? (
              <span className="text-xs font-medium text-green-700">✓ Sent to {output.suggested_owner}</span>
            ) : (
              <button onClick={onSendBrief} disabled={busy}
                className="text-xs bg-amber-400 hover:bg-amber-500 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50">
                Send to support agent
              </button>
            )}
            <button onClick={() => navigator.clipboard.writeText(briefToText(output))}
              className="text-xs border border-gray-300 hover:border-gray-500 text-gray-700 rounded-lg px-3 py-1.5 font-medium">
              Copy brief
            </button>
          </div>
        </div>
      )}

      <ConfirmBar verdict={userVerdict} onConfirm={onConfirm} onReject={onReject} />
      <EvalPanel classification={classification} rows={evalRows} />
    </div>
  )
}
