import { useEffect, useState } from 'react'
import { fetchMenu, placeOrder } from '../api'

export default function OrderPage() {
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cart, setCart] = useState({}) // { menuItemId: quantity }
  const [customerName, setCustomerName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)

  useEffect(() => {
    fetchMenu()
      .then(setMenu)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function addToCart(item) {
    setCart(prev => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }))
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const next = { ...prev }
      if (next[itemId] > 1) next[itemId] -= 1
      else delete next[itemId]
      return next
    })
  }

  const cartItems = menu
    .filter(m => cart[m.id])
    .map(m => ({ menu_item_id: m.id, name: m.name, price: m.price, quantity: cart[m.id] }))

  const cartTotal = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!customerName.trim() || cartItems.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await placeOrder(customerName.trim(), cartItems)
      setSubmitted(result)
      setCart({})
      setCustomerName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="center-msg">Loading menu...</div>

  const categories = [...new Set(menu.map(m => m.category))]

  return (
    <div className="order-page">
      <header className="app-page-intro">
        <div>
          <p className="app-eyebrow">THE DHABA TABLE</p>
          <h1>Good food starts here.</h1>
          <p>Pick a favourite, make it yours, and we’ll send it straight to the kitchen.</p>
        </div>
        <span className="service-status"><i /> Kitchen is open</span>
      </header>

      {submitted && (
        <div className="banner banner-success">
          Order #{submitted.id} placed. Watch the Kitchen tab for updates.
          <button className="banner-close" type="button" aria-label="Dismiss confirmation" onClick={() => setSubmitted(null)}>×</button>
        </div>
      )}
      {error && (
        <div className="banner banner-error">
          {error}
          <button className="banner-close" type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="order-layout">
        <section className="menu-section">
          <div className="section-title-row">
            <div>
              <p className="app-eyebrow">MADE TO BE SHARED</p>
              <h2>Explore the menu</h2>
            </div>
            <span className="menu-count">{menu.length} favourites</span>
          </div>
          {menu.length === 0 && <p className="empty-menu">The menu is being refreshed. Please check back shortly.</p>}
          {categories.map(cat => (
            <div key={cat} className="menu-category">
              <h3 className="category-label">{cat}</h3>
              <div className="menu-grid">
                {menu.filter(m => m.category === cat).map(item => (
                  <div key={item.id} className="menu-card">
                    <div className="menu-card-art" aria-hidden="true">
                      <span>{cat}</span>
                      <i>✳</i>
                    </div>
                    <div className="menu-card-content">
                      <div className="menu-card-name">{item.name}</div>
                      <div className="menu-card-desc">{item.description}</div>
                    </div>
                    <div className="menu-card-footer">
                      <span className="menu-price">Rs {item.price}</span>
                      <button className="btn btn-add" type="button" onClick={() => addToCart(item)} aria-label={`Add ${item.name} to your order`}>
                        <span aria-hidden="true">+</span> Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="cart-section">
          <div className="cart-heading">
            <div>
              <p className="app-eyebrow">MADE YOURS</p>
              <h2>Your order</h2>
            </div>
            <span className="cart-item-count">{cartItems.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </div>
          {cartItems.length === 0 ? (
            <div className="cart-empty">
              <span aria-hidden="true">✳</span>
              <p>Your table is waiting.</p>
              <small>Add a dish from the menu to get started.</small>
            </div>
          ) : (
            <ul className="cart-list">
              {cartItems.map(i => (
                <li key={i.menu_item_id} className="cart-row">
                  <span className="cart-name">{i.name}</span>
                  <span className="cart-controls">
                    <button className="btn btn-qty" type="button" aria-label={`Remove one ${i.name}`} onClick={() => removeFromCart(i.menu_item_id)}>−</button>
                    <span className="cart-qty">{i.quantity}</span>
                    <button
                      className="btn btn-qty"
                      type="button"
                      aria-label={`Add one ${i.name}`}
                      onClick={() => addToCart({ id: i.menu_item_id })}
                    >
                      +
                    </button>
                  </span>
                  <span className="cart-line">Rs {i.price * i.quantity}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="cart-total">
            <span>Total</span>
            <strong>Rs {cartTotal}</strong>
          </div>

          <form onSubmit={handleSubmit} className="cart-form">
            <label htmlFor="customer-name">Name for the order</label>
            <input
              id="customer-name"
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Who are we cooking for?"
              maxLength={100}
              autoComplete="name"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !customerName.trim() || cartItems.length === 0}
            >
              {submitting ? 'Sending to the kitchen…' : 'Send to the kitchen'}
            </button>
          </form>
          <p className="cart-footnote">Freshly prepared, one order at a time.</p>
        </aside>
      </div>
    </div>
  )
}
