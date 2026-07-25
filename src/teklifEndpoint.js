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
//        TEKLIF_MUSTERI_TEMPLATE_NAME = (Meta'da onaylı, "ad" ve "danisman"
//                                        parametreli bir şablonun adı - bkz.
//                                        aşağıdaki 2. adım. Tanımlı değilse bu
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
//     2. adım).
// =====================================================================

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

  // Metin (düz) bir WhatsApp mesajı gönderen küçük ortak yardımcı - hem asıl
  // /api/teklif bildirimi hem de aşağıdaki musteriYazdiBildir tarafından
  // paylaşılıyor.
  async function mesajGonder(numara, metin) {
    return fetch(
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
  }

  // "ad"/"danisman" parametreli, ONAYLI bir şablonla mesaj gönderir (müşteri
  // henüz bize hiç yazmadığı için 24 saatlik oturum penceresi dışındayız -
  // düz metin GÖNDERİLEMEZ, Meta'nın onayladığı bir şablon şart).
  async function sablonGonder(numara, sablonAdi, parametreler) {
    return fetch(
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
                parameters: parametreler.map((deger) => ({ type: 'text', text: String(deger) }))
              }
            ]
          }
        })
      }
    );
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
      const mesaj =
        '🔔 *Yeni Web Teklifi!*\n\n' +
        '👤 ' + b.ad + '\n' +
        '📱 ' + b.telefon + '\n' +
        '🏷️ ' + (b.kisiTipi || '-') + '\n' +
        '💵 Prim: ' + (b.primUsd || '-') + ' $ / ' + (b.odemeDonemi || 'aylık') +
        ' (' + (b.paket || '-') + ' Paket)\n' +
        (b.teminatUsd ? '🛡️ Teminat: ≈ ' + Number(b.teminatUsd).toLocaleString('tr-TR') + ' $' +
          (b.yas ? ' (' + b.yas + ' yaş, ' + (b.cinsiyet || '') + ')' : '') + '\n' : '') +
        '📈 Yıllık vergi avantajı: ' + Number(b.yillikTasarrufTL || 0).toLocaleString('tr-TR') + ' ₺\n' +
        (b.danisman ? '🤝 Danışman: ' + b.danisman + '\n' : '') +
        '\nMüşteri PDF teklifini indirdi — sıcakken arayın! 🔥';

      const alicilar = new Set();
      if (process.env.NOTIFY_NUMBER) alicilar.add(process.env.NOTIFY_NUMBER.trim());
      if (b.danismanTel) {
        const numara = telefonUluslararasiFormata(b.danismanTel);
        if (numara) alicilar.add(numara);
      }
      for (const numara of alicilar) {
        try {
          await mesajGonder(numara, mesaj);
        } catch (e) {
          console.error('Teklif bildirimi gönderilemedi (' + numara + '):', e.message);
        }
      }

      // --- 3) Müşteriye onaylı şablonla bilgilendirme ---
      // Müşteri bu numaraya daha önce hiç yazmamış olabilir (24 saatlik
      // musteri-hizmeti penceresi dışı) - o yüzden düz metin değil, Meta'nın
      // onayladığı bir şablon kullanılıyor. TEKLIF_MUSTERI_TEMPLATE_NAME
      // tanımlı değilse bu adım sessizce atlanır, /api/teklif akışı bundan
      // etkilenmez.
      const musteriSablonAdi = process.env.TEKLIF_MUSTERI_TEMPLATE_NAME;
      if (musteriSablonAdi) {
        const musteriNumarasi = telefonUluslararasiFormata(b.telefon);
        if (musteriNumarasi) {
          try {
            await sablonGonder(musteriNumarasi, musteriSablonAdi, [b.ad, b.danisman || 'ekibimiz']);
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
  // ait bir web_teklifler kaydı olup olmadığını arar - varsa EN GÜNCEL
  // kaydı döner, yoksa null. Numaraları karşılaştırırken baştaki 0/90 farkını
  // gözetmemek için ikisi de "son 10 hane"ye indirgeniyor (bkz. yukarıda
  // telefonSon10Hane).
  async function sonTeklifiBul(telefonHam) {
    const hedef10 = telefonSon10Hane(telefonHam);
    if (!hedef10) return null;
    try {
      const { rows } = await pool.query(
        `SELECT ad, telefon, danisman, tarih FROM web_teklifler
         WHERE tarih >= NOW() - INTERVAL '30 days'
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
  // çağrılması beklenen fonksiyon: gönderen numara son 30 gün içindeki bir
  // web_teklifler kaydıyla eşleşiyorsa, hem ekibe (NOTIFY_NUMBER + varsa
  // ilgili danışman) bir bildirim hem de müşteriye kısa bir teşekkür mesajı
  // gönderir; eşleşme yoksa hiçbir şey yapmaz. Müşteri bu numaraya AZ ÖNCE
  // kendisi yazdığı için (24 saatlik oturum penceresi içi), hem ekibe hem
  // müşteriye giden mesajlar düz metin olarak gönderilebiliyor - şablona
  // gerek yok. Eşleşme bulunup bulunmadığını (true/false) döner ki index.js
  // isterse loglayabilsin; normal mesaj akışını index.js HER DURUMDA kendisi
  // devam ettirmeli, bu fonksiyon akışı durdurmaz/engellemez.
  async function musteriYazdiBildir(telefonHam) {
    const kayit = await sonTeklifiBul(telefonHam);
    if (!kayit) return false;

    const alicilar = new Set();
    if (process.env.NOTIFY_NUMBER) alicilar.add(process.env.NOTIFY_NUMBER.trim());
    const danismanNo = danismanNumarasiBul(kayit.danisman);
    if (danismanNo) alicilar.add(danismanNo);

    const bildirimMetni = `🔔 Web teklif müşterisi yazdı: ${kayit.ad} ${kayit.telefon} — aranmak istiyor`;
    for (const numara of alicilar) {
      try {
        await mesajGonder(numara, bildirimMetni);
      } catch (e) {
        console.error('Müşteri yazdı bildirimi gönderilemedi (' + numara + '):', e.message);
      }
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

    return true;
  }

  return { musteriYazdiBildir, sonTeklifiBul };
};
