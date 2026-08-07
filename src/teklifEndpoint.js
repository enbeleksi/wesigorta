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
  const express = require('express');
  // E-posta imzasi: WE Sigorta kartvizit gorseli (240px JPEG, base64)
  const IMZA_B64 = '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';
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
      await pool.query('ALTER TABLE web_teklifler ADD COLUMN IF NOT EXISTS eposta TEXT');
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
          danisman, kur, kaynak, eposta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [b.ad, b.telefon, b.kisiTipi || null, b.gelirAylikTL || null, b.odemeDonemi || null,
         b.primUsd || null, b.primTL || null, b.paket || null, b.teminatUsd || null,
         b.yas || null, b.cinsiyet || null, b.aylikTasarrufTL || null, b.yillikTasarrufTL || null,
         b.danisman || null, b.kur || null, b.kaynak || 'web', b.eposta || null]
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

  // ============================================================
  // KORUNACAK BLOK: Web hesaplayici - musteriye e-posta ile PDF gonderimi
  // Bu rota ve yukaridaki IMZA_B64 sabiti web sitesindeki hesaplayicinin
  // e-posta ozelligi icin gereklidir; yeni surumlerde SILINMEMELIDIR.
  // ============================================================
  app.post('/api/teklif/eposta', express.text({ type: 'text/plain', limit: '15mb' }), async function (req, res) {
    cors(req, res);
    try {
      var eb; try { eb = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ ok: false }); }
      if (!process.env.TEKLIF_SECRET || eb.secret !== process.env.TEKLIF_SECRET) return res.status(401).json({ ok: false });
      if (!eb.eposta || !eb.pdf || String(eb.pdf).indexOf('data:application/pdf') !== 0) return res.status(400).json({ ok: false });
      if (!process.env.RESEND_API_KEY || !process.env.EPOSTA_GONDEREN_ADRESI) return res.status(503).json({ ok: false });
      var pdfB64 = String(eb.pdf).split(',')[1] || '';
      if (pdfB64.length > 14000000) return res.status(413).json({ ok: false });
      var mAd = String(eb.ad || 'Degerli Musterimiz').slice(0, 80);
      var dnsSatiri = eb.danisman ? '<p>Danışmanınız <strong>' + String(eb.danisman).slice(0, 60) + '</strong>, dilerseniz en kısa sürede sizi arayarak simülasyonunuzu birlikte değerlendirecektir.</p>' : '<p>Danışmanlarımız, dilerseniz en kısa sürede sizi arayarak simülasyonunuzu birlikte değerlendirecektir.</p>';
      var govde = "<div style=\"font-family:Segoe UI,Arial,sans-serif;color:#132F3E;font-size:15px;line-height:1.7;max-width:560px\">"
        + '<p>Sayın <strong>' + mAd + '</strong>,</p>'
        + '<p>WE Sigorta hesaplama aracımızı kullanarak oluşturduğunuz <strong>Prim İadeli Hayat Sigortası</strong> simülasyonunuz ekte yer almaktadır. Simülasyonunuzda; ödeyeceğiniz prim, size özel vergi avantajı, yaklaşık vefat teminatınız ve süre sonu prim iadeniz bir arada sunulmuştur.</p>'
        + dnsSatiri
        + "<p>Sorularınız için 7/24 WhatsApp hattımızdan bize ulaşabilirsiniz: <strong>0850 220 93 61</strong><br>Web: <a href=\"https://wesigorta.com.tr\">wesigorta.com.tr</a></p>"
        + "<p>Sağlıklı günler dileriz.<br><strong>WE Sigorta</strong><br><span style=\"color:#41606F;font-size:13px\">Yetkili Garanti BBVA Emeklilik Acentesi</span></p>"
        + "<p style=\"color:#7A8F98;font-size:11px\">Bu belge bilgilendirme amaçlı bir ön çalışmadır; kesin prim, teminat ve şartlar Garanti BBVA Emeklilik ve Hayat A.Ş. tarafından poliçe teklifinde belirlenir.</p>"
        + "<img src=\"cid:wesigortaimza\" width=\"240\" height=\"186\" style=\"width:240px;max-width:240px;height:auto;display:block;margin-top:14px;border-radius:8px\" alt=\"WE Sigorta\">"
        + '</div>';
      var istek = {
        from: 'WE Sigorta <' + process.env.EPOSTA_GONDEREN_ADRESI + '>',
        to: [String(eb.eposta).slice(0, 120)],
        subject: 'Prim İadeli Hayat Sigortası Simülasyonu',
        html: govde,
        attachments: [{ filename: String(eb.dosyaAdi || 'WE-Sigorta-Teklif.pdf').slice(0, 100), content: pdfB64 }, { filename: 'wesigorta-kartvizit.jpg', content: IMZA_B64, content_id: 'wesigortaimza' }]
      };
      if (process.env.EPOSTA_YANIT_ADRESI) istek.reply_to = process.env.EPOSTA_YANIT_ADRESI;
      var cevap = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(istek)
      });
      if (!cevap.ok) { console.error('Teklif e-postasi gonderilemedi:', cevap.status); return res.status(502).json({ ok: false }); }
      res.json({ ok: true });
    } catch (e) {
      console.error('Teklif e-posta endpoint hatasi:', e);
      res.status(500).json({ ok: false });
    }
  });

  return { musteriYazdiBildir, sonTeklifiBul };
};
