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
//   - EKİP BİLDİRİMİ ARTIK ŞABLON-YEDEKLİ: TEKLIF_EKIP_TEMPLATE_NAME
//     tanımlıysa, ekibe (NOTIFY_NUMBER + danışman) giden bildirim önce bu
//     şablonla denenir (24 saatlik pencereye tabi değildir, ekip üyesi bot'a
//     hiç yazmamış olsa bile ulaşır); başarısız olursa/ayarlanmamışsa düz
//     metne düşer. Şablonun BODY'sinde {{musteri_adi}} ve {{telefon}}
//     adlarında iki değişken olmalı. Bu ŞABLON HEM "yeni web teklifi" HEM
//     "web teklif müşterisi yazdı" bildirimleri için ORTAK kullanılıyor (iki
//     ayrı şablon onaylatma zahmetinden kaçınmak için) - o yüzden metni
//     kasıtlı olarak GENEL tutun (bkz. .env.example'daki örnek).
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

  // Ekibe (NOTIFY_NUMBER + varsa danışman) giden bildirimleri TEK bir yerden
  // yönetir - iki hem /api/teklif hem musteriYazdiBildir tarafından
  // kullanılır (25.07.2026 eklemesi). conversationEngine.js'teki
  // bildirimGonder ile AYNI desen: önce (varsa) TEKLIF_EKIP_TEMPLATE_NAME
  // şablonunu dener - şablon mesajları 24 saatlik müşteri-hizmeti
  // penceresine TABİ DEĞİLDİR, karşı taraf (ekip üyesi) bu numaraya hiç
  // yazmamış olsa bile ulaşır. Şablon başarılı olursa BURADA DURULUR (aynı
  // bilgiyi iki kez göndermemek için). Şablon başarısız olursa/ayarlanmamışsa
  // düz metne düşer - bu SADECE pencere açıksa (ekip üyesi son 24 saatte
  // bot'a yazdıysa) çalışır. Her iki adım da başarısız olursa hata konsola
  // düşer (bkz. yukarıda yanitiKontrolEt - artık HTTP hataları sessizce
  // kaybolmuyor).
  async function ekibeBildirGonder(numara, duzMetin, sablonParametreler) {
    const sablonAdi = process.env.TEKLIF_EKIP_TEMPLATE_NAME;
    if (sablonAdi) {
      try {
        await sablonGonder(numara, sablonAdi, sablonParametreler);
        return; // basarili - sablon zaten yeterli bilgiyi iletti
      } catch (e) {
        console.error('Ekip şablon bildirimi gönderilemedi (' + numara + '):', e.message);
      }
    }
    try {
      await mesajGonder(numara, duzMetin);
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
        await ekibeBildirGonder(numara, mesaj, { musteri_adi: b.ad, telefon: b.telefon });
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

    const alicilar = new Set();
    if (process.env.NOTIFY_NUMBER) alicilar.add(process.env.NOTIFY_NUMBER.trim());
    const danismanNo = danismanNumarasiBul(kayit.danisman);
    if (danismanNo) alicilar.add(danismanNo);

    const bildirimMetni = `🔔 Web teklif müşterisi yazdı: ${kayit.ad} ${kayit.telefon} — aranmak istiyor`;
    for (const numara of alicilar) {
      await ekibeBildirGonder(numara, bildirimMetni, { musteri_adi: kayit.ad, telefon: kayit.telefon });
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

    // Bu kaydı "bildirildi" olarak işaretliyoruz ki AYNI müşteri sonraki
    // mesajlarında (hâlâ 30 günlük pencere içinde olsa bile) tekrar bu
    // bildirim+teşekkür akışını tetiklemesin - sonTeklifiBul artık bu
    // kaydı döndürmeyecek.
    try {
      await pool.query('UPDATE web_teklifler SET yanit_bildirildi_mi = TRUE WHERE id = $1', [kayit.id]);
    } catch (e) {
      console.error('web_teklifler "bildirildi" olarak işaretlenemedi (id=' + kayit.id + '):', e.message);
    }

    return true;
  }

  return { musteriYazdiBildir, sonTeklifiBul };
};
