// Amazon-style chrome: header, nav strip, disclaimer. Layout and palette are
// representative of amazon.in; deliberately no Amazon logo or trademark art.

export default function AmazonShell({ nav, children }) {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="bg-amber-100 text-amber-900 text-xs text-center py-1.5 px-3">
        Work sample built by Nibhrit Mohanty — Not official Amazon content. UI is representative; all orders and policies are simulated.
      </div>

      <header className="bg-[#131921] text-white">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <button onClick={() => nav({ name: 'orders' })} className="font-bold text-lg tracking-tight shrink-0">
            amazon<span className="text-amber-400">.in</span>
            <span className="ml-1.5 text-[10px] font-normal text-gray-400 align-top">prototype</span>
          </button>
          <div className="hidden sm:flex flex-1 bg-white rounded overflow-hidden">
            <input disabled placeholder="Search Amazon.in (disabled in prototype)"
              className="flex-1 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 bg-white" />
            <div className="bg-amber-400 px-3 flex items-center text-gray-900">🔍</div>
          </div>
          <div className="text-xs leading-tight shrink-0 hidden sm:block">
            <p className="text-gray-300">Hello, Nibhrit</p>
            <p className="font-bold">Account &amp; Lists</p>
          </div>
          <button onClick={() => nav({ name: 'orders' })} className="text-xs leading-tight shrink-0 text-left">
            <p className="text-gray-300">Returns</p>
            <p className="font-bold">&amp; Orders</p>
          </button>
        </div>
      </header>

      <nav className="bg-[#232f3e] text-white text-sm">
        <div className="max-w-5xl mx-auto px-4 py-1.5 flex items-center gap-5">
          <button onClick={() => nav({ name: 'orders' })} className="hover:underline">Your Orders</button>
          <button onClick={() => nav({ name: 'customerService' })} className="hover:underline">Customer Service</button>
          <span className="text-gray-400 hidden sm:inline">Prime</span>
          <span className="text-gray-400 hidden sm:inline">Fresh</span>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5">{children}</main>

      <footer className="text-center text-xs text-gray-400 pb-6">
        Portfolio prototype · React + Claude API · evals visible on every AI response
      </footer>
    </div>
  )
}
