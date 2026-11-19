import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'

const MENU = [
  { id: 1, name: 'Chicken Biryani', description: 'Rice', price: 450, category: 'Main Course' },
  { id: 2, name: 'Naan', description: 'Bread', price: 50, category: 'Bread' },
]

function mockFetch(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(url => {
      const body = routes[url]
      return Promise.resolve({ ok: body !== undefined, status: body ? 200 : 404, json: () => Promise.resolve(body) })
    })
  )
}

beforeEach(() => window.history.replaceState(null, '', '/app'))

afterEach(() => vi.unstubAllGlobals())

test('shows the menu and adds an item to the cart', async () => {
  mockFetch({ '/api/menu': MENU })
  render(<App />)

  expect(await screen.findByText('Chicken Biryani')).toBeInTheDocument()
  fireEvent.click(screen.getAllByText('Add')[0])
  expect(screen.getByText('Rs 450', { selector: '.cart-line' })).toBeInTheDocument()
})

test('place order button stays disabled without a name', async () => {
  mockFetch({ '/api/menu': MENU })
  render(<App />)

  await screen.findByText('Naan')
  fireEvent.click(screen.getAllByText('Add')[1])
  expect(screen.getByRole('button', { name: 'Send to the kitchen' })).toBeDisabled()
})

test('kitchen tab groups orders by status', async () => {
  mockFetch({
    '/api/menu': MENU,
    '/api/orders': [
      {
        id: 7,
        customer_name: 'Ali',
        status: 'cooking',
        created_at: new Date().toISOString(),
        items: [{ menu_item_id: 1, name: 'Chicken Biryani', quantity: 2 }],
      },
    ],
  })
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }))
  await waitFor(() => expect(screen.getByText('#7')).toBeInTheDocument())
  expect(screen.getByText('Cooking')).toBeInTheDocument()
})
