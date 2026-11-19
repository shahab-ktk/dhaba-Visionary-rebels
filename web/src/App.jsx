import { useState } from 'react'
import OrderPage from './pages/OrderPage'
import KitchenScreen from './pages/KitchenScreen'
import StatsPanel from './pages/StatsPanel'

const TABS = [
  { id: 'order', label: 'Order' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'stats', label: 'Stats' },
]

export default function App() {
  const [tab, setTab] = useState('order')

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-brand" href="/" aria-label="Dhaba Orders home">
          <span className="app-brand-mark" aria-hidden="true">D</span>
          <span>
            <strong>Dhaba Orders</strong>
            <small>GOOD FOOD, GOOD COMPANY</small>
          </span>
        </a>
        <nav className="tab-nav" aria-label="Restaurant tools">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <a className="back-to-home" href="/">Back to our story <span aria-hidden="true">↗</span></a>
      </header>

      <main className="app-main">
        {tab === 'order' && <OrderPage />}
        {tab === 'kitchen' && <KitchenScreen />}
        {tab === 'stats' && <StatsPanel />}
      </main>
    </div>
  )
}
