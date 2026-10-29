import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// Özel piksel Shopify’ın korumalı alanında çalışır: analytics, window ve document hazır gelir.
function runPixel() {
  const handlers = {}
  const appended = []
  const sandbox = {
    analytics: { subscribe: (name, handler) => (handlers[name] = handler) },
    document: { createElement: () => ({}), head: { appendChild: (node) => appended.push(node) } },
  }
  sandbox.window = sandbox
  vm.runInNewContext(readFileSync(new URL('../pixels/ga4-ozel-piksel.js', import.meta.url), 'utf8'), sandbox)
  const calls = () => Array.from(sandbox.dataLayer, (args) => JSON.parse(JSON.stringify(Array.from(args))))
  const fire = (name, data) => handlers[name]({ name, data, context: { document: { location: { href: 'https://magaza.com/x' }, title: 'Başlık', referrer: '' } } })
  return { handlers, appended, calls, fire }
}

const money = (amount) => ({ amount, currencyCode: 'TRY' })
const variant = { id: '11', sku: 'KG-M', title: 'M / Beyaz', price: money(1249.9), product: { id: '5', title: 'Keten Gömlek', vendor: 'Örnek', type: 'Gömlek' } }
const plainVariant = { id: '12', sku: '', title: 'Default Title', price: money(250), product: { id: '6', title: 'Bez Çanta', vendor: '', type: '' } }

test('gtag yüklenir, otomatik sayfa görüntüleme kapalı, dokuz etkinliğe abone olunur', () => {
  const pixel = runPixel()
  assert.match(pixel.appended[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-/)
  assert.deepEqual(pixel.calls()[1], ['config', 'G-XXXXXXXXXX', { send_page_view: false }])
  assert.equal(Object.keys(pixel.handlers).length, 9)
})

test('ürün, liste, arama ve sepet etkinlikleri', () => {
  const pixel = runPixel()
  pixel.fire('page_viewed', {})
  pixel.fire('product_viewed', { productVariant: variant })
  pixel.fire('collection_viewed', { collection: { id: '9', title: 'Yeni', productVariants: [variant, plainVariant] } })
  pixel.fire('search_submitted', { searchResult: { query: 'keten' } })
  pixel.fire('product_added_to_cart', { cartLine: { merchandise: variant, quantity: 2, cost: { totalAmount: money(2499.8) } } })
  pixel.fire('cart_viewed', { cart: { cost: { totalAmount: money(2749.8) }, lines: [{ merchandise: variant, quantity: 2, cost: { totalAmount: money(2499.8) } }, { merchandise: plainVariant, quantity: 1, cost: { totalAmount: money(250) } }] } })
  const events = pixel.calls().slice(2)
  const location = 'https://magaza.com/x'
  const shirt = { item_id: 'KG-M', item_name: 'Keten Gömlek', item_variant: 'M / Beyaz', item_brand: 'Örnek', item_category: 'Gömlek' }
  assert.deepEqual(events, [
    ['event', 'page_view', { page_location: location, page_title: 'Başlık' }],
    ['event', 'view_item', { page_location: location, currency: 'TRY', value: 1249.9, items: [{ ...shirt, price: 1249.9, quantity: 1 }] }],
    [
      'event',
      'view_item_list',
      { page_location: location, item_list_id: '9', item_list_name: 'Yeni', items: [{ ...shirt, price: 1249.9, quantity: 1, index: 0 }, { item_id: '6', item_name: 'Bez Çanta', price: 250, quantity: 1, index: 1 }] },
    ],
    ['event', 'search', { page_location: location, search_term: 'keten' }],
    ['event', 'add_to_cart', { page_location: location, currency: 'TRY', value: 2499.8, items: [{ ...shirt, price: 1249.9, quantity: 2 }] }],
    ['event', 'view_cart', { page_location: location, currency: 'TRY', value: 2749.8, items: [{ ...shirt, price: 1249.9, quantity: 2 }, { item_id: '6', item_name: 'Bez Çanta', price: 250, quantity: 1 }] }],
  ])
})

test('ödeme ve satın alma: indirimli satır fiyatı, kupon, vergi, kargo, kaynak özellikleri', () => {
  const pixel = runPixel()
  const checkout = {
    token: 'tok1',
    currencyCode: 'TRY',
    order: { id: 'gid://shopify/OrderIdentity/77' },
    subtotalPrice: money(2249.82),
    totalPrice: money(2349.82),
    totalTax: money(391.64),
    shippingLine: { price: money(100) },
    discountApplications: [
      { type: 'DISCOUNT_CODE', title: 'YAZ10' },
      { type: 'AUTOMATIC', title: 'Kargo bedava' },
    ],
    attributes: [
      { key: 'İlk kaynak', value: 'google / cpc / marka' },
      { key: 'Son kaynak', value: 'bulten / email' },
      { key: 'Reklam tıklaması', value: 'gclid:g1' },
    ],
    lineItems: [{ variant, quantity: 2, finalLinePrice: money(2249.82) }],
  }
  pixel.fire('checkout_started', { checkout: { ...checkout, order: null } })
  pixel.fire('checkout_completed', { checkout })
  const [begin, purchase] = pixel.calls().slice(2)
  assert.equal(begin[1], 'begin_checkout')
  assert.equal(begin[2].value, 2249.82)
  assert.equal(begin[2].coupon, 'YAZ10')
  assert.deepEqual(purchase[2], {
    page_location: 'https://magaza.com/x',
    transaction_id: 'gid://shopify/OrderIdentity/77',
    currency: 'TRY',
    value: 2349.82,
    tax: 391.64,
    shipping: 100,
    coupon: 'YAZ10',
    items: [{ item_id: 'KG-M', item_name: 'Keten Gömlek', item_variant: 'M / Beyaz', item_brand: 'Örnek', item_category: 'Gömlek', price: 1124.91, quantity: 2 }],
    ilk_kaynak: 'google / cpc / marka',
    son_kaynak: 'bulten / email',
  })
})

test('eksik veride etkinlik gönderilmez ya da boş alanlar atılır', () => {
  const pixel = runPixel()
  pixel.fire('product_added_to_cart', { cartLine: null })
  pixel.fire('cart_viewed', { cart: null })
  pixel.fire('checkout_completed', { checkout: { token: 't', totalPrice: money(10), lineItems: [], discountApplications: [] } })
  const events = pixel.calls().slice(2)
  assert.equal(events.length, 1)
  assert.deepEqual(events[0][2], { page_location: 'https://magaza.com/x', transaction_id: 't', currency: 'TRY', value: 10, items: [] })
})
