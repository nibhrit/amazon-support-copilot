import { useState } from 'react'
import AmazonShell from './components/AmazonShell'
import OrdersPage from './components/OrdersPage'
import OrderDetailPage from './components/OrderDetailPage'
import CustomerServicePage from './components/CustomerServicePage'
import ChatPage from './components/ChatPage'

const EMPTY_SESSION = { messages: [], categoryCounts: {}, priorContext: null, clarifyBase: null }

export default function App() {
  const [view, setView] = useState({ name: 'orders' })
  // Chat sessions keyed by order id — leaving a chat and coming back keeps the
  // conversation, its loop counter, and any pending clarification.
  const [chatSessions, setChatSessions] = useState({})

  const sessionKey = view.orderId || '_no_order'
  const updateSession = (fn) =>
    setChatSessions((all) => ({ ...all, [sessionKey]: fn(all[sessionKey] || EMPTY_SESSION) }))

  return (
    <AmazonShell nav={setView}>
      {view.name === 'orders' && <OrdersPage nav={setView} />}
      {view.name === 'orderDetail' && <OrderDetailPage orderId={view.orderId} nav={setView} />}
      {view.name === 'customerService' && <CustomerServicePage nav={setView} />}
      {view.name === 'chat' && (
        <ChatPage
          orderId={view.orderId}
          nav={setView}
          session={chatSessions[sessionKey] || EMPTY_SESSION}
          updateSession={updateSession}
        />
      )}
    </AmazonShell>
  )
}
