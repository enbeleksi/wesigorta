// =====================================================================
// WE Sigorta - Urun-Ozel Web Teklif Formlari
// ---------------------------------------------------------------------
// teklifEndpoint.js'ten (Hayat/BES web hesaplayicisi, wesigorta.com.tr uzerinde
// AYRI bir sitede barinan, secret ile korunan cross-origin bir API) farkli
// olarak, buradaki formlar DOGRUDAN BU SUNUCU tarafindan servis edilir (ayni
// origin) ve gonderim, botun kendi altyapisini (leadStore + conversationEngine
// bildirim/guvenlik agi mekanizmasi) kullanarak islenir - yani bir web
// formundan gelen bir talep, panelde ve WhatsApp bildirimlerinde, botun
// kendisinden (chat ile) gelen bir talepten FARKSIZ gorunur.
//
// 28.07.2026 eklendi (Malpraktis web teklif formu): Kullanicinin yukledigi
// "malpraktis_1.html" (bagimsiz, vanilla JS ile yazilmis bir teklif formu -
// hocam hitabi, tescil turu/sehir otomatik algilama gibi flows.js'teki
// mantigin bir kopyasini kendi icinde tasiyordu) projeye entegre edildi:
//   1) GET /teklif/malpraktis - formu servis eder (src/formlar/ altinda).
//   2) POST /api/web-teklif/malpraktis - cevaplari alir, dogrular, ve
//      kullanicinin acikca istedigi gibi Bahadır'a + Enbel'e + (varsa)
//      belirtilen danismana WhatsApp bildirimi gonderip, panelde takip
//      edilebilir bir "Açık" is (lead) olarak kaydeder.
// NOT: Form KENDI ICINDE de (flows.js'teki asistan/uzman/hasta bakma vb.
// skipIf mantigini yansitan) bir dogrulama yapiyor - burasi SADECE ikinci bir
// guvenlik katmani (sunucu tarafi dogrulama olmadan, biri form JS'ini atlayip
// dogrudan bu endpoint'e gecersiz/eksik veri gonderebilirdi).
// =====================================================================

const path = require("path");
const flows = require("./flows");
const leadStore = require("./leadStore");
const conversationEngine = require("./conversationEngine");
const {
  adSoyadGecerliMi,
  tcKimlikGecerliMi,
  tarihGecerliMi,
  telefonGecerliMi,
  telefonUluslararasiFormata,
  pozitifSayiMi
} = require("./validators");

// Malpraktis'in danisman listesi (Enbel, Seda, Bahadır, ...) - flows.js'te
// urunler arasinda paylasilan TEK bir DANISMANLAR dizisi olarak tutuluyor,
// herhangi bir urunun "advisors" alanindan okunabilir (teklifEndpoint.js'teki
// danismanNumarasiBul ile AYNI desen).
function danismanNumarasiBul(adAdi) {
  if (!adAdi) return null;
  const liste = (flows.malpraktis && flows.malpraktis.advisors) || [];
  const hedef = String(adAdi).trim().toLocaleLowerCase("tr");
  const bulunan = liste.find((d) => String(d.name).trim().toLocaleLowerCase("tr") === hedef);
  return bulunan ? bulunan.number : null;
}

// tescil_no/tescil_tarihi sorularinin ETIKETININ (Uzmanlık/Diploma) dogru
// gorunmesi icin - flows.js'teki AYNI kural: asistan degilse VE uzmansa
// "Uzmanlık", aksi halde (asistan ya da sade tabip) "Diploma".
function tescilTuru(answers) {
  return answers.uzman_mi === "Evet" ? "Uzmanlık" : "Diploma";
}

// Gelen ham govdeyi (JSON body), flows.js'teki malpraktis sorularinin skipIf
// mantigina birebir uyacak sekilde dogrular. Eksik/gecersiz bir alan varsa o
// alanin adini (hata mesajinda kullanilmak uzere) dondurur, hepsi geçerliyse
// null doner.
function dogrula(b) {
  if (!adSoyadGecerliMi(b.ad_soyad)) return "ad_soyad";
  if (!telefonGecerliMi(b.telefon)) return "telefon";
  if (!["Kendim İçin", "Başkası İçin"].includes(b.hedef_kisi)) return "hedef_kisi";
  if (!["Evet", "Hayır"].includes(b.asistan_mi)) return "asistan_mi";
  // uzman_mi: asistansa sorulmuyor (skipIf), degilse zorunlu.
  if (b.asistan_mi === "Hayır" && !["Evet", "Hayır"].includes(b.uzman_mi)) return "uzman_mi";
  // uzmanlik_dali: asistan ya da uzmansa zorunlu.
  const uzmanEfektif = b.asistan_mi === "Evet" || b.uzman_mi === "Evet";
  if (uzmanEfektif && !(b.uzmanlik_dali || "").trim()) return "uzmanlik_dali";
  if (!["Evet", "Hayır"].includes(b.hasta_bakiyor_mu)) return "hasta_bakiyor_mu";
  // yillik_hasta_sayisi: sadece aktif hasta bakiyorsa zorunlu.
  if (b.hasta_bakiyor_mu === "Evet" && !pozitifSayiMi(b.yillik_hasta_sayisi)) return "yillik_hasta_sayisi";
  if (!(b.is_adresi || "").trim()) return "is_adresi";
  if (!(b.tescil_no || "").trim()) return "tescil_no";
  if (!tarihGecerliMi(b.tescil_tarihi)) return "tescil_tarihi";
  if (!["Serbest Çalışan", "Kamu Çalışanı"].includes(b.sigorta_ettiren_turu)) return "sigorta_ettiren_turu";
  if (!(b.saglik_kurumu || "").trim()) return "saglik_kurumu";
  if (!(b.sehir || "").trim()) return "sehir";
  if (!tcKimlikGecerliMi(b.tc_kimlik)) return "tc_kimlik";
  // danisman_gorustu_mu = Evet ise danisman_adi da zorunlu.
  if (b.danisman_gorustu_mu === "Evet" && !(b.danisman_adi || "").trim()) return "danisman_adi";
  return null;
}

// 30.07.2026 eklendi: Bu form, kullanicinin wesigorta.com.tr uzerinde
// (bu bot sunucusundan AYRI, kendi ana site hostinginde) yayinladigi
// bir sayfaya (wesigorta.com.tr/malpraktis/) tasindi - yani artik BU
// SUNUCUYLA AYNI origin degil, teklifEndpoint.js'teki (Hayat/BES web
// hesaplayicisi) ile AYNI cross-origin durumu gecerli. O yuzden orada
// zaten kanitlanmis olan AYNI CORS deseni burada da uygulaniyor -
// izin verilen originlerden gelen istekler icin Access-Control-Allow-*
// basliklari ekleniyor ve tarayicinin gonderdigi OPTIONS on-kontrol
// (preflight) istegi ayrica karsilaniyor.
const IZINLI_ORIGINLER = [
  "https://wesigorta.com.tr",
  "https://www.wesigorta.com.tr"
];

function cors(req, res) {
  const origin = req.headers.origin;
  if (IZINLI_ORIGINLER.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = function (app) {
  app.get("/teklif/malpraktis", (req, res) => {
    res.sendFile(path.join(__dirname, "formlar", "malpraktis-teklif-formu.html"));
  });

  app.options("/api/web-teklif/malpraktis", (req, res) => {
    cors(req, res);
    res.sendStatus(204);
  });

  app.post("/api/web-teklif/malpraktis", async (req, res) => {
    cors(req, res);
    try {
      const b = req.body || {};
      const eksikAlan = dogrula(b);
      if (eksikAlan) {
        return res.status(400).json({ ok: false, hata: `Eksik/geçersiz alan: ${eksikAlan}` });
      }

      const telefon = telefonUluslararasiFormata(b.telefon);
      const tur = tescilTuru(b);

      // answers - flows.js'teki malpraktis sorularinin id'leriyle BIREBIR
      // ayni alan adlarini kullaniyor (kompaktDetayOlustur/resolveDanismanText
      // bu id'lere gore calisiyor).
      const answers = {
        danisman_gorustu_mu: b.danisman_gorustu_mu,
        danisman_adi: b.danisman_adi || undefined,
        hedef_kisi: b.hedef_kisi,
        ad_soyad: (b.ad_soyad || "").trim(),
        asistan_mi: b.asistan_mi,
        uzman_mi: b.asistan_mi === "Hayır" ? b.uzman_mi : undefined,
        uzmanlik_dali: (b.uzmanlik_dali || "").trim() || undefined,
        hasta_bakiyor_mu: b.hasta_bakiyor_mu,
        yillik_hasta_sayisi: b.hasta_bakiyor_mu === "Evet" ? String(b.yillik_hasta_sayisi).trim() : undefined,
        is_adresi: (b.is_adresi || "").trim(),
        tescil_no: (b.tescil_no || "").trim(),
        tescil_tarihi: (b.tescil_tarihi || "").trim(),
        sigorta_ettiren_turu: b.sigorta_ettiren_turu,
        saglik_kurumu: (b.saglik_kurumu || "").trim(),
        sehir: (b.sehir || "").trim(),
        tc_kimlik: (b.tc_kimlik || "").trim()
      };

      const musteriAdi = answers.ad_soyad;

      // Danisman secildiyse onun numarasini, secilmediyse Bahadır'in (elementer
      // brans varsayilani) numarasini "birincil" olarak veriyoruz -
      // guvenlikAgiNumaralari zaten flows.malpraktis.agentNumber Bahadır
      // oldugu icin Bahadır'i HER TURLU ekliyor, Enbel'i de HER ZAMAN ekliyor -
      // yani sonuc kume, kullanicinin istedigi "Bahadır + Enbel + varsa
      // danışman" ile birebir orutusuyor.
      const secilenDanismanNumarasi = danismanNumarasiBul(answers.danisman_adi);
      const birincilNumara = secilenDanismanNumarasi || flows.malpraktis.agentNumber;
      const bildirilecekNumaralar = conversationEngine.guvenlikAgiNumaralari(flows.malpraktis, birincilNumara);

      // Ekibe giden zengin bildirim metni - advisorEngine.js'teki
      // danismanYeniTalepiTamamla ile AYNI ruhta: internal/ekip-yonelimli
      // oldugu icin resolveDanismanText (notr, 3. sahis) kullaniliyor.
      const soruSatiriEkle = (lines, etiket, deger) => {
        if (deger === undefined || deger === null || deger === "") return;
        lines.push(`${etiket}: ${deger}`);
      };
      const detaySatirlari = [];
      soruSatiriEkle(detaySatirlari, "Kime Ait", answers.hedef_kisi);
      if (answers.danisman_adi) soruSatiriEkle(detaySatirlari, "Daha Önce Görüşülen Danışman", answers.danisman_adi);
      soruSatiriEkle(detaySatirlari, "Asistan mı", answers.asistan_mi);
      soruSatiriEkle(detaySatirlari, "Uzman mı", answers.uzman_mi);
      soruSatiriEkle(detaySatirlari, "Uzmanlık Dalı", answers.uzmanlik_dali);
      soruSatiriEkle(detaySatirlari, "Aktif Hasta Bakıyor mu", answers.hasta_bakiyor_mu);
      soruSatiriEkle(detaySatirlari, "Yıllık Ortalama Hasta Sayısı", answers.yillik_hasta_sayisi);
      soruSatiriEkle(detaySatirlari, "İş Adresi", answers.is_adresi);
      soruSatiriEkle(detaySatirlari, `${tur} Tescil No`, answers.tescil_no);
      soruSatiriEkle(detaySatirlari, `${tur} Tescil Tarihi`, answers.tescil_tarihi);
      soruSatiriEkle(detaySatirlari, "Sigorta Ettiren Türü", answers.sigorta_ettiren_turu);
      soruSatiriEkle(detaySatirlari, "Bağlı Sağlık Kurumu", answers.saglik_kurumu);
      soruSatiriEkle(detaySatirlari, "Şehir", answers.sehir);
      soruSatiriEkle(detaySatirlari, "T.C. Kimlik No", answers.tc_kimlik);

      const agentMessage =
        `📋 Web'den Yeni Malpraktis Teklifi!\n` +
        `📌 Bu talep web teklif formundan oluşturuldu.\n\n` +
        `Sigortalı: ${musteriAdi}\n` +
        `Telefon: ${telefon}\n` +
        `Ürün: ${flows.malpraktis.label}\n\n` +
        detaySatirlari.join("\n");

      const sahteSession = { answers, name: musteriAdi };
      const kompaktDetayTemel = conversationEngine.kompaktDetayOlustur(flows.malpraktis, sahteSession, telefon);
      const kompaktDetay = `[Web Teklif Formu'ndan oluşturuldu] ${kompaktDetayTemel}`;

      for (const numara of bildirilecekNumaralar) {
        await conversationEngine.bildirimGonder(numara, flows.malpraktis.label, musteriAdi, telefon, agentMessage, kompaktDetay);
      }

      leadStore.yeniLeadOlustur({
        telefon,
        musteriAdi,
        urun: flows.malpraktis.label,
        danismanAdi: answers.danisman_adi || null,
        danismanNumarasi: secilenDanismanNumarasi || null,
        ozet: kompaktDetay
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Malpraktis web teklif formu hatası:", err);
      res.status(500).json({ ok: false, hata: "sunucu_hatasi" });
    }
  });

  console.log("✅ Malpraktis web teklif formu aktif (GET /teklif/malpraktis, POST /api/web-teklif/malpraktis)");
};
