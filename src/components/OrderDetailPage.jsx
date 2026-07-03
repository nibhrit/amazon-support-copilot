import { useState } from 'react'
import { getOrder, formatDate, formatPrice } from '../lib/orderLogic'

const RETURN_REASONS = ['Wrong size / doesn\'t fit', 'Item defective or doesn\'t work', 'Changed my mind', 'Received wrong item', 'Quality not as expected']

// Self-serve return/cancel: deliberately shallow mocks. The product point is
// that templated in-window cases get buttons, not AI — the co-pilot is for
// everything the buttons can't handle.
function ReturnFlow({ order, onClose }) {
  const [reason, setReason] = useState(null)
  const [done, setDone] = useState(false)
  const pickupDate = new Date(Date.now() + 24 * 60 * 60 * 1000)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <div className="bg-white rounded-xl max-w-md w-full p-5">
        {!done ? (
          <>
            <h3 className="font-semibold text-gray-900 mb-1">Return: {order.product}</h3>
            <p className="text-xs text-gray-500 mb-3">Why are you returning this?</p>
            <div className="space-y-1.5 mb-4">
              {RETURN_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="text-sm px-4 py-1.5 border border-gray-300 rounded-full hover:bg-gray-50">Cancel</button>
              <button onClick={() => setDone(true)} disabled={!reason}
                className="text-sm px-4 py-1.5 bg-amber-400 hover:bg-amber-500 rounded-full font-medium disabled:opacity-50">
                Confirm return
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-2xl mb-2">✅</p>
            <h3 className="font-semibold text-gray-900 mb-1">Pickup scheduled</h3>
            <p className="text-sm text-gray-700">
              A pickup agent will collect the item on <strong>{formatDate(pickupDate)}</strong>. After the doorstep
              quality check, {formatPrice(order.price)} will be refunded to your {order.paymentMethod}.
            </p>
            <p className="text-[11px] text-gray-400 mt-2">(simulated self-serve flow — no AI involved; this is the templated path)</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-1.5 bg-amber-400 hover:bg-amber-500 rounded-full font-medium">Done</button>
          </>
        )}
      </div>
    </div>
  )
}

function CancelFlow({ order, onClose }) {
  const [done, setDone] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <div className="bg-white rounded-xl max-w-md w-full p-5">
        {!done ? (
          <>
            <h3 className="font-semibold text-gray-900 mb-2">Cancel this item?</h3>
            <p className="text-sm text-gray-700 mb-4">{order.product} hasn't shipped yet, so it can be cancelled with an immediate refund.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="text-sm px-4 py-1.5 border border-gray-300 rounded-full hover:bg-gray-50">Keep item</button>
              <button onClick={() => setDone(true)} className="text-sm px-4 py-1.5 bg-amber-400 hover:bg-amber-500 rounded-full font-medium">Cancel item</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-2xl mb-2">✅</p>
            <h3 className="font-semibold text-gray-900 mb-1">Order cancelled</h3>
            <p className="text-sm text-gray-700">Refund of {formatPrice(order.price)} initiated to your {order.paymentMethod}.</p>
            <p className="text-[11px] text-gray-400 mt-2">(simulated self-serve flow — no AI involved)</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-1.5 bg-amber-400 hover:bg-amber-500 rounded-full font-medium">Done</button>
          </>
        )}
      </div>
    </div>
  )
}

export default function OrderDetailPage({ orderId, nav }) {
  const order = getOrder(orderId)
  const [flow, setFlow] = useState(null) // 'return' | 'cancel' | null
  if (!order) return null

  return (
    <div>
      <button onClick={() => nav({ name: 'orders' })} className="text-sm text-blue-700 hover:underline mb-2">‹ Back to Your Orders</button>
      <h1 className="text-xl font-semibold text-gray-900 mb-3">Order Details</h1>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-3 text-sm text-gray-700 flex flex-wrap gap-x-8 gap-y-1">
        <span>Ordered {formatDate(order.orderedOn)}</span>
        <span>Order # {order.id}</span>
        <span>{formatPrice(order.price)} · {order.paymentMethod}</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 flex gap-4 items-start">
          <div className="text-5xl shrink-0 w-20 h-20 flex items-center justify-center bg-gray-100 rounded">{order.emoji}</div>
          <div>
            <p className={`text-sm font-semibold mb-1 ${order.status === 'delivered' ? 'text-gray-900' : 'text-green-700'}`}>{order.statusLine}</p>
            <p className="text-blue-700 text-sm">{order.product}</p>
            <p className="text-xs text-gray-500 mb-2">Sold by {order.seller}{order.thirdParty ? ' (third-party seller)' : ''}</p>
            {order.returnWindowEndsOn && (
              <p className={`text-xs ${order.inReturnWindow ? 'text-green-700' : 'text-gray-500'}`}>
                {order.inReturnWindow
                  ? `Return window open until ${formatDate(order.returnWindowEndsOn)}`
                  : `Return window closed on ${formatDate(order.returnWindowEndsOn)}`}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2">Deliver to: Nibhrit Mohanty, Powai, Mumbai 400076</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {order.inReturnWindow && (
            <button onClick={() => setFlow('return')}
              className="text-sm bg-amber-400 hover:bg-amber-500 rounded-full py-2 px-4 font-medium">
              Return or replace items
            </button>
          )}
          {order.cancellable && (
            <button onClick={() => setFlow('cancel')}
              className="text-sm bg-amber-400 hover:bg-amber-500 rounded-full py-2 px-4 font-medium">
              Cancel item
            </button>
          )}
          <button onClick={() => nav({ name: 'chat', orderId: order.id })}
            className="text-sm border border-gray-300 hover:bg-gray-50 rounded-full py-2 px-4">
            Get help with this order
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            {order.inReturnWindow || order.cancellable
              ? 'Standard actions are self-serve — the co-pilot handles everything else.'
              : 'No self-serve actions available — the co-pilot can help.'}
          </p>
        </div>
      </div>

      {flow === 'return' && <ReturnFlow order={order} onClose={() => setFlow(null)} />}
      {flow === 'cancel' && <CancelFlow order={order} onClose={() => setFlow(null)} />}
    </div>
  )
}
