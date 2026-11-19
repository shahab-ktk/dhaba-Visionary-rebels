import { useCallback, useEffect, useState } from 'react'
import { fetchInfo, fetchStats } from '../api'

export default function StatsPanel() {
  const [stats, setStats] = useState(null)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    fetchStats()
      .then(data => {
        setStats(data)
        setError(null)
      })
      .catch(e => setError(e.message))
    // /info is only for the footer; a failure there should not hide the stats.
    fetchInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  if (error && !stats) return <div className="center-msg error-msg">{error}</div>
  if (!stats) return <div className="center-msg">Loading stats...</div>

  const top = stats.top_dishes || []
  const max = Math.max(1, ...top.map(d => d.count))

  return (
    <div className="stats-panel">
      <header className="app-page-intro">
        <div>
          <p className="app-eyebrow">A LITTLE LOOK BEHIND THE SCENES</p>
          <h1>Today at the dhaba.</h1>
          <p>Live service stats, refreshed every few seconds.</p>
        </div>
        <span className="service-status"><i /> Live stats</span>
      </header>
      <div className="stat-tile">
        <div className="stat-value">{stats.orders_per_minute}</div>
        <div className="stat-label">Orders in the last minute</div>
      </div>

      <section className="stat-dishes">
        <h2>Top dishes</h2>
        {top.length === 0 ? (
          <p className="empty-col">No orders yet.</p>
        ) : (
          <ol className="dish-list">
            {top.map(d => (
              <li key={d.name} className="dish-row">
                <span className="dish-name">{d.name}</span>
                <span className="dish-bar-track">
                  <span className="dish-bar" style={{ width: `${(d.count / max) * 100}%` }} />
                </span>
                <span className="dish-count">{d.count}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="refresh-note">
        {info ? `orders-api ${info.version} answered from pod ${info.pod}. ` : ''}
        Refreshes every 5 seconds.
      </p>
    </div>
  )
}
