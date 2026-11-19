import { useCallback, useEffect, useState } from 'react'
import { fetchOrders } from '../api'

// Status values match the orders.status column in Postgres.
const STATUS_ORDER = ['new', 'cooking', 'ready']
const STATUS_LABEL = { new: 'New', cooking: 'Cooking', ready: 'Ready' }

export default function KitchenScreen() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    fetchOrders()
      .then(data => {
        setOrders(data)
        setError(null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return <div className="center-msg">Loading orders...</div>
  const byStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = orders.filter(o => o.status === s)
    return acc
  }, {})

  return (
    <div className="kitchen-screen">
      <header className="app-page-intro kitchen-intro">
        <div>
          <p className="app-eyebrow">THE HEART OF THE HOUSE</p>
          <h1>Kitchen service.</h1>
          <p>Every order, right where it needs to be. This board refreshes automatically.</p>
        </div>
        <span className="service-status"><i /> Live board</span>
      </header>
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
          <button className="btn btn-retry" type="button" onClick={load}>Try again</button>
        </div>
      )}
      <div className="kitchen-cols">
        {STATUS_ORDER.map(status => (
          <div key={status} className={`kitchen-col kitchen-col-${status}`}>
            <h2 className="kitchen-col-title">
              {STATUS_LABEL[status]}
              <span className="col-count">{byStatus[status].length}</span>
            </h2>
            <div className="kitchen-cards">
              {byStatus[status].length === 0 ? (
                <p className="empty-col">Nothing here just yet.</p>
              ) : (
                byStatus[status].map(order => (
                  <div key={order.id} className="kitchen-card">
                    <div className="kc-header">
                      <span className="kc-id">#{order.id}</span>
                      <span className="kc-name">{order.customer_name}</span>
                    </div>
                    <ul className="kc-items">
                      {order.items.map(item => (
                        <li key={`${order.id}-${item.menu_item_id}`}>
                          <span>{item.name}</span>
                          <span className="kc-qty">x{item.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="kc-time">
                      {new Date(order.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="refresh-note"><span className="live-dot" /> Updates every 5 seconds</p>
    </div>
  )
}
