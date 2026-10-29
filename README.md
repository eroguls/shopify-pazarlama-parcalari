# shopify-pazarlama-parcalari

Shopify mağazaları için iki pazarlama parçası:

| Parça | Ne yapar |
| --- | --- |
| [Sipariş kaynağı takibi](#sipariş-kaynağı-takibi) | Müşterinin siteye ilk ve son nereden geldiğini (UTM, reklam tıklaması, yönlendiren site) siparişin içine yazar |
| [GA4 özel pikseli](#ga4-özel-pikseli) | Shopify’ın müşteri etkinliklerini ödeme sayfaları dahil GA4 e-ticaret etkinliklerine çevirir |

İkisi birlikte kullanılınca satın alma etkinliği GA4’e siparişin ilk ve son kaynağıyla gider.

## Sipariş kaynağı takibi

Shopify yöneticisinde her siparişin **Ek ayrıntılar** bölümünde şunlar görünür:

```
İlk kaynak          google / cpc / marka
Son kaynak          bulten / email
İlk giriş sayfası   /products/keten-gomlek
İlk ziyaret         2026-10-12
Reklam tıklaması    gclid:Cj0KCQ…
```

Böylece “bu sipariş hangi kampanyadan geldi?” sorusu, reklam panellerinin kendi sayımlarından
bağımsız olarak sipariş kaydının içinde cevaplanır. Siparişleri CSV olarak dışa aktarıp
kampanyaya göre gruplayabilirsiniz.

### Kurulum

1. `assets/kaynak-takibi.js` → temanın `assets/`, `snippets/kaynak-takibi.liquid` → `snippets/`.
2. `layout/theme.liquid` içinde `</head>` etiketinden önce:
   ```liquid
   {% render 'kaynak-takibi', gun: 90 %}
   ```
3. Reklam ve e-posta bağlantılarınıza UTM etiketi ekleyin:
   `?utm_source=instagram&utm_medium=paid_social&utm_campaign=yaz-indirimi`

### Kurallar

- **Kaynak:** Önce UTM etiketlerine bakılır. UTM yoksa reklam tıklama kimliği (`gclid`, `gbraid`,
  `wbraid` → google; `fbclid` → meta; `ttclid` → tiktok; `msclkid` → bing) kaynağı belirler.
  O da yoksa yönlendiren site arama motoru (organik), sosyal ağ (sosyal) ya da diğer
  (yönlendirme) olarak sınıflanır. Hiçbiri yoksa `(doğrudan)`.
- **İlk kaynak** `gun` süresi (varsayılan 90 gün) boyunca değişmez.
- **Son kaynak** her yeni kaynakla güncellenir, ama doğrudan gelişler onu ezmez. Reklamdan gelip
  iki gün sonra adresi yazarak dönen müşterinin son kaynağı yine reklamdır.
- Site içi gezinme ve Shopify ödeme sayfalarından dönüş kaynak sayılmaz.
- Özellikler yalnızca sepette ürün varken yazılır. Ürünü olmayan ziyaretçiler için sepet
  oluşturulmaz. İlk ürün sepete eklendiği anda yazılır.

### İzin

Mağazada çerez izni toplanıyorsa betik, Shopify’ın
[Customer Privacy API](https://shopify.dev/docs/api/customer-privacy)’sinde **analiz** izni
verilene kadar hiçbir şey saklamaz, sepete yazmaz. İzin sonradan verilirse o andan itibaren
çalışır. Veri yalnızca ziyaretçinin tarayıcısında (`localStorage`) ve mağazanın kendi sepetinde
tutulur; üçüncü bir tarafa gönderilmez. Gizlilik politikanızda bu kullanımı belirtin.

## GA4 özel pikseli

Shopify’ın yeni ödeme sayfalarında (Checkout Extensibility) temaya eklenen izleme kodları
çalışmaz. Ödeme ve satın alma etkinlikleri yalnızca **müşteri etkinlikleri** (pikseller) ile
alınabilir. Bu piksel dokuz standart etkinliği GA4’ün önerilen e-ticaret etkinliklerine çevirir:

| Shopify | GA4 |
| --- | --- |
| `page_viewed` | `page_view` |
| `product_viewed` | `view_item` |
| `collection_viewed` | `view_item_list` |
| `search_submitted` | `search` |
| `product_added_to_cart` | `add_to_cart` |
| `cart_viewed` | `view_cart` |
| `checkout_started` | `begin_checkout` |
| `payment_info_submitted` | `add_payment_info` |
| `checkout_completed` | `purchase` (sipariş kimliği, tutar, vergi, kargo, kupon, ürünler) |

Ürünlerde `item_id` olarak SKU, SKU yoksa ürün kimliği kullanılır. Satın almadaki ürün fiyatı
satır indirimlerinden sonraki birim fiyattır.

> **Önemli:** Google & YouTube uygulaması aynı GA4 mülküne zaten veri gönderiyorsa bu pikseli
> eklemeyin; etkinlikler ve satışlar iki kez sayılır. Bu piksel, uygulamayı kullanmayan ya da
> verileri farklı bir mülke göndermek isteyen mağazalar içindir.

### Kurulum

1. Shopify yöneticisi › **Ayarlar › Müşteri etkinlikleri › Özel piksel ekle**.
2. [`pixels/ga4-ozel-piksel.js`](pixels/ga4-ozel-piksel.js) dosyasının tamamını kod alanına
   yapıştırın, `OLCUM_KIMLIGI` satırına kendi `G-…` kimliğinizi yazın.
3. **İzin** ayarını “Analiz” olarak seçin. Shopify pikseli yalnızca izin veren ziyaretçilerde
   çalıştırır.
4. Kaydedin ve **Bağla**’ya basın. GA4’te **Yönetici › DebugView** ile bir test siparişi verip
   etkinlikleri kontrol edin.

Kaynak takibini de kullanıyorsanız satın alma etkinliği `ilk_kaynak` ve `son_kaynak`
parametreleriyle gider. GA4 raporlarında görmek için **Yönetici › Özel tanımlar**’da bu iki adla
etkinlik kapsamlı özel boyut oluşturun.

## Geliştirme

```bash
npm install
npm test        # kaynak kuralları, sepet özellikleri, piksel etkinlik eşlemesi
npm run check   # Shopify Theme Check
```

Piksel testi, dosyayı Shopify’ın korumalı alanını taklit eden bir ortamda (`analytics`, `window`,
`document`) çalıştırır ve GA4’e giden çağrıları karşılaştırır. Etkinlik alanları Shopify’ın
[Web Pixels API](https://shopify.dev/docs/api/web-pixels-api/standard-events) belgelerine göre
yazıldı.

## Lisans

MIT · [Salih Eroğul](https://saliherogul.com), bağımsız Shopify geliştiricisi.
