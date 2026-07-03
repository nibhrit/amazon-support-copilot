import { getOrders } from '../lib/orderLogic'

export default function CustomerServicePage({ nav }) {
  const orders = getOrders()
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Hi Nibhrit. What do you need help with?</h1>
      <p className="text-sm text-gray-600 mb-4">Choose the order you're having an issue with and our support co-pilot will take it from there.</p>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {orders.map((o) => (
          <button key={o.id} onClick={() => nav({ name: 'chat', orderId: o.id })}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
            <span className="text-3xl w-12 h-12 flex items-center justify-center bg-gray-100 rounded shrink-0">{o.emoji}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-gray-900 truncate">{o.product}</span>
              <span className="block text-xs text-gray-500">{o.statusLine}</span>
            </span>
            <span className="text-blue-700 text-sm shrink-0">Get help ›</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Issue with something else? <button onClick={() => nav({ name: 'chat', orderId: null })} className="text-blue-700 hover:underline">Chat without selecting an order</button>
      </p>
    </div>
  )
}
