import { useState } from 'react'
import { CATEGORY_LABELS } from '../ai/pipeline'

const STATUS_CHIP = {
  pass: { icon: '✓', cls: 'bg-green-100 text-green-800 border-green-300' },
  fail: { icon: '✗', cls: 'bg-red-100 text-red-800 border-red-300' },
  pending: { icon: '…', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  na: { icon: '—', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

const SOURCE_TAG = {
  code: { label: 'code check', cls: 'bg-blue-50 text-blue-700' },
  judge: { label: 'LLM judge', cls: 'bg-purple-50 text-purple-700' },
  user: { label: 'user verdict', cls: 'bg-orange-50 text-orange-700' },
}

// The portfolio differentiator: every response carries its own visible QA.
// Collapsible so it never crowds the answer, but always one click away.
export default function EvalPanel({ classification, rows }) {
  const [open, setOpen] = useState(false)
  const scored = rows.filter((r) => r.status === 'pass' || r.status === 'fail')
  const passed = scored.filter((r) => r.status === 'pass').length
  const anyFail = scored.some((r) => r.status === 'fail')
  const judgePending = rows.some((r) => r.source === 'judge' && r.status === 'pending')
  const awaitingUser = rows.some((r) => r.source === 'user' && r.status === 'pending')

  return (
    <div className="mt-3 border border-gray-200 rounded-lg bg-gray-50 text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-100 rounded-lg"
      >
        <span className="flex items-center gap-2 font-medium text-gray-700">
          <span className={anyFail ? 'text-red-600' : judgePending ? 'text-amber-600' : 'text-green-600'}>
            {anyFail ? '⚠' : '🛡'}
          </span>
          Eval panel — {passed}/{scored.length} checks passed
          {judgePending ? ' · judging…' : awaitingUser ? ' · awaiting your confirmation' : ''}
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 pt-1 pb-2 border-b border-gray-200">
            <span className="text-xs text-gray-500">Classified as</span>
            <span className="text-xs font-semibold bg-gray-800 text-white rounded px-2 py-0.5">
              {CATEGORY_LABELS[classification.category] || classification.category}
            </span>
            <span className="text-xs text-gray-500">confidence</span>
            <span className={`text-xs font-semibold rounded px-2 py-0.5 ${
              classification.confidence === 'HIGH' ? 'bg-green-600 text-white'
              : classification.confidence === 'MEDIUM' ? 'bg-amber-500 text-white'
              : 'bg-red-600 text-white'}`}>
              {classification.confidence}
            </span>
          </div>
          <p className="text-xs text-gray-500 italic">Model reasoning: {classification.reasoning}</p>
          {rows.map((r) => {
            const chip = STATUS_CHIP[r.status]
            const src = SOURCE_TAG[r.source]
            return (
              <div key={r.key} className="flex items-start gap-2">
                <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full border text-xs font-bold ${chip.cls}`}>
                  {chip.icon}
                </span>
                <div className="min-w-0">
                  <span className="font-medium text-gray-800">{r.label}</span>
                  <span className={`ml-2 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${src.cls}`}>{src.label}</span>
                  <p className="text-xs text-gray-600">{r.note}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
