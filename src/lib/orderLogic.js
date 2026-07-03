// Order display + eligibility logic. All order dates are stored as relative
// offsets (daysAgo) and resolved against the real current date, so the demo's
// return windows never expire as the portfolio ages.

import ordersData from '../data/orders.json' with { type: 'json' }

const DAY_MS = 24 * 60 * 60 * 1000

const daysAgoToDate = (n) => new Date(Date.now() - n * DAY_MS)

export const formatDate = (d) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

export const formatPrice = (n) => `₹${n.toLocaleString('en-IN')}`

export function getOrders() {
  return ordersData.orders.map((o) => {
    const orderedOn = daysAgoToDate(o.orderedDaysAgo)
    const deliveredOn = o.deliveredDaysAgo != null ? daysAgoToDate(o.deliveredDaysAgo) : null
    const arrivingOn = o.arrivingInDays != null ? new Date(Date.now() + o.arrivingInDays * DAY_MS) : null

    const returnWindowEndsOn = deliveredOn && o.returnWindowDays > 0
      ? new Date(deliveredOn.getTime() + o.returnWindowDays * DAY_MS)
      : null
    const inReturnWindow = Boolean(returnWindowEndsOn && returnWindowEndsOn > new Date())
    const cancellable = o.status === 'processing'

    let statusLine
    if (o.status === 'delivered') statusLine = `Delivered ${formatDate(deliveredOn)}`
    else if (o.status === 'processing') statusLine = `Arriving ${formatDate(arrivingOn)} · not yet shipped`
    else statusLine = `Charged ${formatDate(orderedOn)}`

    return { ...o, orderedOn, deliveredOn, arrivingOn, returnWindowEndsOn, inReturnWindow, cancellable, statusLine }
  })
}

export function getOrder(id) {
  return getOrders().find((o) => o.id === id)
}

// What the co-pilot receives when a chat opens from this order — the stand-in
// for what Amazon's order API would provide in a native integration.
export function orderToContext(order) {
  return {
    orderId: order.id,
    product: `${order.product} (sold by ${order.seller})`,
    issueDate: new Date().toISOString().slice(0, 10),
    orderFacts: [
      order.statusLine,
      `ordered ${formatDate(order.orderedOn)}`,
      `${formatPrice(order.price)} paid via ${order.paymentMethod}`,
      order.returnWindowEndsOn
        ? `return window ${order.inReturnWindow ? 'open until' : 'closed on'} ${formatDate(order.returnWindowEndsOn)}`
        : 'not returnable',
      order.thirdParty ? 'third-party seller order' : 'fulfilled by Amazon',
    ].join(' · '),
  }
}
