require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const multer = require("multer");
const {
  handleIncoming,
  hatirlatmaGonder,
  cokSatirliMesajGonder,
  memnuniyetAnketiGonder,
  notEklendiBildirimiGonder,
  yeniTalepAksiyonHookAyarla,
  sablonParametresiIcinTemizle
} = require("./conversationEngine");
const advisorEngine = require("./advisorEngine");
const { sendText, sendDocument, sendTemplate, sendAuthTemplate } = require("./loggedWhatsapp");
const { sablonOlustur, sablonDetayGetir, sablonDuzenle } = require("./whatsapp");
const messageLog = require("./messageLog");
const leadStore = require("./leadStore");
const yenilemeStore = require("./yenilemeStore");
const engelliNumaralarStore = require("./engelliNumaralarStore");
const dokumanStore = require("./dokumanStore");
const flows = require("./flows");
const db = require("./db");
const sessionStore = require("./sessionStore");
const { getSession } = sessionStore;
const musteriProfilStore = require("./musteriProfilStore");

const app = express();
// Railway (Render, Heroku vb. gibi) trafigi bir proxy/load balancer arkasindan
// yonlendiriyor - bu ayar olmadan req.ip her zaman proxy'nin kendi IP'sini
// gosterir, gercek istemci IP'sini degil (X-Forwarded-For header'indan okumak
// icin Express'e "bu proxy'e guven" dememiz gerekiyor). Ozellikle
// /panel/dogrula'ya kimin/nereden istek attigini teshis ederken (bkz. asagida)
// bu ayar olmadan loglar ise yaramaz.
app.set("trust proxy", true);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false })); // /panel/dogrula form gonderimi icin

// Panelden yuklenen dosyalari bellekte tutan gecici depolama (diske yazmiyoruz,
// direkt WhatsApp'a yukleyip atiyoruz). 16MB'a kadar dosya kabul eder.
const { dosyaTuruIzinliMi } = require("./izinliDosyaTurleri");

// Sadece PDF, Word, Excel ve fotograf turlerini kabul eder - kotu amacli
// dosyalarin (calistirilabilir, arsiv vb.) yuklenmesini engellemek icin.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (dosyaTuruIzinliMi(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Desteklenmeyen dosya turu. Sadece PDF, Word, Excel ve fotograf dosyalari yuklenebilir."));
    }
  }
});

// --- Ayni WhatsApp mesajinin iki kez islenmesini onleme (webhook tekrari) ---
// Meta bazen ag sorunlari yuzunden ayni mesaji webhook'a birden fazla kez
// gonderebilir. Bu durumda ayni cevap, bot tarafindan yanlislikla iki farkli
// soruya verilmis cevap gibi islenip akisi bozabilir. Her mesajin WhatsApp'in
// verdigi benzersiz "id"sini tutup, daha once gordugumuz bir id'yi tekrar
// islemeyerek bunu onluyoruz.
const islenenMesajIdleri = new Set();
const islenenMesajSirasi = [];
const MAX_TUTULAN_MESAJ_ID = 2000;

function mesajDahaOnceIslendiMi(mesajId) {
  if (!mesajId) return false; // id yoksa (beklenmedik durum) guvenli tarafta kal, isle
  if (islenenMesajIdleri.has(mesajId)) return true;
  islenenMesajIdleri.add(mesajId);
  islenenMesajSirasi.push(mesajId);
  if (islenenMesajSirasi.length > MAX_TUTULAN_MESAJ_ID) {
    const enEski = islenenMesajSirasi.shift();
    islenenMesajIdleri.delete(enEski);
  }
  return false;
}

// Bu liste de (leadler, oturumlar gibi) periyodik olarak veritabanina
// yedekleniyor - boylece bir restart, "daha once gorulmus" mesaj gecmisini
// silmiyor ve Meta'nin gecikmis tekrar denemeleri restart sonrasinda da
// dogru sekilde taninip atlanabiliyor (bkz. webhook isleyicisindeki zaman
// damgasi kontrolu ile birlikte iki katmanli koruma).
async function islenenMesajIdleriYukle() {
  const veri = await db.oku("islenenMesajIdleri");
  if (Array.isArray(veri)) {
    veri.forEach((id) => {
      if (islenenMesajIdleri.has(id)) return; // guvenlik: yinelenen kayit olmasin
      islenenMesajIdleri.add(id);
      islenenMesajSirasi.push(id);
    });
    console.log(`${veri.length} islenmis mesaj ID'si veritabanindan yuklendi.`);
  }
}

async function islenenMesajIdleriKaydet() {
  await db.yaz("islenenMesajIdleri", islenenMesajSirasi);
}

// --- Sifre + WhatsApp OTP ile iki faktorlu giris (temsilci paneli icin) ---
// 1. faktor: kullanici adi/sifre (tarayicinin standart Basic Auth kutusu).
// 2. faktor: WhatsApp'a gonderilen 6 haneli tek kullanimlik kod - GIRIS YAPAN
//    KISININ KENDI numarasina gider (herkes kendi telefonuna kod alir).
// Basariyla dogrulanan bir tarayici, 12 saat boyunca tekrar kod girmek zorunda kalmaz.
const crypto = require("crypto");

function escapeHtmlSunucu(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// Panele girebilecek kisiler. Her birinin kendi kullanici adi/sifresi ve kendi
// WhatsApp numarasi var - sifreler Railway'deki ortam degiskenlerinden okunur,
// numaralar zaten sistemde bilindigi icin burada sabit tanimli. Yeni bir kisi
// eklemek icin bu listeye bir satir eklemeniz (+ ilgili sifre ortam
// degiskenini Railway'e tanimlamaniz) yeterlidir.
const PANEL_KULLANICILARI = [
  {
    kullaniciAdi: "enbeleksi",
    sifre: process.env.PANEL_ENBEL_SIFRE,
    telefon: "905326876126",
    ad: "Enbel"
  },
  {
    kullaniciAdi: "bahadireksi",
    sifre: process.env.PANEL_BAHADIR_SIFRE,
    telefon: "905380711711",
    ad: "Bahadır"
  }
];

// GUVENLIK KODU (2FA/OTP) GECICI OLARAK ASKIYA ALINDI (19.07.2026) - hem
// Bahadır'a hem Enbel'e, GERCEK bir giris denemesi olmadan pespese WhatsApp
// guvenlik kodu gitmeye basladi, kok neden henuz netlesmedi (supheli
// adaylar: onaylanmis bildirim sablonlarindan birine eskiden eklenmis,
// icinde sifre gecen bir link'in WhatsApp tarafindan otomatik "link
// onizleme" olarak sunucu tarafinda ziyaret edilmesi vb.). Sorun netlesip
// duzeltilene kadar butun 2FA akisi TAMAMEN devre disi - panel SADECE
// sifre (Basic Auth) ile aciliyor, hicbir WhatsApp kodu gonderilmiyor.
// PANEL_2FA_AKTIF ortam degiskeni "true" olarak ayarlanip yeniden deploy
// edilirse eski (sifre + WhatsApp kodu) akisi hemen geri doner - alttaki
// kodun hicbiri silinmedi, sadece bu bayrakla by-pass ediliyor.
const PANEL_2FA_AKTIF = process.env.PANEL_2FA_AKTIF === "true";

const OTP_GECERLILIK_MS = 5 * 60 * 1000; // 5 dakika
const OTURUM_GECERLILIK_MS = 12 * 60 * 60 * 1000; // 12 saat

const otpDenemeleri = new Map(); // denemeToken -> { kod, expiresAt, kullaniciAdi }
const dogrulanmisOturumlar = new Map(); // oturumToken -> { expiresAt, kullaniciAdi }

function rastgeleToken() {
  return crypto.randomBytes(24).toString("hex");
}

function altiHaneliKod() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cookieOku(req, isim) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parca = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(isim + "="));
  return parca ? decodeURIComponent(parca.split("=").slice(1).join("=")) : null;
}

function cookieYaz(res, isim, deger, maxAgeMs) {
  res.append(
    "Set-Cookie",
    `${isim}=${encodeURIComponent(deger)}; HttpOnly; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; SameSite=Lax`
  );
}

// Basic Auth basliginda gelen kullanici adi/sifre, tanimli kullanicilardan
// birine uyuyor mu diye bakar. Uyarsa o kullaniciyi (ve dolayisiyla telefon
// numarasini) dondurur, uymazsa null doner.
function basicAuthKullaniciBul(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) return null;
  const decoded = Buffer.from(auth.split(" ")[1], "base64").toString();
  const [girilenKullanici, girilenSifre] = decoded.split(":");
  return (
    PANEL_KULLANICILARI.find(
      (k) =>
        k.sifre &&
        k.kullaniciAdi === (girilenKullanici || "").toLowerCase() &&
        k.sifre === girilenSifre
    ) || null
  );
}

function hicSifreTanimliDegilMi() {
  return PANEL_KULLANICILARI.every((k) => !k.sifre);
}

// Sadece 1. faktoru (sifre) dogrular - OTP giris sayfasinin kendisi icin kullanilir,
// aksi halde "OTP sayfasina git" ile "panelAuth" birbirini sonsuz dongude yonlendirir.
// Dogrulanan kullaniciyi req.panelKullanici'ya yazar (sonraki route bunu kullanir).
function sadeceSifreGerekli(req, res, next) {
  if (hicSifreTanimliDegilMi()) {
    return res.status(500).send("PANEL_ENBEL_SIFRE / PANEL_BAHADIR_SIFRE ortam degiskenleri ayarlanmamis.");
  }
  const kullanici = basicAuthKullaniciBul(req);
  if (!kullanici) {
    res.set("WWW-Authenticate", 'Basic realm="Temsilci Paneli"');
    return res.status(401).send("Giris gerekli.");
  }
  req.panelKullanici = kullanici;
  next();
}

// Tam koruma: hem sifre hem OTP ile dogrulanmis bir oturum gerektirir.
function panelAuth(req, res, next) {
  if (hicSifreTanimliDegilMi()) {
    return res.status(500).send("PANEL_ENBEL_SIFRE / PANEL_BAHADIR_SIFRE ortam degiskenleri ayarlanmamis.");
  }
  const kullanici = basicAuthKullaniciBul(req);
  if (!kullanici) {
    res.set("WWW-Authenticate", 'Basic realm="Temsilci Paneli"');
    return res.status(401).send("Giris gerekli.");
  }
  req.panelKullanici = kullanici;

  // 2FA askiya alinmisken (bkz. PANEL_2FA_AKTIF yukarida) sifre yeterli -
  // /panel/dogrula'ya hic ugramadan devam ediyoruz, boylece hicbir WhatsApp
  // kodu tetiklenmiyor.
  if (!PANEL_2FA_AKTIF) {
    return next();
  }

  const oturumToken = cookieOku(req, "panel_oturum");
  const oturum = oturumToken && dogrulanmisOturumlar.get(oturumToken);
  // Oturumun, GIRIS YAPMAYA CALISAN kullaniciya ait oldugundan da emin oluyoruz
  // (orn. Bahadır'in cerezi Enbel icin gecerli sayilmasin).
  if (oturum && oturum.expiresAt > Date.now() && oturum.kullaniciAdi === kullanici.kullaniciAdi) {
    return next();
  }

  // Sifre dogru ama bu tarayici henuz OTP ile dogrulanmamis - dogrulama sayfasina yonlendir.
  return res.redirect(302, "/panel/dogrula");
}

// OTP dogrulama sayfasi: kod uretir, WhatsApp'tan (girisi yapanin KENDI
// numarasina) gonderir, girisi bekler.
// Ayni kullanici icin kisa surede (OTP_COOLDOWN_MS) art arda YENI kod
// uretilip gonderilmesini engeller - bazi tarayicilarin/telefonlarin acik
// kalan bir sekmeyi arka planda periyodik olarak tazelemesi (orn.
// iPhone'larda yaygin) yuzunden her tazelemede yeni kod gonderilmesini
// onlemek icin. ONEMLI: cooldown suresince YENI mesaj atilmasa da, o an
// gecerli olan kod her zaman tarayicinin cerezine baglanir - aksi halde
// kullanici dogru kodu girse bile "kod hatali" hatasi alirdi (bu, daha
// once yasanan gercek bir hataydi).
const OTP_COOLDOWN_MS = OTP_GECERLILIK_MS;
const sonDenemeler = new Map(); // kullaniciAdi -> { token, deneme, gonderimZamani }

app.get("/panel/dogrula", sadeceSifreGerekli, async (req, res) => {
  const kullanici = req.panelKullanici;
  // TANI AMACLI LOG: Bahadır'a sebepsiz yere tekrar tekrar 2FA kodu gitmesi
  // sikayeti uzerine eklendi - hangi IP/tarayicinin bu sayfayi COOLDOWN'dan
  // BAGIMSIZ olarak (yani WhatsApp mesaji atilmasa bile) ne siklikta ziyaret
  // ettigini gormek icin. Asagidaki asil OTP gonderim logu sadece GERCEKTEN
  // yeni bir kod uretildiginde yaziliyor - bu log ise HER istekte yaziliyor,
  // boylece "arka planda sessizce tekrar tekrar istek atan bir sekme/bot var
  // mi" sorusuna Railway loglarindan cevap bulabiliriz. Sorun teshis edildikten
  // sonra bu log satiri kaldirilabilir.
  console.log(
    `/panel/dogrula istek: kullanici=${kullanici.kullaniciAdi} ip=${req.ip} ua="${req.get("User-Agent") || ""}"`
  );

  // KILL-SWITCH: 2FA askidayken (PANEL_2FA_AKTIF != "true"), bu sayfaya NASIL
  // ulasilirsa ulasilsin (panelAuth yönlendirmesi, dogrudan link, eski bir
  // bookmark, otomatik bir link-onizleme ziyareti vb.) KOD URETIP
  // GONDERMEDEN dogrudan panele yönlendiriyoruz. Yukaridaki tani logu yine de
  // yazilir - boylece bu sayfaya kimin/ne siklikta ulastigini gormeye devam
  // ederiz, ama artik hicbir WhatsApp mesaji tetiklenmez.
  if (!PANEL_2FA_AKTIF) {
    return res.redirect(302, "/panel");
  }

  let denemeToken = cookieOku(req, "panel_deneme");
  let deneme = denemeToken && otpDenemeleri.get(denemeToken);
  const buTarayicidaGecerliDenemeVar =
    deneme && deneme.expiresAt >= Date.now() && deneme.kullaniciAdi === kullanici.kullaniciAdi;

  if (!buTarayicidaGecerliDenemeVar) {
    const sonKayit = sonDenemeler.get(kullanici.kullaniciAdi);
    const sonKayitHalaGecerliMi = sonKayit && sonKayit.deneme.expiresAt >= Date.now();
    const kisaSureOnceGonderildiMi = sonKayit && Date.now() - sonKayit.gonderimZamani < OTP_COOLDOWN_MS;

    if (sonKayitHalaGecerliMi && kisaSureOnceGonderildiMi) {
      // Yakin zamanda (baska bir istekte) bu kullanici icin zaten gecerli bir
      // kod uretilmis - yeni WhatsApp mesaji ATMIYORUZ ama bu tarayiciyi da
      // o gecerli koda BAGLIYORUZ, aksi halde kullanici elindeki dogru kodu
      // girse bile hata alir.
      denemeToken = sonKayit.token;
      deneme = sonKayit.deneme;
      cookieYaz(res, "panel_deneme", denemeToken, deneme.expiresAt - Date.now());
      console.log(`2FA mevcut koda baglandi (yeni mesaj atilmadi): kullanici=${kullanici.kullaniciAdi}`);
    } else {
      const kod = altiHaneliKod();
      denemeToken = rastgeleToken();
      deneme = { kod, expiresAt: Date.now() + OTP_GECERLILIK_MS, kullaniciAdi: kullanici.kullaniciAdi };
      otpDenemeleri.set(denemeToken, deneme);
      cookieYaz(res, "panel_deneme", denemeToken, OTP_GECERLILIK_MS);
      sonDenemeler.set(kullanici.kullaniciAdi, { token: denemeToken, deneme, gonderimZamani: Date.now() });

      console.log(
        `2FA kodu uretildi: kullanici=${kullanici.kullaniciAdi} (${kullanici.ad}) telefon=${kullanici.telefon}`
      );

      const kodMesaji = `🔐 WE Sigorta paneline giriş doğrulama kodunuz: ${kod}\n\nBu kod 5 dakika geçerlidir.`;
      // Onceki deneyimlerimizden biliyoruz ki danismanlar bot numarasina kendileri
      // yazmadigi surece 24 saatlik pencere kapali olabiliyor ve duz metin
      // (sendText) sessizce ulasmayabiliyor. Bu yuzden once ozel 2FA sablonunu
      // (varsa - AGENT_2FA_TEMPLATE_NAME), o da yoksa/basarisiz olursa genel
      // detay sablonunu, o da olmazsa duz metni deniyoruz.
      let gonderimBasarili = false;

      const otpSablonAdi = process.env.AGENT_2FA_TEMPLATE_NAME;
      if (otpSablonAdi) {
        try {
          await sendAuthTemplate(kullanici.telefon, otpSablonAdi, "tr", kod, kodMesaji);
          gonderimBasarili = true;
        } catch (err) {
          console.error("2FA (auth) sablon mesaji gonderilemedi:", err?.response?.data || err.message);
        }
      }

      if (!gonderimBasarili) {
        const detayliSablonAdi = process.env.AGENT_DETAY_TEMPLATE_NAME;
        if (detayliSablonAdi) {
          try {
            await sendTemplate(kullanici.telefon, detayliSablonAdi, "tr", { detay: sablonParametresiIcinTemizle(kodMesaji) }, kodMesaji);
            gonderimBasarili = true;
          } catch (err) {
            console.error("2FA sablon mesaji gonderilemedi:", err?.response?.data || err.message);
          }
        }
      }

      if (!gonderimBasarili) {
        try {
          await sendText(kullanici.telefon, kodMesaji);
        } catch (err) {
          console.error("2FA kodu gonderilemedi:", err?.response?.data || err.message);
        }
      }
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="tr"><head><meta charset="utf-8"><title>WE Sigorta CRM - Doğrulama</title>
    <style>
      body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 360px; margin: 80px auto; text-align: center; color: #333; }
      input { font-size: 22px; padding: 10px; width: 160px; text-align: center; letter-spacing: 6px; border: 1px solid #ccc; border-radius: 6px; }
      button { font-size: 15px; padding: 10px 24px; margin-top: 14px; background: #16324F; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
      .hata { color: #c00; margin-top: 10px; font-size: 13px; }
    </style>
    </head><body>
      <h2>🔐 Giriş Doğrulama</h2>
      <p>Merhaba ${escapeHtmlSunucu(kullanici.ad)}! WhatsApp'ınıza gönderilen 6 haneli kodu girin.</p>
      <form method="POST" action="/panel/dogrula">
        <input type="text" name="kod" maxlength="6" inputmode="numeric" autofocus required />
        <br/><button type="submit">Doğrula</button>
      </form>
      ${req.query.hata ? '<p class="hata">Kod hatalı veya süresi dolmuş, tekrar deneyin.</p>' : ""}
    </body></html>
  `);
});

app.post("/panel/dogrula", sadeceSifreGerekli, (req, res) => {
  const kullanici = req.panelKullanici;
  const denemeToken = cookieOku(req, "panel_deneme");
  const deneme = denemeToken && otpDenemeleri.get(denemeToken);
  const girilenKod = (req.body.kod || "").trim();

  if (
    !deneme ||
    deneme.expiresAt < Date.now() ||
    deneme.kullaniciAdi !== kullanici.kullaniciAdi ||
    girilenKod !== deneme.kod
  ) {
    return res.redirect(302, "/panel/dogrula?hata=1");
  }

  otpDenemeleri.delete(denemeToken);
  const oturumToken = rastgeleToken();
  dogrulanmisOturumlar.set(oturumToken, {
    expiresAt: Date.now() + OTURUM_GECERLILIK_MS,
    kullaniciAdi: kullanici.kullaniciAdi
  });
  cookieYaz(res, "panel_oturum", oturumToken, OTURUM_GECERLILIK_MS);
  res.redirect(302, "/panel");
});

// --- Temsilci paneli sayfasi ve API'leri ---
// --- Bir kerelik kurulum: 2FA guvenlik kodu icin Authentication kategorisinde
// sablon olusturur (Graph API uzerinden - WhatsApp Manager arayuzu bazen
// aciklanamayan genel hatalar verdigi icin). Kullanildiktan sonra silinebilir.
app.get("/api/panel/guvenlik-kodu-sablonu-olustur", panelAuth, async (req, res) => {
  try {
    const sonuc = await sablonOlustur({
      name: "guvenlik_kodu",
      language: "tr",
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 5 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] }
      ]
    });
    res.send(
      `<pre style="font-family:monospace; padding:20px;">✅ Şablon isteği gönderildi.\n\n${JSON.stringify(sonuc.data, null, 2)}</pre>`
    );
  } catch (err) {
    console.error("Sablon olusturma hatasi:", err?.response?.data || err.message);
    res.status(500).send(
      `<pre style="font-family:monospace; padding:20px; color:#c00;">❌ Hata:\n\n${JSON.stringify(err?.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// --- Bir kerelik kurulum: satis basariyla Garanti Emeklilik'e iletildiginde
// MUSTERININ kendi cep telefonuna gonderilen bilgilendirme mesaji icin
// UTILITY kategorisinde bir sablon olusturur. Musteri bu WhatsApp numarasina
// hic yazmadigi (24 saatlik pencere kapali oldugu) icin bu mesaj SADECE
// onceden onaylanmis bir sablonla gonderilebiliyor (bkz. advisorEngine.js
// musteriyeSatisBildirimiGonder). Meta onayi (genelde dakikalar-birkac saat
// surer) WhatsApp Manager > Message Templates ekranindan takip edilebilir;
// onaylanmadan bu bildirim gonderilemez. Onaylandiktan sonra sablon adini
// Railway'de MUSTERI_BASVURU_TEMPLATE_NAME olarak tanimlamaniz yeterli.
// Kullanildiktan sonra bu route silinebilir.
app.get("/api/panel/musteri-bilgilendirme-sablonu-olustur", panelAuth, async (req, res) => {
  try {
    const sonuc = await sablonOlustur({
      // NOT: Ad "_v5" - "_v2", "_v3" VE "_v4" ucu de INVALID_FORMAT sebebiyle
      // reddedildi (Meta'nin sablonDetayGetir sorgusundan ogrendik - bkz.
      // /api/panel/sablon-detay). Sirasiyla denenenler: v3'te degisken
      // araligini genisletmek, v4'te ustelik ust seviyeye
      // "parameter_format": "NAMED" eklemek - hicbiri sorunu cozmedi. Isimli
      // ({{musteri_adi}} gibi) degisken formati bu hesapta/API surumunde
      // (v20.0) guvenilir sonuc vermiyor. Bu yuzden POZISYONEL ({{1}}, {{2}},
      // {{3}}, {{4}}) formata donuldu - Graph API'nin en eski/en yaygin
      // desteklenen, hicbir ozel alan gerektirmeyen sekli. Gonderim tarafi da
      // (advisorEngine.js musteriyeSatisBildirimiGonder) buna gore
      // sendTemplatePozisyonel kullanacak sekilde guncellendi - SIRA onemli:
      // {{1}}=musteri_adi, {{2}}=urun_adi, {{3}}=arama_tarihi,
      // {{4}}=arama_saat_araligi. MUSTERI_BASVURU_TEMPLATE_NAME'i
      // onaylandiktan sonra bu YENI isimle Railway'de tanimlamaniz gerekiyor.
      name: "musteri_basvuru_bilgilendirme_v5",
      language: "tr",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          // NOT: Meta ilk denemede (v1) bu sablonu REJECTED olarak
          // donduruyordu - sebebi, UTILITY kategorisinde gonderilen icerigin
          // PROMOSYON/pazarlama diliyle (orn. "tebrik ederiz", "bizi tercih
          // ettiginiz icin tesekkur ederiz") karismis olmasiydi. Meta, UTILITY
          // sablonlarinin SADECE islemsel/durum bildirimi olmasini, hicbir
          // ovucu/tesekkur/pazarlama cumlesi icermemesini sart kosuyor -
          // aksi halde ya reddediliyor ya da MARKETING kategorisine
          // yonlendiriliyor (ki bu da musteri onayi/opt-in gerektirir ve
          // cok daha zor onaylanir). Bu notr dil burada da korunuyor,
          // degisiklik SADECE degisken formati (isimli -> pozisyonel).
          text:
            "Merhaba {{1}}, size önemli bir bilgilendirme yapıyoruz. " +
            "{{2}} başvurunuz alınmıştır. Garanti Emeklilik Genel Müdürlüğü sizi arayacaktır. " +
            "Planlanan arama tarihi {{3}}, planlanan saat aralığı ise {{4}} olarak belirlenmiştir. " +
            "Arama 444 03 36 ya da 0212 334 ile başlayan bir numaradan gelecektir.",
          example: {
            body_text: [["Ahmet Yılmaz", "Premium Prim İadeli Hayat Sigortası", "21.07.2026", "14:00-16:00"]]
          }
        }
      ]
    });
    res.send(
      `<pre style="font-family:monospace; padding:20px;">✅ Şablon isteği gönderildi.\n\n${JSON.stringify(sonuc.data, null, 2)}</pre>`
    );
  } catch (err) {
    console.error("Musteri bilgilendirme sablonu olusturma hatasi:", err?.response?.data || err.message);
    res.status(500).send(
      `<pre style="font-family:monospace; padding:20px; color:#c00;">❌ Hata:\n\n${JSON.stringify(err?.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// --- Bir kerelik guncelleme: onaylanmis musteri_basvuru_bilgilendirme_v5
// sablonunun BODY metnini daha kurumsal bir dile ve birkac (promosyon
// sayilmayacak, sadece bilgilendirici) emojiye guncellemek icin. Sablonu
// SILIP YENIDEN OLUSTURMAK yerine mevcut (onceden onaylanmis) sablonu
// DUZENLIYORUZ (bkz. whatsapp.js sablonDuzenle) - boylece
// MUSTERI_BASVURU_TEMPLATE_NAME degismiyor, Railway'de yeniden ayarlamaya
// gerek kalmiyor. Meta duzenleme sonrasi sablonu tekrar incelemeye
// (PENDING) alabilir - onay durumu WhatsApp Manager > Message Templates'ten
// takip edilebilir. templateId, WhatsApp Manager'daki sablonun ID'sidir
// (sablon-detay endpoint'i de bu ID'yi doner). Kullanildiktan sonra bu route
// silinebilir.
app.get("/api/panel/musteri-bilgilendirme-sablonu-guncelle/:id", panelAuth, async (req, res) => {
  try {
    const sonuc = await sablonDuzenle(req.params.id, {
      components: [
        {
          type: "BODY",
          // NOT: UTILITY kategorisinde kalabilmek icin metin hala tamamen
          // islemsel/durum bildirimi niteliginde - "teşekkür ederiz",
          // "tebrik ederiz" gibi hicbir ovucu/pazarlama ifadesi
          // KULLANILMADI (bkz. yukaridaki olusturma route'undaki notlar,
          // bu kural v1'de REJECTED almamiza sebep olmustu). Sadece dili
          // daha kurumsal ("Sayın", "tarafımıza ulaşmıştır" gibi) hale
          // getirdik, gelecek aramayi yanitlamanin onemini vurguladik ve
          // sadece bilgilendirici (📋 belge/basvuru, 📞 telefon) iki emoji
          // ekledik - degisken formati (pozisyonel {{1}}-{{4}}) ve sirasi
          // AYNEN korundu.
          text:
            "Sayın {{1}}, 📋 {{2}} başvurunuz tarafımıza ulaşmıştır. " +
            "İşlemlerinizin tamamlanabilmesi için Garanti Emeklilik Genel Müdürlüğü tarafından aranacaksınız. 📞 " +
            "Planlanan arama tarihi {{3}}, saat aralığı ise {{4}} olarak belirlenmiştir. " +
            "Sürecinizin sorunsuz ilerleyebilmesi için bu aramayı yanıtlamanız önem arz etmektedir. " +
            "Arama 444 03 36 ya da 0212 334 ile başlayan bir numaradan gerçekleştirilecektir.",
          example: {
            body_text: [["Ahmet Yılmaz", "Premium Prim İadeli Hayat Sigortası", "21.07.2026", "14:00-16:00"]]
          }
        }
      ]
    });
    res.send(
      `<pre style="font-family:monospace; padding:20px;">✅ Şablon güncelleme isteği gönderildi.\n\n${JSON.stringify(sonuc.data, null, 2)}</pre>`
    );
  } catch (err) {
    console.error("Musteri bilgilendirme sablonu guncelleme hatasi:", err?.response?.data || err.message);
    res.status(500).send(
      `<pre style="font-family:monospace; padding:20px; color:#c00;">❌ Hata:\n\n${JSON.stringify(err?.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// --- Tani amacli: bir sablonun (id ile) TAM reddedilme sebebini gosterir -
// sablon olusturma cevabi sadece "REJECTED" durumunu dondurdugu icin (asil
// sebebi degil), reddedilen bir sablonun ID'sini buraya verip (orn.
// /api/panel/sablon-detay/1355838796633579) rejected_reason ve
// correct_category alanlarini gorebiliyoruz - boylece tahmin yurutmeden
// dogru duzeltmeyi yapabiliyoruz. Kullanildiktan sonra bu route silinebilir.
app.get("/api/panel/sablon-detay/:id", panelAuth, async (req, res) => {
  try {
    const sonuc = await sablonDetayGetir(req.params.id);
    res.send(
      `<pre style="font-family:monospace; padding:20px;">${JSON.stringify(sonuc.data, null, 2)}</pre>`
    );
  } catch (err) {
    console.error("Sablon detayi alinamadi:", err?.response?.data || err.message);
    res.status(500).send(
      `<pre style="font-family:monospace; padding:20px; color:#c00;">❌ Hata:\n\n${JSON.stringify(err?.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// --- Bir kerelik kurulum: WhatsApp Yöneticisi'nde onaylanan YENİ bir görünen
// ad ("WE Sigorta Customer Care" - 25.07.2026), numara "kaydedilene" (Cloud
// API "register" ucu çağrılana) kadar aktif olmuyor - WhatsApp Yöneticisi
// arayüzünde bu işlem için tıklanacak bir buton yok, sadece Graph API
// üzerinden yapılabiliyor. Bu route, o çağrıyı bizim sunucumuz üzerinden
// (zaten Railway'de tanımlı WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID ile)
// yapıyor - böylece hiç kimse token'ı elle kopyalamak/terminal açmak zorunda
// kalmıyor, sadece panel şifresiyle giriş yapıp numaranın 2 Adımlı Doğrulama
// PIN'ini yazması yeterli. Kullanildiktan sonra bu route silinebilir.
app.get("/api/panel/whatsapp-numara-kaydet", panelAuth, async (req, res) => {
  const pin = (req.query.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) {
    return res.status(400).send(
      '<div style="font-family:sans-serif; padding:20px;">' +
        "Numaranın 2 Adımlı Doğrulama PIN'ini (6 haneli) ?pin= ile birlikte yazmanız gerekiyor.<br><br>" +
        `Örnek: <code>${req.path}?pin=123456</code></div>`
    );
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/register`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messaging_product: "whatsapp", pin })
      }
    );
    const sonuc = await response.json();
    res.send(
      `<pre style="font-family:monospace; padding:20px;">${response.ok ? "✅" : "❌"} ${JSON.stringify(sonuc, null, 2)}</pre>`
    );
  } catch (err) {
    console.error("WhatsApp numara kaydi hatasi:", err.message);
    res.status(500).send(
      `<pre style="font-family:monospace; padding:20px; color:#c00;">❌ Hata:\n\n${err.message}</pre>`
    );
  }
});

app.get("/panel", panelAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "panel.html"));
});

// Deploy sirasinda kisa sureli kullanilan eski yol - yer imleri kirilmasin diye yonlendirir.
app.get("/wesigorta-crm", (req, res) => {
  res.redirect(302, "/panel");
});

app.get("/api/panel/conversations", panelAuth, (req, res) => {
  res.json(messageLog.listConversations());
});

app.get("/api/panel/conversations/:phone", panelAuth, (req, res) => {
  const phone = req.params.phone;
  const session = getSession(phone);
  res.json({
    name: session.name,
    paused: !!session.paused,
    // 28.07.2026 eklendi: kalici numara engelleme ozelligi (bkz.
    // engelliNumaralarStore.js) - session.paused'dan FARKLI, kalici bir
    // "bu numaraya bir daha asla cevap verme" bayragi.
    engelli: engelliNumaralarStore.numaraEngelliMi(phone),
    messages: messageLog.getMessages(phone)
  });
});

app.post("/api/panel/send", panelAuth, async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: "to ve message gerekli" });
  try {
    await sendText(to, message);
    res.json({ ok: true });
  } catch (err) {
    console.error("Panel mesaj gonderme hatasi:", err?.response?.data || err.message);
    res.status(500).json({ error: "Mesaj gonderilemedi" });
  }
});

// Panelden musteriye/danismana PDF (poliçe, teklif dosyasi vb.) gonderir.
// Form-data olarak gelir: "to" (telefon), "caption" (opsiyonel aciklama), "dosya" (PDF).
app.post("/api/panel/send-document", panelAuth, upload.single("dosya"), async (req, res) => {
  const { to, caption } = req.body;
  const dosya = req.file;
  if (!to || !dosya) return res.status(400).json({ error: "to ve dosya gerekli" });
  try {
    await sendDocument(to, dosya.buffer, dosya.mimetype, dosya.originalname, caption || undefined);
    res.json({ ok: true });
  } catch (err) {
    console.error("Panel dosya gonderme hatasi:", err?.response?.data || err.message);
    res.status(500).json({ error: "Dosya gonderilemedi" });
  }
});

// --- Urun bazinda form/dokuman kutuphanesi ---
// Danismanlar WhatsApp'tan "Doküman Merkezi" ile bu dokumanlari istedigi an alabilir.
app.get("/api/panel/dokumanlar", panelAuth, (req, res) => {
  const urunler = Object.keys(flows).map((key) => {
    const dokuman = dokumanStore.dokumanGetir(key);
    return {
      urunKey: key,
      urunAdi: flows[key].label,
      yuklu: !!dokuman,
      dosyaAdi: dokuman ? dokuman.dosyaAdi : null,
      yuklenmeZamani: dokuman ? dokuman.yuklenmeZamani : null
    };
  });
  res.json({ urunler });
});

app.post("/api/panel/dokumanlar/:urunKey", panelAuth, upload.single("dosya"), (req, res) => {
  const { urunKey } = req.params;
  const dosya = req.file;
  if (!flows[urunKey]) return res.status(400).json({ error: "Gecersiz urun" });
  if (!dosya) return res.status(400).json({ error: "dosya gerekli" });
  dokumanStore.dokumanKaydet(urunKey, dosya.originalname, dosya.mimetype, dosya.buffer);
  res.json({ ok: true });
});

app.delete("/api/panel/dokumanlar/:urunKey", panelAuth, (req, res) => {
  dokumanStore.dokumanSil(req.params.urunKey);
  res.json({ ok: true });
});

app.post("/api/panel/toggle-pause", panelAuth, (req, res) => {
  const { to, paused } = req.body;
  if (!to) return res.status(400).json({ error: "to gerekli" });
  const session = getSession(to);
  session.paused = !!paused;
  res.json({ ok: true, paused: session.paused });
});

// 28.07.2026 eklendi: kullanicinin talebi uzerine - herhangi bir numarayi
// KALICI olarak engelleyip/kaldirabilme (toggle-pause'un GECICI mekanizmasindan
// bilincli olarak ayri, bkz. engelliNumaralarStore.js). Webhook seviyesindeki
// kontrol (bkz. app.post("/webhook", ...)) bu store'u okur.
app.post("/api/panel/toggle-block", panelAuth, (req, res) => {
  const { to, engelli, not: engelNotu } = req.body;
  if (!to) return res.status(400).json({ error: "to gerekli" });
  if (engelli) {
    engelliNumaralarStore.numarayiEngelle(to, engelNotu || null, req.panelKullanici ? req.panelKullanici.ad : null);
  } else {
    engelliNumaralarStore.engeliKaldir(to);
  }
  res.json({ ok: true, engelli: engelliNumaralarStore.numaraEngelliMi(to) });
});

// Panelde "Engelli Numaralar" listesi gosterebilmek icin.
app.get("/api/panel/engelli-numaralar", panelAuth, (req, res) => {
  res.json({ numaralar: engelliNumaralarStore.tumEngelliNumaralariGetir() });
});

// --- Talep takip sistemi (leads) ---
app.get("/api/panel/leads", panelAuth, (req, res) => {
  res.json({ leads: leadStore.tumLeadleriGetir(), durumlar: leadStore.DURUMLAR });
});

app.post("/api/panel/leads/:id/durum", panelAuth, (req, res) => {
  const { durum } = req.body;
  if (!durum) return res.status(400).json({ error: "durum gerekli" });
  const lead = leadStore.durumGuncelle(req.params.id, durum);
  if (!lead) return res.status(404).json({ error: "Talep bulunamadi ya da gecersiz durum" });
  res.json({ ok: true, lead });
});

app.post("/api/panel/leads/:id/not", panelAuth, async (req, res) => {
  const { metin } = req.body;
  if (!metin) return res.status(400).json({ error: "metin gerekli" });
  const lead = leadStore.notEkle(req.params.id, metin);
  if (!lead) return res.status(404).json({ error: "Talep bulunamadi" });
  res.json({ ok: true, lead });
  // 27.07.2026 eklendi: panelden (Bahadır/Enbel) not eklendiginde de ilgili
  // herkese bilgilendirme gitsin - yanit ZATEN gonderildigi icin (yukarida)
  // bu bildirim beklenmeden (await edilmeden), arka planda yapiliyor.
  notEklendiBildirimiGonder(lead, metin, req.panelKullanici.ad, req.panelKullanici.telefon).catch((err) =>
    console.error("Panelden not bildirimi gonderilemedi:", err)
  );
});

// "YYYY-MM-DDTHH:mm" (HTML <input type="datetime-local"> ciktisi) formatindaki
// bir metni, TURKIYE YEREL SAATI olarak yorumlayip dogru UTC ms zaman damgasina
// cevirir. "new Date(zamanString)" KULLANMIYORUZ - saat dilimi bilgisi
// icermeyen bir "YYYY-MM-DDTHH:mm" metnini Node, CALISAN SUNUCUNUN yerel saat
// dilimine gore yorumluyor (Railway'de bu genelde UTC, panelin kullanildigi
// Turkiye'den 3 saat farkli) - bu yuzden panelden "14:00" secilse bile
// hatirlatma gercekte 17:00'da (Turkiye saatiyle) tetikleniyordu. Asagidaki
// yaklasim (advisorEngine.js'teki tarihSaatDogrula ile AYNI mantik: Date.UTC +
// sabit 3 saatlik Turkiye farki) sunucunun hangi saat diliminde calistigindan
// tamamen bagimsizdir - bkz. 20.07.2026 tarihli hatirlatma gecikmesi vakasi.
const PANEL_TARIH_SAAT_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const TURKIYE_UTC_FARKI_MS = 3 * 60 * 60 * 1000;

function turkiyeYerelSaatindenUtcMsHesapla(zamanString) {
  const eslesme = PANEL_TARIH_SAAT_REGEX.exec((zamanString || "").trim());
  if (!eslesme) return NaN;
  const [, yil, ay, gun, saat, dakika] = eslesme.map(Number);
  const sankiUtc = Date.UTC(yil, ay - 1, gun, saat, dakika);
  return sankiUtc - TURKIYE_UTC_FARKI_MS;
}

// Panelden bir hatirlatma kurar. zaman: <input type="datetime-local"> ciktisi
// (orn. "2026-07-16T09:00") - panel Turkiye'den kullanildigi icin bu deger
// HER ZAMAN Turkiye yerel saati olarak yorumlanir (bkz. yukaridaki yorum).
app.post("/api/panel/leads/:id/hatirlatma", panelAuth, (req, res) => {
  const { zaman, not } = req.body;
  if (!zaman) return res.status(400).json({ error: "zaman gerekli" });
  const zamanMs = turkiyeYerelSaatindenUtcMsHesapla(zaman);
  if (Number.isNaN(zamanMs)) return res.status(400).json({ error: "Gecersiz tarih/saat" });
  const lead = leadStore.hatirlatmaKur(req.params.id, zamanMs, not);
  if (!lead) return res.status(404).json({ error: "Talep bulunamadi" });
  res.json({ ok: true, lead });
});

// --- Istatistikler ---
// Tum talep verisinden ozet metrikler cikartir: urun bazinda, danisman
// bazinda, durum bazinda dagilim, donusum orani, son 7/30 gunluk talep sayisi.
app.get("/api/panel/stats", panelAuth, (req, res) => {
  const leads = leadStore.tumLeadleriGetir();

  const urunBazinda = {};
  const danismanBazinda = {};
  const durumBazinda = {};
  leadStore.DURUMLAR.forEach((d) => (durumBazinda[d] = 0));

  const simdi = Date.now();
  const simdiTarih = new Date(simdi);
  const GUN_MS = 24 * 60 * 60 * 1000;
  const yilBaslangic = new Date(simdiTarih.getFullYear(), 0, 1).getTime();
  const ceyrekIndex = Math.floor(simdiTarih.getMonth() / 3);
  const ceyrekBaslangic = new Date(simdiTarih.getFullYear(), ceyrekIndex * 3, 1).getTime();

  let son7Gun = 0;
  let son30Gun = 0;
  let buCeyrek = 0;
  let yilBasindanBugune = 0;

  leads.forEach((lead) => {
    urunBazinda[lead.urun] = (urunBazinda[lead.urun] || 0) + 1;
    const danisman = lead.danismanAdi || "Atanmamış";
    danismanBazinda[danisman] = (danismanBazinda[danisman] || 0) + 1;
    durumBazinda[lead.durum] = (durumBazinda[lead.durum] || 0) + 1;

    const yas = simdi - lead.olusturulmaZamani;
    if (yas <= 7 * GUN_MS) son7Gun += 1;
    if (yas <= 30 * GUN_MS) son30Gun += 1;
    if (lead.olusturulmaZamani >= ceyrekBaslangic) buCeyrek += 1;
    if (lead.olusturulmaZamani >= yilBaslangic) yilBasindanBugune += 1;
  });

  const kapananSayisi = (durumBazinda["Olumlu Kapandı"] || 0) + (durumBazinda["Olumsuz Kapandı"] || 0);
  const donusumOrani =
    kapananSayisi > 0 ? Math.round(((durumBazinda["Olumlu Kapandı"] || 0) / kapananSayisi) * 100) : null;

  res.json({
    toplamTalep: leads.length,
    son7Gun,
    son30Gun,
    buCeyrek,
    yilBasindanBugune,
    ceyrekNo: ceyrekIndex + 1,
    urunBazinda,
    danismanBazinda,
    durumBazinda,
    donusumOrani
  });
});

// Panele giren kisinin kim oldugunu (adi, kullanici adi) dondurur - panel.html
// bunu kullanarak SADECE Enbel'e ozel gorunumleri (bkz. asagidaki ekip-ozeti)
// gosterip gostermeyecegine karar verir. Sifre/telefon gibi hassas alanlar
// asla donulmez.
app.get("/api/panel/ben", panelAuth, (req, res) => {
  res.json({ ad: req.panelKullanici.ad, kullaniciAdi: req.panelKullanici.kullaniciAdi });
});

// --- Genel ekip performans ozeti ---
// 26.07.2026 eklendi: Enbel'in talebi uzerine, TUM ekibin (danisman bazinda)
// performansini tek bir yerde goren bir ozet. Bahadır zaten WhatsApp'tan
// "Performansım" menusuyle SADECE KENDI istatistiklerini gorebiliyordu -
// buradaki genel ekip gorunumu ise bilinçli olarak SADECE Enbel'e acik
// (panelKullanici.kullaniciAdi === "enbeleksi"), cunku bu ekip-genelinde
// karsilastirmali bir yonetim gorunumu, danismanlarin birbirini gormesi
// icin tasarlanmadi.
app.get("/api/panel/ekip-ozeti", panelAuth, (req, res) => {
  if (req.panelKullanici.kullaniciAdi !== "enbeleksi") {
    return res.status(403).json({ error: "Bu görünüme erişim yetkiniz yok." });
  }
  res.json({ ekip: leadStore.ekipOzeti() });
});

// 1) Meta webhook DOGRULAMA (GET) - Meta App panelinde webhook'u kaydederken cagirilir
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook dogrulandi.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2) Gelen mesajlari isleme (POST) - musteriden mesaj geldiginde Meta buraya POST atar
// Dosya yukleme rotalarinda (multer) olusan hatalari (orn. desteklenmeyen
// dosya turu, boyut siniri asimi) duzgun bir JSON mesajina cevirir. Express'te
// hata yakalama middleware'i her zaman 4 parametreli olmali ve rotalardan
// SONRA tanimlanmalidir.
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/panel/") && err) {
    console.error("Dosya yukleme hatasi:", err.message);
    return res.status(400).json({ error: err.message || "Dosya yuklenemedi." });
  }
  next(err);
});

app.post("/webhook", async (req, res) => {
  // Meta'ya hemen 200 donmek gerekiyor, aksi halde tekrar tekrar gonderir
  res.sendStatus(200);
  console.log("Webhook istegi alindi.");

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // durum bildirimi (okundu/iletildi) vb. olabilir, yoksay

    console.log(`Webhook mesaji alindi: from=${message.from} type=${message.type} id=${message.id}`);

    // Meta, sunucumuz zamaninda 200 donemedigi durumlarda (orn. tam o anda
    // Railway restart oluyorsa) AYNI mesaji saatler hatta bir gun boyunca,
    // aralikli olarak tekrar teslim etmeye calisir. mesajDahaOnceIslendiMi()
    // bunu bellek-ici bir listeyle engelliyor ama bu liste her restart'ta
    // sifirlaniyor - restart tam o araliga denk gelirse tekrar eden mesaj
    // "yeni" sanilip ikinci (hatta ucuncu, dorduncu...) kez islenebiliyor.
    // Bunun onune gecmek icin, mesajin ORIJINAL gonderilme zamanini (Meta
    // her mesajda "timestamp" olarak yolluyor, saniye cinsinden Unix zamani)
    // kontrol edip belli bir sureden daha eskiyse (gecikmis bir tekrar
    // deneme oldugu neredeyse kesin) hic islemeden atliyoruz.
    const MESAJ_GECERLILIK_SURESI_MS = 5 * 60 * 1000; // 5 dakika
    if (message.timestamp) {
      const mesajZamaniMs = Number(message.timestamp) * 1000;
      const yasMs = Date.now() - mesajZamaniMs;
      if (!Number.isNaN(mesajZamaniMs) && yasMs > MESAJ_GECERLILIK_SURESI_MS) {
        console.log(
          `Eski/gecikmis webhook mesaji atlandi (Meta'nin tekrar deneme mesaji olabilir): id=${message.id}, yas=${Math.round(yasMs / 60000)} dk`
        );
        return;
      }
    }

    if (mesajDahaOnceIslendiMi(message.id)) {
      console.log("Tekrarlanan webhook mesaji atlandi:", message.id);
      return;
    }

    const from = message.from; // musterinin telefon numarasi

    // 28.07.2026 eklendi: kullanicinin talebi uzerine - kalici olarak
    // engellenmis bir numaradan gelen mesaj burada, HER SEYDEN once (danisman
    // ya da musteri akisina hic girmeden, session state'i bile guncellenmeden)
    // sessizce yoksayilir. Bu, session.paused (panelden tek tikla geri acilan
    // GECICI devir alma) ile KARISTIRILMAMALI - burasi bilincli ve kalici bir
    // "bu numaraya bir daha asla cevap verme" karari icin (bkz.
    // engelliNumaralarStore.js).
    if (engelliNumaralarStore.numaraEngelliMi(from)) {
      console.log(`Engelli numaradan gelen mesaj yoksayildi: ${from}`);
      return;
    }

    // Web hesaplayicidan teklif isteyip PDF indiren bir musteri, daha sonra
    // (30 gun icinde) dogrudan WhatsApp'a yazarsa - ekibe (NOTIFY_NUMBER +
    // ilgili danisman) bir bildirim ve musteriye kisa bir tesekkur mesaji
    // gonderiyoruz (24.07.2026 geri bildirimi). Musteri ayni kayittan sonra
    // birden fazla mesaj yazsa bile HER mesajinda tekrar bildirim/tesekkur
    // gonderilmesi ISTENDI (bkz. ilgili karar). Danisman numaralari icin bu
    // kontrolu atliyoruz - web_teklifler tablosunda zaten musteri numaralari
    // tutuluyor, bir danismanin kendi numarasiyla yanlislikla eslesmesi
    // beklenmez ama yine de guvenlik icin haric tutuyoruz. Bu kontrol normal
    // mesaj akisini ASLA durdurmuyor/engellemiyor - hata olsa bile (bkz.
    // try/catch) asagidaki isDanisman/handleIncoming akisi normal sekilde
    // devam eder.
    if (!advisorEngine.isDanisman(from)) {
      try {
        await teklifYardimcilari.musteriYazdiBildir(from);
      } catch (err) {
        console.error("Web teklif yanit kontrolu basarisiz:", err.message);
      }
    }

    let parsed;
    if (message.type === "text") {
      parsed = { type: "text", text: message.text.body };
    } else if (message.type === "interactive") {
      const interactive = message.interactive;
      if (interactive.type === "button_reply") {
        parsed = {
          type: "interactive",
          interactiveId: interactive.button_reply.id,
          interactiveTitle: interactive.button_reply.title
        };
      } else if (interactive.type === "list_reply") {
        parsed = {
          type: "interactive",
          interactiveId: interactive.list_reply.id,
          interactiveTitle: interactive.list_reply.title
        };
      }
    } else if (message.type === "image") {
      parsed = {
        type: "media",
        mediaKind: "image",
        mediaId: message.image.id,
        mimeType: message.image.mime_type,
        dosyaAdi: "fotograf.jpg"
      };
    } else if (message.type === "document") {
      parsed = {
        type: "media",
        mediaKind: "document",
        mediaId: message.document.id,
        mimeType: message.document.mime_type,
        dosyaAdi: message.document.filename || "belge"
      };
    }

    if (parsed) {
      if (advisorEngine.isDanisman(from)) {
        await advisorEngine.handleAdvisorMessage(from, parsed);
      } else {
        // Musteri tarafinda foto/belge kabulu artik baglama gore (orn. kasko
        // arac fotograflari, ruhsat fotografi bekleniyorsa) handleIncoming
        // icinde karar veriliyor - burada blanket red yok.
        await handleIncoming(from, parsed);
      }
    }
  } catch (err) {
    console.error("Webhook isleme hatasi:", err?.response?.data || err.message);
  }
});

app.get("/", (req, res) => {
  res.send("Sigorta WhatsApp Bot calisiyor.");
});

const PORT = process.env.PORT || 3000;

// --- Hatirlatma zamanlayicisi ---
// Her dakika, zamani gelmis (ve henuz gonderilmemis) hatirlatmalari kontrol
// edip ilgili danismana WhatsApp mesaji olarak gonderir.
const HATIRLATMA_KONTROL_SIKLIGI_MS = 60 * 1000;
// Gonderim basarisiz olursa (orn. WhatsApp'in 24 saatlik musteri penceresi
// kapaliysa) her dakika tekrar deneriz - ama sonsuza kadar degil. 30 deneme
// (~30 dakika, zamani gectikten sonra) sonunda pes edip "basarisiz" olarak
// isaretleriz (bkz. leadStore.hatirlatmaDenemeBasarisiz) - boylece hem
// gereksiz sonsuz log/istek dongusune girilmez, hem de hatirlatma SESSIZCE
// kaybolmaz (panelde/lead kaydinda basarisiz oldugu goruntlenebilir kalir).
const HATIRLATMA_MAX_DENEME = 30;

// ONEMLI (20.07.2026 tarihli hatirlatma kaybi vakasi): eskiden bu fonksiyon
// hatirlatmaGonder basarisiz olsa BILE (finally blogu icinde, kosulsuzca)
// hatirlatmayi "gonderildi" olarak isaretliyordu - yani WhatsApp mesaji hic
// ulasmasa da sistem bunu "gonderildi" saniyor, BIR DAHA HIC denemiyor ve
// hatirlatma sessizce kayboluyordu (sunucu logu disinda hicbir yerde iz
// birakmadan). Artik: basarili olursa "gonderildi" isaretlenir; basarisiz
// olursa (HATIRLATMA_MAX_DENEME'ye kadar) ISARETLENMEZ ki bir sonraki
// dakika TEKRAR denensin; esik asilirsa pes edilip acikca "basarisiz"
// olarak isaretlenir (bkz. leadStore.hatirlatmaDenemeBasarisiz).
async function hatirlatmalariKontrolEt() {
  const zamaniGelenler = leadStore.zamaniGelenHatirlatmalar();
  for (const lead of zamaniGelenler) {
    if (!lead.danismanNumarasi) {
      leadStore.hatirlatmaGonderildiIsaretle(lead.id);
      continue;
    }
    const mesaj =
      `⏰ Hatırlatma!\n\n` +
      `Müşteri: ${lead.musteriAdi}\n` +
      `Ürün: ${lead.urun}\n` +
      `Telefon: ${lead.telefon}\n\n` +
      (lead.hatirlatma.not ? `Not: ${lead.hatirlatma.not}` : "Bu müşteriyle ilgilenme zamanı geldi.");
    try {
      await hatirlatmaGonder(lead.danismanNumarasi, mesaj);
      console.log("Hatirlatma gonderildi:", lead.id, lead.danismanNumarasi);
      leadStore.hatirlatmaGonderildiIsaretle(lead.id);
    } catch (err) {
      const guncelDenemeSayisi = (lead.hatirlatma.denemeSayisi || 0) + 1;
      const pesGecMi = guncelDenemeSayisi >= HATIRLATMA_MAX_DENEME;
      console.error(
        `Hatirlatma gonderilemedi (deneme ${guncelDenemeSayisi}/${HATIRLATMA_MAX_DENEME}, lead ${lead.id}, ${lead.danismanNumarasi})${
          pesGecMi ? " - PES EDILDI, bir daha denenmeyecek" : " - bir dakika sonra tekrar denenecek"
        }:`,
        err?.response?.data || err.message
      );
      leadStore.hatirlatmaDenemeBasarisiz(lead.id, pesGecMi);
    }
  }
}

// --- Memnuniyet/kalite kontrolu anketi zamanlayicisi ---
// Her dakika, zamani gelmis (ve henuz gonderilmemis) memnuniyet anketlerini
// kontrol edip ilgili musteriye WhatsApp mesaji olarak gonderir. Hatirlatma
// zamanlayicisindan (yukarida) farkli olarak burada bir "deneme sayaci/pes
// etme" mekanizmasi YOK - bu anket kritik bir is takibi degil (nice-to-have),
// basarisiz olursa sadece loglanir ve BIR SONRAKI dakika TEKRAR denenir. Bu
// bilinçli bir tercih: sonsuza kadar denenmesi (hatirlatmadaki gibi bir esik
// olmadan) hicbir zarara yol acmaz, cunku memnuniyetAnketiGonder() sablon
// ayarliysa (bkz. MEMNUNIYET_ANKETI_TEMPLATE_NAME) zaten neredeyse her zaman
// ilk denemede basarili olur; sablon HENUZ ayarlanmamissa (Meta onayi
// beklenirken) da sessizce "gonderilemedi" loglanip bir sonraki dakika tekrar
// denenmesi, o gunku musteriler icin anketin TAMAMEN kaybolmasindan iyidir.
async function memnuniyetAnketleriniKontrolEt() {
  const zamaniGelenler = leadStore.zamaniGelenMemnuniyetAnketleri();
  for (const lead of zamaniGelenler) {
    if (!lead.telefon) {
      leadStore.memnuniyetAnketiGonderildiIsaretle(lead.id);
      continue;
    }
    try {
      await memnuniyetAnketiGonder(lead.telefon, lead.musteriAdi, lead.urun);
      console.log("Memnuniyet anketi gonderildi:", lead.id, lead.telefon);
      leadStore.memnuniyetAnketiGonderildiIsaretle(lead.id);
    } catch (err) {
      console.error(
        `Memnuniyet anketi gonderilemedi (lead ${lead.id}, ${lead.telefon}) - bir dakika sonra tekrar denenecek:`,
        err?.response?.data || err.message
      );
    }
  }
}

// --- Poliçe yenileme -> otomatik "Bekleyen İş" donusumu ---
// 26.07.2026 eklendi (Enbel'in "yenilemesine 15 gün kala tüm poliçeleri
// bekleyen iş listesine alalım" talebi uzerine). Eskiden yenilemeStore
// SADECE danismanin WhatsApp'tan "Yaklaşan Yenilemeler" menusune kendisi
// girip BAKMASIYLA (pull) isliyordu. Artik her dakika, bitis tarihine
// YENILEME_BEKLEYEN_IS_ESIK_GUN gun (varsayilan 15) ya da daha az kalmis VE
// HENUZ donusturulmemis kayitlar icin leadStore'da OTOMATIK bir "Bekleyen
// İş" (Açık talep) olusturuluyor - boylece panelde ve asagidaki gunluk
// ozet mesajinda (gunlukBekleyenIsOzetiKontrolEt) diger butun bekleyen
// islerle AYNI sekilde goruntulenip takip edilebiliyor, kapanana kadar her
// gun hatirlatiliyor.
const YENILEME_BEKLEYEN_IS_ESIK_GUN = 15;

async function yenilemeleriBekleyenIseAktar() {
  const zamaniGelenler = yenilemeStore.zamaniGelenYenilemeler(YENILEME_BEKLEYEN_IS_ESIK_GUN);
  for (const kayit of zamaniGelenler) {
    const gecikmisMi = kayit.bitisTarihi < Date.now();
    const tarihMetni = new Date(kayit.bitisTarihi).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    leadStore.gecmisLeadEkle({
      telefon: null,
      musteriAdi: kayit.musteriAdi,
      urun: kayit.urun,
      danismanAdi: kayit.danismanAdi,
      danismanNumarasi: kayit.danismanNumarasi,
      ozet:
        `[Otomatik - Yenileme Zamanı Geldi] ${kayit.urun}` +
        (kayit.plaka ? ` • Plaka: ${kayit.plaka}` : "") +
        ` • Bitiş Tarihi: ${tarihMetni}${gecikmisMi ? " (süresi geçmiş görünüyor)" : ""}`,
      durum: "Açık",
      olusturulmaZamani: Date.now(),
      netPrim: null,
      disKaynakId: `YENILEME:${kayit.id}`
    });
    yenilemeStore.yenilemeBekleyenIseAktarildiIsaretle(kayit.id);
    console.log("Yenileme bekleyen ise donusturuldu:", kayit.id, kayit.musteriAdi, kayit.urun);
  }
}

// --- Gunluk "Bekleyen İşler" ozeti (her sabah 09:30, Turkiye saatiyle) ---
// 26.07.2026 eklendi. Her danismana KENDI acik (Açık durumundaki) talep/
// bekleyen isleri, ayrica Bahadır'a TUM elementer (Trafik/Kasko/DASK/Konut/
// İşyeri/Yeşil Kart) acik islerin toplu ozetini, Enbel'e ise TUM acik
// islerin ("tüm üretimler") toplu ozetini gonderir. Bir is Olumlu ya da
// Olumsuz olarak KAPATILMADAN once listeden dusmez - yani ayni is, kapanana
// kadar HER GUN tekrar hatirlatilir (bu yuzden burada bir "gonderildi"
// isaretlemesi YOK, sadece "bugun zaten gonderildi mi" kontrolu var, asagiya
// bakin).
//
// Saat kontrolu Turkiye saatine (UTC+3, 2016'dan beri yaz saati uygulamasi
// yok) gore yapilir - Railway sunuculari genelde UTC calistigi icin
// dogrudan sunucu saatine guvenilemez (bkz. paneldeki turkiyeYerelSaatinden
// UtcMsHesapla'daki ayni sebep).
function simdiTurkiyeSaatineGore() {
  const turkiyeMs = Date.now() + TURKIYE_UTC_FARKI_MS;
  const d = new Date(turkiyeMs);
  return {
    saat: d.getUTCHours(),
    dakika: d.getUTCMinutes(),
    gunAnahtari: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  };
}

// Bir talebin urunu "elementer" bir brans mi (Trafik/Kasko/DASK/Konut/
// İşyeri/Yeşil Kart - yani saglik/hayat/BES/hekim sorumluluk DISINDAKI
// klasik elementer branslar) diye bakar. Hem botun kendi flows.js
// etiketlerinde ("DASK", "Trafik Sigortası" gibi) HEM DE Excel'den aktarilan
// daha dagimik etiketlerde ("TRAFİK ZEYİL", "KASKO ZEYİL" gibi) calismasi
// icin anahtar-kelime tabanli, esnek bir eslestirme kullanir.
const ELEMENTER_ANAHTAR_KELIMELER = ["trafik", "kasko", "dask", "konut", "işyeri", "isyeri", "yeşil kart", "yesil kart"];
function urunElementerMi(urun) {
  if (!urun) return false;
  const normalized = String(urun).toLocaleLowerCase("tr-TR");
  return ELEMENTER_ANAHTAR_KELIMELER.some((k) => normalized.includes(k));
}

// 26.07.2026 eklendi: bir isin en son eklenen notu (varsa) satirin altina
// KUCUK bir 📝 satiri olarak eklenir - boylece "not ekleyebilsin, eklenen
// notu herkes görsün" talebi karsilaniyor: not, panelden (Bahadır/Enbel -
// hicbir kisitlama yok, TUM isler gorunur) ya da WhatsApp'tan ("Bekleyen İş"
// menusu - danisman kendi isine, Bahadır/Enbel ise TUM ekibin islerine not
// ekleyebilir, bkz. advisorEngine.js'deki anaMenuGoster) eklenmis olsun,
// SADECE EN SON eklenen not gosterilir (tum not gecmisini gostermek gunluk
// ozeti cok kalabaliklastirirdi) - tam not gecmisi hala panelde/WhatsApp'taki
// talep detayinda goruluyor.
function acikIsSatiriOlustur(lead) {
  const gunSayisi = Math.max(0, Math.floor((Date.now() - lead.olusturulmaZamani) / (24 * 60 * 60 * 1000)));
  const sonNot = lead.notlar && lead.notlar.length > 0 ? lead.notlar[lead.notlar.length - 1] : null;
  const notEki = sonNot ? `\n   📝 ${sonNot.metin}` : "";
  // 27.07.2026 eklendi: destek talebi gibi bir "baslik" tasiyan kayitlarda,
  // urun'un yaninda 🆘 ile baslik da gosterilir (bkz. leadStore.js'deki
  // yeniLeadOlustur'un baslik alani, advisorEngine.js'deki destekTalebiGonder).
  const anaEtiket = lead.baslik ? `🆘 ${lead.baslik} (${lead.urun})` : lead.urun;
  return `• ${lead.musteriAdi || lead.telefon} - ${anaEtiket}${lead.danismanAdi ? ` (${lead.danismanAdi})` : ""} - ${gunSayisi} gündür açık${notEki}`;
}

// 26.07.2026 eklendi: her sabah AYNI "☀️ Günaydın!" yerine, gunden gune
// degisen 10 farkli pozitif/enerjik acilis mesajindan biri kullanilsin diye
// (kullanicinin talebi). gunAnahtari'ye ("YYYY-MM-DD") gore SABIT bir mesaj
// secilir (Math.random KULLANILMAZ) - boylece: 1) o gun danismana/Bahadır'a/
// Enbel'e giden UC mesaj da BIRBIRIYLE AYNI acilisi kullanir (tutarli), 2)
// gunden gune sirayla degisir (10 gunde bir dongu tekrar eder), 3) test/deploy
// sirasinda ayni gun icin hep ayni sonuc cikar (rastgelelik yok).
const GUNAYDIN_MESAJLARI = [
  "☀️ Günaydın! Yeni bir gün, yeni fırsatlar demek.",
  "🌅 Günaydın! Bugün de harika işler çıkaracağınıza inanıyoruz.",
  "🌞 Günaydın! Enerjiniz bol, gününüz bereketli olsun.",
  "✨ Günaydın! Küçük adımlar büyük başarılara götürür, bugün de bir adım daha atalım.",
  "🌻 Günaydın! Güzel bir gün sizi bekliyor, dolu dolu geçirin.",
  "💪 Günaydın! Bugün de ekip olarak harika işler çıkaracağız.",
  "🌈 Günaydın! Gülümseyerek başlayan gün, güzel biter.",
  "🚀 Günaydın! Hedeflerimize bir gün daha yaklaşıyoruz.",
  "🍀 Günaydın! Bugün şansınız ve emeğiniz bol olsun.",
  "🌸 Günaydın! Yeni gün, yeni bir başarı hikayesi yazmak için hazırız."
];

function gunlukGunaydinMesajiSec(gunAnahtari) {
  const [yil, ay, gun] = gunAnahtari.split("-").map(Number);
  const gunSayisi = Math.floor(Date.UTC(yil, ay - 1, gun) / (24 * 60 * 60 * 1000));
  return GUNAYDIN_MESAJLARI[gunSayisi % GUNAYDIN_MESAJLARI.length];
}

// 27.07.2026 eklendi: o gun bekleyen (Açık) bir isi OLMAYAN danismanlara da
// yine 09.30'da bir mesaj gitsin diye - "yeni iş beklediğimizi sevimli bir
// dille hatırlatalım" (kullanicinin talebi). GUNAYDIN_MESAJLARI'nin aksine
// burada BILEREK Math.random() kullaniliyor (kullanici acikca "random
// gönder" dedi) - acilis mesaji zaten gune gore sabit oldugu icin, bu ekstra
// mesajin da rastgele degismesi tekdüzeligi azaltiyor.
const BOS_GUN_MESAJLARI = [
  "Bugün için üzerinize kayıtlı bekleyen bir işiniz yok 🎉 Yeni bir talep için hazır olun, bugün güzel bir gün olabilir!",
  "Şu an bekleyen bir işiniz görünmüyor. Belki bugün yeni bir müşteriyle tanışırsınız 😊",
  "Bekleyen listeniz bomboş görünüyor! Yeni bir fırsat için gözünüz açık olsun 👀",
  "Bugünlük bekleyen bir işiniz yok, tebrikler! Yeni bir talep geldiğinde hemen haber vereceğiz 🔔",
  "Listenizde bekleyen bir şey yok - güzel bir boşluk. Yeni bir müşteri kapıyı çalarsa hemen burada olacak 🚪",
  "Şu anda açık bir işiniz yok. Enerjinizi yeni fırsatlar için saklayın 💪",
  "Bekleyen iş listeniz temiz! Yeni bir talep gelirse anında bilgilendirileceksiniz 📲",
  "Bugün için bekleyen bir işiniz bulunmuyor. Belki de bugün yeni bir portföy günü olur 🌟",
  "Şu an listenizde bekleyen bir iş yok - keyifli bir gün geçirin, yeni talepler yolda olabilir 🚀",
  "Bekleyen işiniz yok görünüyor, harika! Yeni bir müşteri geldiğinde ilk sizi haberdar edeceğiz ✅"
];
function bosGunMesajiSec() {
  return BOS_GUN_MESAJLARI[Math.floor(Math.random() * BOS_GUN_MESAJLARI.length)];
}

// 27.07.2026 eklendi: kullanicinin talebi uzerine, her gunluk ozet mesajinin
// sonuna eklenen sabit kapanis cumlesi ("Bekleyen İş" WhatsApp menusundeki
// interaktif listeyle ayni ifadeyi kullaniyor - danisman/Bahadır/Enbel bu
// cumleyi gorunce zaten alisik oldugu "Bekleyen İş" akisina gitmesi gerektigini
// anlar).
const GUNLUK_OZET_KAPANIS_CUMLESI = "Açık talepleriniz aşağıda, detay görmek istediğinizi seçin:";

let gunlukOzetGonderilenGun = null; // "YYYY-MM-DD" - ayni gun icinde tekrar gonderilmesin diye

// 27.07.2026 eklendi: bir kisinin KENDI bolumunu (varsa isleri, yoksa rastgele
// bir "bos gun" mesaji) olusturur - hem sade danisman mesajinda hem de
// Bahadır/Enbel'in birlesik mesajindaki "kendi isleriniz" bolumunde kullanilir.
function kisiselBolumMetni(kisiselIsler) {
  return kisiselIsler.length > 0 ? kisiselIsler.map(acikIsSatiriOlustur).join("\n") : bosGunMesajiSec();
}

// 27.07.2026 eklendi: kullanicinin ekran goruntusuyle bildirdigi butun
// sikayetleri (yanlis sablon basligi, satir sonlarinin kaybolmasi, Bahadır/
// Enbel'e IKI AYRI mesaj gitmesi, bekleyen isi olmayanlara HIC mesaj
// gitmemesi, kapanis cumlesinin olmamasi) tek seferde cozecek sekilde
// YENIDEN YAZILDI:
// - Artik SADECE gruplanmis (en az bir isi olan) numaralar degil, flows.js'deki
//   TUM KAYITLI danisman numaralari (Enbel, Seda, Bahadır, Fırat, Furkan, ...)
//   dolasilir - boylece bekleyen isi olmayan biri de mutlaka bir mesaj alir.
// - Bahadır ve Enbel icin TEK bir mesaj gonderilir - "Kendi bekleyen işleriniz"
//   ve "Ekibin ... bekleyen işleri" ayni mesajda iki ayri bolum olarak.
// - Gonderim artik hatirlatmaGonder yerine cokSatirliMesajGonder ile yapiliyor
//   (bkz. conversationEngine.js) - boylece pencere acikken satir sonlari VE
//   baslik dogru gorunur.
async function gunlukBekleyenIsOzetiKontrolEt() {
  const { saat, dakika, gunAnahtari } = simdiTurkiyeSaatineGore();
  if (saat !== 9 || dakika !== 30) return;
  if (gunlukOzetGonderilenGun === gunAnahtari) return;
  gunlukOzetGonderilenGun = gunAnahtari; // ilk once isaretle - gonderim sirasinda bir hata olsa bile ayni dakika icinde tekrar tekrar denenmesin

  const acikLeadler = leadStore.tumLeadleriGetir().filter((l) => l.durum === "Açık");
  const gunaydinMesaji = gunlukGunaydinMesajiSec(gunAnahtari);
  const elementerAcikIsler = acikLeadler.filter((l) => urunElementerMi(l.urun));

  const bahadir = PANEL_KULLANICILARI.find((k) => k.kullaniciAdi === "bahadireksi");
  const enbel = PANEL_KULLANICILARI.find((k) => k.kullaniciAdi === "enbeleksi");
  const tumDanismanlar = (flows.dask && flows.dask.advisors) || [];

  for (const danisman of tumDanismanlar) {
    const kisiselIsler = acikLeadler.filter((l) => l.danismanNumarasi === danisman.number);

    let mesaj;
    let logEtiketi;
    // 28.07.2026 eklendi ve DUZELTILDI: kullanicinin talebi mesajin TAMAMEN
    // atlanmasi degil, sadece "Açık talepleriniz aşağıda, detay görmek
    // istediğinizi seçin:" kapanis cumlesinin (GUNLUK_OZET_KAPANIS_CUMLESI)
    // gosterilecek acik bir talep YOKKEN eklenmemesiydi - gunaydin mesaji ve
    // "bekleyen isiniz yok" bolumu her zaman oldugu gibi gonderilmeye devam
    // ediyor. Bahadır/Enbel'in mesaji hem kendi hem ekip bolumu icerdigi
    // icin, onlar icin kapanis cumlesi HER IKI bolumden herhangi biri
    // doluysa eklenir - sade danisman icin ise sadece kendi isleri doluysa.
    let kapanisEklensinMi;

    if (bahadir && danisman.number === bahadir.telefon) {
      kapanisEklensinMi = kisiselIsler.length > 0 || elementerAcikIsler.length > 0;
      const ekipBolumu =
        elementerAcikIsler.length > 0
          ? elementerAcikIsler.map(acikIsSatiriOlustur).join("\n")
          : "Şu an ekipte bekleyen elementer bir iş yok 🎉";
      mesaj =
        `${gunaydinMesaji}\n\n` +
        `👤 Kendi bekleyen işleriniz:\n${kisiselBolumMetni(kisiselIsler)}\n\n` +
        `👥 Ekibin elementer bekleyen işleri:\n${ekipBolumu}` +
        (kapanisEklensinMi ? `\n\n${GUNLUK_OZET_KAPANIS_CUMLESI}` : "");
      logEtiketi = `Bahadır (${kisiselIsler.length} kendi, ${elementerAcikIsler.length} ekip)`;
    } else if (enbel && danisman.number === enbel.telefon) {
      kapanisEklensinMi = kisiselIsler.length > 0 || acikLeadler.length > 0;
      const ekipBolumu = acikLeadler.length > 0 ? acikLeadler.map(acikIsSatiriOlustur).join("\n") : "Şu an ekipte bekleyen bir iş yok 🎉";
      mesaj =
        `${gunaydinMesaji}\n\n` +
        `👤 Kendi bekleyen işleriniz:\n${kisiselBolumMetni(kisiselIsler)}\n\n` +
        `👥 Ekibin TÜM bekleyen işleri:\n${ekipBolumu}` +
        (kapanisEklensinMi ? `\n\n${GUNLUK_OZET_KAPANIS_CUMLESI}` : "");
      logEtiketi = `Enbel (${kisiselIsler.length} kendi, ${acikLeadler.length} ekip)`;
    } else {
      kapanisEklensinMi = kisiselIsler.length > 0;
      mesaj =
        `${gunaydinMesaji}\n\nBugün bekleyen işleriniz:\n\n${kisiselBolumMetni(kisiselIsler)}` +
        (kapanisEklensinMi ? `\n\n${GUNLUK_OZET_KAPANIS_CUMLESI}` : "");
      logEtiketi = `${danisman.name} (${kisiselIsler.length} iş)`;
    }

    try {
      await cokSatirliMesajGonder(danisman.number, mesaj);
      console.log(`Gunluk bekleyen is ozeti gonderildi: ${logEtiketi}`);
    } catch (err) {
      console.error(`Gunluk bekleyen is ozeti gonderilemedi (${danisman.name}):`, err?.response?.data || err.message);
    }
  }
}

// --- Kalici depolama: acilista yukleme, calisirken periyodik yedekleme ---
// DATABASE_URL tanimliysa (Railway'de PostgreSQL eklenmisse), tum oturumlar,
// mesaj gecmisi ve talepler her 15 saniyede bir ve kapanmadan hemen once
// otomatik olarak veritabanina yedeklenir. Tanimli degilse bu fonksiyonlar
// sessizce hicbir sey yapmaz - sistem eskisi gibi sadece bellekte calisir.
const YEDEKLEME_SIKLIGI_MS = 15 * 1000;

async function tumVeriyiKaydet() {
  await Promise.all([
    sessionStore.kaydet().catch((err) => console.error("Oturumlar kaydedilemedi:", err.message)),
    leadStore.kaydet().catch((err) => console.error("Talepler kaydedilemedi:", err.message)),
    messageLog.kaydet().catch((err) => console.error("Mesaj gecmisi kaydedilemedi:", err.message)),
    dokumanStore.kaydet().catch((err) => console.error("Dokumanlar kaydedilemedi:", err.message)),
    yenilemeStore.kaydet().catch((err) => console.error("Yenilemeler kaydedilemedi:", err.message)),
    islenenMesajIdleriKaydet().catch((err) => console.error("İşlenen mesaj ID'leri kaydedilemedi:", err.message)),
    musteriProfilStore.kaydet().catch((err) => console.error("Müşteri profilleri kaydedilemedi:", err.message)),
    engelliNumaralarStore.kaydet().catch((err) => console.error("Engelli numaralar kaydedilemedi:", err.message))
  ]);
}

// 27.07.2026 eklendi: conversationEngine.js, yeni bir elementer talep
// bildiriminin ardindan advisorEngine.js'deki danisman-oturum ekranini
// gosterebilsin diye (dongusel require olmadan) - bkz. conversationEngine.js
// finishFlow ve advisorEngine.js yeniTalepIcinAksiyonSor.
yeniTalepAksiyonHookAyarla(advisorEngine.yeniTalepIcinAksiyonSor);

async function baslat() {
  // db.init() basarisiz olursa (orn. DATABASE_URL tanimli ama baglanti
  // kurulamiyorsa) tum sunucunun ayaga kalkmasini engellememesi icin
  // burada yakalaniyor - kalicilik olmadan, bellek-ici calismaya devam edilir.
  try {
    await db.init();
  } catch (err) {
    console.error("Veritabani baslatilamadi, kalicilik olmadan bellek-ici calisilacak:", err.message);
  }

  // ASAGIDAKI yukle() cagrilari da (db.init() gibi) TEK TEK yakalanmali -
  // db.init() basarisiz oldugunda (ya da baglanti tam bu satirlar
  // calisirken kesildiginde) bunlar da AYNI hatayi (orn. ECONNREFUSED)
  // firlatiyor. Eskiden bu cagrilar CIPLAK (try/catch'siz) await
  // ediliyordu - yakalanmayan bir "rejection" TUM SURECI cokertiyor (Node,
  // yakalanmamis promise red'lerinde varsayilan olarak sureci
  // sonlandiriyor). Yani DB gecici olarak erisilemez oldugunda uygulama
  // "kalicilik olmadan bellek-ici calisilacak" YERINE sonsuz bir
  // crash-restart dongusune giriyordu - yukaridaki yorumun ve db.init()
  // catch'inin vaat ettigi davranisin tam tersi (bkz. 20.07.2026 log
  // kaydi). guvenliYukle bu bes cagriyi de birbirinden bagimsiz olarak
  // sarmaliyor, boylece biri basarisiz olsa bile digerleri denenmeye
  // devam ediyor ve sunucu her durumda ayaga kalkiyor.
  async function guvenliYukle(isim, fn) {
    try {
      await fn();
    } catch (err) {
      console.error(`${isim} veritabanindan yuklenemedi, bos/bellek-ici baslanacak:`, err.message);
    }
  }
  await guvenliYukle("Oturumlar", sessionStore.yukle);
  await guvenliYukle("Talepler", leadStore.yukle);
  await guvenliYukle("Mesaj gecmisi", messageLog.yukle);
  await guvenliYukle("Dokumanlar", dokumanStore.yukle);
  await guvenliYukle("Yenilemeler", yenilemeStore.yukle);
  await guvenliYukle("Islenmis mesaj ID'leri", islenenMesajIdleriYukle);
  await guvenliYukle("Musteri profilleri", musteriProfilStore.yukle);
  await guvenliYukle("Engelli numaralar", engelliNumaralarStore.yukle);

  app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda calisiyor.`);
  });

  setInterval(() => {
    tumVeriyiKaydet();
  }, YEDEKLEME_SIKLIGI_MS);

  setInterval(() => {
    hatirlatmalariKontrolEt().catch((err) => console.error("Hatirlatma kontrolu hatasi:", err));
  }, HATIRLATMA_KONTROL_SIKLIGI_MS);

  setInterval(() => {
    memnuniyetAnketleriniKontrolEt().catch((err) => console.error("Memnuniyet anketi kontrolu hatasi:", err));
  }, HATIRLATMA_KONTROL_SIKLIGI_MS);

  setInterval(() => {
    yenilemeleriBekleyenIseAktar().catch((err) => console.error("Yenileme -> bekleyen is donusumu hatasi:", err));
  }, HATIRLATMA_KONTROL_SIKLIGI_MS);

  setInterval(() => {
    gunlukBekleyenIsOzetiKontrolEt().catch((err) => console.error("Gunluk bekleyen is ozeti hatasi:", err));
  }, HATIRLATMA_KONTROL_SIKLIGI_MS);

  // Suresi gecmis 2FA deneme/oturum kayitlarini temizle (bellek sismesin diye).
  setInterval(() => {
    const simdi = Date.now();
    for (const [token, deneme] of otpDenemeleri) {
      if (deneme.expiresAt < simdi) otpDenemeleri.delete(token);
    }
    for (const [token, bitis] of dogrulanmisOturumlar) {
      if (bitis < simdi) dogrulanmisOturumlar.delete(token);
    }
  }, HATIRLATMA_KONTROL_SIKLIGI_MS);

  // Railway bir deploy/restart sirasinda once SIGTERM gonderir - bu sinyali
  // yakalayip kapanmadan hemen once son bir kez kaydederek veri kaybini
  // en aza indiriyoruz.
  const kapatirkenKaydet = async (sinyal) => {
    console.log(`${sinyal} alindi, kapanmadan once veriler kaydediliyor...`);
    try {
      await tumVeriyiKaydet();
    } catch (err) {
      console.error("Kapanirken kaydetme hatasi:", err.message);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => kapatirkenKaydet("SIGTERM"));
  process.on("SIGINT", () => kapatirkenKaydet("SIGINT"));
}

baslat();

// Web hesaplayici teklif bildirimleri - donen nesne, webhook'a yazan bir
// numaranin daha once web'den teklif isteyip istemedigini kontrol etmek
// icin asagida (app.post("/webhook", ...)) kullaniliyor.
const teklifYardimcilari = require('./teklifEndpoint')(app, db.pool);

// 28.07.2026 eklendi: Malpraktis icin urun-ozel web teklif formu (GET
// /teklif/malpraktis - formu servis eder; POST /api/web-teklif/malpraktis -
// cevaplari alir, dogrular, Bahadır'a/Enbel'e/varsa danışmana bildirim
// gonderir ve panelde takip edilebilir bir lead olarak kaydeder). Bu,
// teklifEndpoint.js'teki (ayri bir sitede barinan, secret'li) hesaplayicidan
// FARKLI bir desen - bu form dogrudan bu sunucu tarafindan servis edildigi
// icin ayri bir secret/CORS'a ihtiyac yok (ayni origin).
require('./webTeklifFormlari')(app);
