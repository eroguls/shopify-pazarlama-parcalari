/*
 * GA4 özel pikseli (shopify-pazarlama-parcalari)
 *
 * Shopify yöneticisinde Ayarlar › Müşteri etkinlikleri › Özel piksel ekle alanına bu dosyanın
 * tamamı yapıştırılır. Shopify’ın standart müşteri etkinliklerini GA4 e-ticaret etkinliklerine
 * çevirir; ödeme sayfaları da dahil.
 *
 * Google & YouTube uygulaması aynı GA4 mülküne zaten veri gönderiyorsa bunu eklemeyin; satışlar iki
 * kez sayılır.
 *
 * https://github.com/eroguls/shopify-pazarlama-parcalari · MIT
 */

// ---- Ayarlar --------------------------------------------------------------------------------
const OLCUM_KIMLIGI = 'G-XXXXXXXXXX' // GA4 › Yönetici › Veri akışları › Ölçüm kimliği
const KAYNAK_OZELLIKLERI = {
  // kaynak-takibi.js’in sepete yazdığı özellikler satın alma etkinliğine parametre olarak eklenir.
  'İlk kaynak': 'ilk_kaynak',
  'Son kaynak': 'son_kaynak',
}
const LISTE_SINIRI = 20
// ---------------------------------------------------------------------------------------------

const amount = (money) => (money && money.amount != null ? Number(money.amount) : undefined)
const currency = (...moneys) => moneys.find((money) => money && money.currencyCode)?.currencyCode

function item(variant, quantity, linePrice) {
  if (!variant) return null
  const product = variant.product || {}
  const unit = linePrice != null && quantity ? linePrice / quantity : amount(variant.price)
  const out = {
    item_id: variant.sku || String(product.id || variant.id || ''),
    item_name: product.title || variant.title || '',
    item_variant: variant.title && variant.title !== 'Default Title' ? variant.title : undefined,
    item_brand: product.vendor || undefined,
    item_category: product.type || undefined,
    price: unit != null ? Math.round(unit * 100) / 100 : undefined,
    quantity: quantity || 1,
  }
  Object.keys(out).forEach((key) => out[key] === undefined && delete out[key])
  return out
}

function checkoutItems(checkout) {
  return (checkout.lineItems || [])
    .map((line) => item(line.variant, line.quantity, amount(line.finalLinePrice)))
    .filter(Boolean)
}

function coupons(checkout) {
  const codes = (checkout.discountApplications || []).filter((discount) => discount.type === 'DISCOUNT_CODE').map((discount) => discount.title)
  return codes.length ? codes.join(',') : undefined
}

function attribution(checkout) {
  const params = {}
  for (const attribute of checkout.attributes || []) {
    const name = KAYNAK_OZELLIKLERI[attribute.key]
    if (name && attribute.value) params[name] = String(attribute.value).slice(0, 100)
  }
  return params
}

/** Shopify etkinliğini [GA4 etkinlik adı, parametreler] çiftine çevirir; ilgisizse null. */
function toGa4(event) {
  const data = event.data || {}
  const location = event.context?.document?.location?.href
  switch (event.name) {
    case 'page_viewed':
      return ['page_view', { page_location: location, page_title: event.context?.document?.title, page_referrer: event.context?.document?.referrer || undefined }]
    case 'product_viewed': {
      const variant = data.productVariant
      return ['view_item', { currency: currency(variant?.price), value: amount(variant?.price), items: [item(variant, 1)].filter(Boolean) }]
    }
    case 'collection_viewed': {
      const collection = data.collection || {}
      return [
        'view_item_list',
        {
          item_list_id: collection.id ? String(collection.id) : undefined,
          item_list_name: collection.title,
          items: (collection.productVariants || []).slice(0, LISTE_SINIRI).map((variant, index) => ({ ...item(variant, 1), index })),
        },
      ]
    }
    case 'search_submitted':
      return ['search', { search_term: data.searchResult?.query }]
    case 'product_added_to_cart': {
      const line = data.cartLine
      if (!line) return null
      const total = line.cost?.totalAmount
      return ['add_to_cart', { currency: currency(total, line.merchandise?.price), value: amount(total), items: [item(line.merchandise, line.quantity, amount(total))].filter(Boolean) }]
    }
    case 'cart_viewed': {
      const cart = data.cart
      if (!cart) return null
      const total = cart.cost?.totalAmount
      return [
        'view_cart',
        { currency: currency(total), value: amount(total), items: (cart.lines || []).map((line) => item(line.merchandise, line.quantity, amount(line.cost?.totalAmount))).filter(Boolean) },
      ]
    }
    case 'checkout_started':
    case 'payment_info_submitted': {
      const checkout = data.checkout || {}
      return [
        event.name === 'checkout_started' ? 'begin_checkout' : 'add_payment_info',
        { currency: currency(checkout.totalPrice, checkout.subtotalPrice) || checkout.currencyCode, value: amount(checkout.subtotalPrice) ?? amount(checkout.totalPrice), coupon: coupons(checkout), items: checkoutItems(checkout) },
      ]
    }
    case 'checkout_completed': {
      const checkout = data.checkout || {}
      return [
        'purchase',
        {
          transaction_id: checkout.order?.id ? String(checkout.order.id) : checkout.token,
          currency: currency(checkout.totalPrice) || checkout.currencyCode,
          value: amount(checkout.totalPrice),
          tax: amount(checkout.totalTax),
          shipping: amount(checkout.shippingLine?.price),
          coupon: coupons(checkout),
          items: checkoutItems(checkout),
          ...attribution(checkout),
        },
      ]
    }
    default:
      return null
  }
}

function clean(params) {
  const out = {}
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') out[key] = value
  return out
}

// ---- GA4 bağlantısı --------------------------------------------------------------------------
window.dataLayer = window.dataLayer || []
function gtag() {
  window.dataLayer.push(arguments)
}
const tag = document.createElement('script')
tag.async = true
tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(OLCUM_KIMLIGI)
document.head.appendChild(tag)
gtag('js', new Date())
// Sayfa görüntülemeyi Shopify’ın page_viewed etkinliği gönderir; ödeme sayfaları da dahil.
gtag('config', OLCUM_KIMLIGI, { send_page_view: false })

;['page_viewed', 'product_viewed', 'collection_viewed', 'search_submitted', 'product_added_to_cart', 'cart_viewed', 'checkout_started', 'payment_info_submitted', 'checkout_completed'].forEach(
  (name) => {
    analytics.subscribe(name, (event) => {
      const mapped = toGa4(event)
      if (!mapped) return
      // Piksel korumalı bir iframe’de çalışır; adres verilmezse GA4 iframe adresini kaydeder.
      const params = { page_location: event.context?.document?.location?.href, ...mapped[1] }
      gtag('event', mapped[0], clean(params))
    })
  },
)
