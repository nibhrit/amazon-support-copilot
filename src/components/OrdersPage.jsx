import { getOrders, formatDate, formatPrice } from '../lib/orderLogic'

export default function OrdersPage({ nav }) {
  const orders = getOrders()
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-3">Your Orders</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <div key={o.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
              <span>ORDER PLACED<br /><span className="text-gray-800">{formatDate(o.orderedOn)}</span></span>
              <span>TOTAL<br /><span className="text-gray-800">{formatPrice(o.price)}</span></span>
              <span className="hidden sm:block">SHIP TO<br /><span className="text-blue-700">Nibhrit Mohanty</span></span>
              <span className="ml-auto hidden sm:block">ORDER # {o.id}</span>
            </div>
            <div className="px-4 py-3 flex gap-3 items-start">
              <div className="text-4xl shrink-0 w-14 h-14 flex items-center justify-center bg-gray-100 rounded">{o.emoji}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${o.status === 'delivered' ? 'text-gray-900' : 'text-green-700'}`}>{o.statusLine}</p>
                <button onClick={() => nav({ name: 'orderDetail', orderId: o.id })}
                  className="text-blue-700 hover:underline text-sm text-left">
                  {o.product}
                </button>
                <p className="text-xs text-gray-500">Sold by {o.seller}{o.thirdParty ? ' (third-party seller)' : ''}</p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0 w-40">
                <button onClick={() => nav({ name: 'orderDetail', orderId: o.id })}
                  className="text-xs bg-amber-400 hover:bg-amber-500 rounded-full py-1.5 px-3 font-medium">
                  View order details
                </button>
                <button onClick={() => nav({ name: 'chat', orderId: o.id })}
                  className="text-xs border border-gray-300 hover:bg-gray-50 rounded-full py-1.5 px-3">
                  Get product support
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
