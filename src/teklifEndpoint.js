// =====================================================================
// WE Sigorta – Web Hesaplayıcı Teklif Bildirimi Endpoint'i
// ---------------------------------------------------------------------
// Kurulum (WE Sigorta botunuzda):
//   1) Bu dosyayı proje köküne "teklifEndpoint.js" adıyla ekleyin.
//   2) index.js (ana dosya) içinde, app ve pool tanımlandıktan sonra:
//        const teklifYardimcilari = require('./teklifEndpoint')(app, pool);
//      Dönen nesne, webhook tarafında müşterinin daha önce web'den teklif
//      isteyip istemediğini kontrol etmek için kullanılır (bkz. aşağıda
//      "musteriYazdiBildir" - 3. adım).
//   3) Railway ortam değişkenlerine ekleyin:
//        TEKLIF_SECRET                = wesigorta-teklif-2026   (HTML'dekiyle AYNI olmalı)
//        NOTIFY_NUMBER                = 905326876126            (bildirim gidecek numara, 90 ile)
//        TEKLIF_MUSTERI_TEMPLATE_NAME = (Meta'da onaylı bir şablonun adı - bu
//                                        şablonun BODY'sinde tam olarak
//                                        {{musteri_adi}} ve {{danisman_adi}}
//                                        adlarında (Meta artık {{1}}/{{2}}
//                                        değil, küçük harf+alt çizgili
//                                        ADLANDIRILMIŞ değişken istiyor) iki
//                                        değişken olmalı. Örnek metin: "Merhaba
//                                        {{musteri_adi}}, WE Sigorta'ya
//                                        iletmiş olduğunuz teklif talebiniz
//                                        alınmıştır. Danışmanımız
//                                        {{danisman_adi}} en kısa sürede sizi
//                                        arayacaktır." Tanımlı değilse bu
//                                        bilgilendirme sessizce atlanır.)
//      (WHATSAPP_TOKEN ve WHATSAPP_PHONE_NUMBER_ID zaten mevcut.)
//   4) Deploy edin. Tablo ilk istekte otomatik oluşur.
//
// 24.07.2026 eklemeleri:
//   - Müşteri PDF teklifini indirdiğinde (secret doğrulandıktan sonra),
//     TEKLIF_MUSTERI_TEMPLATE_NAME şablonuyla müşteriye de bir onay mesajı
//     gönderiliyor (parametreler: ad, danışman adı).
//   - Webhook'a (WhatsApp'a doğrudan) yazan bir numara, son 30 gün içindeki
//     web_teklifler kayıtlarından biriyle eşleşiyorsa (musteriYazdiBildir),
//     hem ekibe (NOTIFY_NUMBER + ilgili danışman) bir bildirim hem de
//     müşteriye kısa bir teşekkür mesajı gönderiliyor - bu kontrolü index.js
//     tarafında webhook handler'ının içine eklemeniz gerekiyor (bkz. yukarıda
//     2. adım). Bu bildirim+teşekkür SADECE o teklif kaydından sonraki İLK
//     mesajda gönderilir (web_teklifler.yanit_bildirildi_mi sütunuyla takip
//     edilir) - müşteri sonrasında kaç kez yazarsa yazsın tekrarlanmaz.
//
// 25.07.2026 eklemeleri (bir web teklifi bildirimi ekibe ULAŞMADIĞI için):
//   - KÖK NEDEN: mesajGonder/sablonGonder, fetch()'in HTTP hata kodlarında
//     (4xx/5xx) reject ETMEDİĞİNİ hesaba katmıyordu - WhatsApp API'nin
//     döndürdüğü gerçek hatalar (24 saatlik pencere kapalı vb.) hiçbir
//     try/catch tarafından yakalanmıyor, konsola bile düşmüyordu. Artık
//     yanitiKontrolEt ile response.ok kontrol ediliyor ve hata varsa
//     düzgün bir Error fırlatılıyor.
//   - EKİP BİLDİRİMİ ARTIK ŞABLON-YEDEKLİ, TEK-DEĞİŞKENLİ (Enbel'in acik
//     talebi uzerine ayni gun GUNCELLENDI - "24 saat olayi ne olursa olsun
//     mesaj gitsin"): TEKLIF_EKIP_TEMPLATE_NAME tanımlıysa, ekibe
//     (NOTIFY_NUMBER + danışman) giden bildirim ÖNCE bu şablonla denenir -
//     conversationEngine.js'teki AGENT_DETAY_TEMPLATE_NAME ile AYNI, halihazirda
//     kanitlanmis desen: TÜM zengin/detaylı metin TEK bir {{detay}}
//     değişkenine gidiyor, bu yüzden şablon 24 saatlik pencere durumundan
//     TAMAMEN BAĞIMSIZ olarak TAM bilgiyi iletebiliyor. Başarısız olursa/
//     ayarlanmamışsa düz metne düşer (SADECE pencere açıksa çalışır - bu
//     yüzden şablonu onaylatıp tanımlamanız ŞART). Bu ŞABLON HEM "yeni web
//     teklifi" HEM "web teklif müşterisi yazdı" bildirimleri için ORTAK
//     kullanılıyor. NOT: şablon parametreleri satır sonu içeremediğinden
//     (Meta 132018 hatası), şablonla giden versiyon çok satırlı değil,
//     " • " ile ayrılmış tek satır olarak görünür (bkz. aşağıda
//     sablonIcinTemizle) - bu WhatsApp'ın kendi teknik kısıtlaması.
// =====================================================================

const leadStore = require('./leadStore');

module.exports = function (app, pool) {
  const IZINLI_ORIGINLER = [
    'https://wesigorta.com.tr',
    'https://www.wesigorta.com.tr'
  ];

  function cors(req, res) {
    const origin = req.headers.origin;
    if (IZINLI_ORIGINLER.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  // Ham bir telefon girdisini ("0532 123 45 67", "532-123-45-67",
  // "905321234567" vb.) WhatsApp'ın beklediği uluslararası formata
  // ("905321234567") çevirir. Ayrıştıramazsa null döner.
  function telefonUluslararasiFormata(ham) {
    const d = String(ham || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) return '9' + d; // 0532... -> 90532...
    if (d.length === 10) return '90' + d; // 532... -> 90532...
    if (d.length === 12 && d.startsWith('90')) return d; // zaten 90532...
    return null;
  }

  // Aynı numarayı, kayıtlar arasında biçim farkı gözetmeden (baştaki 0/90
  // olsun olmasın) karşılaştırabilmek için son 10 haneye indirger.
  function telefonSon10Hane(ham) {
    const d = String(ham || '').replace(/\D/g, '');
    return d.length >= 10 ? d.slice(-10) : null;
  }

  // fetch() HTTP hata kodlarinda (4xx/5xx) PROMISE'i REJECT ETMEZ - sadece
  // gercek network hatalarinda (DNS, baglanti kopmasi vb.) eder. Bu yuzden
  // WhatsApp API'nin dondurdugu gercek hatalar (24 saatlik pencere kapali,
  // yanlis sablon param adi, gecersiz numara vb.) response.ok kontrolu
  // yapilmadan TAMAMEN SESSIZ kayboluyordu - cagiran taraftaki try/catch bile
  // bunu yakalamiyordu (25.07.2026 tarihli "ekip bildirimi gitmedi" vakasi -
  // muhtemelen 24 saatlik pencere kapaliydi ama hata hicbir yere loglanmadi).
  // Artik response.ok false ise govdeyi okuyup bir Error firlatiyoruz ki
  // gercek hata hem konsola dussun hem de asagidaki sablon-yedegi devreye
  // girebilsin.
  async function yanitiKontrolEt(response) {
    if (!response.ok) {
      let govde = '';
      try { govde = await response.text(); } catch (e) { /* yoksay */ }
      throw new Error('HTTP ' + response.status + ': ' + govde);
    }
    return response;
  }

  // Metin (düz) bir WhatsApp mesajı gönderen küçük ortak yardımcı - hem asıl
  // /api/teklif bildirimi hem de aşağıdaki musteriYazdiBildir tarafından
  // paylaşılıyor.
  async function mesajGonder(numara, metin) {
    const response = await fetch(
      'https://graph.facebook.com/v19.0/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/messages',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: numara,
          type: 'text',
          text: { body: metin }
        })
      }
    );
    return yanitiKontrolEt(response);
  }

  // ADLANDIRILMIŞ (named) parametreli, ONAYLI bir şablonla mesaj gönderir -
  // müşteri henüz bize hiç yazmadığı için 24 saatlik oturum penceresi
  // dışındayız, düz metin GÖNDERİLEMEZ, Meta'nın onayladığı bir şablon şart.
  // "parametreler" bir NESNE olmalı, anahtarları şablondaki {{degisken_adi}}
  // isimleriyle BİREBİR aynı olmalı (24.07.2026: Meta artık eski {{1}}/{{2}}
  // pozisyonel formatını değil, küçük harf + alt çizgili adlandırılmış
  // değişkenleri istiyor - orn. {{musteri_adi}} - o yüzden her parametrede
  // "parameter_name" alanı da gönderiliyor, sadece sıralı bir dizi değil).
  async function sablonGonder(numara, sablonAdi, parametreler) {
    const response = await fetch(
      'https://graph.facebook.com/v19.0/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/messages',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: numara,
          type: 'template',
          template: {
            name: sablonAdi,
            language: { code: 'tr' },
            components: [
              {
                type: 'body',
                parameters: Object.keys(parametreler).map((ad) => ({
                  type: 'text',
                  parameter_name: ad,
                  text: String(parametreler[ad])
                }))
              }
            ]
          }
        })
      }
    );
    return yanitiKontrolEt(response);
  }

  // WhatsApp sablon PARAMETRE DEGERLERI (sablonun kendi sabit metni degil)
  // satir sonu (\n) ICEREMEZ ve 4'ten fazla ardisik bosluk barindiramaz -
  // Meta bunu 132018 hatasiyla reddediyor. conversationEngine.js'teki
  // sablonParametresiIcinTemizle ile AYNI, kanitlanmis cozum: satir
  // sonlarini " • " ile degistiriyoruz. Duz metin (mesajGonder) gonderiminde
  // BU DONUSUM UYGULANMAZ - orijinal, satir sonlu hali oldugu gibi gider.
  function sablonIcinTemizle(metin) {
    return String(metin || '')
      .replace(/\r\n|\r|\n/g, ' • ')
      .replace(/\t/g, ' ')
      .replace(/ {5,}/g, '    ')
      .replace(/(\s*•\s*){2,}/g, ' • ')
      .replace(/^\s*•\s*|\s*•\s*$/g, '')
      .trim();
  }

  // Ekibe (NOTIFY_NUMBER + varsa danışman) giden bildirimleri TEK bir yerden
  // yönetir - hem /api/teklif hem musteriYazdiBildir tarafından kullanılır.
  //
  // 25.07.2026 eklemesi, 25.07.2026 GÜNCELLEMESİ (Enbel'in acik talebi -
  // "24 saat olayini sikitriet, mesaj HER DURUMDA gitsin"): artik TEK
  // degiskenli ({{detay}}), conversationEngine.js'teki AGENT_DETAY_TEMPLATE_NAME
  // ile AYNI, KANITLANMIS deseni kullaniyoruz - zengin/detayli metnin
  // TAMAMI tek bir sablon degiskenine gidiyor, boylece sablon HER SEFERINDE
  // (24 saatlik pencere durumundan BAGIMSIZ) TAM bilgiyi iletebiliyor. Sablon
  // basarili olursa BURADA DURULUR (ayni bilgiyi iki kez, hem sablon hem duz
  // metin olarak gondermemek icin). Sablon basarisiz olursa/ayarlanmamissa
  // (TEKLIF_EKIP_TEMPLATE_NAME bos ise) duz metne duser - bu durumda mesaj
  // SADECE pencere acik olursa ulasir (bu yuzden sablonu ONAYLATIP
  // TANIMLAMANIZ SART - aksi halde "her durumda ulassin" garantisi calismaz).
  //
  // NOT (bicim farki): sablon PARAMETRESİ satir sonu iceremedigi icin
  // (yukarida sablonIcinTemizle), sablonla giden versiyon multi-line degil,
  // " • " ile ayrilmis TEK SATIR olarak gorunur (orn. "🔔 *Yeni Web
  // Teklifi!* • 👤 Ad: Haluk Levent • 📱 Tel: ..."). Bu, WhatsApp'in kendi
  // teknik kisitlamasi - bu sablon disinda bir cozum yok. Pencere acikken
  // giden duz metin versiyonu ise SIZIN VERDIGINIZ orijinal, satir sonlu
  // formatta kalir - fakat sablon basarili oldugunda o zaten gonderilmiyor
  // (tekrari onlemek icin), yani gunluk kullanimda EN SIK GORECEGINIZ format
  // sablonun tek-satirlik hali olacak.
  async function ekibeBildirGonder(numara, zenginMetin) {
    const sablonAdi = process.env.TEKLIF_EKIP_TEMPLATE_NAME;
    if (sablonAdi) {
      try {
        await sablonGonder(numara, sablonAdi, { detay: sablonIcinTemizle(zenginMetin) });
        return; // basarili - sablon zaten TUM detayi (mesaj) iletti
      } catch (e) {
        console.error('Ekip şablon bildirimi gönderilemedi (' + numara + '):', e.message);
      }
    }
    try {
      await mesajGonder(numara, zenginMetin);
    } catch (e) {
      console.error('Teklif bildirimi gönderilemedi (' + numara + '):', e.message);
    }
  }

  // Tabloyu (ve sonradan eklenen sütunları) idempotent şekilde hazırlar -
  // hem /api/teklif hem de musteriYazdiBildir (webhook tarafı) çağırmadan
  // önce bunu bekliyor, böylece ikisinden hangisi önce çalışırsa çalışsın
  // tablo/sütun eksikliğinden hata almazlar. ADD COLUMN IF NOT EXISTS,
  // Railway'deki MEVCUT prod tablosuna da (veri kaybı olmadan) güvenle
  // uygulanabiliyor.
  async function tabloyuHazirla() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_teklifler (
        id SERIAL PRIMARY KEY,
        tarih TIMESTAMPTZ DEFAULT NOW(),
        ad TEXT, telefon TEXT, kisi_tipi TEXT,
        gelir_aylik_tl INTEGER, odeme_donemi TEXT,
        prim_usd INTEGER, prim_tl INTEGER, paket TEXT,
        teminat_usd INTEGER, yas INTEGER, cinsiyet TEXT,
        aylik_tasarruf_tl INTEGER, yillik_tasarruf_tl INTEGER,
        danisman TEXT, kur NUMERIC, kaynak TEXT
      )`);
    // 24.07.2026 eklemesi: musteri, teklif talebinden sonra WhatsApp'a
    // yazdiginda bildirim+tesekkurun SADECE ILK seferde gitmesi icin.
    await pool.query(`
      ALTER TABLE web_teklifler
      ADD COLUMN IF NOT EXISTS yanit_bildirildi_mi BOOLEAN DEFAULT FALSE`);
  }

  app.options('/api/teklif', (req, res) => { cors(req, res); res.sendStatus(204); });

  app.post('/api/teklif', async (req, res) => {
    cors(req, res);
    try {
      const b = req.body || {};
      if (!process.env.TEKLIF_SECRET || b.secret !== process.env.TEKLIF_SECRET) {
        return res.status(401).json({ ok: false });
      }
      if (!b.ad || !b.telefon) return res.status(400).json({ ok: false });

      // --- 1) Veritabanına kaydet ---
      await tabloyuHazirla();
      await pool.query(
        `INSERT INTO web_teklifler
         (ad, telefon, kisi_tipi, gelir_aylik_tl, odeme_donemi, prim_usd, prim_tl,
          paket, teminat_usd, yas, cinsiyet, aylik_tasarruf_tl, yillik_tasarruf_tl,
          danisman, kur, kaynak)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [b.ad, b.telefon, b.kisiTipi || null, b.gelirAylikTL || null, b.odemeDonemi || null,
         b.primUsd || null, b.primTL || null, b.paket || null, b.teminatUsd || null,
         b.yas || null, b.cinsiyet || null, b.aylikTasarrufTL || null, b.yillikTasarrufTL || null,
         b.danisman || null, b.kur || null, b.kaynak || 'web']
      );

      // --- 2) WhatsApp bildirimi (ekibe) ---
      // 25.07.2026: format Enbel'in verdigi ornege gore birebir yeniden
      // duzenlendi (etiketli alanlar, "Aylik Gelir" satiri eklendi, "$" yerine
      // "USD", "≈" yerine "~", "Yillik vergi avantaji" satiri kaldirildi).
      const mesaj =
        '🔔 *Yeni Web Teklifi!*\n\n' +
        '👤 Ad: ' + b.ad + '\n' +
        '📱 Tel: ' + b.telefon + '\n' +
        '🏷️ Tip: ' + (b.kisiTipi || '-') + '\n' +
        (b.gelirAylikTL ? '💰 Aylık Gelir: ' + Number(b.gelirAylikTL).toLocaleString('tr-TR') + ' TL\n' : '') +
        '💵 Prim: ' + (b.primUsd || '-') + ' USD / ' + (b.odemeDonemi || 'aylık') +
        ' (' + (b.paket || '-') + ' Paket)\n' +
        (b.teminatUsd ? '🛡️ Teminat: ~' + Number(b.teminatUsd).toLocaleString('tr-TR') + ' USD' +
          (b.yas ? ' (' + b.yas + ' yaş, ' + (b.cinsiyet || '') + ')' : '') + '\n' : '') +
        (b.danisman ? '🤝 Danışman: ' + b.danisman + '\n' : '') +
        '\nMüşteri PDF teklifini indirdi, sıcakken arayın! 🔥';

      // --- 1.5) leadStore'a "Bekleyen İş" olarak ekle ---
      // 07.08.2026 eklendi: bu web hesaplayicisindan (Prim İadeli Hayat/BES)
      // gelen teklifler eskiden SADECE web_teklifler tablosuna yaziliyor ve
      // WhatsApp bildirimi gonderiliyordu, ama leadStore'a hic eklenmiyordu -
      // bu yuzden panelde/"Bekleyen İş" listesinde hic gorunmuyorlardi.
      // webTeklifFormlari.js'teki (Malpraktis formu) leadStore.yeniLeadOlustur
      // cagrisiyla AYNI desen izleniyor. Bir hata olursa (orn. flows.js
      // okunamazsa) SADECE bu adim atlanir, DB kaydi/bildirimler etkilenmez.
      try {
        const flows = require('./flows');
        const musteriTel = telefonUluslararasiFormata(b.telefon);
        const danismanNo = danismanNumarasiBul(b.danisman);
        leadStore.yeniLeadOlustur({
          telefon: musteriTel || b.telefon,
          musteriAdi: b.ad,
          urun: (flows.hayat && flows.hayat.label) || 'Prim İadeli Hayat Sigortası',
          danismanAdi: b.danisman || null,
          danismanNumarasi: danismanNo || null,
          ozet: "[Web Teklif Formu'ndan oluşturuldu] " + mesaj
        });
      } catch (e) {
        console.error("Web teklifi leadStore'a eklenemedi:", e.message);
      }

      const alicilar = new Set();
      if (process.env.NOTIFY_NUMBER) alicilar.add(process.env.NOTIFY_NUMBER.trim());
      if (b.danismanTel) {
        const numara = telefonUluslararasiFormata(b.danismanTel);
        if (numara) alicilar.add(numara);
      }
      for (const numara of alicilar) {
        await ekibeBildirGonder(numara, mesaj);
      }

      // --- 3) Müşteriye onaylı şablonla bilgilendirme ---
      // Müşteri bu numaraya daha önce hiç yazmamış olabilir (24 saatlik
      // musteri-hizmeti penceresi dışı) - o yüzden düz metin değil, Meta'nın
      // onayladığı bir şablon kullanılıyor. TEKLIF_MUSTERI_TEMPLATE_NAME
      // tanımlı değilse bu adım sessizce atlanır, /api/teklif akışı bundan
      // etkilenmez. Şablonun BODY'sinde {{musteri_adi}} ve {{danisman_adi}}
      // adlarında (aşağıdaki nesnenin anahtarlarıyla BİREBİR aynı) iki
      // değişken olmalı - Meta artık adlandırılmış değişken istiyor, isim
      // uyuşmazsa gönderim hata verir (bkz. yukarıda sablonGonder).
      const musteriSablonAdi = process.env.TEKLIF_MUSTERI_TEMPLATE_NAME;
      if (musteriSablonAdi) {
        const musteriNumarasi = telefonUluslararasiFormata(b.telefon);
        if (musteriNumarasi) {
          try {
            await sablonGonder(musteriNumarasi, musteriSablonAdi, {
              musteri_adi: b.ad,
              danisman_adi: b.danisman || 'ekibimiz'
            });
          } catch (e) {
            console.error('Müşteriye onay şablonu gönderilemedi (' + musteriNumarasi + '):', e.message);
          }
        }
      } else {
        console.warn('TEKLIF_MUSTERI_TEMPLATE_NAME tanımlı değil - müşteriye onay mesajı gönderilemedi.');
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('Teklif endpoint hatası:', e);
      res.status(500).json({ ok: false });
    }
  });

  console.log('✅ /api/teklif endpoint aktif (web hesaplayıcı bildirimleri)');

  // Verilen ad soyada (web formunda seçilen danışman adına) göre, projenin
  // flows.js dosyasındaki DANISMANLAR listesinden telefon numarasını bulur -
  // web_teklifler tablosunda sadece isim saklandığı için (telefon değil),
  // yanıt geldiğinde "ilgili danışmanı" bu şekilde çözüyoruz. İsim
  // listede yoksa (henüz numarası paylaşılmamış bir danışmansa) null döner -
  // bu durumda sadece NOTIFY_NUMBER'a bildirim gider, akış hata vermez.
  function danismanNumarasiBul(adAdi) {
    if (!adAdi) return null;
    try {
      const flows = require('./flows');
      const liste = (flows && flows.dask && flows.dask.advisors) || [];
      const hedef = String(adAdi).trim().toLocaleLowerCase('tr');
      const bulunan = liste.find((d) => String(d.name).trim().toLocaleLowerCase('tr') === hedef);
      return bulunan ? bulunan.number : null;
    } catch (e) {
      console.error('Danışman numarası çözülemedi (flows.js okunamadı):', e.message);
      return null;
    }
  }

  // Son 30 gün içinde, verilen (ham, herhangi bir formatta) telefon numarasına
  // ait, HENÜZ bildirilmemiş (yanit_bildirildi_mi = false) bir web_teklifler
  // kaydı olup olmadığını arar - varsa EN GÜNCEL kaydı döner, yoksa null.
  // Numaraları karşılaştırırken baştaki 0/90 farkını gözetmemek için ikisi de
  // "son 10 hane"ye indirgeniyor (bkz. yukarıda telefonSon10Hane). Zaten
  // bildirilmiş kayıtlar burada DÖNMEZ - böylece musteriYazdiBildir doğal
  // olarak sadece o kayıt için İLK mesajda bir sonuç bulur.
  async function sonTeklifiBul(telefonHam) {
    const hedef10 = telefonSon10Hane(telefonHam);
    if (!hedef10) return null;
    try {
      await tabloyuHazirla();
      const { rows } = await pool.query(
        `SELECT id, ad, telefon, danisman, tarih FROM web_teklifler
         WHERE tarih >= NOW() - INTERVAL '30 days'
           AND yanit_bildirildi_mi IS NOT TRUE
           AND RIGHT(regexp_replace(telefon, '[^0-9]', '', 'g'), 10) = $1
         ORDER BY tarih DESC
         LIMIT 1`,
        [hedef10]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('web_teklifler sorgusu başarısız (musteriYazdiBildir):', e.message);
      return null;
    }
  }

  // Webhook'a (WhatsApp'a doğrudan) bir mesaj geldiğinde, index.js tarafından
  // çağrılması beklenen fonksiyon: gönderen numara son 30 gün içindeki, henüz
  // bildirilmemiş bir web_teklifler kaydıyla eşleşiyorsa, hem ekibe
  // (NOTIFY_NUMBER + varsa ilgili danışman) bir bildirim hem de müşteriye
  // kısa bir teşekkür mesajı gönderir, sonra o kaydı "bildirildi" olarak
  // işaretler (24.07.2026 kararı - bu SADECE o kayıttan sonraki İLK mesajda
  // olur, müşteri sonrasında kaç kez yazarsa yazsın bir daha tekrarlanmaz).
  // Eşleşme yoksa (ya da zaten daha önce bildirilmişse) hiçbir şey yapmaz.
  // Müşteri bu numaraya AZ ÖNCE kendisi yazdığı için (24 saatlik oturum
  // penceresi içi), müşteriye giden teşekkür mesajı düz metin olarak
  // gönderilebiliyor. FAKAT bu, ekibe (NOTIFY_NUMBER/danışman) giden
  // bildirim için GEÇERLİ DEĞİL - müşterinin bot'a yazmış olması, ekip
  // üyelerinin KENDİ numaralarının penceresini AÇMAZ (bunlar ayrı, birbirinden
  // bağımsız numaralar) - o yüzden ekip bildirimi de /api/teklif'teki gibi
  // ekibeBildirGonder (şablon-yedekli) üzerinden gönderiliyor (25.07.2026
  // düzeltmesi - önceki yorum bunu yanlış varsayıyordu). Eşleşme bulunup bulunmadığını
  // (true/false) döner ki index.js isterse loglayabilsin; normal mesaj
  // akışını index.js HER DURUMDA kendisi devam ettirmeli, bu fonksiyon akışı
  // durdurmaz/engellemez.
  async function musteriYazdiBildir(telefonHam) {
    const kayit = await sonTeklifiBul(telefonHam);
    if (!kayit) return false;
    const hedef10 = telefonSon10Hane(telefonHam);

    const alicilar = new Set();
    if (process.env.NOTIFY_NUMBER) alicilar.add(process.env.NOTIFY_NUMBER.trim());
    const danismanNo = danismanNumarasiBul(kayit.danisman);
    if (danismanNo) alicilar.add(danismanNo);

    const bildirimMetni = `🔔 Web teklif müşterisi yazdı: ${kayit.ad} ${kayit.telefon} — aranmak istiyor`;
    for (const numara of alicilar) {
      await ekibeBildirGonder(numara, bildirimMetni);
    }

    const musteriNumarasi = telefonUluslararasiFormata(telefonHam);
    if (musteriNumarasi) {
      try {
        await mesajGonder(
          musteriNumarasi,
          'Mesajınız için teşekkür ederiz! 🙏 Danışmanımız en kısa sürede sizinle iletişime geçecek.'
        );
      } catch (e) {
        console.error('Müşteriye teşekkür mesajı gönderilemedi (' + musteriNumarasi + '):', e.message);
      }
    }

    // Bu kaydı (VE aynı telefon numarasına ait, henüz bildirilmemiş TÜM diğer
    // eski kayıtları) "bildirildi" olarak işaretliyoruz ki AYNI müşteri
    // sonraki mesajlarında (hâlâ 30 günlük pencere içinde olsa bile) tekrar bu
    // bildirim+teşekkür akışını tetiklemesin.
    //
    // 27.07.2026 DÜZELTMESİ: Eskiden SADECE sonTeklifiBul'un döndürdüğü TEK
    // kayıt (kayit.id) işaretleniyordu. Ama aynı müşteri web formunu birden
    // fazla kez doldurmuşsa (ya da aynı numarayla birden fazla web_teklifler
    // satırı varsa), sonTeklifiBul her seferinde EN YENİ bildirilmemiş kaydı
    // buluyor - bir önceki mesajda bir satır işaretlendiğinde, BİR SONRAKİ
    // mesajda hâlâ işaretlenmemiş bir sonraki eski satır eşleşiyor ve
    // "Mesajınız için teşekkür ederiz..." mesajı HER MESAJDA tekrar tekrar
    // gönderiliyordu (ekran görüntüsünde "DASK", sonra "Hayır", sonra "Ev
    // Sahibiyim" - müşterinin gönderdiği HER mesajdan sonra bu mesaj tekrar
    // düşmüştü). Artık eşleşen telefon numarasına ait TÜM bildirilmemiş
    // kayıtlar tek seferde işaretleniyor, böylece bu mesaj gerçekten sadece
    // İLK mesajda bir kez gidiyor.
    try {
      await pool.query(
        `UPDATE web_teklifler
         SET yanit_bildirildi_mi = TRUE
         WHERE yanit_bildirildi_mi IS NOT TRUE
           AND RIGHT(regexp_replace(telefon, '[^0-9]', '', 'g'), 10) = $1`,
        [hedef10]
      );
    } catch (e) {
      console.error('web_teklifler "bildirildi" olarak işaretlenemedi (telefon=' + telefonHam + '):', e.message);
    }

    return true;
  }

  return { musteriYazdiBildir, sonTeklifiBul };
};
