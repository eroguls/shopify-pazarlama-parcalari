import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../assets/kaynak-takibi.js', import.meta.url), 'utf8')
const context = { URL }
vm.runInNewContext(source, context)
const { parseTouch, merge, toAttributes, sameAttributes } = context.KaynakTakibi
const plain = (value) => JSON.parse(JSON.stringify(value))

const NOW = Date.parse('2026-10-29T10:00:00Z')
const DAY = 86400000
const shop = ['magaza.com']
const touch = (href, referrer = '', now = NOW) => plain(parseTouch(href, referrer, shop, now))

test('UTM etiketleri okunur', () => {
  assert.deepEqual(touch('https://magaza.com/products/kupa?utm_source=instagram&utm_medium=paid_social&utm_campaign=yaz&utm_content=reels'), {
    kaynak: 'instagram',
    ortam: 'paid_social',
    kampanya: 'yaz',
    icerik: 'reels',
    terim: '',
    tiklama: '',
    giris: '/products/kupa',
    tarih: '2026-10-29T10:00:00.000Z',
  })
})

test('UTM yoksa reklam tıklama kimliği kaynağı belirler', () => {
  const google = touch('https://magaza.com/?gclid=abc123')
  assert.equal(google.kaynak, 'google')
  assert.equal(google.ortam, 'cpc')
  assert.equal(google.tiklama, 'gclid:abc123')
  assert.equal(touch('https://magaza.com/?fbclid=x').kaynak, 'meta')
  assert.equal(touch('https://magaza.com/?ttclid=x').kaynak, 'tiktok')
  assert.equal(touch('https://magaza.com/?msclkid=x').kaynak, 'bing')
  assert.equal(touch('https://magaza.com/?utm_source=bulten&gclid=x').kaynak, 'bulten', 'UTM önceliklidir')
})

test('yönlendiren siteye göre sınıflandırma; site içi gezinme yok sayılır', () => {
  assert.deepEqual([touch('https://magaza.com/', 'https://www.google.com.tr/').kaynak, touch('https://magaza.com/', 'https://www.google.com.tr/').ortam], ['google.com.tr', 'organik'])
  assert.equal(touch('https://magaza.com/', 'https://l.instagram.com/').ortam, 'sosyal')
  assert.equal(touch('https://magaza.com/', 'https://blog.ornek.org/yazi').ortam, 'yönlendirme')
  assert.equal(touch('https://magaza.com/', '').kaynak, '(doğrudan)')
  assert.equal(parseTouch('https://magaza.com/cart', 'https://www.magaza.com/products/x', shop, NOW), null)
  assert.equal(parseTouch('https://magaza.com/', 'https://magaza.myshopify.com/', shop, NOW), null)
  assert.equal(parseTouch('bozuk', '', shop, NOW), null)
})

test('ilk kaynak korunur; son kaynak doğrudan gelişle ezilmez', () => {
  let state = merge(null, touch('https://magaza.com/?utm_source=google&utm_medium=cpc&utm_campaign=marka'), NOW)
  state = merge(state, touch('https://magaza.com/', '', NOW + DAY), NOW + DAY)
  assert.equal(state.son.kaynak, 'google')
  state = merge(state, touch('https://magaza.com/?utm_source=bulten&utm_medium=email', '', NOW + 2 * DAY), NOW + 2 * DAY)
  assert.equal(state.ilk.kaynak, 'google')
  assert.equal(state.son.kaynak, 'bulten')
  assert.deepEqual(plain(merge(state, null, NOW + 3 * DAY)), plain(state), 'site içi gezinme durumu değiştirmez')
})

test('doğrudan başlayan ziyaretçi sonradan bir kaynakla gelirse son kaynak güncellenir', () => {
  let state = merge(null, touch('https://magaza.com/'), NOW)
  state = merge(state, touch('https://magaza.com/?fbclid=x', '', NOW + DAY), NOW + DAY)
  assert.equal(state.ilk.kaynak, '(doğrudan)')
  assert.equal(state.son.kaynak, 'meta')
})

test('süresi dolan ilk kaynak yenilenir', () => {
  const old = merge(null, touch('https://magaza.com/?utm_source=eski', '', NOW - 100 * DAY), NOW - 100 * DAY)
  assert.equal(merge(old, touch('https://magaza.com/?utm_source=yeni'), NOW, 90).ilk.kaynak, 'yeni')
  assert.equal(merge(old, null, NOW, 90), null)
})

test('sepet özellikleri', () => {
  let state = merge(null, touch('https://magaza.com/products/kupa?utm_source=google&utm_medium=cpc&utm_campaign=marka&gclid=g1'), NOW)
  state = merge(state, touch('https://magaza.com/?utm_source=bulten&utm_medium=email', '', NOW + DAY), NOW + DAY)
  const attributes = plain(toAttributes(state))
  assert.deepEqual(attributes, {
    'İlk kaynak': 'google / cpc / marka',
    'Son kaynak': 'bulten / email',
    'İlk giriş sayfası': '/products/kupa',
    'İlk ziyaret': '2026-10-29',
    'Reklam tıklaması': 'gclid:g1',
  })
  assert.equal(sameAttributes({ ...attributes, Hediye: 'evet' }, attributes), true)
  assert.equal(sameAttributes({}, attributes), false)
  assert.deepEqual(plain(toAttributes(null)), {})
})
