/*
 * Sipariş kaynağı takibi (shopify-pazarlama-parcalari)
 *
 * Ziyaretçinin siteye ilk ve son geldiği kaynağı (UTM, reklam tıklama kimliği, yönlendiren site)
 * tarayıcıda saklar ve sepet özelliklerine yazar. Sipariş verilince bu bilgiler Shopify
 * yöneticisinde siparişin “Ek ayrıntılar” bölümünde görünür.
 *
 * Üst kısım saf fonksiyonlardır ve Node’da test edilir. Alt kısım tarayıcıda çalışır.
 * https://github.com/eroguls/shopify-pazarlama-parcalari · MIT
 */
;(function (root) {
  'use strict'

  var ATTRIBUTES = {
    ilk: 'İlk kaynak',
    son: 'Son kaynak',
    giris: 'İlk giriş sayfası',
    tarih: 'İlk ziyaret',
    tiklama: 'Reklam tıklaması',
  }
  var CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid']
  var SEARCH = /(^|\.)(google|bing|yandex|duckduckgo|yahoo|ecosia|baidu)\./
  var SOCIAL = /(^|\.)(facebook|instagram|t\.co|twitter|x\.com|linkedin|pinterest|tiktok|youtube|reddit|whatsapp)/

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch (error) {
      return ''
    }
  }

  /** Bir sayfa açılışından kaynak bilgisini çıkarır; site içi gezinmede null döner. */
  function parseTouch(href, referrer, ownHosts, now) {
    var url
    try {
      url = new URL(href)
    } catch (error) {
      return null
    }
    var params = url.searchParams
    var own = [].concat(ownHosts || [url.hostname]).map(function (host) {
      return String(host).replace(/^www\./, '')
    })
    var referrerHost = hostOf(referrer)
    var touch = {
      kaynak: params.get('utm_source') || '',
      ortam: params.get('utm_medium') || '',
      kampanya: params.get('utm_campaign') || '',
      icerik: params.get('utm_content') || '',
      terim: params.get('utm_term') || '',
      tiklama: '',
      giris: url.pathname,
      tarih: new Date(now || Date.now()).toISOString(),
    }
    CLICK_IDS.forEach(function (name) {
      if (!touch.tiklama && params.get(name)) touch.tiklama = name + ':' + params.get(name).slice(0, 80)
    })
    if (!touch.kaynak && touch.tiklama) {
      var platform = touch.tiklama.split(':')[0]
      touch.kaynak = /^(gclid|gbraid|wbraid)$/.test(platform) ? 'google' : platform === 'fbclid' ? 'meta' : platform === 'ttclid' ? 'tiktok' : 'bing'
      touch.ortam = 'cpc'
    }
    if (!touch.kaynak) {
      if (!referrerHost) {
        touch.kaynak = '(doğrudan)'
        touch.ortam = '(yok)'
      } else if (own.indexOf(referrerHost) !== -1 || /(^|\.)(myshopify\.com|shopify\.com|shop\.app)$/.test(referrerHost)) {
        return null
      } else {
        touch.kaynak = referrerHost
        touch.ortam = SEARCH.test(referrerHost) ? 'organik' : SOCIAL.test(referrerHost) ? 'sosyal' : 'yönlendirme'
      }
    }
    return touch
  }

  function isDirect(touch) {
    return touch.kaynak === '(doğrudan)'
  }

  /**
   * İlk kaynak süre dolana kadar korunur. Son kaynak, doğrudan gelişlerle ezilmez
   * (“son doğrudan olmayan tıklama”).
   */
  function merge(stored, touch, now, days) {
    var limit = (days || 90) * 86400000
    var state = stored && stored.ilk ? { ilk: stored.ilk, son: stored.son || stored.ilk } : null
    if (state && now - Date.parse(state.ilk.tarih) > limit) state = null
    if (!touch) return state
    if (!state) return { ilk: touch, son: touch }
    if (!isDirect(touch) || isDirect(state.son)) state.son = touch
    return state
  }

  function label(touch) {
    return [touch.kaynak, touch.ortam, touch.kampanya].filter(Boolean).join(' / ')
  }

  // Ziyaretçinin kendi saatine göre YYYY-AA-GG.
  function localDate(iso) {
    var date = new Date(iso)
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function toAttributes(state) {
    var out = {}
    if (!state) return out
    out[ATTRIBUTES.ilk] = label(state.ilk)
    out[ATTRIBUTES.son] = label(state.son)
    out[ATTRIBUTES.giris] = state.ilk.giris
    out[ATTRIBUTES.tarih] = localDate(state.ilk.tarih)
    out[ATTRIBUTES.tiklama] = state.son.tiklama || state.ilk.tiklama || ''
    return out
  }

  function sameAttributes(current, wanted) {
    return Object.keys(wanted).every(function (key) {
      return (current && current[key] != null ? String(current[key]) : '') === wanted[key]
    })
  }

  var core = {
    ATTRIBUTES: ATTRIBUTES,
    parseTouch: parseTouch,
    merge: merge,
    toAttributes: toAttributes,
    sameAttributes: sameAttributes,
  }
  root.KaynakTakibi = core

  if (typeof document === 'undefined' || typeof fetch === 'undefined') return

  /* ---------------------------------------------------------------- tarayıcı */

  var script = document.currentScript
  var days = Number((script && script.getAttribute('data-gun')) || 90)
  var KEY = 'kaynakTakibi'
  var routes = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/'

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null')
    } catch (error) {
      return null
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch (error) {
      /* depolama kapalı */
    }
  }

  var nativeFetch = window.fetch.bind(window)

  function syncCart(state) {
    var wanted = toAttributes(state)
    if (!Object.keys(wanted).length) return Promise.resolve()
    return nativeFetch(routes + 'cart.js', { headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.json()
      })
      .then(function (cart) {
        if (!cart.item_count || sameAttributes(cart.attributes, wanted)) return
        return nativeFetch(routes + 'cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ attributes: wanted }),
        })
      })
      .catch(function (error) {
        console.warn('[kaynak-takibi]', error)
      })
  }

  function run() {
    var state = merge(read(), parseTouch(location.href, document.referrer, [location.hostname], Date.now()), Date.now(), days)
    if (!state) return
    write(state)
    syncCart(state)
    // Sepete ilk ürün eklendiğinde özellikleri yaz.
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url
      var promise = nativeFetch(input, init)
      if (url && /\/cart\/add(\.js)?(\?|$)/.test(url)) {
        promise.then(function (response) {
          if (response.ok) syncCart(read())
        })
      }
      return promise
    }
  }

  // Mağazada çerez izni isteniyorsa yalnızca analiz izni verilince çalışır.
  function withConsent(callback) {
    var shopify = window.Shopify
    if (!shopify || typeof shopify.loadFeatures !== 'function') return callback()
    shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.2' }], function (error) {
      var privacy = shopify.customerPrivacy
      if (error || !privacy) return
      if (privacy.analyticsProcessingAllowed()) return callback()
      document.addEventListener('visitorConsentCollected', function once() {
        if (privacy.analyticsProcessingAllowed()) {
          document.removeEventListener('visitorConsentCollected', once)
          callback()
        }
      })
    })
  }

  withConsent(run)
})(typeof globalThis !== 'undefined' ? globalThis : this)
