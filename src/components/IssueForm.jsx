const SAMPLES = [
  {
    label: 'Return shoes (resolvable)',
    form: {
      orderId: '171-2233445-0011223',
      product: 'Nike Revolution 7 running shoes',
      issueDate: '2026-06-27',
      issueText: "I bought these running shoes 5 days ago and they're too small. I want to return them and get my money back.",
    },
  },
  {
    label: 'Fake SSD from seller (escalates)',
    form: {
      orderId: '408-1122334-5566778',
      product: 'Samsung 980 1TB SSD (sold by RetailKing)',
      issueDate: '2026-06-25',
      issueText: "I bought an SSD from a third-party seller on Amazon and it's clearly fake — half the advertised capacity. The seller isn't replying to my messages for a week.",
    },
  },
  {
    label: 'Marked delivered, not received',
    form: {
      orderId: '403-5566778-9900112',
      product: 'boAt Airdopes earbuds',
      issueDate: '2026-07-01',
      issueText: 'My package shows delivered yesterday at 3pm but I never got it. Nobody in my building received anything either.',
    },
  },
]

export default function IssueForm({ form, setForm, onSubmit, busy }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
      <h2 className="font-semibold text-gray-800">Describe your order issue</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={form.orderId} onChange={set('orderId')} placeholder="Order ID (optional)"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input value={form.product} onChange={set('product')} placeholder="Product (optional)"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input value={form.issueDate} onChange={set('issueDate')} type="date"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>

      <textarea value={form.issueText} onChange={set('issueText')} rows={3} maxLength={2000}
        placeholder="Tell us what happened, in your own words — e.g. “My order says delivered but I never received it”"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={busy || !form.issueText.trim()}
          className="bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 font-semibold rounded-lg px-5 py-2 text-sm"
        >
          {busy ? 'Working…' : 'Get help'}
        </button>
        <span className="text-xs text-gray-400 mr-1">or try a sample:</span>
        {SAMPLES.map((s) => (
          <button key={s.label} onClick={() => setForm(s.form)} disabled={busy}
            className="text-xs border border-gray-300 rounded-full px-3 py-1 text-gray-600 hover:border-amber-400 hover:text-gray-900 disabled:opacity-50">
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
