// Danismanlarin, panele hic girmeden, dogrudan WhatsApp uzerinden:
// 1) Kendi taleplerini gormesini, not eklemesini, durum degistirmesini,
//    hatirlatma kurmasini,
// 2) Musteri (sigortali) adina YENI bir talep olusturmasini
// saglar. Bir mesaj bilinen bir danisman numarasindan geldiginde, server.js
// bu modulu cagirir - musteri akisina (conversationEngine) hic girmez,
// tamamen ayri bir menu sistemidir.

const fs = require("fs");
const path = require("path");
const { getSession, resetSession } = require("./sessionStore");
const { sendText, sendButtons, sendList, sendDocument, sendTemplatePozisyonel, mediaIndir } = require("./loggedWhatsapp");
const leadStore = require("./leadStore");
const yenilemeStore = require("./yenilemeStore");
const engelliNumaralarStore = require("./engelliNumaralarStore");
const dokumanStore = require("./dokumanStore");
const { dosyaTuruIzinliMi } = require("./izinliDosyaTurleri");
const { garantiEmekliligeGonder } = require("./eposta");
const {
  tcKimlikGecerliMi,
  tarihGecerliMi,
  tarihiNormallestir,
  plakaGecerliMi,
  yenilemeTarihiGecerliMi,
  aramaTarihiGecerliMi,
  aramaTarihiBugunMu,
  tarihiMsYap,
  bosDegilMi,
  adSoyadGecerliMi,
  telefonGecerliMi,
  telefonUluslararasiFormata,
  epostaGecerliMi,
  primTutariGecerliMi,
  saatAraligiGecerliMi,
  saatAraligiNormallestir
} = require("./validators");
const flows = require("./flows");
const conversationEngine = require("./conversationEngine");
const sozlukSSS = require("./sozlukSSS");
const { gunSelamlamasi } = require("./gunSelamlama");
const musteriProfilStore = require("./musteriProfilStore");
const { belgeleriTekPdfeBirlestir } = require("./pdfBirlestir");
const { belgeFotografiAnalizEt, kimlikOnArkaTutarliMi } = require("./belgeAnaliz");
// 28.07.2026 eklendi: danismanin musteri adina olusturdugu yeni talep akisinda
// (DANISMAN_YENI_SORU) Trafik/Kasko'nun "belge" tipi sorulari (proforma/ruhsat
// OCR) da musteri akisiyla (conversationEngine.js) AYNI analiz fonksiyonlarini
// kullanarak destekleyebilmek icin eklendi.
const { ruhsatFotografiAnalizEt } = require("./ruhsatAnaliz");
const { proformaAnalizEt } = require("./proformaAnaliz");
const { vefatTeminatiHesapla } = require("./vefatTeminatiHesapla");
const { satisSozlesmesiAnalizEt } = require("./satisSozlesmesiAnaliz");
const { BES_FONLARI, fonlariKategoriyeGoreGrupla } = require("./besFonVerileri");
const { fonGetirileriniGetir } = require("./tefasGetiriAnaliz");

// Elinde "Trafik Sigortası" ya da "Kasko Sigortası" gecen urun etiketleri
// icin, yenileme eklerken ayrica plaka soruyoruz (diger urunlerde anlamsiz).
const PLAKA_ISTENEN_URUN_ETIKETLERI = ["Trafik Sigortası", "Kasko Sigortası"];

// Bir satis GERCEKTEN Garanti Emeklilik'e iletildikten (bkz. satisTamamla'daki
// mailSonucu.basarili kontrolu) kac ms sonra musteriye memnuniyet/kalite
// kontrolu mesaji gonderilecegi (bkz. server.js'deki memnuniyetAnketleriniKontrolEt).
const MEMNUNIYET_ANKETI_GECIKME_MS = 3 * 24 * 60 * 60 * 1000; // 3 gun

// Bir talebin/kaydin "urun" alanindaki serbest metinden (orn. "Standart Prim
// İadeli Hayat Sigortası") hangi flows.js urunune ait oldugunu bulur -
// Satis Kaydi gibi akislarda urun adi paket ismiyle birlestirilip
// kaydedildigi icin tam esitlik yerine "icerir mi" kontrolu yapiyoruz.
function flowBulUrunAdindan(urunAdi) {
  if (!urunAdi) return null;
  return Object.values(flows).find((f) => urunAdi.includes(f.label)) || null;
}

// --- Satis Kaydi: Prim Iadeli Hayat Sigortasi / BES (Yeni Is) ---
// Musteri urunu satin almaya karar verdikten SONRA (satis asamasi) doldurulan,
// Garanti Emeklilik'in bekledigi tam formatta bilgi toplayan ayri bir akis.
// Mevcut "Yeni İş Talebi" (teklif talebi) akisindan tamamen bagimsizdir.
// NOT: BES'te "Aktarım" henuz desteklenmiyor - sadece "Yeni İş" calisiyor,
// Aktarım secilirse yakinda eklenecegi soylenip ana menuye donuluyor.
// Belgeler adimina gelindiginde, danismanin musteriye yazdirip imzalatmasi
// icin Garanti'nin bos sablon formlarini (Acik Riza Metni + Imza Karti)
// otomatik olarak gonderiyoruz - boylece danisman bunlari ayrica aramak
// zorunda kalmiyor.
const SABIT_SABLONLAR = [
  { dosyaYolu: path.join(__dirname, "sablonlar", "acik_riza_metni.pdf"), dosyaAdi: "Garanti Açık Rıza Metni.pdf" },
  // BES Yeni İş'te ıslak imza kartı istenmiyor (bkz. asagida SATIS_SORULARI_BES_YENI_IS
  // filtrelemesi) - o yuzden bu bos sablonu da SADECE Hayat'ta gonderiyoruz,
  // BES'te danismana ihtiyaci olmayan bir form gondermeyelim.
  {
    dosyaYolu: path.join(__dirname, "sablonlar", "imza_karti.pdf"),
    dosyaAdi: "İletişim Bilgileri ve Islak İmza Kartı.pdf",
    sadeceHayatta: true
  }
];

// Vefat teminati 500.000 USD'nin uzerinde oldugunda ayrica istenen Saglik
// Beyan Formu'nun BOS sablonu - danismanin sigortaliya yazdirip
// doldurtmasi/imzalatmasi icin, tipki acik riza/imza karti sablonlari gibi
// belge sorusuna gelindiginde otomatik gonderiliyor (bkz. asagida
// satisSoruSor'daki soru.sablonGonder === "saglikBeyani" kontrolu).
const SAGLIK_BEYAN_SABLONU = {
  dosyaYolu: path.join(__dirname, "sablonlar", "saglik_beyan_formu.pdf"),
  dosyaAdi: "Sağlık Beyan Formu (Boş).pdf"
};

async function sabitSablonlariGonder(from, urunTipi) {
  const gonderilecekler = besUrunTipiMi(urunTipi) ? SABIT_SABLONLAR.filter((s) => !s.sadeceHayatta) : SABIT_SABLONLAR;
  for (const sablon of gonderilecekler) {
    try {
      const buffer = fs.readFileSync(sablon.dosyaYolu);
      await sendDocument(from, buffer, "application/pdf", sablon.dosyaAdi);
    } catch (err) {
      console.error(`Sabit sablon gonderilemedi (${sablon.dosyaAdi}):`, err.message);
    }
  }
}

async function saglikBeyanSablonuGonder(from) {
  try {
    const buffer = fs.readFileSync(SAGLIK_BEYAN_SABLONU.dosyaYolu);
    await sendDocument(from, buffer, "application/pdf", SAGLIK_BEYAN_SABLONU.dosyaAdi);
  } catch (err) {
    console.error(`Saglik beyan formu sablonu gonderilemedi:`, err.message);
  }
}

// _urunTipi'nin BES ailesinden olup olmadigini (Yeni İş VEYA Aktarım) kontrol
// eder - "BES Hayat Başvurusu" akisi 24.07.2026'da gercek bir Aktarım kolu
// kazandigi icin, eskiden sadece "bes_yeni_is" kontrol eden pek cok yer artik
// bu ortak fonksiyonu kullaniyor (asagida primAsgariBilgisi, odeme donemi/
// katki payi metinleri, sabitSablonlariGonder, unvanIyelik, ilgiliFlow gibi
// SADECE "BES mi degil mi" ayrimi yapan yerler icin). Yeni İş ile Aktarım'i
// birbirinden AYIRAN kontroller (katki payi asgarisi, odeme araci secenekleri,
// ekstra belgeler) hala answers._urunTipi'nin TAM degerine (bes_yeni_is vs
// bes_aktarim) bakmaya devam ediyor.
function besUrunTipiMi(urunTipi) {
  return urunTipi === "bes_yeni_is" || urunTipi === "bes_aktarim";
}

// --- "Musteri" kelimesi lugatimizdan kaldirildi: BES'te (Bireysel Emeklilik)
// dogru terim "katilimci", diger tum urunlerde (Hayat, elementer) "sigortali".
// Soru metinlerinde/mesajlarda bu fonksiyon kullanilir - answers._urunTipi
// satisAkisiBaslat'ta baslangicta yazilir (bkz. asagida).
// buyukHarfle: true ise cumle basi ("Katılımcı"/"Sigortalı"), false ise
// cumle ici ("katılımcı"/"sigortalı").
function sigortaliUnvani(answers, buyukHarfle) {
  const besMi = besUrunTipiMi(answers && answers._urunTipi);
  const unvan = besMi ? "katılımcı" : "sigortalı";
  return buyukHarfle ? unvan.charAt(0).toUpperCase() + unvan.slice(1) : unvan;
}

// "USD 450,00", "TL 5.000,00", "5000" gibi Turkce bicimli bir tutar
// metninden sayisal degeri cikarir - nokta binlik ayraci, virgul ondalik
// ayraci olarak yorumlanir (orn. "5.000,00" -> 5000). Ayristiramazsa NaN doner.
function tutarSayiyaCevir(value) {
  const v = (value || "").replace(/[^\d.,]/g, "");
  if (!v) return NaN;
  if (v.includes(".") && v.includes(",")) {
    return Number(v.replace(/\./g, "").replace(",", "."));
  }
  if (v.includes(",")) {
    return Number(v.replace(",", "."));
  }
  // SADECE nokta varsa (virgul yok) - Turkce yazim kuralina gore nokta
  // BINLIK AYIRICIDIR (asla ondalik degil, ondalik icin virgul kullanilir),
  // o yuzden "600.000" gibi bir girdi 600 degil 600000 olarak okunmali.
  // Bu kontrol olmadan (eski davranis) "600.000" yanlislikla 600'e
  // yuvarlaniyordu - bu da hem asgari prim/katki payi kontrolunu hem de
  // 500.000 USD vefat teminati esigini yanlis hesaplatiyordu.
  if (v.includes(".")) {
    return Number(v.replace(/\./g, ""));
  }
  return Number(v);
}

// Danismanlarin girdigi prim/katki payi tutarinin izin verilen araligi -
// Hayat'ta pakete gore degisiyor: Standart paket SADECE 150-299 USD
// araliginda kabul edilir (24.07.2026 geri bildirimi - "standart seçildiyse
// cevap olarak minimum 150 dolar maksimum 299 dolar"), Premium pakette ise
// sadece bir ASGARI var (300 USD, ustsinir yok). BES'te Yeni İş'te asgari
// 2.000 TL (24.07.2026 geri bildirimiyle 5.000 TL'den dusuruldu), Aktarım'da
// ise asgari 150 TL - ikisinde de ustsinir yok. answers.paket sadece Hayat'ta
// doldurulur (BES'te bu soru yok), o yuzden BES kontrolleri once yapiliyor.
// "azami" alani null ise o paket/urun icin bir ust sinir olmadigi anlamina
// gelir.
function primAsgariBilgisi(answers) {
  if (answers && answers._urunTipi === "bes_aktarim") {
    return { asgari: 150, azami: null, birim: "TL" };
  }
  if (answers && answers._urunTipi === "bes_yeni_is") {
    return { asgari: 2000, azami: null, birim: "TL" };
  }
  if (answers && answers.paket === "Premium") {
    return { asgari: 300, azami: null, birim: "USD" };
  }
  return { asgari: 150, azami: 299, birim: "USD" };
}

function primTutariVeMinimumGecerliMi(value, answers) {
  if (!primTutariGecerliMi(value)) return false;
  const sayi = tutarSayiyaCevir(value);
  if (Number.isNaN(sayi)) return false;
  const { asgari, azami } = primAsgariBilgisi(answers);
  if (sayi < asgari) return false;
  if (azami != null && sayi > azami) return false;
  return true;
}

function primMinimumHatasi(value, answers) {
  if (!primTutariGecerliMi(value) || Number.isNaN(tutarSayiyaCevir(value))) {
    return "Bu bir tutar gibi görünmüyor, lütfen rakamla birlikte tekrar yazar mısınız?";
  }
  const { asgari, azami, birim } = primAsgariBilgisi(answers);
  const paketNotu = answers && answers.paket ? `${answers.paket} paket için ` : "";
  if (azami != null) {
    return (
      `Girilen tutar izin verilen aralığın dışında görünüyor, bu tutarı kabul edemiyorum ⚠️ ${paketNotu}kabul edilen ` +
      `aralık ${birim} ${asgari.toLocaleString("tr-TR")} - ${birim} ${azami.toLocaleString("tr-TR")} arasıdır, lütfen bu aralıkta bir değer paylaşır mısınız?`
    );
  }
  return (
    `Girilen tutar asgari tutarın altında görünüyor, bu tutarı kabul edemiyorum ⚠️ ${paketNotu}asgari tutar ` +
    `${birim} ${asgari.toLocaleString("tr-TR")} olmalıdır, lütfen bu tutarın üzerinde bir değer paylaşır mısınız?`
  );
}

// --- Arama tarihi/saati icin secenek uretimi (task: danisman serbest metin
// yazmak yerine listeden secsin) ---
const HAFTA_GUNLERI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const TURKCE_AYLAR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık"
];
const SAAT_ARALIKLARI = ["08:00-10:00", "10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00"];
// Son aralik 16:00'da basliyor, "bugunse en az 2 saat sonrasi" kurali
// geregi bu saatten (16:00 - 2 saat = 14:00) sonra bugun icin hicbir uygun
// aralik kalmiyor - o yuzden "bugun" secenegi bu saatten sonra listeye hic
// eklenmiyor (bkz. asagida bugundenBaslayanHaftaIciGunleri).
const BUGUN_ICIN_SON_MAKUL_DK = 16 * 60 - 120;

// Bugunden baslayarak (gerekirse yarindan), hafta sonlarini (Cumartesi/
// Pazar) ATLAYARAK ilk `adet` kadar HAFTA ICI gunu Date olarak dondurur -
// cagri merkezi hafta sonlari calismiyor, bu yuzden secenek olarak hic
// sunmuyoruz.
function bugundenBaslayanHaftaIciGunleri(adet) {
  const simdi = new Date();
  const simdiDk = simdi.getHours() * 60 + simdi.getMinutes();
  let cursor = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate());
  if (simdiDk > BUGUN_ICIN_SON_MAKUL_DK) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  const gunler = [];
  while (gunler.length < adet) {
    const gun = cursor.getDay();
    if (gun !== 0 && gun !== 6) {
      gunler.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return gunler;
}

function ikiHane(n) {
  return String(n).padStart(2, "0");
}

// Bir Date'i hem kanonik deger ("GG.AA.YYYY") hem de danismana gosterilecek
// kisa etikete ("Bugün", "Yarın" ya da "Perşembe (17.07)") cevirir.
function tarihSecenegiOlustur(tarih) {
  const simdi = new Date();
  const bugunMu =
    tarih.getFullYear() === simdi.getFullYear() &&
    tarih.getMonth() === simdi.getMonth() &&
    tarih.getDate() === simdi.getDate();
  const yarin = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate() + 1);
  const yarinMi =
    tarih.getFullYear() === yarin.getFullYear() &&
    tarih.getMonth() === yarin.getMonth() &&
    tarih.getDate() === yarin.getDate();

  const gunAdi = HAFTA_GUNLERI[tarih.getDay()];
  // 24.07.2026 geri bildirimi: "(27.07)" yerine "(27 Temmuz)" formati - sadece
  // GORUNTULENEN kisa etiket icin, kanonik "deger" (GG.AA.YYYY) degismiyor
  // cunku validators.js'deki aramaTarihiBugunMu/tarihiMsYap bu kesin formati
  // regex ile parse ediyor.
  const gunAyMetniTurkce = `${tarih.getDate()} ${TURKCE_AYLAR[tarih.getMonth()]}`;
  const kisaEtiket = bugunMu ? "Bugün" : yarinMi ? "Yarın" : `${gunAdi} (${gunAyMetniTurkce})`;

  return {
    deger: `${ikiHane(tarih.getDate())}.${ikiHane(tarih.getMonth() + 1)}.${tarih.getFullYear()}`,
    kisaEtiket
  };
}

// Kanonik "GG.AA.YYYY" formatindaki bir arama_tarihi degerini (orn.
// "27.07.2026"), mail/ozet metinlerinde gosterilmek uzere Turkce ay adiyla
// insan-okunur bir metne cevirir (orn. "27 Temmuz"). Deger beklenen formatta
// degilse (orn. bos/gecersiz), oldugu gibi geri dondurur - boylece beklenmedik
// bir veri akisi bozmuyor.
function tarihiGunAyOlarakYaz(deger) {
  const match = (deger || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return deger;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  if (ay < 1 || ay > 12) return deger;
  return `${gun} ${TURKCE_AYLAR[ay - 1]}`;
}

// arama_tarihi sorusunun "options"/"kisaSecenekler" fonksiyonlari - 5 hafta
// ici gun secenegi uretir.
function aramaTarihiSecenekleri() {
  return bugundenBaslayanHaftaIciGunleri(5).map((t) => tarihSecenegiOlustur(t).deger);
}
function aramaTarihiKisaSecenekleri() {
  return bugundenBaslayanHaftaIciGunleri(5).map((t) => tarihSecenegiOlustur(t).kisaEtiket);
}

// arama_saat_araligi sorusunun secenekleri - secilen tarih BUGUNSE, su anki
// saatten (+2 saat kurali ile) once baslayan araliklari listeden cikarir.
function aramaSaatAraligiSecenekleri(answers) {
  if (!answers || !answers.arama_tarihi || !aramaTarihiBugunMu(answers.arama_tarihi)) {
    return SAAT_ARALIKLARI;
  }
  const simdi = new Date();
  const simdiDk = simdi.getHours() * 60 + simdi.getMinutes();
  const uygunlar = SAAT_ARALIKLARI.filter((araligi) => {
    const [baslangicSaat, baslangicDk] = araligi.split("-")[0].split(":").map(Number);
    return baslangicSaat * 60 + baslangicDk >= simdiDk + 120;
  });
  // Beklenmedik bir durumda (orn. saat kaymasi) hicbir aralik kalmazsa, bos
  // liste yerine tum araliklari gosterip kullaniciyi tikanmis birakmamak
  // daha güvenli - saatAraligiGecerliMi zaten gecmis bir secimi reddedecektir.
  return uygunlar.length > 0 ? uygunlar : SAAT_ARALIKLARI;
}

// Bir soru metnini, akisi kimin baslattigina gore (danisman mi, yoksa
// musteri kendi kendine mi) iki farkli sekilde ifade etmek icin kucuk bir
// yardimci - Turkce'de 3. sahis ("sigortalının X'i") ile 2. sahis ("X'iniz")
// arasindaki fark sadece bir sozcuk degistirmekle olmuyor, cumle yapisi
// degisiyor, o yuzden genel bir "cevirici" yerine her soru kendi iki
// varyantini acikca yaziyor.
function hitapEt(a, ucuncuSahisMetni, ikinciSahisMetni) {
  return a && a._musteriKendiKendine ? ikinciSahisMetni : ucuncuSahisMetni;
}

// Musteriye "daha once bir danismanla gorustunuz mu" diye sorarken gosterilen
// tam liste - flows.js'teki TUM_DANISMAN_ISIMLERI ile AYNI (numarasi olsun
// olmasin tum danismanlar) - musteri kiminle gorustugunu soyleyebilsin diye.
// Iki ayri dosyada tutulmasinin sebebi dairesel require sorunundan kacinmak
// (bkz. musteriSatisBaslat yorumu) - bu liste nadiren degistigi icin
// senkron tutmak risk degil.
const SATIS_TUM_DANISMAN_ISIMLERI = [
  "Enbel",
  "Seda",
  "Bahadır",
  "Fırat",
  "Yasemin",
  "Furkan",
  "Şevval",
  "Nilşah",
  "Simge",
  "Tuğçe"
];

// BES basvurularinda (Yeni İş ve Aktarım) mail'e eklenen SABIT varsayilan fon
// dagilimi (bkz. besOzetVerileriniHesapla yorumu - dinamik/guncel piyasaya
// gore olmasi istenmisti ama ayarlanamadigi icin sabit birakildi). Oranlarin
// toplami %100 olmalidir.
const BES_FON_DAGILIMI_SABIT = [
  { ad: "PARA PİYASASI EYF", kod: "GEL", oran: 15 },
  { ad: "BİRİNCİ FON SEPETİ", kod: "GCT", oran: 10 },
  { ad: "ÜÇÜNCÜ DEĞİŞKEN EYF", kod: "GHO", oran: 15 },
  { ad: "YENİ TEK. HİSSE SENEDİ EYF", kod: "GCN", oran: 10 },
  { ad: "KARMA EYF", kod: "GCY", oran: 15 },
  { ad: "ALTIN KATILIM EYF", kod: "GHA", oran: 35 }
];

const SATIS_SORULARI_HAYAT = [
  // Sadece musteri KENDI KENDINE bu akisi baslattiginda sorulur (danisman
  // bir satis kaydi olustururken bu iki soru anlamsiz, o zaten kendisi bir
  // danisman) - bkz. flows.js'teki ayni amacli DANISMAN_SORULARI, ayni
  // mantik burada musteri-kendi-kendine satis akisi icin tekrarlaniyor.
  {
    id: "satis_danisman_gorustu_mu",
    text: "Daha önce acentemiz bünyesindeki danışmanlarımızdan biriyle görüşme fırsatınız oldu mu?",
    type: "choice",
    options: ["Evet", "Hayır"],
    skipIf: (a) => !a._musteriKendiKendine
  },
  {
    id: "satis_danisman_adi",
    text: "Hangi danışmanımızla görüşme fırsatınız oldu?",
    type: "choice",
    options: SATIS_TUM_DANISMAN_ISIMLERI,
    skipIf: (a) => !a._musteriKendiKendine || a.satis_danisman_gorustu_mu !== "Evet"
  },
  {
    id: "paket",
    // Paketler arasindaki farki (tenzil kesinti orani) da bu soruda
    // aciklayarak danismanin/musterinin bilgiyle secim yapmasini sagliyoruz
    // (24.07.2026 geri bildirimi).
    text: (a) =>
      `${hitapEt(a, "Hangi paket için satış kaydı oluşturuyorsunuz?", "Hangi paket ile devam etmek istersiniz?")}\n\n` +
      "📌 Paketler arasındaki fark: 2. yıl ile 8. yıl arasında poliçeden ayrılma (tenzil) durumunda uygulanan kesinti oranı " +
      "*Standart* pakette %30, *Premium* pakette %15'tir.",
    type: "choice",
    // "Standart"/"Premium" oldugu gibi mail'e gidiyor (urunAdiTam icinde,
    // "Ürün Adı: Standart Prim İadeli Hayat Sigortası" gibi) - o yuzden bu
    // degerleri degistirmiyoruz. Butonda asgari/azami tutar bilgisini
    // gostermek icin ayri bir kisaSecenekler tanimliyoruz.
    options: ["Standart", "Premium"],
    kisaSecenekler: ["Standart(150-299usd)", "Premium(min.300usd)"]
  },
  {
    id: "musteri_ad_soyad",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın adını ve soyadını paylaşır mısınız?`, "Adınızı ve soyadınızı paylaşır mısınız?"),
    type: "text",
    validate: adSoyadGecerliMi,
    validationError: "Lütfen adı ve soyadı birlikte yazar mısınız? (Örn: Ahmet Yılmaz)",
    // Musteri kendi kendine basvurduysa bu soru zaten konusmanin en basinda
    // (ASK_NAME) bir kere soruldu - satisAkisiBaslat, gecerli (en az 2
    // kelimelik) bir ad-soyad varsa answers.musteri_ad_soyad'i ONCEDEN
    // dolduruyor; burada da o durumda soruyu ATLIYORUZ ki musteriye ayni
    // soru iki kez sorulmasin (bkz. 20.07.2026 geri bildirimi - "bunlar
    // salak mi" izlenimi). Danisman akisinda (_musteriKendiKendine=false)
    // bu hicbir zaman true olmaz, soru eskisi gibi her zaman sorulur.
    skipIf: (a) => a._musteriKendiKendine && !!a.musteri_ad_soyad
  },
  // "Müşteri kelimesini lugatımızdan kaldırıyoruz" karari geregi, TCK sormadan
  // once artik T.C. vatandaşlığını soruyoruz - "Evet" ise uyruk otomatik
  // "T.C." sayilip TCK isteniyor, "Hayır" ise serbest metin uyruk + TCK
  // yerine Mavi Kart numarasi isteniyor (bkz. asagidaki 3 soru).
  {
    id: "sigortali_tc_vatandasi_mi",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)} Türkiye Cumhuriyeti vatandaşı mı?`, "Türkiye Cumhuriyeti vatandaşı mısınız?"),
    type: "choice",
    options: ["Evet", "Hayır"]
  },
  {
    id: "sigortali_tck",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın T.C. kimlik numarasını paylaşır mısınız?`, "T.C. kimlik numaranızı paylaşır mısınız?"),
    type: "text",
    validate: tcKimlikGecerliMi,
    validationError: "Girilen T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?",
    skipIf: (a) => a.sigortali_tc_vatandasi_mi !== "Evet"
  },
  {
    id: "sigortali_mavi_kart_no",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın Mavi Kart numarasını paylaşır mısınız?`, "Mavi Kart numaranızı paylaşır mısınız?"),
    type: "text",
    validate: bosDegilMi,
    validationError: "Bu alanı boş bırakamayız, lütfen Mavi Kart numarasını paylaşır mısınız?",
    skipIf: (a) => a.sigortali_tc_vatandasi_mi !== "Hayır"
  },
  {
    id: "sigortali_dogum_tarihi",
    text: (a) =>
      hitapEt(
        a,
        `${sigortaliUnvani(a, true)}nın doğum tarihini paylaşır mısınız? (Örn: 04.08.1997 ya da 4.8.97)`,
        "Doğum tarihinizi paylaşır mısınız? (Örn: 04.08.1997 ya da 4.8.97)"
      ),
    type: "text",
    validate: tarihGecerliMi,
    normalize: tarihiNormallestir,
    validationError: "Lütfen geçerli bir tarih yazar mısınız? (Örn: 04.08.1997 ya da 4.8.97)"
  },
  {
    id: "sigortali_cinsiyet",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın cinsiyeti nedir?`, "Cinsiyetiniz nedir?"),
    type: "choice",
    options: ["Kadın", "Erkek"]
  },
  {
    id: "sigortali_uyruk",
    text: (a) =>
      hitapEt(
        a,
        `T.C. vatandaşı olmadığını belirttiniz, ${sigortaliUnvani(a, false)}nın uyruğunu paylaşır mısınız? (Örn: Alman)`,
        "T.C. vatandaşı olmadığınızı belirttiniz, uyruğunuzu paylaşır mısınız? (Örn: Alman)"
      ),
    type: "text",
    validate: bosDegilMi,
    validationError: "Bu alanı boş bırakamayız, lütfen uyruğu paylaşır mısınız?",
    skipIf: (a) => a.sigortali_tc_vatandasi_mi !== "Hayır"
  },
  {
    id: "sigortali_dogum_yeri",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın doğum yerini paylaşır mısınız? (Örn: Adana)`, "Doğum yerinizi paylaşır mısınız? (Örn: Adana)"),
    type: "text",
    validate: bosDegilMi,
    validationError: "Bu alanı boş bırakamayız, lütfen doğum yerini paylaşır mısınız?"
  },
  {
    id: "odeyen_farkli_mi",
    text: (a) => {
      const alan = besUrunTipiMi(a._urunTipi) ? "Katkı payını" : "Primi";
      return hitapEt(a, `${alan} ödeyecek kişi ${sigortaliUnvani(a, false)}nın kendisi mi?`, `${alan} ödeyecek kişi siz misiniz?`);
    },
    type: "choice",
    options: ["Evet, Kendisi", "Hayır, Farklı Biri"]
  },
  {
    id: "odeyen_ad_soyad",
    text: "Ödeyecek kişinin adını ve soyadını paylaşır mısınız?",
    type: "text",
    validate: adSoyadGecerliMi,
    validationError: "Lütfen adı ve soyadı birlikte yazar mısınız? (Örn: Ahmet Yılmaz)",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  {
    id: "odeyen_tck",
    text: "Ödeyecek kişinin T.C. kimlik numarasını paylaşır mısınız?",
    type: "text",
    validate: tcKimlikGecerliMi,
    validationError: "Girilen T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  {
    id: "odeme_araci",
    text: "Ödeme aracı nedir?",
    type: "choice",
    // BES Aktarım'da ucuncu bir secenek olarak "Manuel" de sunuluyor
    // (24.07.2026 geri bildirimi) - Hayat'ta ve BES Yeni İş'te bu secenek
    // gosterilmiyor. "Manuel" secilirse katki payi sorusu atlanip otomatik
    // "TL 150,00" olarak kaydediliyor (bkz. yukarida satisSoruSor'daki ozel
    // durum kontrolu).
    options: (a) =>
      a && a._urunTipi === "bes_aktarim"
        ? ["Kredi Kartı", "Garanti Bankası Hesabı", "Manuel"]
        : ["Kredi Kartı", "Garanti Bankası Hesabı"],
    // "Garanti Bankası Hesabı" 22 karakter, WhatsApp'in dugme siniri olan 20'yi
    // asiyor. Bu deger oldugu gibi maile gittigi icin ("Ödeme Aracı: ...")
    // kisaltip degistiremeyiz - bunun yerine dugmede gosterilecek kisa bir
    // etiket tanimlıyoruz, kaydedilen/mail'e giden deger yine tam metin oluyor
    // (bkz. satisSoruSor / DANISMAN_SATIS_SORU'daki kisaSecenekler kullanimi).
    kisaSecenekler: (a) =>
      a && a._urunTipi === "bes_aktarim"
        ? ["Kredi Kartı", "Garanti Bank. Hesabı", "Manuel"]
        : ["Kredi Kartı", "Garanti Bank. Hesabı"]
  },
  {
    id: "odeme_donemi",
    // BES'te odeme donemi police suresi boyunca HER ZAMAN degistirilebiliyor
    // (Hayat'ta degistirilemiyor) - bu yuzden uyari sadece Hayat'ta gosteriliyor.
    text: (a) =>
      besUrunTipiMi(a._urunTipi)
        ? "Ödeme dönemi nedir?"
        : "Ödeme dönemi nedir? (Not: poliçe süresi boyunca değiştirilemez.)",
    type: "choice",
    options: ["Aylık", "Üç Aylık", "Altı Aylık", "Yıllık"]
  },
  {
    id: "prim_tutari",
    // BES'te dogru terim "katki payi tutari" (Hayat'ta "prim"). Hayat'ta bu
    // tutar artik harici bir hesaplayiciya gerek kalmadan girilebiliyor -
    // vefat teminati, girilen bu prim tutarindan bot tarafindan otomatik
    // hesaplaniyor (bkz. asagidaki vefat_teminati sorusu / vefatTeminatiHesapla.js).
    // Ornek tutar da secilen pakete/urun tipine gore degisiyor (24.07.2026
    // geri bildirimi) - Hayat'ta Standart'ta "USD 200,00", Premium'da
    // "USD 450,00"; BES Yeni İş'te "TL 2.000,00" (yeni asgariyle uyumlu),
    // BES Aktarım'da "TL 150,00" gosteriliyor. NOT: BES Aktarım'da "Manuel"
    // odeme araci secilirse bu soru zaten hic sorulmuyor (yukarida ozel durum).
    text: (a) => {
      const donem = a.odeme_donemi || "";
      if (a._urunTipi === "bes_aktarim") {
        return hitapEt(
          a,
          `Katılımcının ödeyeceği ${donem} katkı payı tutarını paylaşır mısınız? (Örn: TL 150,00)`,
          `Ödemek istediğiniz ${donem} katkı payı tutarını paylaşır mısınız? (Örn: TL 150,00)`
        );
      }
      if (a._urunTipi === "bes_yeni_is") {
        return hitapEt(
          a,
          `Katılımcının ödeyeceği ${donem} katkı payı tutarını paylaşır mısınız? (Örn: TL 2.000,00)`,
          `Ödemek istediğiniz ${donem} katkı payı tutarını paylaşır mısınız? (Örn: TL 2.000,00)`
        );
      }
      const ornekTutar = a.paket === "Standart" ? "USD 200,00" : "USD 450,00";
      return hitapEt(
        a,
        `${donem} prim tutarını paylaşır mısınız? (Örn: ${ornekTutar})`,
        `Ödemek istediğiniz ${donem} prim tutarını paylaşır mısınız? (Örn: ${ornekTutar})`
      );
    },
    type: "text",
    // Asgari VE azami tutar sinirlarinin disinda bir deger girilirse KABUL
    // ETMIYORUZ (Hayat Standart: 150-299 USD araligi, Premium: sadece asgari
    // 300 USD - ustsinir yok; BES: sadece asgari 5.000 TL) - bkz. yukarida
    // primAsgariBilgisi / primTutariVeMinimumGecerliMi / primMinimumHatasi.
    validate: primTutariVeMinimumGecerliMi,
    validationError: primMinimumHatasi
  },
  // Sadece Hayat'ta soruluyor (BES listesine dahil edilmiyor, asagida
  // SATIS_SORULARI_BES_YENI_IS filtrelemesine bakin). Vefat teminati artik
  // paket/yas/cinsiyet/odeme donemine gore BOTUN KENDISI otomatik hesapliyor
  // (bkz. vefatTeminatiHesapla.js, satisSoruSor icindeki vefat_teminati
  // ozel-durum kontrolu) - bu soru asagidaki metniyle SADECE otomatik
  // hesaplama basarisiz olursa (orn. yas tablo araliginin disindaysa)
  // guvenli bir fallback olarak gosteriliyor.
  {
    id: "vefat_teminati",
    text: (a) =>
      hitapEt(
        a,
        `${sigortaliUnvani(a, true)}nın vefat teminatını paylaşır mısınız? (Bu yaş/ödeme dönemi için otomatik hesaplayamadık, tutarı elle paylaşmanız gerekiyor.)`,
        "Vefat teminatınızı paylaşır mısınız? (Bu yaş/ödeme dönemi için otomatik hesaplayamadık, tutarı elle paylaşmanız gerekiyor.)"
      ),
    type: "text",
    validate: primTutariGecerliMi,
    validationError: "Bu bir tutar gibi görünmüyor, lütfen vefat teminatını rakamla birlikte tekrar yazar mısınız?"
  },
  {
    id: "sigortali_cep",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın cep telefonu numarasını paylaşır mısınız?`, "Cep telefonu numaranızı paylaşır mısınız?"),
    type: "text",
    validate: telefonGecerliMi,
    validationError: "Girilen cep telefonu numarası geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 0555 123 45 67)"
  },
  {
    id: "sigortali_eposta",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın e-posta adresini paylaşır mısınız?`, "E-posta adresinizi paylaşır mısınız?"),
    type: "text",
    validate: epostaGecerliMi,
    validationError: "Girilen e-posta adresi geçerli görünmüyor, lütfen tekrar yazar mısınız?"
  },
  {
    id: "odeyen_cep",
    text: "Ödeyecek kişinin cep telefonu numarasını paylaşır mısınız?",
    type: "text",
    validate: telefonGecerliMi,
    validationError: "Girilen cep telefonu numarası geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 0555 123 45 67)",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  {
    id: "odeyen_eposta",
    text: "Ödeyecek kişinin e-posta adresini paylaşır mısınız?",
    type: "text",
    validate: epostaGecerliMi,
    validationError: "Girilen e-posta adresi geçerli görünmüyor, lütfen tekrar yazar mısınız?",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  // Garanti Emeklilik'in cagri merkezi bu tarih/saat araliginda arayacak -
  // mailin en ustunde bir cumle olarak ozetleniyor (bkz. satisTamamla'daki
  // acilisMetni). Serbest metin yerine artik LISTEDEN SECILIYOR: bugunden
  // baslayan 5 hafta ici gun + sabit saat araliklari (bkz. yukarida
  // aramaTarihiSecenekleri / aramaSaatAraligiSecenekleri).
  {
    id: "arama_tarihi",
    text: (a) => hitapEt(a, `${sigortaliUnvani(a, true)}nın hangi tarihte aranmasını istersiniz?`, "Hangi tarihte aranmak istersiniz?"),
    type: "choice",
    options: aramaTarihiSecenekleri,
    kisaSecenekler: aramaTarihiKisaSecenekleri
  },
  {
    id: "arama_saat_araligi",
    text: (a) => hitapEt(a, "Hangi saat aralığında aranmasını istersiniz?", "Hangi saat aralığında aranmak istersiniz?"),
    type: "choice",
    options: aramaSaatAraligiSecenekleri
  },
  // Belge sorulari: her biri tek bir belgenin FOTOĞRAFINI ister (PDF/döküman
  // değil - kamera ya da galeriden seçilen bir fotoğraf her zaman WhatsApp'ın
  // kendi "fotoğraf ekle" arayüzünden gönderilebiliyor). Her fotoğraf
  // gönderildiğinde Claude görsel analiziyle hem netlik hem de doğru belge
  // olup olmadığı kontrol ediliyor (bkz. belgeAnaliz.js).
  //
  // NOT (24.07.2026 geri bildirimi - "sırayla tek tek göndermek zorunda
  // kalmasın kimse"): bu belgelerin ARTIK sirayla, bot'un her birini teker
  // teker sormasini bekleyerek gonderilmesi gerekmiyor - danisman/musteri
  // hepsini art arda, hatta karisik sirada gonderebilir. Gelen her fotograf,
  // hangi bekleyen belgeye ait oldugu Claude gorsel analiziyle otomatik tespit
  // edilerek kabul ediliyor (bkz. asagida handleAdvisorMessage icindeki
  // belgeFotografiIsle / kalanBelgeSorulariniBul).
  {
    id: "belge_acik_riza",
    type: "tekli_foto_belge",
    kisaAd: "Açık Rıza Beyanı",
    text: (a) =>
      "Şimdi birkaç belgenin fotoğrafını rica edeceğim.\n\n" +
      "📄 İlk olarak, imzalı *Açık Rıza Beyanı'nın (KVKK metni)* fotoğrafını gönderir misiniz? " +
      hitapEt(
        a,
        `(Yukarıda gönderdiğim şablonu ${sigortaliUnvani(a, false)}ya yazdırıp imzalatabilirsiniz)`,
        "(Yukarıda gönderdiğim şablonu yazdırıp imzalayabilirsiniz)"
      ),
    beklenenBelge:
      "İmzalı bir Açık Rıza Beyanı / KVKK aydınlatma-rıza metni. Üzerinde yazılı metin ve belgenin altında " +
      "el yazısıyla atılmış bir imza olmalı.",
    dosyaAdi: "acik_riza_beyani.jpg",
    sablonGonder: true,
    imzaGerekli: true
  },
  // Sadece Hayat'ta isteniyor - BES Yeni İş'te ıslak imza kartı gerekmiyor
  // (bkz. asagida SATIS_SORULARI_BES_YENI_IS filtrelemesi).
  {
    id: "belge_imza_karti",
    type: "tekli_foto_belge",
    kisaAd: "İmza Kartı",
    text: "📄 Şimdi imzalı *İletişim Bilgileri ve Islak İmza Kartı*nın fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "İmzalı bir İletişim Bilgileri ve Islak İmza Kartı formu. Üzerinde iletişim bilgileri (ad, telefon, " +
      "adres vb.) ve el yazısıyla atılmış bir imza olmalı.",
    dosyaAdi: "imza_karti.jpg",
    imzaGerekli: true
  },
  // Sadece Hayat'ta isteniyor - BES Yeni İş'te yerleşim yeri belgesi
  // gerekmiyor (bkz. asagida SATIS_SORULARI_BES_YENI_IS filtrelemesi).
  {
    id: "belge_yerlesim_yeri",
    type: "tekli_foto_belge",
    kisaAd: "Yerleşim Yeri Belgesi",
    text: "📄 Şimdi *yerleşim yeri belgesinin (ikametgah)* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir yerleşim yeri belgesi / ikametgah belgesi. Resmi bir kurum (nüfus müdürlüğü, e-Devlet çıktısı vb.) " +
      "tarafından düzenlenmiş, kişinin güncel adres bilgisini gösteren bir belge olmalı.",
    dosyaAdi: "yerlesim_yeri_belgesi.jpg"
  },
  {
    id: "belge_kimlik_on",
    type: "tekli_foto_belge",
    kisaAd: "Kimlik (Ön Yüz)",
    text: "📄 Şimdi *kimliğin ön yüzünün* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir T.C. kimlik kartının ÖN yüzü - üzerinde fotoğraf, isim, soyisim ve T.C. kimlik numarası bulunan yüz.",
    dosyaAdi: "kimlik_on.jpg"
  },
  {
    id: "belge_kimlik_arka",
    type: "tekli_foto_belge",
    kisaAd: "Kimlik (Arka Yüz)",
    // "Son olarak" sadece gercekten daha fazla belge istenmeyecekse dogru -
    // odeyen farkliysa (sigorta ettirenden de belge istenecek) ya da saglik
    // beyani gerekiyorsa bunun ardindan baska belgeler de gelecek.
    text: (a) =>
      a.odeyen_farkli_mi === "Hayır, Farklı Biri" || tutarSayiyaCevir(a.vefat_teminati) > 500000
        ? "📄 Şimdi *kimliğin arka yüzünün* fotoğrafını gönderir misiniz?"
        : "📄 Son olarak *kimliğin arka yüzünün* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir T.C. kimlik kartının ARKA yüzü - üzerinde seri numarası, doğum yeri/tarihi ve diğer bilgilerin " +
      "bulunduğu yüz.",
    dosyaAdi: "kimlik_arka.jpg"
  },
  // --- Sigorta ettiren (primi/katkı payını ödeyecek kişi) sigortalıdan/
  // katılımcıdan farklıysa, aşağıdaki belgelerin AYNI şekilde sigorta
  // ettirenden de alınması gerekiyor (24.07.2026 geri bildirimi - "sağlık
  // beyanı hariç en sonda istediğimiz evrakları hem sigortalıdan hem de
  // sigorta ettirenden almamız lazım"). Sağlık Beyan Formu bu kuralın DIŞINDA
  // tutuluyor - o sadece sigortalının/katılımcının sağlık durumuyla ilgili
  // olduğu için tekrar istenmiyor.
  {
    id: "belge_acik_riza_odeyen",
    type: "tekli_foto_belge",
    kisaAd: "Sigorta Ettiren - Açık Rıza Beyanı",
    text:
      "Primi ödeyecek kişi sigortalıdan farklı olduğu için aynı belgeleri sigorta ettirenden de alacağız.\n\n" +
      "📄 Öncelikle sigorta ettirenin imzaladığı *Açık Rıza Beyanı'nın (KVKK metni)* fotoğrafını gönderir misiniz? " +
      "(Yukarıda gönderdiğim şablonu sigorta ettirene de yazdırıp imzalatabilirsiniz)",
    beklenenBelge:
      "İmzalı bir Açık Rıza Beyanı / KVKK aydınlatma-rıza metni (sigorta ettiren tarafından imzalanmış). Üzerinde " +
      "yazılı metin ve belgenin altında el yazısıyla atılmış bir imza olmalı.",
    dosyaAdi: "sigorta_ettiren_acik_riza_beyani.jpg",
    sablonGonder: true,
    imzaGerekli: true,
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  // Sadece Hayat'ta isteniyor (bkz. asagida SATIS_SORULARI_BES_YENI_IS filtrelemesi).
  {
    id: "belge_imza_karti_odeyen",
    type: "tekli_foto_belge",
    kisaAd: "Sigorta Ettiren - İmza Kartı",
    text: "📄 Şimdi sigorta ettirenin imzaladığı *İletişim Bilgileri ve Islak İmza Kartı*nın fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "İmzalı bir İletişim Bilgileri ve Islak İmza Kartı formu (sigorta ettiren tarafından imzalanmış). Üzerinde " +
      "iletişim bilgileri (ad, telefon, adres vb.) ve el yazısıyla atılmış bir imza olmalı.",
    dosyaAdi: "sigorta_ettiren_imza_karti.jpg",
    imzaGerekli: true,
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  // Sadece Hayat'ta isteniyor (bkz. asagida SATIS_SORULARI_BES_YENI_IS filtrelemesi).
  {
    id: "belge_yerlesim_yeri_odeyen",
    type: "tekli_foto_belge",
    kisaAd: "Sigorta Ettiren - Yerleşim Yeri Belgesi",
    text: "📄 Şimdi sigorta ettirenin *yerleşim yeri belgesinin (ikametgah)* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir yerleşim yeri belgesi / ikametgah belgesi (sigorta ettiren adına). Resmi bir kurum (nüfus müdürlüğü, " +
      "e-Devlet çıktısı vb.) tarafından düzenlenmiş, kişinin güncel adres bilgisini gösteren bir belge olmalı.",
    dosyaAdi: "sigorta_ettiren_yerlesim_yeri_belgesi.jpg",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  {
    id: "belge_kimlik_on_odeyen",
    type: "tekli_foto_belge",
    kisaAd: "Sigorta Ettiren - Kimlik (Ön Yüz)",
    text: "📄 Şimdi sigorta ettirenin *kimliğinin ön yüzünün* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir T.C. kimlik kartının ÖN yüzü (sigorta ettiren adına) - üzerinde fotoğraf, isim, soyisim ve T.C. kimlik " +
      "numarası bulunan yüz.",
    dosyaAdi: "sigorta_ettiren_kimlik_on.jpg",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  {
    id: "belge_kimlik_arka_odeyen",
    type: "tekli_foto_belge",
    kisaAd: "Sigorta Ettiren - Kimlik (Arka Yüz)",
    // Bu, "sigorta ettiren" blogunun son belgesi - eger ardindan saglik
    // beyani da istenecekse "Son olarak" yerine "Simdi" diyoruz.
    text: (a) =>
      tutarSayiyaCevir(a.vefat_teminati) > 500000
        ? "📄 Şimdi sigorta ettirenin *kimliğinin arka yüzünün* fotoğrafını gönderir misiniz?"
        : "📄 Son olarak sigorta ettirenin *kimliğinin arka yüzünün* fotoğrafını gönderir misiniz?",
    beklenenBelge:
      "Bir T.C. kimlik kartının ARKA yüzü (sigorta ettiren adına) - üzerinde seri numarası, doğum yeri/tarihi ve " +
      "diğer bilgilerin bulunduğu yüz.",
    dosyaAdi: "sigorta_ettiren_kimlik_arka.jpg",
    skipIf: (a) => a.odeyen_farkli_mi !== "Hayır, Farklı Biri"
  },
  // Sadece vefat teminati 500.000 USD'nin UZERINDEYSE isteniyor (Hayat'ta
  // anlamli - BES'te vefat_teminati hic sorulmadigi icin bu soru BES'te
  // otomatik atlanir, ayrica listeden cikarmaya gerek yok). Bos sablon,
  // sablonGonder: "saglikBeyani" ile bu soruya gelindiginde otomatik gonderilir.
  // Sigorta ettiren farkli olsa BILE bu belge SADECE sigortalidan/katilimcidan
  // isteniyor (24.07.2026 geri bildirimi - "sağlık beyanı hariç").
  {
    id: "belge_saglik_beyan",
    type: "tekli_foto_belge",
    kisaAd: "Sağlık Beyan Formu",
    text:
      "📄 Vefat teminatı 500.000 USD üzerinde olduğu için ayrıca doldurulmuş ve imzalanmış " +
      "*Sağlık Beyan Formu*'nun fotoğrafını/taramasını gönderir misiniz?",
    beklenenBelge:
      "Doldurulmuş ve imzalanmış bir Sağlık Beyan Formu. Üzerinde sağlık durumuna dair sorular/cevaplar ve " +
      "altında el yazısıyla atılmış bir imza olmalı.",
    dosyaAdi: "saglik_beyan_formu.jpg",
    sablonGonder: "saglikBeyani",
    imzaGerekli: true,
    skipIf: (a) => !(tutarSayiyaCevir(a.vefat_teminati) > 500000)
  }
];

// BES (Yeni İş) soru listesi, Hayat listesiyle birebir ayni - "paket" ve
// "vefat_teminati" (BES'te yok) haric, ayrica ıslak imza karti ve yerlesim
// yeri belgesi (sigortali VE sigorta ettiren varyantlari) de BES Yeni İş'te
// istenmiyor. Boylece iki liste hep senkron kalir.
const SATIS_SORULARI_BES_YENI_IS = SATIS_SORULARI_HAYAT.filter(
  (soru) =>
    ![
      "paket",
      "vefat_teminati",
      "belge_imza_karti",
      "belge_yerlesim_yeri",
      "belge_imza_karti_odeyen",
      "belge_yerlesim_yeri_odeyen"
    ].includes(soru.id)
);

// --- BES Aktarım'a ozel ekstra belgeler (24.07.2026 geri bildirimi) ---
// Aktarım Talep Formu ve Aktarım Bilgi Formu tek sayfalik normal belgeler;
// Hesap Özeti Cetveli genelde birden fazla (1-3) sayfa oldugu icin ayri bir
// "cok_sayfali_foto_belge" tipiyle tanimlaniyor - danisman/musteri "bitti"/
// "tamam" yazana kadar (ya da 3 sayfaya ulasana kadar) bu belge acik kalir,
// gelen HER fotograf yeni bir sayfa olarak eklenir (bkz. asagida
// belgeFotografiIsle / handleAdvisorMessage'daki "bitti" komutu).
const AKTARIM_TALEP_FORMU_SORUSU = {
  id: "belge_aktarim_talep_formu",
  type: "tekli_foto_belge",
  kisaAd: "Aktarım Talep Formu",
  text: "📄 Şimdi imzalı *Aktarım Talep Formu*'nun fotoğrafını gönderir misiniz?",
  beklenenBelge:
    "İmzalı bir Aktarım Talep Formu - bireysel emeklilik birikiminin başka bir şirkete/plana aktarılması için " +
    "doldurulup imzalanmış resmi bir form.",
  dosyaAdi: "aktarim_talep_formu.jpg",
  imzaGerekli: true
};

const AKTARIM_BILGI_FORMU_SORUSU = {
  id: "belge_aktarim_bilgi_formu",
  type: "tekli_foto_belge",
  kisaAd: "Aktarım Bilgi Formu",
  text: "📄 Şimdi *Aktarım Bilgi Formu*'nun fotoğrafını gönderir misiniz?",
  beklenenBelge:
    "Bir Aktarım Bilgi Formu - bireysel emeklilik aktarım işlemiyle ilgili bilgilendirme içeriği taşıyan resmi " +
    "bir form/belge.",
  dosyaAdi: "aktarim_bilgi_formu.jpg"
};

const HESAP_OZETI_CETVELI_SORUSU = {
  id: "belge_hesap_ozeti_cetveli",
  type: "cok_sayfali_foto_belge",
  kisaAd: "Hesap Özeti Cetveli",
  text:
    "📄 Şimdi mevcut kurumunuzdan alınan *Hesap Özeti Cetveli*'nin fotoğraflarını gönderir misiniz? Bu belge " +
    "genelde birden fazla sayfa olur - tüm sayfaları art arda gönderebilirsiniz, hepsini gönderdiğinizde " +
    '"bitti" yazmanız yeterli.',
  beklenenBelge:
    "Bir Hesap Özeti Cetveli - bireysel emeklilik hesabının güncel durumunu/bakiyesini gösteren, ilgili kurumdan " +
    "alınmış resmi bir doküman/çizelge (birden fazla sayfadan oluşabilir).",
  // Dikkat: burada dosya UZANTISI YOK - her sayfa kabul edildiğinde
  // "hesap_ozeti_cetveli_1.jpg", "hesap_ozeti_cetveli_2.jpg" gibi numaralı bir
  // ad uretiliyor (bkz. belgeFotografiIsle).
  dosyaAdi: "hesap_ozeti_cetveli",
  minSayfa: 1,
  maksSayfa: 3
};

// BES Aktarım soru listesi - BES Yeni İş ile ayni temeli paylasir (odeyen
// farkliysa acik riza + kimlik on/arka sigorta ettirenden de istenir, ayni
// sekilde), ustune Aktarım'a ozel 3 ekstra belge eklenir. Bu belgeler,
// "belge_saglik_beyan"dan HEMEN ONCE ekleniyor (saglik beyani BES'te zaten
// hicbir zaman tetiklenmiyor - vefat_teminati BES'te hic sorulmuyor - ama
// yine de listenin en sonunda kalsin diye).
const SATIS_SORULARI_BES_AKTARIM = (() => {
  const temel = SATIS_SORULARI_BES_YENI_IS.slice();
  const saglikBeyanIndex = temel.findIndex((soru) => soru.id === "belge_saglik_beyan");
  const eklenecekler = [AKTARIM_TALEP_FORMU_SORUSU, HESAP_OZETI_CETVELI_SORUSU, AKTARIM_BILGI_FORMU_SORUSU];
  const eklemeNoktasi = saglikBeyanIndex >= 0 ? saglikBeyanIndex : temel.length;
  temel.splice(eklemeNoktasi, 0, ...eklenecekler);
  return temel;
})();

// Danisman listesi tum urunlerde ayni referansi paylasir (flows.js'deki
// DANISMANLAR sabiti), o yuzden herhangi bir urunden okuyabiliriz.
const DANISMANLAR = flows.dask.advisors;

function danismaniBul(numara) {
  return DANISMANLAR.find((d) => d.number === numara) || null;
}

function isDanisman(numara) {
  return !!danismaniBul(numara);
}

// 26.07.2026 eklendi: "bahadır veya enbel veya herhangi bir danışman bekleyen
// işe bir not ekleyebilsin" talebi icin - Bahadır ve Enbel'in numaralari
// "yonetici" sayilir: "Bekleyen İş" menusunden SADECE kendi degil, TUM
// danismanlarin acik islerini gorup (ve dolayisiyla not ekleyebilir), bkz.
// asagidaki anaMenuGoster. Diger danismanlar (Seda, Fırat, ve numarasi henuz
// bizde olmayanlar) hala SADECE kendi acik islerini gorur/not ekler - zaten
// gunluk 09.30 ozetinde de sadece kendi isleri onlara gidiyor (bkz. server.js).
const YONETICI_NUMARALARI = DANISMANLAR.filter((d) => d.name === "Enbel" || d.name === "Bahadır").map(
  (d) => d.number
);

// --- Turkce karakter toleransli secenek eslestirme (conversationEngine.js'deki
// ile ayni mantik, kucuk oldugu icin burada ayrica tanimlandi) ---
function normalizeTr(str) {
  return (str || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function matchOption(userText, options) {
  const normalized = normalizeTr((userText || "").trim());
  if (!normalized) return null;
  const exact = options.find((opt) => normalizeTr(opt) === normalized);
  if (exact) return exact;
  return (
    options.find((opt) => normalized.includes(normalizeTr(opt)) || normalizeTr(opt).includes(normalized)) || null
  );
}

// GG.AA.YYYY SS:DD formatinda bir tarih-saat metnini gecerliyse zaman
// damgasina (ms) cevirir, degilse null doner.
//
// ONEMLI (20.07.2026 tarihli hatirlatma gecikmesi/kaybi vakasi): bu fonksiyon
// eskiden "new Date(yil, ay-1, gun, saat, dakika)" kullaniyordu - bu, girilen
// saati SUNUCUNUN calistigi process'in yerel saat dilimine gore yorumluyordu.
// Railway'deki (ve genel olarak konfigure edilmemis Node) container'lar
// varsayilan olarak UTC calisir, TZ ortam degiskeni tanimli degilse Turkiye
// saatiyle (UTC+3) hicbir ilgisi olmuyor. Sonuc: bir danisman "14:00" yazip
// Turkiye saatiyle 14:00'u kastettiginde, sunucu bunu 14:00 UTC olarak
// kaydediyordu - yani gercekte Turkiye saatiyle 17:00'da (3 saat GEC)
// tetikleniyordu. Bunu, sunucunun yerel saat dilimine HIC BAGIMLI OLMAYAN bir
// hesaplamayla duzeltiyoruz: Turkiye 2016'dan beri yaz saati uygulamiyor,
// HER ZAMAN sabit UTC+3 - o yuzden Date.UTC (her zaman UTC'yi varsayan, sunucu
// saat dilimine gore DEGISMEYEN bir fonksiyon) ile hesaplayip TURKIYE_UTC_FARKI_MS
// kadar geriye kaydırmak, sunucu nerede/hangi saat diliminde calisirsa
// calissin HER ZAMAN dogru sonucu verir.
const TARIH_SAAT_REGEX = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
const TURKIYE_UTC_FARKI_MS = 3 * 60 * 60 * 1000; // Turkiye = UTC+3 (sabit, yaz saati yok)

function tarihSaatDogrula(metin) {
  const eslesme = TARIH_SAAT_REGEX.exec((metin || "").trim());
  if (!eslesme) return null;
  const gun = parseInt(eslesme[1], 10);
  const ay = parseInt(eslesme[2], 10);
  const yil = parseInt(eslesme[3], 10);
  const saat = parseInt(eslesme[4], 10);
  const dakika = parseInt(eslesme[5], 10);
  // Once, girilen degerlerin GERCEK bir tarihe karsilik gelip gelmedigini
  // (orn. 31.02.YYYY gibi olmayan bir tarihi reddetmek icin) UTC bazli
  // (sunucu saat dilimine bagli olmayan) bir round-trip ile kontrol ediyoruz.
  const sanki_UTC = Date.UTC(yil, ay - 1, gun, saat, dakika);
  const kontrol = new Date(sanki_UTC);
  const gecerliMi =
    kontrol.getUTCFullYear() === yil &&
    kontrol.getUTCMonth() === ay - 1 &&
    kontrol.getUTCDate() === gun &&
    kontrol.getUTCHours() === saat &&
    kontrol.getUTCMinutes() === dakika;
  if (!gecerliMi) return null;
  // Girilen saat Turkiye yerel saatidir - gercek UTC zaman damgasini elde
  // etmek icin 3 saat GERIYE aliyoruz (Turkiye = UTC + 3).
  return sanki_UTC - TURKIYE_UTC_FARKI_MS;
}

// Bir Unix ms zaman damgasini, SUNUCUNUN calistigi saat dilimi ne olursa
// olsun HER ZAMAN Turkiye yerel saatiyle bicimlendirir ("tr-TR" locale'i
// SADECE sayi/ay adi formatini belirler, saat dilimini DEGIL - saat dilimini
// ayrica "timeZone: 'Europe/Istanbul'" ile sabitlemek gerekiyor, aksi halde
// sunucu UTC'de calisiyorsa gosterilen saat 3 saat GERIDE gorunur). Ayni
// hatirlatma-gecikmesi vakasinin (bkz. tarihSaatDogrula yorumu) bir baska
// yuzu - bu duzeltme olmadan, dogru hesaplanan bir hatirlatma zamani bile
// danismana YANLIS saatte goruntuleniyor olabilirdi.
function turkiyeSaatiniFormatla(ms, secenekler) {
  return new Date(ms).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", ...(secenekler || {}) });
}

// --- Karsilama (ana giris noktasi) ---
const ANA_MENU_SECENEKLERI = [
  "Elementer Teklif Al",
  "BES Hayat Başvurusu",
  "Bekleyen İş",
  "Destek Talebi Oluştur",
  "Yaklaşan Yenilemeler",
  "Yenileme Takibi Ekle",
  "BES Fonları",
  "Doküman Merkezi",
  "SSS",
  "Performansım"
];

// Ana menude hicbir secenekle eslesmeyen, ama "hayır", "yok", "teşekkürler"
// gibi bir kapanis/red ifadesi iceren kisa cevaplari yakalar (orn. "hayır yok
// teşekkürler", "yok teşekkürler", "hayır teşekkürler", "teşekkürler").
const KARSILAMA_KAPANIS_REGEX = /\b(hay[ıi]r|yok|te[şs]ekk[üu]r)/i;

async function karsilamaGoster(from, session) {
  const danisman = danismaniBul(from);
  // 28.07.2026 eklendi: isimden sonra "Bey"/"Hanım" hitabi (kullanicinin talebi).
  const hitapliIsim = danisman ? flows.danismanHitapliIsim(danisman.name) : "";
  session.state = "DANISMAN_KARSILAMA";
  await sendList(
    from,
    `${gunSelamlamasi()} ${hitapliIsim}! 👋 Umarım gününüz güzel geçiyordur. WE Sigorta danışman asistanınız hazır — size bugün nasıl yardımcı olabilirim?`,
    "Seçin",
    ANA_MENU_SECENEKLERI
  );
}

// karsilamaGoster ile ayni menuyu gosterir, ama "Merhaba" selamlamasi olmadan -
// danisman bir islemi (satis kaydi, destek talebi, not/hatirlatma vb.) yeni
// tamamladiginda, hemen ardindan "Merhaba, gununuz nasil gidiyor" demek
// sanki bastan basliyormus gibi garip kaciyordu. Bu yuzden bir sonuc/bilgi
// mesaji gosterildikten SONRA ana menuye donerken karsilamaGoster yerine bu
// fonksiyon kullaniliyor; gercek bir "merhaba" tetikleyicisinden (bkz. asagida
// selamlasma regex'i) ya da bilinmeyen bir oturum durumundan (default case)
// donuste ise hala karsilamaGoster (tam selamlama) kullaniliyor.
async function devamMenuGoster(from, session) {
  session.state = "DANISMAN_KARSILAMA";
  await sendList(from, "Senin için yapabileceğim başka bir şey var mı? 😊", "Seçin", ANA_MENU_SECENEKLERI);
}

// --- Istenildigi an urun bazinda PDF form/dokuman gonderme ---
async function formUrunSec(from, session) {
  session.state = "DANISMAN_FORM_URUN_SEC";
  const urunAnahtarlari = Object.keys(flows);
  session.danismanFormUrunAnahtarlari = urunAnahtarlari;
  const etiketler = urunAnahtarlari.map((k) => flows[k].menuLabel || flows[k].label);
  await sendList(from, "Hangi ürünün formunu/dokümanını almak istersiniz?", "Ürün Seç", etiketler);
}

// --- Mevcut talepleri listeleme/yonetme ---
async function anaMenuGoster(from, session) {
  const danisman = danismaniBul(from);
  const yoneticiMi = YONETICI_NUMARALARI.includes(from);
  // Yonetici (Bahadır/Enbel) icin TUM ekibin acik isleri, digerleri icin
  // sadece kendi acik isleri (bkz. yukaridaki YONETICI_NUMARALARI yorumu).
  const tumAcikLeadler = leadStore
    .tumLeadleriGetir()
    .filter((l) => (yoneticiMi ? true : l.danismanNumarasi === from) && l.durum === "Açık");

  if (tumAcikLeadler.length === 0) {
    session.state = "DANISMAN_LEAD_SECIMI";
    session.danismanLeadListesi = [];
    await sendText(
      from,
      yoneticiMi
        ? `Şu an ekipte açık bir iş yok. 🎉`
        : `Şu an açık bir talebiniz yok. 🎉 Yeni bir talep oluşturmak isterseniz "evet" yazabilirsiniz.`
    );
    return;
  }

  // WhatsApp interaktif listesi en fazla 10 satir destekliyor. Yonetici
  // gorunumunde TUM ekibin isleri bir arada gorunebilecegi icin, en uzun
  // suredir acik (en "gecikmis") 10 tanesi gosterilir - geri kalani icin
  // panel her zaman TAM listeyi (kisitlamasiz) gosterir.
  const siraliLeadler = yoneticiMi
    ? [...tumAcikLeadler].sort((a, b) => a.olusturulmaZamani - b.olusturulmaZamani)
    : tumAcikLeadler;
  const acikLeadler = siraliLeadler.slice(0, 10);

  session.state = "DANISMAN_LEAD_SECIMI";
  session.danismanLeadListesi = acikLeadler.map((l) => l.id);

  // Durum artik tek ("Açık"), o yuzden ikon olarak durum yerine hatirlatma
  // kurulu olup olmadigini gosteriyoruz - danisman icin daha faydali bir
  // sinyal (hangi musteride ne zaman tekrar aranmasi gerektigini hatirlatir).
  // Yonetici gorunumunde ayrica hangi danismana ait oldugu da eklenir.
  const satirlar = acikLeadler.map((l) => {
    const ikon = l.hatirlatma ? "⏰" : "⚪";
    const danismanEtiketi = yoneticiMi && l.danismanAdi ? ` - ${l.danismanAdi}` : "";
    return `${ikon} ${l.musteriAdi || l.telefon} (${l.urun})${danismanEtiketi}`;
  });

  const baslikMetni =
    yoneticiMi && tumAcikLeadler.length > 10
      ? `Ekipte toplam ${tumAcikLeadler.length} açık iş var, en uzun süredir bekleyen 10 tanesi aşağıda (tamamı için panele bakabilirsiniz). Detay görmek istediğinizi seçin:`
      : `Açık talepleriniz aşağıda, detay görmek istediğinizi seçin:`;

  await sendList(from, baslikMetni, "Talep Seç", satirlar);
}

async function leadDetayGoster(from, session, lead) {
  session.state = "DANISMAN_LEAD_DETAY";
  session.danismanSeciliLeadId = lead.id;

  const notlarMetni = lead.notlar.length
    ? "\n\n📝 Notlar:\n" + lead.notlar.map((n) => `- ${n.metin}`).join("\n")
    : "";
  const hatirlatmaMetni = lead.hatirlatma
    ? `\n\n⏰ Hatırlatma: ${turkiyeSaatiniFormatla(lead.hatirlatma.zaman)}${
        lead.hatirlatma.not ? " - " + lead.hatirlatma.not : ""
      }${lead.hatirlatma.basarisiz ? "\n⚠️ Bu hatırlatma WhatsApp üzerinden gönderilemedi, müşteriyi elle kontrol edin." : ""}`
    : "";

  // Yonetici (Bahadır/Enbel) kendi isi olmayan bir talebe bakiyorsa, hangi
  // danismana ait oldugunu burada da gorsun (liste satirinda zaten vardi,
  // detayda da tekrar gorunmesi karisikligi onler).
  const danismanSatiri =
    YONETICI_NUMARALARI.includes(from) && lead.danismanNumarasi !== from && lead.danismanAdi
      ? `👨‍💼 Danışman: ${lead.danismanAdi}\n`
      : "";

  const detay =
    `👤 ${lead.musteriAdi || lead.telefon}\n` +
    `📦 ${lead.urun}\n` +
    `📞 ${lead.telefon}\n` +
    danismanSatiri +
    `📊 Durum: ${lead.durum}\n\n` +
    `${lead.ozet || ""}` +
    notlarMetni +
    hatirlatmaMetni;

  await sendText(from, detay);
  // 29.07.2026 eklendi: "🚫 Numarayı Engelle" secenegi eklenince 4 secenege
  // cikti - WhatsApp'in interaktif DUGME (button_reply) tipi en fazla 3
  // secenek destekliyor, bu yuzden sendButtons yerine sendList'e (interaktif
  // LISTE, 10 satira kadar destekler) gecildi.
  await sendList(from, "Ne yapmak istersiniz?", "Seçin", [
    "Not Ekle",
    "Durum Değiştir",
    "Hatırlatma Kur",
    "🚫 Numarayı Engelle"
  ]);
}

// --- Musteri (sigortali) adina yeni talep olusturma akisi ---

// Bir sorular listesinden, danisman modunda gosterilmeyecek (danismandaGizle)
// ya da skipIf ile atlanmasi gereken sorulari atlayip bir sonraki gecerli
// index'i bulur.
// 28.07.2026: "already answered" kontrolu eklendi (conversationEngine.js'deki
// nextValidIndex ile AYNI mantik) - Trafik/Kasko'nun proforma/ruhsat OCR'i
// (bkz. handleAdvisorMessage'daki media isleyici), marka/model/motor_no/
// sasi_no/plaka/tc_kimlik gibi bazi alanlari, o alanlarin KENDI "fallback"
// sorusuna (orn. MARKA_FALLBACK_SORU) hic gelinmeden ONCEDEN dolduruyor - bu
// kontrol olmadan, zaten OCR'dan dolu bir alan icin fallback sorusu YINE DE
// sorulurdu (skipIf tanimli olmadigi icin). "geri al" (oncekiGecerliIndex)
// icin BU KONTROL BILEREK eklenmedi - geriye giderken zaten cevaplanmis
// TUM onceki sorular dogal olarak "answered" olur, bu kontrol eklenseydi geri
// al hicbir zaman bir onceki soruyu bulamazdi.
function sonrakiGecerliIndex(sorular, answers, baslangic) {
  let idx = baslangic;
  while (idx < sorular.length) {
    const soru = sorular[idx];
    const atlanmali = soru.danismandaGizle || (soru.skipIf && soru.skipIf(answers));
    const zatenCevaplanmis = Object.prototype.hasOwnProperty.call(answers, soru.id) && answers[soru.id];
    if (atlanmali || zatenCevaplanmis) {
      idx += 1;
      continue;
    }
    break;
  }
  return idx;
}

// sonrakiGecerliIndex'in tersi - "geri al" komutu icin, gecerli sorudan
// GERIYE dogru ilk atlanmayan (skipIf/danismandaGizle olmayan) soruyu bulur.
// Basa kadar hicbir gecerli soru yoksa (yani ilk soruda "geri al" denirse)
// -1 doner.
function oncekiGecerliIndex(sorular, answers, baslangic) {
  let idx = baslangic;
  while (idx >= 0) {
    const soru = sorular[idx];
    if (soru.danismandaGizle || (soru.skipIf && soru.skipIf(answers))) {
      idx -= 1;
      continue;
    }
    break;
  }
  return idx;
}

const GERI_AL_REGEX = /^\s*geri\s*al\s*[!.]?\s*$/i;

// Cok sayfali bir belgenin (orn. Hesap Ozeti Cetveli) sayfalarinin bittigini
// bildirmek icin kullanilan komut - "bitti" ya da "tamam" yazip gonderince
// o an acik olan cok sayfali belge tamamlanmis sayilir (bkz.
// devamEdenCokSayfaliBelgeyiBul, belgeTamamlandiMesajiGonderVeDevamEt).
const BELGE_BITTI_REGEX = /^\s*(bitti|tamam)\s*[!.]?\s*$/i;

// "choice" tipi bir satis sorusuna gelen cevabi, o sorunun tam/kanonik
// degerlerinden (soru.options) birine cozer. Soruda kisaSecenekler
// tanimliysa (WhatsApp'in 20 karakter dugme sinirini asan uzun degerler
// icin - orn. "Garanti Bankası Hesabı") once kisa etiketlere karsi
// eslestirip, eslesen index uzerinden tam degeri (options[index]) donduruyoruz
// - boylece dugmede kisa metin gorunse de kaydedilen/mail'e giden deger hep
// tam metin oluyor.
// soru.options/soru.kisaSecenekler sabit bir dizi OLABILECEGI gibi (answers)
// alan bir FONKSIYON da olabilir (orn. arama_tarihi/arama_saat_araligi -
// secenekler her seferinde dinamik uretiliyor). Bu yardimci ikisini de tek
// bicimde (her zaman dizi) dondurur.
function secenekleriCoz(secenekler, answers) {
  if (typeof secenekler === "function") return secenekler(answers);
  return secenekler;
}

function secilenSecenegiCoz(userText, soru, answers) {
  const options = secenekleriCoz(soru.options, answers);
  const kisaSecenekler = secenekleriCoz(soru.kisaSecenekler, answers);
  if (kisaSecenekler) {
    const kisaEslesen = matchOption(userText, kisaSecenekler);
    if (kisaEslesen) {
      const idx = kisaSecenekler.indexOf(kisaEslesen);
      return options[idx];
    }
  }
  return matchOption(userText, options);
}

// Satis kaydi (Hayat / BES Yeni İş / ileride Aktarım) tamamlanmadan once son
// bir guvenlik kontrolu: atlanmayan (skipIf/danismandaGizle olmayan) HER
// sorunun gercekten cevaplanmis oldugundan emin oluyoruz. Normalde akis zaten
// bir soruyu cevaplanmadan atlamiyor, ama bu fonksiyon; ileride Aktarım gibi
// yeni bir soru listesi eklendiginde de otomatik olarak ayni korumayi
// sagliyor - urun tipine gore ayri ayri kontrol yazmaya gerek kalmiyor.
// ("tekli_foto_belge" tipi sorularin cevabi answers'da degil, ayrica
// session.satisBelgeler'de tutuluyor - o yuzden burada kontrol edilmiyor,
// belgeler satisTamamla'da ayrica kontrol ediliyor.)
function eksikBilgiVarMi(sorular, answers) {
  return sorular.some((soru) => {
    if (soru.type === "tekli_foto_belge" || soru.type === "cok_sayfali_foto_belge") return false;
    if (soru.danismandaGizle || (soru.skipIf && soru.skipIf(answers))) return false;
    const cevap = answers[soru.id];
    return cevap === undefined || cevap === null || (typeof cevap === "string" && cevap.trim() === "");
  });
}

// --- Satis kaydi akisi (Prim Iadeli Hayat Sigortasi) ---
// "BES Hayat Satış" ilk once hangi urun oldugunu soruyor (Hayat/BES), BES
// secilirse ayrica Yeni İş mi Aktarım mi oldugunu soruyor - Aktarım henuz
// desteklenmedigi icin secilirse bir "yakinda" mesaji gosterip ana menuye
// donuluyor.
// NOT: WhatsApp dugme basliklarini 20 karakterle sinirliyor, o yuzden burada
// kisa etiketler ("Hayat Sigortası" / "BES") kullaniyoruz - tam urun adi
// ("Prim İadeli Hayat Sigortası" / "Bireysel Emeklilik Sistemi (BES)")
// mail'e giderken ayri bir yerden (satisTamamla'daki urunAdiTam,
// session.satisUrunTipi bayragindan kuruluyor) geldigi icin bu kisaltma
// mail iceriğini etkilemiyor.
const SATIS_URUN_SECENEKLERI = ["Hayat Sigortası", "BES"];

async function satisBaslat(from, session) {
  session.state = "DANISMAN_SATIS_URUN_SEC";
  await sendButtons(from, "Hangi ürün için satış kaydı oluşturuyorsunuz?", SATIS_URUN_SECENEKLERI);
}

function satisAkisiBaslat(from, session, urunTipi, sorular, musteriKendiKendineMi) {
  session.satisUrunTipi = urunTipi; // "hayat" | "bes_yeni_is"
  session.satisSorular = sorular;
  // _urunTipi, cevaplar nesnesinin icine de yaziliyor (normal bir soru
  // cevabi degil, "_" ile basliyor) - boylece soru metni/secenek/asgari-tutar
  // fonksiyonlari (sadece answers parametresi alan) urun tipine gore dogru
  // metni ("sigortalı" ya da "katılımcı" vb.) uretebiliyor. eksikBilgiVarMi
  // ve ozetSatirlari bu alani soru id'siyle eslesmedigi icin yoksayar.
  // _musteriKendiKendine ayni mantikla - musterinin KENDISININ, bir danisman
  // araya girmeden, kendi satis talebini olusturdugu akis icin true olur
  // (bkz. musteriSatisBaslat) - soru metinleri buna gore 2. sahsa ("sizin",
  // "paylaşır mısınız?") donusuyor, tamamlanma mesaji ve bildirim akisi da
  // farklilasiyor (bkz. satisTamamla).
  session.satisAnswers = { _urunTipi: urunTipi, _musteriKendiKendine: !!musteriKendiKendineMi };
  // Musteri kendi kendine basvuruyorsa, adini/soyadini konusmanin en basinda
  // (ASK_NAME asamasinda) zaten sormustuk - session.name GECERLI bir ad-soyad
  // formatindaysa (musteri_ad_soyad sorusuyla AYNI kural: en az 2 kelime,
  // bkz. adSoyadGecerliMi) burada onceden dolduruyoruz; asagidaki
  // sonrakiGecerliIndex cagrisi bu durumda musteri_ad_soyad sorusunu
  // (skipIf sayesinde) otomatik atlar. Musteri ASK_NAME'e tek kelimelik bir
  // isim yazmissa (orn. sadece "Ahmet") pre-fill YAPILMIYOR - o zaman soru
  // normal sekilde tekrar sorulur, boylece gecerlilik kontrolu atlanmis
  // olmuyor.
  if (musteriKendiKendineMi && session.name && adSoyadGecerliMi(session.name)) {
    session.satisAnswers.musteri_ad_soyad = session.name;
  }
  session.satisBelgeler = [];
  // Hangi belge sorularinin (id'lerinin) kabul edildigini tutar - belgeler
  // artik sirayla degil, KARISIK/TOPLU sirada da gonderilebildigi icin
  // "hangi index'e kadar geldik" yerine "hangi id'ler tamamlandi" takip
  // ediyoruz (bkz. kalanBelgeSorulariniBul / belgeFotografiIsle).
  session.satisBelgeTamamlanan = [];
  session.satisSoruIndex = sonrakiGecerliIndex(sorular, session.satisAnswers, 0);
  session.state = musteriKendiKendineMi ? "MUSTERI_SATIS_SORU" : "DANISMAN_SATIS_SORU";
  return satisSoruSor(from, session);
}

// Musterinin (danisman araya girmeden) kendi satis talebini baslatmasi icin
// disariya (conversationEngine.js -> startProductFlow) acilan giris noktasi.
// urunTipi: "hayat" | "bes_yeni_is".
async function musteriSatisBaslat(from, session, urunTipi) {
  const sorular = urunTipi === "bes_yeni_is" ? SATIS_SORULARI_BES_YENI_IS : SATIS_SORULARI_HAYAT;
  await satisAkisiBaslat(from, session, urunTipi, sorular, true);
}

// Musteri satis talebi akisinin ortasindayken "menü"/"iptal"/"merhaba" gibi
// bir sey yazarsa (bkz. handleAdvisorMessage'daki global kisayol) - danisman
// panelindeki ana menuyu ASLA gostermiyoruz (o panel musteriyi ilgilendirmez),
// bunun yerine talebi iptal edip musteriyi normal musteri akisina (conversationEngine)
// geri birakiyoruz.
async function musteriSatisIptalEt(from, session) {
  resetSession(from);
  await sendText(
    from,
    "Satış talebiniz iptal edildi 🙏 Yeniden başlamak isterseniz \"merhaba\" yazmanız yeterli."
  );
}

async function satisSoruSor(from, session) {
  const soru = session.satisSorular[session.satisSoruIndex];

  // vefat_teminati sorusuna gelindiginde, once musteriye/danismana SORMADAN
  // otomatik hesaplamayi deniyoruz (bkz. vefatTeminatiHesapla.js). Bu noktada
  // paket/sigortali_dogum_tarihi/sigortali_cinsiyet/odeme_donemi/prim_tutari
  // sorularinin hepsi zaten cevaplanmis oluyor (SATIS_SORULARI_HAYAT'taki
  // sira geregi). Hesaplama basarili olursa: sonucu dogrudan
  // session.satisAnswers.vefat_teminati'ye yaziyoruz, bilgilendirme mesaji
  // gonderiyoruz ve bu soruyu HIC gostermeden bir sonraki gecerli soruya
  // geciyoruz. Basarisiz olursa (orn. yas 0-85 tablo araliginin disinda)
  // asagidaki normal soru-gosterme akisina SESSIZCE dusuyoruz - musteri/
  // danisman eskisi gibi tutari elle girer, satis akisi hic etkilenmez.
  // "!session.satisAnswers.vefat_teminati" kontrolu, bu soruya "geri al" ile
  // donulup deger silindiginde tekrar hesaplanmasini, ama zaten (herhangi bir
  // sebeple) bir deger varsa tekrar hesaplanip ustune yazilmamasini saglar.
  if (soru.id === "vefat_teminati" && !session.satisAnswers.vefat_teminati) {
    const primSayi = tutarSayiyaCevir(session.satisAnswers.prim_tutari);
    const sonuc = vefatTeminatiHesapla({
      paket: session.satisAnswers.paket,
      cinsiyet: session.satisAnswers.sigortali_cinsiyet,
      odemeDonemi: session.satisAnswers.odeme_donemi,
      dogumTarihi: session.satisAnswers.sigortali_dogum_tarihi,
      primSayi
    });
    if (sonuc.basarili) {
      session.satisAnswers.vefat_teminati = sonuc.teminatMetin;
      await sendText(
        from,
        hitapEt(
          session.satisAnswers,
          `${sigortaliUnvani(session.satisAnswers, true)}nın ödeyeceği prime göre vefat teminatını otomatik hesapladık: *${sonuc.teminatMetin}* ✅`,
          `Ödeyeceğiniz prime göre vefat teminatınızı otomatik hesapladık: *${sonuc.teminatMetin}* ✅`
        )
      );
      session.satisSoruIndex = sonrakiGecerliIndex(
        session.satisSorular,
        session.satisAnswers,
        session.satisSoruIndex + 1
      );
      if (session.satisSoruIndex >= session.satisSorular.length) {
        await satisTamamla(from, session);
      } else {
        await satisSoruSor(from, session);
      }
      return;
    }
    console.warn(`Vefat teminati otomatik hesaplanamadi (${sonuc.sebep}), soru elle sorulacak.`);
  }

  // BES Aktarım'da odeme araci olarak "Manuel" secildiyse, katki payi
  // sorusunu HIC SORMADAN otomatik olarak asgari tutar olan "TL 150,00"
  // olarak kaydedip bir sonraki soruya geciyoruz (24.07.2026 geri bildirimi -
  // "manuel seçildiğinde katkı payı otomatik olarak 150 olarak belirlenir").
  // vefat_teminati'nin otomatik hesaplama deseniyle birebir ayni mantik.
  if (soru.id === "prim_tutari" && session.satisAnswers.odeme_araci === "Manuel" && !session.satisAnswers.prim_tutari) {
    session.satisAnswers.prim_tutari = "TL 150,00";
    await sendText(
      from,
      "Ödeme aracı olarak *Manuel* seçildiği için katkı payını otomatik olarak *TL 150,00* olarak kaydettik ✅"
    );
    session.satisSoruIndex = sonrakiGecerliIndex(session.satisSorular, session.satisAnswers, session.satisSoruIndex + 1);
    if (session.satisSoruIndex >= session.satisSorular.length) {
      await satisTamamla(from, session);
    } else {
      await satisSoruSor(from, session);
    }
    return;
  }

  // Belgeler adimina ilk gelindiginde, danismanin sigortaliya/katilimciya
  // yazdirip imzalatmasi icin Garanti'nin bos sablon formlarini once
  // gonderiyoruz. sablonGonder === true -> acik riza + (Hayat'ta) imza karti,
  // sablonGonder === "saglikBeyani" -> Saglik Beyan Formu (vefat teminati
  // 500.000 USD ustunde oldugunda tetiklenen ek belge sorusu).
  if (soru.sablonGonder === true) {
    await sabitSablonlariGonder(from, session.satisAnswers._urunTipi);
  } else if (soru.sablonGonder === "saglikBeyani") {
    await saglikBeyanSablonuGonder(from);
  }

  let metin = typeof soru.text === "function" ? soru.text(session.satisAnswers) : soru.text;

  // Belge asamasinin en basinda (belge_acik_riza), o an gecerli olan (paket/
  // odeyen_farkli_mi/vefat_teminati'ne gore skipIf'leri cozulmus) TAM belge
  // listesini ONCEDEN gosteriyoruz - boylece danisman/musteri hangi
  // belgelerin isteneceğini bastan bilir ve hepsini istediği sırada, hatta
  // hepsini art arda gönderebilir (bkz. 24.07.2026 geri bildirimi - "sırayla
  // tek tek göndermek zorunda kalmasın kimse").
  if (soru.id === "belge_acik_riza") {
    const tumBelgeler = kalanBelgeSorulariniBul(session);
    const liste = tumBelgeler.map((s) => `• ${belgeKisaEtiket(s)}`).join("\n");
    metin =
      `${metin}\n\n📋 İstenen belgeler:\n${liste}\n\n` +
      "Bu belgelerin fotoğraflarını istediğiniz sırayla, hatta hepsini art arda (benim cevabımı beklemeden) tek seferde de gönderebilirsiniz - her birini tanıyıp otomatik olarak işleyeceğim.";
  }

  if (soru.type === "choice") {
    // kisaSecenekler varsa (bkz. odeme_araci) butonda/liste'de o gosterilir -
    // kaydedilen deger yine soru.options'taki tam metin olur (bkz. asagida
    // DANISMAN_SATIS_SORU case'indeki cozumleme).
    const options = secenekleriCoz(soru.options, session.satisAnswers);
    const kisaSecenekler = secenekleriCoz(soru.kisaSecenekler, session.satisAnswers);
    const gosterilecekler = kisaSecenekler || options;
    if (gosterilecekler.length > 3) await sendList(from, metin, "Seçin", gosterilecekler);
    else await sendButtons(from, metin, gosterilecekler);
  } else {
    await sendText(from, metin);
  }
}

// Satis basariyla Garanti Emeklilik'e iletildikten sonra, MUSTERININ kendi
// cep telefonuna dogrudan WhatsApp'tan bir bilgilendirme mesaji gonderir -
// hem BES hem Hayat satislarinda gecerli (satisTamamla ikisi tarafindan da
// paylasiliyor). Musteri bu WhatsApp numarasina hic yazmamis oluyor (bu
// numarayla konusan danismandir, musteri degil) - bu yuzden mesaj normal
// sendText ile ATILAMAZ: Meta, 24 saatlik musteri hizmeti penceresi disinda
// (isletme tarafindan baslatilan) mesajlarin SADECE onceden onaylanmis bir
// SABLON (template) ile gonderilmesine izin veriyor. Bu yuzden
// MUSTERI_BASVURU_TEMPLATE_NAME ortam degiskeninde, Meta tarafindan
// onaylanmis bir sablon adi bekleniyor - tanimli degilse (henuz sablon
// olusturulmadi/onaylanmadiysa) bu bildirim sessizce atlanir, satis akisi
// bundan etkilenmez.
async function musteriyeSatisBildirimiGonder(a, urunAdiTam) {
  const sablonAdi = process.env.MUSTERI_BASVURU_TEMPLATE_NAME;
  if (!sablonAdi) {
    console.warn(
      "MUSTERI_BASVURU_TEMPLATE_NAME tanimli degil - musteriye satis bilgilendirme mesaji gonderilemedi."
    );
    return;
  }
  if (!a.sigortali_cep) return;

  const numara = telefonUluslararasiFormata(a.sigortali_cep);
  // Sablon POZISYONEL ({{1}}, {{2}}, {{3}}, {{4}}) degiskenlerle olusturuldu
  // (bkz. server.js musteri-bilgilendirme-sablonu-olustur route'undaki NOT -
  // isimli degisken formati Meta tarafindan pespese INVALID_FORMAT ile
  // reddedildi). Bu yuzden burada da SIRALI bir dizi gonderiyoruz - sira
  // sablondaki {{1}}..{{4}} ile BIREBIR ayni olmak zorunda: musteri_adi,
  // urun_adi, arama_tarihi, arama_saat_araligi.
  const degerler = [a.musteri_ad_soyad, urunAdiTam, tarihiGunAyOlarakYaz(a.arama_tarihi), a.arama_saat_araligi];
  const gosterilecekMetin =
    `[Otomatik - Satış Bilgilendirme] ${a.musteri_ad_soyad} için ${urunAdiTam} başvurusu alındı, ` +
    `Garanti Emeklilik ${tarihiGunAyOlarakYaz(a.arama_tarihi)} tarihinde ${a.arama_saat_araligi} saatleri arasında arayacak bilgisi iletildi.`;

  try {
    await sendTemplatePozisyonel(numara, sablonAdi, "tr", degerler, gosterilecekMetin);
  } catch (err) {
    console.error(
      `Müşteriye satış bilgilendirme mesajı gönderilemedi (${a.musteri_ad_soyad} - ${numara}):`,
      err?.response?.data || err.message
    );
  }
}

// satisTamamla'nin kullandigi ozet satirlarini hesaplayan SAF (yan etkisiz)
// fonksiyon - hem test edilebilir olsun hem de satisTamamla okunabilir
// kalsin diye ayristirildi. "answers" (a) ve "urunTipi" disinda hicbir seye
// bagli degil, I/O yapmiyor.
function satisOzetVerileriniHesapla(a, urunTipi) {
  // TC vatandasi mi sorusuna gore TCK/Mavi Kart ve uyruk bilgisini cozuyoruz -
  // "Evet" ise uyruk otomatik T.C. kabul edilir ve TCK No istenir, "Hayır"
  // ise uyruk ayrica sorulur ve TCK No yerine Mavi Kart No istenir.
  const tcVatandasiMi = a.sigortali_tc_vatandasi_mi === "Evet";
  const sigortaliKimlikNo = tcVatandasiMi ? a.sigortali_tck : a.sigortali_mavi_kart_no;
  const kimlikNoEtiketi = tcVatandasiMi ? "TCK No" : "Mavi Kart No";
  const sigortaliUyrukDegeri = tcVatandasiMi ? "T.C." : a.sigortali_uyruk;
  const unvan = sigortaliUnvani(a, true); // "Sigortalı" veya "Katılımcı"

  const odeyenAyniMi = a.odeyen_farkli_mi !== "Hayır, Farklı Biri";
  const odeyenAdSoyad = odeyenAyniMi ? a.musteri_ad_soyad : a.odeyen_ad_soyad;
  const odeyenTck = odeyenAyniMi ? sigortaliKimlikNo : a.odeyen_tck;
  const odeyenCep = odeyenAyniMi ? a.sigortali_cep : a.odeyen_cep;
  const odeyenEposta = odeyenAyniMi ? a.sigortali_eposta : a.odeyen_eposta;
  const urunAdiTam =
    urunTipi === "hayat" ? `${a.paket} Prim İadeli Hayat Sigortası` : "Bireysel Emeklilik Sistemi (BES) - Yeni İş";

  const ozetSatirlari = [
    `Ürün Adı: ${urunAdiTam}`,
    `${unvan} Ad Soyad: ${a.musteri_ad_soyad}`,
    `${unvan} ${kimlikNoEtiketi}: ${sigortaliKimlikNo}`,
    `${unvan} Doğum Tarihi: ${a.sigortali_dogum_tarihi}`,
    `Cinsiyet: ${a.sigortali_cinsiyet}`,
    `${unvan} Uyruk/Doğum Yeri: ${sigortaliUyrukDegeri} / ${a.sigortali_dogum_yeri}`,
    // Sigorta ettiren (primi/katkı payını ödeyecek kişi) bilgileri - 24.07.2026
    // geri bildirimi geregi ayri, acik satirlar halinde ("Ödeyen Ad Soyad TCK
    // No" tek satirda birlesik degil) ve "Sigorta Ettiren" terimiyle
    // (Garanti Emeklilik'in de kullandigi resmi terim) etiketleniyor. Odeyen
    // her zaman T.C. vatandasi varsayiliyor (odeyen_tck sorusu Mavi Kart
    // secenegi sunmuyor), o yuzden burada sabit "TCK No" kullaniliyor -
    // sigortalinin kendi kimlikNoEtiketi'nden (Mavi Kart olabilir) bagimsiz.
    `Sigorta Ettiren Ad Soyad: ${odeyenAdSoyad}`,
    `Sigorta Ettiren TCK No: ${odeyenTck}`,
    `Dağıtım Kanalı Adı: EKŞİ GROUP`,
    `Dağıtım Kanalı kodu: 329`,
    // Poliçe süresi artik sorulmuyor - Hayat'ta her zaman 12 yil varsayiliyor.
    ...(urunTipi === "hayat" ? [`Poliçe Süresi: 12 YIL`] : []),
    `Ödeme Aracı: ${a.odeme_araci}`,
    `Aylık Prim Tutarı: ${a.prim_tutari}`,
    `Ödeme Dönemi: ${a.odeme_donemi}`,
    // Vefat teminatini artik bot paket/yas/cinsiyet/odeme donemine gore
    // otomatik hesaplayip giriyor (bkz. vefatTeminatiHesapla.js) - manuel
    // giris sadece otomatik hesaplama basarisiz olursa devreye giriyor.
    // Sadece Hayat'ta soruluyor, BES'te bu alan yok.
    ...(urunTipi === "hayat" ? [`Vefat Teminatı: ${a.vefat_teminati}`] : []),
    `Sigortalı Cep Telefonu: ${a.sigortali_cep}`,
    `Sigortalı E-Posta: ${a.sigortali_eposta}`,
    `Sigorta Ettiren Cep Telefonu: ${odeyenCep}`,
    `Sigorta Ettiren E-Posta: ${odeyenEposta}`
  ];

  const unvanIyelik = besUrunTipiMi(urunTipi) ? "Katılımcımızın" : "Sigortalımızın";
  const acilisMetni = `${unvanIyelik} ${tarihiGunAyOlarakYaz(a.arama_tarihi)} tarihinde, ${a.arama_saat_araligi} saatleri arasında aranması ricadır.`;

  return { urunAdiTam, ozetSatirlari, acilisMetni };
}

// BES basvurularinda (hem Yeni İş hem Aktarım) Garanti Emeklilik'e giden
// mailin, kullanicinin paylastigi ornek formata (Dagitim Kanali/Plan Kodu/
// Grup Kodu/birlesik satirlar/Lehtar/Fon Dagilimi) uyacak sekilde AYRI bir
// ozet fonksiyonu - Hayat'takinden (satisOzetVerileriniHesapla) yapisal
// olarak farkli oldugu icin (birlesik satirlar, ekstra sabit alanlar) ayni
// fonksiyonu asiri karmasiklastirmak yerine BAGIMSIZ tutuluyor (24.07.2026
// geri bildirimi).
//
// NOT - Fon Dağılımı: kullanici bunun "güncel piyasa koşullarına göre
// değişken" olmasini istedigini ama bunu ayarlayamadiklarini belirtti (daha
// once denenen "Ekonomiye Göre Fon" ozelliginin kaldirilmasiyla ayni sebep) -
// bu yuzden asagidaki BES_FON_DAGILIMI_SABIT, kullanicinin paylastigi ornek
// gorseldeki oranlarla SABIT bir varsayilan olarak kullaniliyor. Ileride
// gercekten guncel/degisken bir dagilim istenirse bu sabiti degistirmek ya da
// disaridan (env/panel) okunan bir degere baglamak yeterli olur.
function besOzetVerileriniHesapla(a, urunTipi) {
  const tcVatandasiMi = a.sigortali_tc_vatandasi_mi === "Evet";
  const sigortaliKimlikNo = tcVatandasiMi ? a.sigortali_tck : a.sigortali_mavi_kart_no;
  const kimlikNoEtiketi = tcVatandasiMi ? "T.C. No" : "Mavi Kart No";
  const sigortaliUyrukDegeri = tcVatandasiMi ? "T.C." : a.sigortali_uyruk;

  const odeyenAyniMi = a.odeyen_farkli_mi !== "Hayır, Farklı Biri";
  const odeyenAdSoyad = odeyenAyniMi ? a.musteri_ad_soyad : a.odeyen_ad_soyad;
  const odeyenTck = odeyenAyniMi ? sigortaliKimlikNo : a.odeyen_tck;
  const odeyenCep = odeyenAyniMi ? a.sigortali_cep : a.odeyen_cep;
  const odeyenEposta = odeyenAyniMi ? a.sigortali_eposta : a.odeyen_eposta;

  const urunAdiTam =
    urunTipi === "bes_aktarim"
      ? "Bireysel Emeklilik Sistemi (BES) - Aktarım"
      : "Bireysel Emeklilik Sistemi (BES) - Yeni İş";

  const ozetSatirlari = [
    `Ürün Adı: ${urunAdiTam}`,
    `Dağıtım Kanalı Adı: EKŞİ GROUP`,
    `Dağıtım Kanalı Kodu: 329`,
    `Plan Kodu: 8040`,
    `Grup Kodu: 70270`,
    `Katılımcı Ad Soyadı / ${kimlikNoEtiketi} / Cep Telefonu: ${a.musteri_ad_soyad} / ${sigortaliKimlikNo} / ${a.sigortali_cep}`,
    `Katılımcı E-Posta: ${a.sigortali_eposta}`,
    `Katılımcı Uyruk/Doğum Yeri: ${sigortaliUyrukDegeri} / ${a.sigortali_dogum_yeri}`,
    `Ödeyen Ad Soyadı / T.C. No / Cep Telefonu: ${odeyenAdSoyad} / ${odeyenTck} / ${odeyenCep}`,
    `Ödeyen E-Posta: ${odeyenEposta}`,
    `Ödeme Periyodu ve Katkı Payı: ${a.odeme_donemi} - ${a.prim_tutari}`,
    `Ödeme Aracı: ${a.odeme_araci}`,
    `Lehtar: Kanuni Varisler`,
    `Fon Dağılımı:`,
    ...BES_FON_DAGILIMI_SABIT.map((f) => `${f.ad} (${f.kod}): %${f.oran}`)
  ];

  const acilisMetni = `Katılımcımızın ${tarihiGunAyOlarakYaz(a.arama_tarihi)} tarihinde, ${a.arama_saat_araligi} saatleri arasında aranması ricadır.`;

  return { urunAdiTam, ozetSatirlari, acilisMetni };
}

// satisTamamla'nin sonunda, akisi kimin baslattigina gore dogru "kapanis"a
// donuyor: danisman ise kendi panelinin ana menusune (devamMenuGoster),
// musteri kendi kendine basvurduysa ise oturumu sifirlayip normal musteri
// akisina (conversationEngine) birakiyoruz - musteriye ASLA danisman
// panelinin ana menusu (Yeni İş Talebi, Bekleyen İş, Performansım vb.)
// gosterilmemeli.
async function satisSonrasiKapat(from, session, musteriKendiKendine) {
  if (musteriKendiKendine) {
    resetSession(from);
  } else {
    await devamMenuGoster(from, session);
  }
}

async function satisTamamla(from, session) {
  const musteriKendiKendine = session.satisAnswers && session.satisAnswers._musteriKendiKendine === true;

  // Belge olmadan Garanti Emeklilik'e mail gitmesinin hicbir anlami yok -
  // normal akista buraya sadece 5 belge de kabul edildikten sonra
  // gelinebiliyor, ama savunmaci olarak yine de kontrol ediyoruz.
  if (!session.satisBelgeler || session.satisBelgeler.length === 0) {
    console.error("satisTamamla belgesiz cagirildi, mail gonderilmeden durduruldu.");
    await sendText(
      from,
      "Belgeler eksik olduğu için kaydı tamamlayamadım 😕 Lütfen belgeleri tekrar göndermeyi deneyin, sorun devam ederse bana ulaşın."
    );
    await satisSonrasiKapat(from, session, musteriKendiKendine);
    return;
  }

  // Eksik bilgiyle de mail gitmesin - Hayat, BES ve (ileride) Aktarım icin
  // ayni kontrol gecerli, cunku eksikBilgiVarMi urun tipine ozel degil,
  // dogrudan o akisin soru listesi (session.satisSorular) uzerinden calisiyor.
  if (eksikBilgiVarMi(session.satisSorular, session.satisAnswers)) {
    console.error("satisTamamla eksik bilgiyle cagirildi, mail gonderilmeden durduruldu.");
    await sendText(
      from,
      "Bazı bilgiler eksik göründüğü için kaydı tamamlayamadım 😕 Lütfen \"menü\" yazıp baştan tekrar deneyin, sorun devam ederse bana ulaşın."
    );
    await satisSonrasiKapat(from, session, musteriKendiKendine);
    return;
  }

  // Belgeleri tek PDF'te birlestirip mail gondermek birkac saniye surebiliyor -
  // bu sirada bir seyler oluyor sinyali verelim (hem Hayat hem BES, hem
  // danisman hem musteri-kendi-kendine akisi icin gecerli, cunku bu
  // fonksiyon hepsi tarafindan paylasiliyor).
  await sendText(from, "Evraklarınızı hazırlıyorum, bir saniye... 📎");

  // Musteri kendi kendine basvurduysa "from" bir danismanin degil,
  // musterinin kendi numarasidir - danismaniBul(from) burada null doner (ki
  // bu dogrudur), gercek sorumlu danismani asagida resolveAgentNumber ile
  // ayrica cozuyoruz (bkz. musteriDanismanNumarasi).
  const danisman = danismaniBul(from);
  const a = session.satisAnswers;
  const urunTipi = session.satisUrunTipi;

  // BES (Yeni İş/Aktarım) ve Hayat mail formatlari yapisal olarak farklilasti
  // (24.07.2026 geri bildirimi) - hangi ozet fonksiyonunun kullanilacagini
  // urun tipine gore seciyoruz.
  const { urunAdiTam, ozetSatirlari, acilisMetni } = besUrunTipiMi(urunTipi)
    ? besOzetVerileriniHesapla(a, urunTipi)
    : satisOzetVerileriniHesapla(a, urunTipi);

  // Danismanin tek tek yukledigi belgeleri (kimlik on/arka, imzali evraklar,
  // yerlesim yeri belgesi) mail'e ayri ayri ek olarak eklemek yerine tek bir
  // PDF halinde birlestiriyoruz. Birlestirme herhangi bir sebeple basarisiz
  // olursa (orn. bozuk bir resim dosyasi), mail'in gitmemesi yerine belgeleri
  // ayri ayri ekleyerek gonderime devam ediyoruz - guvenli yedek.
  let ekBelgeler = session.satisBelgeler;
  try {
    const birlesikPdfBuffer = await belgeleriTekPdfeBirlestir(session.satisBelgeler);
    ekBelgeler = [
      {
        dosyaAdi: `${a.musteri_ad_soyad} - Belgeler.pdf`,
        mimeType: "application/pdf",
        veriBase64: birlesikPdfBuffer.toString("base64")
      }
    ];
  } catch (err) {
    console.error(
      "Belgeler tek PDF halinde birlestirilemedi, ayri ayri gonderiliyor:",
      err.message
    );
  }

  // Musteri kendi kendine basvurduysa mail ASLA dogrudan Garanti
  // Emeklilik'in gercek adreslerine gitmemeli - once ekip (Enbel)
  // inceleyip uygun gorurse KENDISI Garanti Emeklilik'e iletecek. Onay
  // adresi olarak once ozel MUSTERI_TALEP_ONAY_EPOSTA_ADRESI'ni, o
  // tanimli degilse zaten var olan EPOSTA_YANIT_ADRESI'ni kullaniyoruz.
  // Ikisi de tanimli degilse mail HIC GONDERILMIYOR - yanlislikla Garanti
  // Emeklilik'e gitmesindense hic gitmemesi tercih edilir; kayit yine de
  // panelde ve WhatsApp bildiriminde (asagida) kayboluyor degil.
  const musteriOnayAdresi = musteriKendiKendine
    ? process.env.MUSTERI_TALEP_ONAY_EPOSTA_ADRESI || process.env.EPOSTA_YANIT_ADRESI || null
    : null;

  // Mail gonderim sonucunu artik BEKLIYORUZ (fire-and-forget degil) ki
  // danismana dogru bir onay mesaji gosterebilelim - eskiden mail gitse de
  // gitmese de (orn. OUTLOOK_EMAIL/OUTLOOK_APP_SIFRE Railway'de tanimli
  // degilse ya da SMTP hata verirse) danismana hep "Garanti Emeklilik'e
  // iletildi" deniyordu, bu yanlis bir onaydi.
  let mailSonucu;
  if (musteriKendiKendine && !musteriOnayAdresi) {
    console.warn(
      "Musteri kendi kendine basvurdu ama MUSTERI_TALEP_ONAY_EPOSTA_ADRESI / EPOSTA_YANIT_ADRESI tanimli degil - onay maili gonderilemedi, sadece panel kaydi ve WhatsApp bildirimi ile devam ediliyor."
    );
    mailSonucu = {
      basarili: false,
      sebep: "MUSTERI_TALEP_ONAY_EPOSTA_ADRESI / EPOSTA_YANIT_ADRESI tanımlı değil"
    };
  } else {
    mailSonucu = await garantiEmekliligeGonder({
      urunAdi: urunAdiTam,
      musteriAdi: a.musteri_ad_soyad,
      telefon: a.sigortali_cep,
      ozetSatirlari,
      ekBelgeler,
      konuFormati: "satis", // konu satirini "Urun Adi Musteri Adi" formatinda kurar
      acilisMetni,
      // Musteri kendi kendine basvurduysa Garanti Emeklilik yerine onay
      // adresine gonderilsin (bkz. eposta.js aliciOverride) - danisman
      // akisinda undefined kalir, davranis tamamen degismez.
      aliciOverride: musteriKendiKendine ? [musteriOnayAdresi] : undefined
    }).catch((err) => {
      console.error("Satis maili gonderilirken hata:", err.message);
      return { basarili: false, sebep: err.message };
    });
  }

  // Musteri kendi kendine basvurduysa, bu satisi takip edecek gercek
  // danismani (daha once "hangi danismanla gorustunuz" sorusuna verdigi
  // cevaba, yoksa urunun varsayilan numarasina gore) coz - flows.js'teki
  // ayni amacli mantikla (resolveAgentNumber) birebir tutarli olsun diye
  // conversationEngine'deki fonksiyonu tekrar kullaniyoruz.
  const ilgiliFlow = flows[besUrunTipiMi(urunTipi) ? "bes" : "hayat"];
  const musteriDanismanNumarasi = musteriKendiKendine
    ? conversationEngine.resolveAgentNumber(ilgiliFlow, { answers: { danisman_adi: a.satis_danisman_adi } })
    : null;

  // Panelde de gorunmesi icin lead olarak da kaydediyoruz - mail basarisiz
  // olsa bile bu kayit HER ZAMAN olusturulur, boylece belgeler/bilgiler
  // kaybolmuyor ve panel uzerinden manuel takip edilebiliyor.
  const olusturanEtiketi = musteriKendiKendine
    ? "Müşteri kendisi başvurdu"
    : `${danisman ? danisman.name : "Danışman"} tarafından oluşturuldu`;
  const kompaktDetay = `[${olusturanEtiketi} - SATIŞ] ${urunAdiTam} • ${ozetSatirlari.join(" • ")}`;
  const yeniLead = leadStore.yeniLeadOlustur({
    telefon: a.sigortali_cep,
    musteriAdi: a.musteri_ad_soyad,
    urun: urunAdiTam,
    danismanAdi: musteriKendiKendine ? a.satis_danisman_adi || null : danisman ? danisman.name : null,
    danismanNumarasi: musteriKendiKendine ? musteriDanismanNumarasi : from,
    ozet: kompaktDetay
  });
  session.satisBelgeler.forEach((belge) => leadStore.belgeEkle(yeniLead.id, belge));

  // 27.07.2026 eklendi: bu akis (Satis Kaydi - Hayat/BES) musteriProfilStore'a
  // hic yazmiyordu, bu yuzden burada satisi TAMAMLAYAN musteriler bir dahaki
  // sefere yazdiginda ismiyle karsilanmiyordu (bkz. conversationEngine.js'deki
  // baslaYeniKonusma). Musterinin kendi cep telefonunu (a.sigortali_cep),
  // musteriyeSatisBildirimiGonder'de de kullanilan ayni normallestirme
  // fonksiyonuyla (telefonUluslararasiFormata) anahtarlayip kalici profile
  // yaziyoruz - boylece "from" (danisman numarasi OLABILIR) ile degil,
  // musterinin GERCEK numarasiyla dogru profil guncelleniyor. Bu akista zaten
  // imzali "Açık Rıza Metni" toplandigi icin KVKK onayini da burada isaretliyoruz.
  const musteriProfilNumarasi = telefonUluslararasiFormata(a.sigortali_cep);
  if (musteriProfilNumarasi) {
    musteriProfilStore.profilGuncelle(musteriProfilNumarasi, {
      adSoyad: a.musteri_ad_soyad,
      kvkkOnayVerildi: true
    });
  }

  // Musteri kendi kendine basvurduysa, danisman devrede olmadigi icin bu
  // satisi bir INSANIN (danisman) fark edebilmesi icin ayrica WhatsApp
  // bildirimi gonderiyoruz - mail basarili/basarisiz FARK ETMEKSIZIN, cunku
  // danismanin belgeleri gozden gecirip musteriyi karsılaması gerekiyor.
  // guvenlikAgiNumaralari sayesinde Enbel her zaman ayrica haberdar oluyor.
  if (musteriKendiKendine) {
    const bildirilecekNumaralar = conversationEngine.guvenlikAgiNumaralari(ilgiliFlow, musteriDanismanNumarasi);
    const detayliMetin =
      `📋 Yeni iş talebi geldi\n📌 ${olusturanEtiketi}${a.satis_danisman_adi ? ` (${a.satis_danisman_adi})` : ""}\n\n` +
      ozetSatirlari.join("\n");
    for (const numara of bildirilecekNumaralar) {
      await conversationEngine.bildirimGonder(numara, urunAdiTam, a.musteri_ad_soyad, a.sigortali_cep, detayliMetin, kompaktDetay);
    }
  }

  if (mailSonucu && mailSonucu.basarili) {
    if (musteriKendiKendine) {
      // DIKKAT: mailSonucu.basarili burada sadece onay adresine (Enbel'e)
      // basariyla ulastigini gosterir - Garanti Emeklilik'e HENUZ hicbir
      // sey gitmedi, o yuzden musteriye "Garanti Emeklilik'e iletildi"
      // DENMIYOR; ekip inceleyip uygun gorduginde iletecegi vurgulaniyor.
      await sendText(
        from,
        `Satış talebiniz alındı ✅ ${urunAdiTam} için ilettiğiniz bilgiler ve belgeler ekibimize ulaştı. Kısa süre içinde inceleyip Garanti Emeklilik'e ileteceğiz, ardından belirttiğiniz tarih ve saat aralığında sizi arayacaklar. Bizi tercih ettiğiniz için teşekkür ederiz! 🙏`
      );
    } else {
      await sendText(
        from,
        `Satış kaydı tamamlandı ✅ Ellerine sağlık! 🙌 ${a.musteri_ad_soyad} için ${urunAdiTam} kaydı Garanti Emeklilik'e iletildi.`
      );
      // Mail basariyla gittiyse (yani Garanti Emeklilik musteriyi gercekten
      // arayacaksa) musteriye de bilgilendirme mesaji atalim - mail gitmediyse
      // (asagidaki else) bu bildirimi ATLIYORUZ, cunku arama fiilen
      // planlanmamis olabilir ve musteriye yanlis bir beklenti vermek istemeyiz.
      // (Musteri kendi kendine basvurduysa bu ayrica bildirime gerek yok -
      // yukaridaki tamamlanma mesaji zaten dogrudan kendisine gidiyor.)
      await musteriyeSatisBildirimiGonder(a, urunAdiTam);

      // 26.07.2026 eklendi: satis GERCEKTEN Garanti Emeklilik'e iletildigi
      // icin (bu dal - musteri-kendi-kendine degil VE mail basarili), birkac
      // gun sonra musteriye bir memnuniyet/kalite kontrolu mesaji gonderilmek
      // uzere zamanlaniyor (bkz. server.js'deki memnuniyetAnketleriniKontrolEt).
      // Musteri-kendi-kendine basvurdugunda BUNU YAPMIYORUZ - o durumda
      // Garanti Emeklilik'e HENUZ hicbir sey gitmedi (sadece ekip onayi
      // icin bir mail gitti), ekip once elle inceleyip Garanti Emeklilik'e
      // iletecek - o noktada bu kod tarafindan otomatik takip edilmiyor.
      leadStore.memnuniyetAnketiKur(yeniLead.id, Date.now() + MEMNUNIYET_ANKETI_GECIKME_MS);
    }
  } else if (musteriKendiKendine) {
    // Onay maili (Enbel'e) gitmedi - Garanti Emeklilik'e zaten hic
    // gonderilmiyordu bu akista, o yuzden musteriye "Garanti Emeklilik'e
    // gonderirken sorun oldu" DENMIYOR (yanlis olur) - kaydin/belgelerin
    // guvenle alindigini ve ekibin panelden takip edecegini vurguluyoruz.
    console.error(
      `Musteri kendi kendine satis kaydi tamamlandi ama onay maili GONDERILEMEDI (${a.musteri_ad_soyad} - ${urunAdiTam}): ${mailSonucu ? mailSonucu.sebep : "bilinmeyen hata"}`
    );
    await sendText(
      from,
      `Satış talebiniz ve belgeleriniz alındı ✅ Ekibimiz talebinizi panel üzerinden inceleyip uygun görürse Garanti Emeklilik'e iletecek - sizin ekstra bir şey yapmanıza gerek yok. Bizi tercih ettiğiniz için teşekkür ederiz! 🙏`
    );
  } else {
    console.error(
      `Satis kaydi tamamlandi ama Garanti Emeklilik maili GONDERILEMEDI (${a.musteri_ad_soyad} - ${urunAdiTam}): ${mailSonucu ? mailSonucu.sebep : "bilinmeyen hata"}`
    );
    await sendText(
      from,
      `Satış kaydınız ve belgeleriniz sisteme kaydedildi ✅ ancak Garanti Emeklilik'e mail gönderirken bir sorun oluştu ⚠️ Bu kayıt panelde duruyor, ekibimiz kontrol edip manuel olarak iletecek - sizin ekstra bir şey yapmanıza gerek yok.`
    );
  }
  await satisSonrasiKapat(from, session, musteriKendiKendine);
}

// "Yeni İş Talebi" sadece elementer branslar icindir (BES/Hayat icin ayri
// "BES Hayat Satış" akisi var) - o yuzden burada sadece agentNumber'i
// Bahadır olan (elementer) urunler listeleniyor.
const BAHADIR_NUMARASI = "905380711711";

async function yeniTalepUrunSec(from, session) {
  session.state = "DANISMAN_YENI_URUN_SEC";
  const urunAnahtarlari = Object.keys(flows).filter((k) => flows[k].agentNumber === BAHADIR_NUMARASI);
  session.danismanUrunAnahtarlari = urunAnahtarlari;
  const etiketler = urunAnahtarlari.map((k) => flows[k].menuLabel || flows[k].label);
  await sendList(from, "Hangi ürün için yeni bir talep oluşturmak istersiniz?", "Ürün Seç", etiketler);
}

// Ozel Saglik/TSS'nin "aile_dongu" tipi sorusu (esin/cocuklarin toplanmasi),
// conversationEngine.js'deki saglikAileSorusunuSor/saglikAileCevabiIsle
// fonksiyonlarini (bkz. o dosya) BURADA DA aynen kullanabilmek icin bir
// "vekil" (shim) session olusturur. O fonksiyonlar cagirdiklari session
// nesnesinde SADECE .answers / .saglikAileAsama / .saglikAileGecici
// alanlarini okuyup yaziyor - bu shim bu 3 alani, danismanin KENDI
// oturumundaki (musteri akisiyla CATISMAYAN, ayri) danismanYeniAnswers/
// danismanSaglikAileAsama/danismanSaglikAileGecici alanlarina yonlendiriyor.
function danismanAileShimOlustur(session) {
  return {
    get answers() {
      return session.danismanYeniAnswers;
    },
    set answers(deger) {
      session.danismanYeniAnswers = deger;
    },
    get saglikAileAsama() {
      return session.danismanSaglikAileAsama;
    },
    set saglikAileAsama(deger) {
      session.danismanSaglikAileAsama = deger;
    },
    get saglikAileGecici() {
      return session.danismanSaglikAileGecici;
    },
    set saglikAileGecici(deger) {
      session.danismanSaglikAileGecici = deger;
    }
  };
}

async function danismanSoruSor(from, session) {
  const flow = flows[session.danismanYeniUrunKey];
  const soru = flow.questions[session.danismanYeniSoruIndex];

  // "belge" tipi (Trafik/Kasko proforma/ruhsat OCR) - cevap yaziyla degil,
  // bir fotograf/PDF gonderilerek verilir (bkz. handleAdvisorMessage'daki
  // media isleyici), burada sadece istek metnini gosteriyoruz.
  if (soru.type === "belge") {
    const metin = conversationEngine.resolveDanismanText(soru, session.danismanYeniAnswers);
    await sendText(from, metin);
    return;
  }

  // "aile_dongu" tipi (Ozel Saglik/TSS esin/cocuklarin toplanmasi) - gercek
  // soru-cevap akisi tamamen conversationEngine.js'deki motora devrediliyor.
  if (soru.type === "aile_dongu") {
    if (!session.danismanSaglikAileAsama) session.danismanSaglikAileAsama = "ES_SORULUYOR";
    await conversationEngine.saglikAileSorusunuSor(from, danismanAileShimOlustur(session));
    return;
  }

  const metin = conversationEngine.resolveDanismanText(soru, session.danismanYeniAnswers);

  if (soru.type === "choice") {
    if (soru.options.length > 3) {
      await sendList(from, metin, "Seçin", soru.options);
    } else {
      await sendButtons(from, metin, soru.options);
    }
  } else {
    await sendText(from, metin);
  }
}

async function danismanYeniTalepiTamamla(from, session) {
  const flow = flows[session.danismanYeniUrunKey];
  const danisman = danismaniBul(from);
  const sigortaliTelefon = session.danismanYeniTelefon;
  const answers = session.danismanYeniAnswers;
  const musteriAdi = answers.ad_soyad || "(isim alınmadı)";
  const olusturanEtiketi = danisman ? danisman.name : "Bir danışman";

  // Danismandaki (bu akista hic sorulmayan) sorulari cikartip ozet olusturuyoruz.
  // "belge" (proforma/ruhsat OCR) ve "aile_dongu" (Ozel Saglik/TSS aile
  // bireyleri) tipi sorularin gercek cevabi answers[q.id]'de DEGIL, ayri
  // alanlarda (marka/model/.../answers.saglik_kisiler) tutuluyor - bu yuzden
  // conversationEngine.js'deki AYNI ozetlenecekSorular fonksiyonuyla (bkz. o
  // dosyadaki yorum) bu iki tip ozetten haric tutulup, gercek bilgileri
  // asagida aracEkBilgiSatirlari/saglikKisiSatirlari ile ayrica ekleniyor.
  const filtrelenmisFlow = { ...flow, questions: flow.questions.filter((q) => !q.danismandaGizle) };
  const askedQuestions = conversationEngine.ozetlenecekSorular(filtrelenmisFlow, answers);
  const summaryLines = askedQuestions.map((q) => {
    const soruMetni = conversationEngine.resolveDanismanText(q, answers);
    return `- ${soruMetni.replace(/\?$/, "")}: ${answers[q.id]}`;
  });
  const aracEkBilgiSatirlari = conversationEngine
    .aracEkBilgiSatirlariOlustur({ answers }, ": ")
    .map((satir) => `- ${satir}`);
  const saglikKisiSatirlari = conversationEngine
    .saglikKisileriOzetSatirlariOlustur({ answers })
    .map((satir) => `- ${satir}`);

  const agentMessage =
    `\u{1F4CB} Yeni iş talebi geldi\n` +
    `📌 Bu talep ${olusturanEtiketi} tarafından oluşturuldu.\n\n` +
    `Sigortalı: ${musteriAdi}\n` +
    `Telefon: ${sigortaliTelefon}\n` +
    `Ürün: ${flow.label}\n\n` +
    summaryLines.join("\n") +
    (aracEkBilgiSatirlari.length ? "\n" + aracEkBilgiSatirlari.join("\n") : "") +
    (saglikKisiSatirlari.length ? "\n" + saglikKisiSatirlari.join("\n") : "");

  const sahteSession = { answers, name: musteriAdi };
  const kompaktDetayTemel = conversationEngine.kompaktDetayOlustur(filtrelenmisFlow, sahteSession, sigortaliTelefon);
  const kompaktDetay = `[${olusturanEtiketi} tarafından oluşturuldu] ${kompaktDetayTemel}`;

  // Guvenlik agi (Enbel her zaman, Bahadır elementer branslarda) + kendisine
  // tekrar bildirim gondermeye gerek yok, zaten kendisi olusturdu.
  const bildirilecekNumaralar = conversationEngine.guvenlikAgiNumaralari(flow, from);
  bildirilecekNumaralar.delete(from);

  for (const numara of bildirilecekNumaralar) {
    await conversationEngine.bildirimGonder(numara, flow.label, musteriAdi, sigortaliTelefon, agentMessage, kompaktDetay);
  }

  const yeniLead = leadStore.yeniLeadOlustur({
    telefon: sigortaliTelefon,
    musteriAdi,
    urun: flow.label,
    danismanAdi: danisman ? danisman.name : null,
    danismanNumarasi: from,
    ozet: kompaktDetay
  });

  // Proforma/ruhsat gibi OCR ile okunan belgeler varsa (bkz. DANISMAN_YENI_SORU
  // altindaki media isleyici) talebe ekliyoruz - musteri tarafindaki
  // finishFlow'un session.ekBelgeler icin yaptigi ile AYNI mantik.
  if (Array.isArray(session.danismanYeniEkBelgeler)) {
    session.danismanYeniEkBelgeler.forEach((belge) => leadStore.belgeEkle(yeniLead.id, belge));
  }

  // BES ve Prim Iadeli Hayat Sigortasi gibi bazi urunlerde, danisman tarafindan
  // olusturulan talepler de Garanti Emeklilik'e otomatik mail olarak gider.
  if (flow.garantiEmekliligeGonder) {
    garantiEmekliligeGonder({
      urunAdi: flow.label,
      musteriAdi,
      telefon: sigortaliTelefon,
      ozetSatirlari: summaryLines
    }).catch((err) => console.error("Garanti Emeklilik maili gonderilirken beklenmeyen hata:", err.message));
  }

  await sendText(
    from,
    `Talep başarıyla oluşturuldu ✅ ${musteriAdi} için ${flow.label} talebi kaydedildi ve ilgili kişilere iletildi.`
  );
  await devamMenuGoster(from, session);
}

// --- Performansım: danismanin kendi ozet istatistiklerini gosterir ---
async function performansGoster(from, session) {
  const istatistik = leadStore.danismanIstatistikleri(from);
  const donusumMetni = istatistik.donusumOrani === null ? "henüz kapanan talep yok" : `%${istatistik.donusumOrani}`;

  await sendText(
    from,
    `📊 Performansım\n\n` +
      `Bu ay girilen talep: ${istatistik.buAyTalep}\n` +
      `Bu ay kapanan satış: ${istatistik.olumluBuAy}\n` +
      `Şu an açık talep: ${istatistik.acikSayisi}\n\n` +
      `Toplam (tüm zamanlar):\n` +
      `Talep: ${istatistik.toplamTalep}\n` +
      `Satış: ${istatistik.olumluToplam}\n` +
      `Dönüşüm oranı: ${donusumMetni}`
  );
  await devamMenuGoster(from, session);
}

// --- Destek Talebi: mevcut bir musteri/police ile ilgili ek servis talebi
// (zeyil, iştira, iptal, adres/bilgi güncelleme vb.) - 27.07.2026'da
// kullanicinin talebiyle YENIDEN TASARLANDI:
// 1) Once NE ICIN kullanildigina dair kisa bir aciklama gosteriliyor.
// 2) Ilgili musteri/talep secildikten sonra bir BASLIK isteniyor.
// 3) Ardindan aciklama (serbest metin) isteniyor.
// 4) Destek talebi artik SADECE ilgili kisilere bildirim gitmesiyle
//    kalmiyor - kendi basina, BASLIGIYLA BIRLIKTE, bekleyen iş listesine
//    (leadStore'da yeni bir "Açık" kayit olarak) ekleniyor (bkz.
//    destekTalebiGonder sonundaki leadStore.yeniLeadOlustur cagrisi).
async function destekTalebiAciklamaGoster(from, session) {
  await sendText(
    from,
    "🆘 Destek Talebi, mevcut bir müşteriniz/poliçenizle ilgili ek bir servis talebini (örneğin zeyil, iştira, iptal, adres/bilgi güncelleme gibi) ilgili kişilere iletmek için kullanılır.\n\n" +
      "Önce hangi müşteri/talep ile ilgili olduğunu seçeceksiniz, sonra talebinize kısa bir başlık ve açıklama yazacaksınız - bu destek talebi kendi başına bir bekleyen iş olarak takip edilecek."
  );
  await destekLeadSecimiGoster(from, session);
}

async function destekLeadSecimiGoster(from, session) {
  const kendiLeadleri = leadStore.tumLeadleriGetir().filter((l) => l.danismanNumarasi === from);

  if (kendiLeadleri.length === 0) {
    await sendText(
      from,
      "Destek talebi oluşturmak için önce en az bir talebinizin olması gerekiyor. Önce 'Yeni Talep Oluştur' ile bir talep girebilirsiniz."
    );
    await devamMenuGoster(from, session);
    return;
  }

  // WhatsApp interaktif liste en fazla 10 satir destekliyor, o yuzden en
  // guncel 10 talep gosteriliyor.
  const gosterilecekler = kendiLeadleri.slice(0, 10);
  session.state = "DANISMAN_DESTEK_LEAD_SECIMI";
  session.danismanDestekLeadListesi = gosterilecekler.map((l) => l.id);

  const satirlar = gosterilecekler.map((l) => `${l.musteriAdi || l.telefon} (${l.urun}) - ${l.durum}`);
  await sendList(from, "Hangi talep/sigortalı ile ilgili destek almak istersiniz?", "Talep Seç", satirlar);
}

async function destekBaslikIste(from, session, lead) {
  session.state = "DANISMAN_DESTEK_BASLIK_BEKLE";
  session.danismanDestekLeadId = lead.id;
  await sendText(from, `${lead.musteriAdi || lead.telefon} (${lead.urun}) için bu destek talebine kısa bir başlık verir misiniz? (örn: "Zeyil talebi - adres değişikliği")`);
}

async function destekMetniIste(from, session, baslik) {
  session.state = "DANISMAN_DESTEK_METIN_BEKLE";
  session.danismanDestekBaslik = baslik;
  await sendText(from, `Şimdi ne konuda destek almak istediğinizi kısaca yazar mısınız?`);
}

async function destekTalebiGonder(from, session, destekMetni) {
  const lead = leadStore.leadGetir(session.danismanDestekLeadId);
  const baslik = session.danismanDestekBaslik;
  if (!lead) {
    await sendText(from, "İlgili talebi bulamadım, tekrar deneyebilir misiniz?");
    await devamMenuGoster(from, session);
    return;
  }

  const danisman = danismaniBul(from);
  const danismanAdi = danisman ? danisman.name : "Bir danışman";
  const flow = flowBulUrunAdindan(lead.urun);

  const detay =
    `🆘 Destek Talebi: ${baslik}\n` +
    `📌 ${danismanAdi} tarafından oluşturuldu.\n\n` +
    `Sigortalı: ${lead.musteriAdi || lead.telefon}\n` +
    `Ürün: ${lead.urun}\n` +
    `Telefon: ${lead.telefon}\n\n` +
    `Mesaj: ${destekMetni}`;

  // Orijinal talebe de (gecmisini kaybetmesin diye) kisa bir not birakiyoruz.
  leadStore.notEkle(lead.id, `🆘 Destek Talebi (${baslik}): ${destekMetni}`);

  // Urune gore dogru kisiye (elementerde Bahadır, hayat/BES'te Enbel) +
  // her zaman Enbel'e kopya olacak sekilde ayni guvenlik agi mantigi
  // kullaniliyor (yeni talep bildirimindeki ile birebir ayni).
  const birincilNumara = flow ? flow.agentNumber : process.env.AGENT_WHATSAPP_NUMBER;
  const bildirilecekNumaralar = conversationEngine.guvenlikAgiNumaralari(flow || {}, birincilNumara);
  bildirilecekNumaralar.delete(from);

  for (const numara of bildirilecekNumaralar) {
    await conversationEngine.bildirimGonder(numara, lead.urun, lead.musteriAdi || lead.telefon, lead.telefon, detay, detay);
  }

  // 27.07.2026 eklendi: destek talebi artik SADECE bir bildirim/not degil -
  // kendi basina, "Bekleyen İş" listesinde takip edilen YENI bir Açık kayit.
  // danismanNumarasi = "from" (talebi ACAN kisi) - boylece kendi Bekleyen İş
  // listesinde gorunur ve kapatana kadar (Olumlu/Olumsuz) gunluk ozette
  // hatirlatilmaya devam eder. urun alani ORIJINAL urunu tasimaya devam eder
  // (elementer/Bahadır filtrelemesi bunun uzerinden calistigi icin), baslik
  // ayri bir alanda tutulur (bkz. server.js -> acikIsSatiriOlustur).
  leadStore.yeniLeadOlustur({
    telefon: lead.telefon,
    musteriAdi: lead.musteriAdi,
    urun: lead.urun,
    danismanAdi: danismanAdi,
    danismanNumarasi: from,
    ozet: detay,
    baslik
  });

  await sendText(from, "Destek talebiniz iletildi ✅ Bekleyen İş listenize de eklendi, en kısa sürede dönüş yapılacaktır.");
  await devamMenuGoster(from, session);
}

// Taninan bir arac satis sozlesmesinden (bkz. satisSozlesmesiAnaliz.js)
// cikarilan bilgilerle yeni bir "Satıştan İptal Talebi" kaydi acar
// (leadStore'da, Bahadır'in kendi numarasina atanmis olarak - boylece
// Bahadır bunu kendi "Taleplerimi Gör" listesinde gorur) VE Bahadır + Enbel'e
// (guvenlik agi, destekTalebiGonder ile ayni mekanizma) WhatsApp bildirimi
// gonderir. Musterinin (saticinin) bir WhatsApp numarasi belgeden
// cikarilamadigi icin telefon alani bilerek null birakiliyor - bu, gercek bir
// musteri konusma kaydi degil, sadece bir ic takip/bildirim kaydidir.
// ONEMLI - 22.07.2026 tarihli geri bildirim: bu ozellik eskiden SADECE
// fotograftan cikarilan bilgileri (TC/plaka/motor no/sasi no) METIN olarak
// Bahadır'a bildiriyordu - fotografin/belgenin KENDISI hic gitmiyordu.
// Bahadır'in bu talebi Garanti Emeklilik'e iletebilmesi icin sozlesmenin
// PDF halinin de eline ulasmasi gerekiyor. Bu yuzden fonksiyon artik
// orijinalBuffer/orijinalMimeType parametrelerini de aliyor, fotografi
// (zaten var olan belgeleriTekPdfeBirlestir - satis kaydi belgelerini
// birlestirmek icin kullanilan AYNI fonksiyon, tek elemanli bir dizi ile
// cagrilarak) bir PDF'e ceviriyor, bu PDF'i hem lead'e belge olarak
// ekliyor (panelde gorunmesi icin) HEM DE Bahadır'a (+ Enbel'e) WhatsApp
// dokuman olarak dogrudan gonderiyor. PDF'e cevirme/gonderme herhangi bir
// sebeple basarisiz olursa (orn. bozuk resim verisi), talep/bildirim METIN
// olarak YINE DE olusturulmaya devam eder - bu ek adim ana akisi ASLA
// engellememeli, sadece "olursa iyi olur" bir tamamlama.
async function satistanIptalTalebiOlustur(from, analiz, orijinalBuffer, orijinalMimeType) {
  const danisman = danismaniBul(from);
  const bildirenDanismanAdi = danisman ? danisman.name : "Bir danışman";

  const ozetSatirlari = [
    `Eski Plaka: ${analiz.eskiPlaka || "okunamadı"}`,
    `Yeni Plaka: ${analiz.yeniPlaka || "okunamadı"}`,
    `Motor No: ${analiz.motorNo || "okunamadı"}`,
    `Şasi No: ${analiz.sasiNo || "okunamadı"}`,
    `Satıcı (mevcut sigortalı): ${analiz.saticiAdi || "okunamadı"} - TC: ${analiz.saticiTck || "okunamadı"}`,
    `Alıcı: ${analiz.aliciAdi || "okunamadı"} - TC: ${analiz.aliciTck || "okunamadı"}`,
    ...(analiz.satisTarihi ? [`Satış Tarihi: ${analiz.satisTarihi}`] : [])
  ];

  const lead = leadStore.yeniLeadOlustur({
    telefon: null,
    musteriAdi: analiz.saticiAdi || "Bilinmeyen (satış sözleşmesi)",
    urun: "Araç Satışı - Poliçe İptal Talebi",
    danismanAdi: "Bahadır",
    danismanNumarasi: BAHADIR_NUMARASI,
    ozet: ozetSatirlari.join(" • ")
  });
  leadStore.notEkle(
    lead.id,
    `📄 ${bildirenDanismanAdi} tarafından gönderilen araç satış sözleşmesi fotoğrafından otomatik oluşturuldu.`
  );

  // Fotografi PDF'e cevir (satis kaydi akisinda zaten kullanilan/test
  // edilmis olan ayni fonksiyon - tek elemanli dizi ile "birlestirme"
  // aslinda sadece tek bir A4 sayfaya yerlestirme islemi yapar).
  //
  // ONEMLI - "PDF gitmezse olmaz" (22.07.2026): PDF'e cevirme SADECE JPEG/
  // PNG icin calisir (pdf-lib'in kendi sinirlamasi) - WhatsApp'in gonderdigi
  // fotograflarin ezici cogunlugu zaten JPEG oldugu icin bu neredeyse HER
  // ZAMAN basarili olur. Yine de (cok nadir de olsa) beklenmeyen bir format
  // ya da bozuk veri PDF donusumunu basarisiz kilarsa, Bahadır'a HICBIR
  // GORSEL BELGE ULASMAMASI kabul edilemez - bu yuzden boyle bir durumda
  // asagida ORIJINAL FOTOGRAF dogrudan (PDF'e cevrilmeden) WhatsApp
  // dokumani olarak gonderilir. Yani belge HER ZAMAN bir sekilde
  // (PDF olarak ya da, cok nadir durumda, orijinal fotograf olarak)
  // Bahadır'a ulasir - sadece metin bildirimiyle yetinilmez.
  let sozlesmePdfBuffer = null;
  let belgeninTuru = null; // "pdf" | "orijinal_fotograf" | null
  if (orijinalBuffer && orijinalMimeType) {
    try {
      sozlesmePdfBuffer = await belgeleriTekPdfeBirlestir([
        { dosyaAdi: "arac_satis_sozlesmesi", mimeType: orijinalMimeType, veriBase64: orijinalBuffer.toString("base64") }
      ]);
      leadStore.belgeEkle(lead.id, {
        dosyaAdi: "Arac_Satis_Sozlesmesi.pdf",
        mimeType: "application/pdf",
        veriBase64: sozlesmePdfBuffer.toString("base64")
      });
      belgeninTuru = "pdf";
    } catch (err) {
      console.error("Satis sozlesmesi fotografi PDF'e cevrilemedi (orijinal fotograf yedek olarak gonderilecek):", err.message);
      sozlesmePdfBuffer = null;
      try {
        leadStore.belgeEkle(lead.id, {
          dosyaAdi: "Arac_Satis_Sozlesmesi" + (orijinalMimeType.includes("png") ? ".png" : ".jpg"),
          mimeType: orijinalMimeType,
          veriBase64: orijinalBuffer.toString("base64")
        });
        belgeninTuru = "orijinal_fotograf";
      } catch (err2) {
        console.error("Orijinal fotograf da lead'e eklenemedi:", err2.message);
      }
    }
  }

  const detay =
    `🚗 Satıştan İptal Talebi\n` +
    `📌 ${bildirenDanismanAdi} tarafından gönderilen araç satış sözleşmesinden otomatik oluşturuldu.\n\n` +
    ozetSatirlari.join("\n");

  // Urun/danisman fark etmeksizin HER ZAMAN Bahadır + Enbel'e gitmesi icin,
  // guvenlikAgiNumaralari'na "agentNumber: BAHADIR_NUMARASI" tasiyan sahte
  // bir flow nesnesi veriyoruz (destekTalebiGonder'daki "flow || {}" ile ayni
  // mantik, sadece burada gercek bir urun akisi olmadigi icin dogrudan
  // Bahadır'i hedefliyoruz).
  const bildirilecekNumaralar = conversationEngine.guvenlikAgiNumaralari(
    { agentNumber: BAHADIR_NUMARASI },
    BAHADIR_NUMARASI
  );
  for (const numara of bildirilecekNumaralar) {
    await conversationEngine.bildirimGonder(numara, lead.urun, lead.musteriAdi, "-", detay, detay);
    if (belgeninTuru === "pdf") {
      try {
        await sendDocument(
          numara,
          sozlesmePdfBuffer,
          "application/pdf",
          "Arac_Satis_Sozlesmesi.pdf",
          `${bildirenDanismanAdi} tarafından gönderilen araç satış sözleşmesi`
        );
      } catch (err) {
        console.error(`Satis sozlesmesi PDF'i ${numara} numarasina gonderilemedi:`, err.message);
      }
    } else if (belgeninTuru === "orijinal_fotograf") {
      // PDF'e cevrilemedi (cok nadir bir durum) - belge YINE DE Bahadır'a
      // ulassin diye orijinal fotografi oldugu gibi (WhatsApp dokumani
      // olarak) gonderiyoruz. Boylece "hicbir gorsel belge gitmedi" durumu
      // ASLA yasanmaz.
      try {
        await sendDocument(
          numara,
          orijinalBuffer,
          orijinalMimeType,
          "Arac_Satis_Sozlesmesi" + (orijinalMimeType.includes("png") ? ".png" : ".jpg"),
          `${bildirenDanismanAdi} tarafından gönderilen araç satış sözleşmesi (orijinal fotoğraf - PDF'e çevrilemedi)`
        );
      } catch (err) {
        console.error(`Satis sozlesmesi orijinal fotografi ${numara} numarasina gonderilemedi:`, err.message);
      }
    }
  }

  const belgeNotu =
    belgeninTuru === "pdf"
      ? " (sözleşmenin PDF'i de dahil)"
      : belgeninTuru === "orijinal_fotograf"
        ? " (sözleşmenin orijinal fotoğrafı da dahil - PDF'e çevrilemedi ama fotoğraf yine de iletildi)"
        : "";

  await sendText(
    from,
    `Araç satış sözleşmesini tanıdım ✅ Aşağıdaki bilgilerle bir "Satıştan İptal Talebi" oluşturdum ve Bahadır'a ilettim` +
      `${belgeNotu}:\n\n${ozetSatirlari.join("\n")}`
  );
}

// --- Yenileme Ekle: satis/talep akisindan bagimsiz, manuel police yenileme kaydi ---
async function yenilemeBaslat(from, session) {
  session.state = "DANISMAN_YENILEME_MUSTERI_BEKLE";
  session.yenilemeVerisi = {};
  await sendText(from, "Sigortalının adını ve soyadını paylaşır mısınız?");
}

async function yenilemeUrunSor(from, session) {
  session.state = "DANISMAN_YENILEME_URUN_SEC";
  const urunAnahtarlari = Object.keys(flows);
  session.yenilemeUrunAnahtarlari = urunAnahtarlari;
  const etiketler = urunAnahtarlari.map((k) => flows[k].menuLabel || flows[k].label);
  await sendList(from, "Hangi ürünün yenilemesini eklemek istiyorsunuz?", "Ürün Seç", etiketler);
}

async function yenilemeTarihSor(from, session) {
  session.state = "DANISMAN_YENILEME_TARIH_BEKLE";
  await sendText(from, "Poliçenin yenileme/bitiş tarihini paylaşır mısınız? (GG.AA.YYYY formatında, örn: 12.09.2026)");
}

async function yenilemeTamamla(from, session) {
  const danisman = danismaniBul(from);
  const v = session.yenilemeVerisi;

  const kayit = yenilemeStore.yeniYenilemeOlustur({
    danismanNumarasi: from,
    danismanAdi: danisman ? danisman.name : null,
    musteriAdi: v.musteriAdi,
    urun: v.urunLabel,
    plaka: v.plaka || null,
    bitisTarihi: v.bitisTarihiMs
  });

  const tarihMetni = turkiyeSaatiniFormatla(kayit.bitisTarihi, { year: "numeric", month: "2-digit", day: "2-digit" });
  await sendText(
    from,
    `Yenileme kaydı eklendi ✅ ${v.musteriAdi} - ${v.urunLabel}${v.plaka ? ` (${v.plaka})` : ""} - ${tarihMetni}\n\nBu tarih yaklaşınca "Yaklaşan Yenilemeler" menüsünden takip edebilirsiniz.`
  );
  await devamMenuGoster(from, session);
}

// --- Yaklaşan Yenilemeler: kendi yenileme kayitlarindan yaklasanlari listeler ---
async function yenilemelerimGoster(from, session) {
  const yaklasanlar = yenilemeStore.yaklasanYenilemeleriGetir(30, from);

  if (yaklasanlar.length === 0) {
    await sendText(from, "Önümüzdeki 30 gün içinde yaklaşan bir yenileme kaydınız yok. 🎉");
    await devamMenuGoster(from, session);
    return;
  }

  const simdi = Date.now();
  const satirlar = yaklasanlar.map((y) => {
    const ikon = y.bitisTarihi < simdi ? "🔴" : "🟡";
    const tarihMetni = turkiyeSaatiniFormatla(y.bitisTarihi, { year: "numeric", month: "2-digit", day: "2-digit" });
    const plakaMetni = y.plaka ? ` (${y.plaka})` : "";
    return `${ikon} ${y.musteriAdi} - ${y.urun}${plakaMetni} - ${tarihMetni}`;
  });

  await sendText(from, `📅 Yaklaşan Yenilemeler (30 gün)\n\n${satirlar.join("\n")}`);
  await devamMenuGoster(from, session);
}

// --- SSS: sozlukSSS.js'teki TUM terim/urun aciklamalarini danismana dogrudan
// gosterir (27.07.2026 eklendi, kullanicinin talebi). sozlukSSS.js'in musteri
// tarafindaki otomatik "X nedir?" tetiklemesinden BAGIMSIZ, ayri bir giris
// noktasi - danisman menuden tikladiginda TUM icerigi (soru kalibi beklemeden)
// gorur.
async function sssGoster(from, session) {
  const [terimlerMetni, urunlerMetni] = sozlukSSS.tumSssIcerigiMesajlari();
  await sendText(from, terimlerMetni);
  await sendText(from, urunlerMetni);
  await devamMenuGoster(from, session);
}

// --- BES Fonları ---
// Fon KIMLIK bilgileri (kod/ad/risk/ana varlik yapisi) besFonVerileri.js'te
// SABIT olarak tutulur (bkz. o dosyanin basindaki aciklama - GETIRI
// YUZDELERI BILEREK burada YOK, cok cabuk eskir).
//
// NOT (22.07.2026): "Ekonomiye Göre Fon" (guncel ekonomi ozeti + risk
// profiline gore dinamik fon sepeti onerisi - eskiden ekonomiRaporuAnaliz.js
// araciligiyla Claude'un web aramasi ozelligini kullanarak calisiyordu)
// KULLANICI TALEBIYLE TAMAMEN KALDIRILDI - guvenilir calismadigi icin
// (web_search'e bagli iki API cagrisi zaman zaman basarisiz oluyordu).
// ekonomiRaporuAnaliz.js dosyasi da bu yuzden silindi. "BES Fonları" artik
// SADECE fon listesini (asagidaki besFonListesiGoster) gosterir - bu
// fonksiyon hala tefasGetiriAnaliz.js araciligiyla web aramasiyla GUNCEL
// GETIRI verisi cekmeye calisir, ama bu "best-effort" bir ek oldugu icin
// basarisiz olsa bile fon listesi YINE DE (getirisiz) gosterilmeye devam
// eder - o yuzden ayni guvenilirlik sorunu burada kullaniciyi
// engellemiyor/hata mesajiyla karsilastirmiyor.
//
// WhatsApp metin mesajlarinin gercek karakter siniri ~4096 - bir kategoride
// (orn. "Yüksek Riskli" 11 fon) tum fon bloklari tek mesaja sigmayabilir.
// Bu yuzden her kategori, bu sinirin altinda kalacak sekilde birden fazla
// mesaja bolunebilir (guvenlik payi birakmak icin sinirdan daha dusuk bir
// esik kullaniyoruz).
const WHATSAPP_MESAJ_KARAKTER_ESIGI = 3500;

function bloklariMesajGruplarinaBol(baslikUzunlugu, bloklar) {
  const gruplar = [];
  let mevcutGrup = [];
  let mevcutUzunluk = baslikUzunlugu;
  for (const blok of bloklar) {
    const ekUzunluk = blok.length + 2; // aralarina "\n\n" ekleniyor
    if (mevcutGrup.length > 0 && mevcutUzunluk + ekUzunluk > WHATSAPP_MESAJ_KARAKTER_ESIGI) {
      gruplar.push(mevcutGrup);
      mevcutGrup = [];
      mevcutUzunluk = baslikUzunlugu;
    }
    mevcutGrup.push(blok);
    mevcutUzunluk += ekUzunluk;
  }
  if (mevcutGrup.length > 0) gruplar.push(mevcutGrup);
  return gruplar;
}

// "Fon Listesini Gör" secildiginde TUM fonlari (21'i de) risk kategorisine
// gore gruplanmis sekilde, kisa bilgileriyle birlikte gosterir - artik ayrica
// bir kategori sec(im)i istemez. Ayrica tefasGetiriAnaliz.js araciligiyla
// once Garanti BBVA Emeklilik'in kendi resmi fon getirileri sayfasindan,
// bulunamazsa www.tefas.gov.tr'den (ve ilgili kaynaklardan) GUNCEL getiri
// yuzdelerini arastirmayi dener; bu "best-effort" bir ek oldugu icin BASARISIZ olsa
// bile (API hatasi, anahtar tanimsiz, hicbir fon icin veri bulunamamasi
// vb.) fon listesi YINE DE getirisiz olarak gosterilmeye devam eder - bir
// veri kaynagi sorunu, temel fon bilgisi gosterimini ASLA engellemez.
// WhatsApp mesaj uzunlugu sinirlarina takilmamak icin liste, TEK BIR dev
// mesaj yerine HER RISK KATEGORISI icin (gerekirse kategori icinde de
// birden fazla parcaya bolunerek) AYRI mesajlar olarak gonderilir.
async function besFonListesiGoster(from, session) {
  await sendText(from, "Fon listesini ve güncel getiri verilerini hazırlıyorum, bir saniye... 🔍");

  let getiriHaritasi = {};
  let getiriBulundu = false;
  try {
    getiriHaritasi = await fonGetirileriniGetir(BES_FONLARI.map((f) => f.kod));
    getiriBulundu = Object.keys(getiriHaritasi).length > 0;
  } catch (err) {
    console.error("Fon getirileri alinamadi (liste yine de getirisiz gosterilecek):", err.message);
  }

  const gruplar = fonlariKategoriyeGoreGrupla().filter((g) => g.fonlar.length > 0);
  for (const grup of gruplar) {
    const satirlar = grup.fonlar.map((f) => {
      const getiri = getiriHaritasi[f.kod];
      const getiriSatiri = getiri ? `Güncel Getiri: ${getiri}\n` : "";
      return (
        `*${f.kod}* - ${f.ad} (Risk ${f.riskDegeri}/7)\n` +
        `${f.aciklama}\n` +
        `Ana Varlık Yapısı: ${f.anaVarlikYapisi}\n` +
        `${getiriSatiri}` +
        `Karşılaştırma Ölçütü: ${f.karsilastirmaOlcutu}`
      );
    });
    const baslikMetni = `📋 ${grup.etiket}`;
    const parcalar = bloklariMesajGruplarinaBol(baslikMetni.length + 4, satirlar);
    for (let i = 0; i < parcalar.length; i++) {
      const sayfaEki = parcalar.length > 1 ? ` (${i + 1}/${parcalar.length})` : "";
      await sendText(from, `${baslikMetni}${sayfaEki}\n\n${parcalar[i].join("\n\n")}`);
    }
  }

  await sendText(
    from,
    getiriBulundu
      ? "ℹ️ Getiri verileri isteğiniz anında web'den (Garanti BBVA Emeklilik ve TEFAS kaynakları) araştırılmıştır - yaklaşık değerlerdir. Kesin ve güncel rakamlar için garantibbvaemeklilik.com.tr/urunler/emeklilik-yatirim-fonlarimiz/bes-fon-getirileri ya da tefas.gov.tr/tr/fon-getirileri adresini kontrol ediniz."
      : "ℹ️ Şu an güncel getiri verileri alınamadı. Kesin rakamlar için garantibbvaemeklilik.com.tr/urunler/emeklilik-yatirim-fonlarimiz/bes-fon-getirileri ya da tefas.gov.tr/tr/fon-getirileri adresini kontrol ediniz."
  );

  await devamMenuGoster(from, session);
}

// --- Belgelerin TOPLU/KARISIK sirada gonderilebilmesi (24.07.2026 geri
// bildirimi) icin yardimci fonksiyonlar ---

// Bir numara (from) icin, art arda gelen belge fotograflarinin BIRBIRINE
// KARISMADAN, her biri bir oncekinin islemi TAMAMEN bitmeden baslamayacak
// sekilde SIRAYLA islenmesini saglayan basit bir kuyruk. Bu olmadan, ayni
// session'a nerdeyse ayni anda gelen iki fotograf webhook'u, ikisi de
// "su an bekleyen ilk belge hangisi" sorusunu AYNI (eski) session durumuyla
// okuyup celisen guncellemeler yapabilirdi (bkz. asagida belgeFotografiIsle).
const belgeIslemSirasi = new Map();
function belgeIslemSirayaAl(from, gorev) {
  const onceki = belgeIslemSirasi.get(from) || Promise.resolve();
  const sonraki = onceki.then(gorev, gorev);
  // Zincirin bir sonraki fotografi engellememesi icin hatalari burada yutuyoruz
  // (gorev kendi ici try/catch ile zaten hatalari kullaniciya bildiriyor).
  belgeIslemSirasi.set(from, sonraki.catch(() => {}));
  return sonraki;
}

// Bir belge sorusu icin kisa, insan-okunur bir etiket - "Belge alındı ✅"
// onayinda ve "kalan belgeler" listesinde kullanilir.
function belgeKisaEtiket(soru) {
  return (soru && soru.kisaAd) || (soru && soru.dosyaAdi) || "belge";
}

// Su anda bekleyen (henuz kabul edilmemis VE skipIf'e gore atlanmamis) tum
// "tekli_foto_belge" tipi sorulari, session.satisSorular icindeki SIRAYLA
// dondurur. Belgeler artik KESINLIKLE sirayla gelmek zorunda olmadigi icin,
// "su anki tek bir soru" yerine tum bekleyen adaylari donduruyoruz - gelen
// bir fotografin hangisine ait oldugunu belgeFotografiIsle bu listeye gore
// tespit ediyor.
function belgeSorusuMu(soru) {
  return soru.type === "tekli_foto_belge" || soru.type === "cok_sayfali_foto_belge";
}

// Kimlik on/arka yuz cifti olusturan belge sorulari arasindaki eslesme
// (24.07.2026 geri bildirimi - "farklı bir kimliğin arka yüzünü kabul
// etmeyelim"): bir taraf kabul edildikten sonra diger taraf geldiginde,
// ikisinin ayni kimlige ait olup olmadigini kontrol edebilmek icin hangi
// soru id'sinin "ciftlendigini" burada tutuyoruz. Hem sigortalinin hem de
// (farkliysa) odeyenin kimlik on/arka sorulari icin ayri ayri tanimli.
const KIMLIK_ESLESEN_CIFT = {
  belge_kimlik_on: "belge_kimlik_arka",
  belge_kimlik_arka: "belge_kimlik_on",
  belge_kimlik_on_odeyen: "belge_kimlik_arka_odeyen",
  belge_kimlik_arka_odeyen: "belge_kimlik_on_odeyen"
};

function kalanBelgeSorulariniBul(session) {
  const tamamlanan = session.satisBelgeTamamlanan || [];
  return session.satisSorular.filter(
    (soru) => belgeSorusuMu(soru) && !(soru.skipIf && soru.skipIf(session.satisAnswers)) && !tamamlanan.includes(soru.id)
  );
}

// Kalan (henuz tamamlanmamis) belgeler arasinda, en az 1 sayfasi kabul edilmis
// ama HENUZ "bitti" denilmemis (tamamlanmis sayilmamis) bir "cok_sayfali_foto_belge"
// var mi diye bakar - varsa "bitti"/"tamam" komutunun hangi belgeyi kapatacagini
// bulmak icin kullanilir (bkz. asagida handleAdvisorMessage).
function devamEdenCokSayfaliBelgeyiBul(session) {
  const sayilar = session.satisCokSayfaliSayilar || {};
  return (
    kalanBelgeSorulariniBul(session).find(
      (soru) => soru.type === "cok_sayfali_foto_belge" && (sayilar[soru.id] || 0) > 0
    ) || null
  );
}

// Gelen bir belge fotografini, bekleyen belge sorulariyla eslestirip kabul
// eder/reddeder ve session'i (satisBelgeler, satisBelgeTamamlanan,
// satisSoruIndex) buna gore gunceller. Tum bekleyen belgeler tamamlaninca
// satisTamamla'yi kendisi cagirir.
async function belgeFotografiIsle(from, session, buffer, gercekMimeType) {
  const kalanlar = kalanBelgeSorulariniBul(session);
  if (kalanlar.length === 0) {
    await sendText(from, "Şu an bir fotoğraf/döküman beklemiyorum 🙂");
    return;
  }

  // Once, session.satisSoruIndex'in isaret ettigi (varsa) "sirali" beklenen
  // soruyu deniyoruz - belgeler beklenen sirayla geldiginde (yaygin durum) tek
  // bir analiz cagrisi yeterli oluyor. Eslesmezse (yanlis belge turu),
  // SIRAYLA diger bekleyen adaylari da deniyoruz - boylece belgeler HANGI
  // SIRAYLA/KARISIK gonderilirse gonderilsin dogru sekilde taninabiliyor.
  const suankiSoru = session.satisSorular[session.satisSoruIndex];
  const suankiKalandaMi = suankiSoru && kalanlar.includes(suankiSoru);
  const adaylar = suankiKalandaMi ? [suankiSoru, ...kalanlar.filter((s) => s !== suankiSoru)] : kalanlar;

  let eslesenSoru = null;
  let sonAnaliz = null;
  let analizAtlandi = false;

  for (const aday of adaylar) {
    let analiz = null;
    try {
      analiz = await belgeFotografiAnalizEt(buffer, gercekMimeType, aday.beklenenBelge, aday.imzaGerekli);
    } catch (err) {
      // Analiz hic yapilamiyorsa (orn. ANTHROPIC_API_KEY yok) tum adaylari
      // tek tek denemenin bir anlami yok - eski (analizsiz kabul) davranisina,
      // ilk (sirali) adayi kullanarak guvenli sekilde dusuyoruz.
      console.error("Belge foto analizi yapilamadi (belge yine de kabul edilecek):", err.message);
      analizAtlandi = true;
      eslesenSoru = adaylar[0];
      break;
    }
    sonAnaliz = analiz;
    if (analiz.dogruBelgeMi) {
      eslesenSoru = aday;
      break;
    }
  }

  if (!eslesenSoru) {
    const beklenenler = kalanlar.map((s) => `• ${belgeKisaEtiket(s)}`).join("\n");
    await sendText(
      from,
      `Bu fotoğraf beklediğim belgelerden hiçbirine benzemiyor 🤔 ${sonAnaliz && sonAnaliz.aciklama ? sonAnaliz.aciklama + "\n\n" : ""}` +
        `Hâlâ şu belgeleri bekliyorum:\n${beklenenler}\n\nLütfen bunlardan birinin fotoğrafını gönderir misiniz?`
    );
    return;
  }

  if (!analizAtlandi) {
    if (!sonAnaliz.netMi) {
      await sendText(
        from,
        `"${belgeKisaEtiket(eslesenSoru)}" için gönderdiğiniz fotoğraf yeterince net görünmüyor 😕 ${sonAnaliz.aciklama || ""}\n\nDaha iyi ışıkta, net bir şekilde tekrar çeker misiniz?`
      );
      return;
    }
    if (eslesenSoru.imzaGerekli && !sonAnaliz.imzaliMi) {
      await sendText(
        from,
        `"${belgeKisaEtiket(eslesenSoru)}" boş/imzasız bir şablon gibi görünüyor 🤔 ${sonAnaliz.aciklama || ""}\n\nLütfen doldurup imzalanmış halinin fotoğrafını gönderir misiniz?`
      );
      return;
    }
  }

  // Kimlik on/arka tutarlilik kontrolu (24.07.2026 geri bildirimi - "farklı
  // bir kimliğin arka yüzünü kabul etmeyelim"): eslesen soru bir kimlik on/
  // arka belgesiyse VE cifti (on<->arka) zaten kabul edilmisse, ikisinin ayni
  // kimlige ait olup olmadigini kontrol ediyoruz. SONRADAN gelen taraf
  // (yani su an isledigimiz eslesenSoru) uyusmuyorsa REDDEDIYORUZ - onceden
  // kabul edilmis olan taraf dokunulmadan kaliyor.
  const ciftSoruId = KIMLIK_ESLESEN_CIFT[eslesenSoru.id];
  if (ciftSoruId && session.satisBelgeTamamlanan.includes(ciftSoruId)) {
    const ciftSoru = session.satisSorular.find((s) => s.id === ciftSoruId);
    const ciftBelge = ciftSoru && session.satisBelgeler.find((b) => b.dosyaAdi === ciftSoru.dosyaAdi);
    if (ciftBelge) {
      try {
        const ciftBuffer = Buffer.from(ciftBelge.veriBase64, "base64");
        const yeniOnMu = eslesenSoru.id.includes("kimlik_on");
        const tutarlilik = await kimlikOnArkaTutarliMi(
          yeniOnMu ? buffer : ciftBuffer,
          yeniOnMu ? gercekMimeType : ciftBelge.mimeType,
          yeniOnMu ? ciftBuffer : buffer,
          yeniOnMu ? ciftBelge.mimeType : gercekMimeType
        );
        if (!tutarlilik.tutarliMi) {
          await sendText(
            from,
            `"${belgeKisaEtiket(eslesenSoru)}" olarak gönderdiğiniz fotoğraf, daha önce kabul ettiğim ` +
              `"${belgeKisaEtiket(ciftSoru)}" ile aynı kimliğe ait görünmüyor 🤔 ${tutarlilik.aciklama || ""}\n\n` +
              `Lütfen bu kimliğe ait doğru "${belgeKisaEtiket(eslesenSoru)}" fotoğrafını gönderir misiniz?`
          );
          return;
        }
      } catch (err) {
        console.error("Kimlik on/arka tutarlilik kontrolu yapilamadi (belge yine de kabul edilecek):", err.message);
      }
    }
  }

  if (eslesenSoru.type === "cok_sayfali_foto_belge") {
    session.satisCokSayfaliSayilar = session.satisCokSayfaliSayilar || {};
    const sayfaNo = (session.satisCokSayfaliSayilar[eslesenSoru.id] || 0) + 1;
    session.satisBelgeler.push({
      dosyaAdi: `${eslesenSoru.dosyaAdi}_${sayfaNo}.jpg`,
      mimeType: gercekMimeType,
      veriBase64: buffer.toString("base64")
    });
    session.satisCokSayfaliSayilar[eslesenSoru.id] = sayfaNo;

    if (sayfaNo >= eslesenSoru.maksSayfa) {
      // Azami sayfa sayisina ulasildi - danismana/musteriye sormadan otomatik
      // tamamlanmis sayiyoruz.
      session.satisBelgeTamamlanan = session.satisBelgeTamamlanan || [];
      session.satisBelgeTamamlanan.push(eslesenSoru.id);
      await belgeTamamlandiMesajiGonderVeDevamEt(from, session, eslesenSoru, `${sayfaNo}. sayfa alındı, azami sayfa sayısına ulaşıldı`);
      return;
    }

    // Henuz azami sayfaya ulasilmadi - belge hala "acik", "bitti" yazilana
    // kadar yeni sayfalar eklenmeye devam edebilir.
    await sendText(
      from,
      `"${belgeKisaEtiket(eslesenSoru)}" - ${sayfaNo}. sayfa alındı ✅\n\n` +
        `Bu belgenin başka sayfası varsa gönderebilirsiniz, hepsi bittiyse *"bitti"* yazmanız yeterli.`
    );
    return;
  }

  session.satisBelgeler.push({
    dosyaAdi: eslesenSoru.dosyaAdi,
    mimeType: gercekMimeType,
    veriBase64: buffer.toString("base64")
  });
  session.satisBelgeTamamlanan = session.satisBelgeTamamlanan || [];
  session.satisBelgeTamamlanan.push(eslesenSoru.id);

  await belgeTamamlandiMesajiGonderVeDevamEt(from, session, eslesenSoru, `"${belgeKisaEtiket(eslesenSoru)}" alındı`);
}

// belgeFotografiIsle ve "bitti" komutu tarafindan paylasilan ORTAK kapanis
// adimi: bir belge (tekli ya da coktan tamamlanmis cok sayfali) tamamlandi
// olarak isaretlendikten SONRA cagrilir - butun belgeler bittiyse satisTamamla'yi
// tetikler, bitmediyse kalan belgeleri hatirlatir. onEkMesaj, onay cumlesinin
// basina eklenen kisa aciklama (orn. "\"X\" alındı" ya da "3. sayfa alındı,
// azami sayfa sayısına ulaşıldı").
async function belgeTamamlandiMesajiGonderVeDevamEt(from, session, eslesenSoru, onEkMesaj) {
  const kalanSonrasi = kalanBelgeSorulariniBul(session);
  if (kalanSonrasi.length === 0) {
    await sendText(from, `${onEkMesaj} ✅ Tüm belgeler tamamlandı, hazırlıyorum...`);
    session.satisSoruIndex = session.satisSorular.length;
    await satisTamamla(from, session);
    return;
  }

  // satisSoruIndex'i, kalan (henuz kabul edilmemis) sorularin dizideki EN
  // KUCUK index'ine guncelliyoruz - boylece "geri al" ve bu adimda metin
  // yaziIrsa gosterilen uyari gibi index'e bagli diger kod parcalari,
  // belgeler karisik sirada kabul edilse bile tutarli kalmaya devam eder.
  session.satisSoruIndex = session.satisSorular.indexOf(kalanSonrasi[0]);

  const beklenenler = kalanSonrasi.map((s) => `• ${belgeKisaEtiket(s)}`).join("\n");
  await sendText(
    from,
    `${onEkMesaj} ✅\n\nKalan belgeler:\n${beklenenler}\n\nHepsini art arda (aramızda beklemeden) gönderebilirsiniz.`
  );
}

async function handleAdvisorMessage(from, parsed) {
  const session = getSession(from);

  // Musteri (danisman) bir foto/belge gonderdiyse: eger su an bir talebin
  // detayini goruntuluyorsa, dogrudan o talebe eklenir. Aksi halde nazikce
  // uyarilir. Guvenlik icin sadece PDF/Word/Excel/fotograf turleri kabul edilir.
  if (parsed.type === "media") {
    if (!dosyaTuruIzinliMi(parsed.mimeType)) {
      await sendText(
        from,
        "Bu dosya türünü kabul edemiyoruz 🙏 Sadece PDF, Word, Excel veya fotoğraf (jpg/png) gönderebilirsiniz."
      );
      return;
    }

    // Satis kaydi akisinda, en az bir "tekli_foto_belge" tipi soru
    // bekleniyorsa (KVKK metni, imza karti, yerlesim yeri belgesi, kimlik on/
    // arka yuz - sigortalidan ve/veya sigorta ettirenden) belge fotografini
    // once Claude gorsel analiziyle kontrol edip (net mi, dogru belge mi,
    // imzaGerekli isaretliyse gercekten doldurulup imzalanmis mi) sonra kabul
    // ediyoruz.
    //
    // NOT (24.07.2026 - "sırayla tek tek göndermek zorunda kalmasın kimse"):
    // belgeler artik KESIN bir sirayla gelmek zorunda degil - danisman/musteri
    // hepsini art arda gonderebilir. Hangi fotografin hangi bekleyen belgeye
    // ait oldugu belgeFotografiIsle tarafindan otomatik tespit ediliyor;
    // ayni numaradan nerdeyse ayni anda gelen fotograflarin birbirine
    // KARISMAMASI icin de belgeIslemSirayaAl ile sirayla (bir onceki
    // fotografin islemi tamamen bitmeden digeri baslamadan) isleniyor.
    if (session.state === "DANISMAN_SATIS_SORU" || session.state === "MUSTERI_SATIS_SORU") {
      const soru = session.satisSorular[session.satisSoruIndex];
      if (soru && belgeSorusuMu(soru)) {
        if (!parsed.mimeType || !parsed.mimeType.startsWith("image/")) {
          await sendText(from, "Bu adımda bir PDF/döküman değil, fotoğraf göndermeniz gerekiyor. Lütfen fotoğraf olarak gönderir misiniz? 📸");
          return;
        }
        await belgeIslemSirayaAl(from, async () => {
          try {
            const { buffer, mimeType } = await mediaIndir(parsed.mediaId);
            const gercekMimeType = parsed.mimeType || mimeType;
            await sendText(from, "Fotoğrafınızı inceliyorum, bir saniye... 🔍");
            await belgeFotografiIsle(from, session, buffer, gercekMimeType);
          } catch (err) {
            console.error("Satis belgesi indirilemedi:", err?.response?.data || err.message);
            await sendText(from, "Belgeyi kaydederken bir sorun oluştu, tekrar gönderir misiniz?");
          }
        });
        return;
      }
    }

    // Danismanin musteri adina olusturdugu yeni talep akisinda (bkz. yukarida
    // yeniTalepUrunSec/danismanSoruSor), Trafik/Kasko'nun "belge" tipi sorusu
    // (proforma/ruhsat OCR) gelirse - musteri akisiyla (conversationEngine.js'deki
    // message.type === "media" isleyicisi) AYNI analiz fonksiyonlarini
    // kullanarak isliyoruz, sadece sonuclari session.answers yerine
    // session.danismanYeniAnswers'a yaziyoruz.
    if (session.state === "DANISMAN_YENI_SORU") {
      const flow = flows[session.danismanYeniUrunKey];
      const soru = flow.questions[session.danismanYeniSoruIndex];
      if (!soru || soru.type !== "belge") {
        await sendText(from, "Şu an bir fotoğraf/belge beklemiyoruz, lütfen cevabınızı yazılı olarak paylaşır mısınız? 🙏");
        return;
      }
      const mimeGecerliMi =
        parsed.mimeType && (parsed.mimeType.startsWith("image/") || parsed.mimeType === "application/pdf");
      if (!mimeGecerliMi) {
        await sendText(from, "Lütfen belgeyi fotoğraf ya da PDF olarak gönderir misiniz? 🙏");
        return;
      }
      try {
        const { buffer, mimeType } = await mediaIndir(parsed.mediaId);
        const gercekMime = parsed.mimeType || mimeType;
        await sendText(from, "Belgenizi inceliyorum, bir saniye... 🔍");

        if (soru.belgeTuru === "proforma") {
          const sonuc = await proformaAnalizEt(buffer, gercekMime);
          if (!sonuc.okunabilir) {
            await sendText(
              from,
              `Belgeyi net okuyamadım 😕 ${sonuc.aciklama || ""}\n\n` +
                "Proforma belgesini (fotoğraf ya da PDF olarak) tekrar gönderir misiniz?"
            );
            return;
          }
          if (sonuc.marka) session.danismanYeniAnswers.marka = sonuc.marka;
          if (sonuc.model) session.danismanYeniAnswers.model = sonuc.model;
          if (sonuc.motorNo) session.danismanYeniAnswers.motor_no = sonuc.motorNo;
          if (sonuc.sasiNo) session.danismanYeniAnswers.sasi_no = sonuc.sasiNo;
          if (sonuc.modelYili) session.danismanYeniAnswers.model_yili = sonuc.modelYili;
          if (sonuc.adSoyad) session.danismanYeniAnswers.proforma_ad_soyad = sonuc.adSoyad;
          if (sonuc.tcKimlik && tcKimlikGecerliMi(sonuc.tcKimlik)) session.danismanYeniAnswers.tc_kimlik = sonuc.tcKimlik;
          if (sonuc.plaka) session.danismanYeniAnswers.plaka = sonuc.plaka;

          if (!session.danismanYeniEkBelgeler) session.danismanYeniEkBelgeler = [];
          session.danismanYeniEkBelgeler.push({
            dosyaAdi: gercekMime === "application/pdf" ? "proforma.pdf" : "proforma.jpg",
            mimeType: gercekMime,
            veriBase64: buffer.toString("base64")
          });
          await sendText(from, "Proforma belgesini inceledim, teşekkürler ✅");
        } else {
          const sonuc = await ruhsatFotografiAnalizEt(buffer, gercekMime);
          if (!sonuc.okunabilir) {
            await sendText(
              from,
              `Ruhsatı net okuyamadım 😕 ${sonuc.aciklama || ""}\n\n` +
                "Lütfen tüm bilgilerin net göründüğü, iyi ışıkta bir fotoğraf çeker misiniz?"
            );
            return;
          }
          if (sonuc.plaka) session.danismanYeniAnswers.plaka = sonuc.plaka;
          if (sonuc.marka) session.danismanYeniAnswers.marka = sonuc.marka;
          if (sonuc.model) session.danismanYeniAnswers.model = sonuc.model;
          if (sonuc.motorNo) session.danismanYeniAnswers.motor_no = sonuc.motorNo;
          if (sonuc.sasiNo) session.danismanYeniAnswers.sasi_no = sonuc.sasiNo;
          if (sonuc.adSoyad) session.danismanYeniAnswers.ruhsat_ad_soyad = sonuc.adSoyad;
          if (sonuc.tcKimlik && tcKimlikGecerliMi(sonuc.tcKimlik)) session.danismanYeniAnswers.tc_kimlik = sonuc.tcKimlik;

          if (!session.danismanYeniEkBelgeler) session.danismanYeniEkBelgeler = [];
          session.danismanYeniEkBelgeler.push({
            dosyaAdi: "ruhsat.jpg",
            mimeType: gercekMime,
            veriBase64: buffer.toString("base64")
          });
          await sendText(from, "Ruhsat fotoğrafını inceledim, teşekkürler ✅");
        }

        // Soru cevaplanmis sayilsin diye isaretliyoruz (gercek veri yukarida
        // ayri alanlara yazildi - bkz. danismanYeniTalepiTamamla/ozetlenecekSorular).
        session.danismanYeniAnswers[soru.id] = true;

        session.danismanYeniSoruIndex = sonrakiGecerliIndex(
          flow.questions,
          session.danismanYeniAnswers,
          session.danismanYeniSoruIndex + 1
        );
        if (session.danismanYeniSoruIndex >= flow.questions.length) {
          await danismanYeniTalepiTamamla(from, session);
        } else {
          await danismanSoruSor(from, session);
        }
      } catch (err) {
        console.error("Danisman yeni talep - belge analizi hatasi:", err?.response?.data || err.message);
        await sendText(from, "Belgeyi analiz ederken bir sorun oluştu 🙏 Lütfen tekrar gönderir misiniz?");
      }
      return;
    }

    if (session.state === "DANISMAN_LEAD_DETAY" && session.danismanSeciliLeadId) {
      try {
        const { buffer, mimeType } = await mediaIndir(parsed.mediaId);
        const lead = leadStore.belgeEkle(session.danismanSeciliLeadId, {
          dosyaAdi: parsed.dosyaAdi,
          mimeType: parsed.mimeType || mimeType,
          veriBase64: buffer.toString("base64")
        });
        await sendText(from, "Belge talebe eklendi ✅");
        if (lead) await leadDetayGoster(from, session, lead);
        else await devamMenuGoster(from, session);
      } catch (err) {
        console.error("Belge indirilemedi/eklenemedi:", err?.response?.data || err.message);
        await sendText(from, "Belgeyi kaydederken bir sorun oluştu, tekrar dener misiniz?");
      }
      return;
    }
    // Musteri kendi satis talebi akisinin ortasinda (ama su an fotograf
    // BEKLENMEYEN bir soruda - orn. metin/secim sorusu) bir dosya
    // gonderirse, danisman paneline ozel fallback mesaji ("Taleplerimi
    // Gör...") yerine soruyu tekrarlayan nazik bir uyari veriyoruz.
    if (session.state === "MUSTERI_SATIS_SORU") {
      await sendText(from, "Şu an bir fotoğraf/döküman beklemiyorum 🙂 Az önceki soruyu yazıyla yanıtlar mısınız?");
      await satisSoruSor(from, session);
      return;
    }

    // Buraya kadar gelindiyse (aktif bir soru/belge akisi yok - danisman
    // menu/bos seviyede) VE gonderilen bir fotografsa, otomatik olarak bir
    // "Araç Satış Sözleşmesi" (noter onaylı) olup olmadigini kontrol ediyoruz.
    // Boylece danisman ozel bir menu secmeden, sadece belgeyi gonderdigi an
    // bot taniyip TC/plaka/motor no/sasi no bilgilerini cikariyor ve
    // Bahadır'a "Satıştan İptal Talebi" olarak yonlendiriyor (bkz.
    // satisSozlesmesiAnaliz.js, satistanIptalTalebiOlustur). Sadece fotograf
    // icin calisir (PDF/Word/Excel Vision API'ye gonderilemez). Belge bu tur
    // degilse (aracSatisSozlesmesiMi=false) ya da analiz herhangi bir sebeple
    // basarisiz olursa (orn. ANTHROPIC_API_KEY tanimli degil), SESSIZCE
    // asagidaki eski/genel red mesajina duselim - bu yeni ozellik mevcut
    // davranisi asla bozmamali.
    if (parsed.mimeType && parsed.mimeType.startsWith("image/")) {
      try {
        const { buffer, mimeType } = await mediaIndir(parsed.mediaId);
        const gercekMimeType = parsed.mimeType || mimeType;
        const analiz = await satisSozlesmesiAnalizEt(buffer, gercekMimeType);
        if (analiz.aracSatisSozlesmesiMi) {
          if (!analiz.netMi) {
            await sendText(
              from,
              `Bu bir araç satış sözleşmesi gibi görünüyor ama fotoğraf yeterince net değil 😕 ${analiz.aciklama || ""}\n\nDaha net bir fotoğraf gönderir misiniz?`
            );
            return;
          }
          await satistanIptalTalebiOlustur(from, analiz, buffer, gercekMimeType);
          await devamMenuGoster(from, session);
          return;
        }
        // aracSatisSozlesmesiMi false: bu tanimadigimiz baska bir belge -
        // asagidaki genel red mesajina (mevcut davranis) dusuyoruz.
      } catch (err) {
        console.error("Satis sozlesmesi foto analizi yapilamadi (genel red mesajina dusuluyor):", err.message);
      }
    }

    await sendText(
      from,
      "Bu belgeyi bir talebe eklemek için önce 'Taleplerimi Gör' ile ilgili talebi açmanız gerekiyor."
    );
    return;
  }

  let userText = parsed.type === "text" ? parsed.text.trim() : parsed.interactiveTitle;

  // 29.07.2026 eklendi: kullanicinin talebi uzerine - panele hic girmeden,
  // dogrudan WhatsApp'tan yazilan serbest metin komutlarla kalici numara
  // engelleme/kaldirma/listeleme. Sadece Bahadır ve Enbel (YONETICI_NUMARALARI)
  // kullanabilir - "engelle"/"engel kaldır" gibi genel bir metin komutunun her
  // danismanda acik olmasi, ilgisiz bir talebin akisinda yanlislikla
  // tetiklenme riskini artirirdi. Talep detayindaki "🚫 Numarayı Engelle"
  // menu secenegi (bkz. DANISMAN_LEAD_DETAY case'i) ise TUM danismanlara
  // acik - o zaten belirli, o an ekranda goruntulenen bir talebe baglidir ve
  // ayrica bir onay adimi (DANISMAN_LEAD_ENGELLE_ONAY) gerektirir.
  // Bu blok hangi state'te olunursa olsun (switch'ten ONCE) calisir - "menu"/
  // "iptal" kisayolunun asagidaki calisma sekliyle AYNI mantik.
  if (parsed.type === "text" && YONETICI_NUMARALARI.includes(from)) {
    const kucukMetin = (userText || "").toLocaleLowerCase("tr").trim();

    if (/^engelliler\s*[!.?]?$/.test(kucukMetin)) {
      const liste = engelliNumaralarStore.tumEngelliNumaralariGetir();
      if (!liste.length) {
        await sendText(from, "Şu an engellenmiş bir numara yok. 🎉");
      } else {
        const satirlar = liste.map(
          (k) => `🚫 ${k.numara}${k.not ? ` - ${k.not}` : ""}${k.engelleyenAdi ? ` (${k.engelleyenAdi})` : ""}`
        );
        await sendText(from, `Engelli numaralar (${liste.length}):\n\n${satirlar.join("\n")}`);
      }
      return;
    }

    const engelleEslesme = kucukMetin.match(/^engelle\s+(.+)$/);
    if (engelleEslesme) {
      const girilenNumara = engelleEslesme[1].trim();
      if (!telefonGecerliMi(girilenNumara)) {
        await sendText(
          from,
          `Bu numarayı tanıyamadım 🙏 Lütfen "05XX XXX XX XX" formatında yazar mısınız? (Örn: engelle 0532 123 45 67)`
        );
        return;
      }
      const numara = telefonUluslararasiFormata(girilenNumara);
      const ekleyen = danismaniBul(from);
      engelliNumaralarStore.numarayiEngelle(numara, "Komutla engellendi", ekleyen ? ekleyen.name : null);
      await sendText(
        from,
        `🚫 ${numara} numarası kalıcı olarak engellendi. Bu numaradan gelen mesajlara bot artık hiç cevap vermeyecek.\n\nGeri almak isterseniz: "engel kaldır ${girilenNumara}"`
      );
      return;
    }

    const kaldirEslesme = kucukMetin.match(/^engel\s*kaldır\s+(.+)$/);
    if (kaldirEslesme) {
      const girilenNumara = kaldirEslesme[1].trim();
      const numara = telefonGecerliMi(girilenNumara) ? telefonUluslararasiFormata(girilenNumara) : girilenNumara;
      const kaldirildiMi = engelliNumaralarStore.engeliKaldir(numara);
      await sendText(
        from,
        kaldirildiMi
          ? `✅ ${numara} numarasının engeli kaldırıldı. Bot bu numaraya artık normal şekilde cevap verecek.`
          : `${numara} numarası zaten engelli değildi.`
      );
      return;
    }
  }

  // Her zaman "menu"/"iptal"/"geri" ya da bir selamlasma ("merhaba" vb.)
  // yazarak karsilama ekranina donulebilir. Selamlasma kelimelerinin de bu
  // listede olmasi onemli: danisman uzun bir aradan sonra tekrar yazdiginda
  // (orn. eski bir alt akisin - Bekleyen Is listesi gibi - ortasinda takili
  // kalmis bir oturuma "merhaba" derse) once sicak bir karsilamayla
  // baslamasi lazim, kaldigi yerden (ilgisiz eski bir ekranla) devam etmesi
  // degil.
  // NOT: "evet" bu listeden CIKARILDI - birden fazla soruda (orn. "Sigortalı
  // Türkiye Cumhuriyeti vatandaşı mı?", elementer akistaki "Uzman mısınız?"
  // gibi) gecerli bir "Evet"/"Hayır" cevap secenegi oldugu icin, bu kelime
  // burada kalsaydi danisman soruyu normal cevapladiginda (sadece "Evet"
  // yazarak) akis yanlislikla bastan ana menuye donuyordu - cevap hic
  // kaydedilmiyordu. "Hayır" boyle bir catisma yaratmiyor cunku zaten bu
  // listede hic yoktu.
  // Musteri kendi satis talebi akisindaysa ("MUSTERI_SATIS_SORU") bu kisayol
  // ASLA danismanin ana menusunu (karsilamaGoster) gostermemeli - musteriye
  // internal panel menusu sizmasin diye once bunu ayirt ediyoruz (bkz.
  // musteriSatisIptalEt).
  if (
    parsed.type === "text" &&
    /^(men[uü]|iptal|geri|merhaba|selam|slm|mrb|hey|hi|hello|g[uü]naydin|iyi g[uü]nler)$/i.test(userText || "")
  ) {
    if (session.state === "MUSTERI_SATIS_SORU") {
      await musteriSatisIptalEt(from, session);
    } else {
      await karsilamaGoster(from, session);
    }
    return;
  }

  switch (session.state) {
    case "DANISMAN_KARSILAMA": {
      // WhatsApp'in dugme/liste basliklarini kestigi durumlarda (asagida
      // aciklandigi gibi) geri gelen metin orijinal secenekle birebir
      // eslesmeyebilir - matchOption ile (kismi/onek eslesmesi) dogru
      // secenegi geri buluyoruz.
      userText = matchOption(userText, ANA_MENU_SECENEKLERI) || userText;
      // Menu etiketleri 24.07.2026 geri bildirimiyle degisti: "Yeni İş
      // Talebi" -> "Elementer Teklif Al", "BES Hayat Satış" -> "BES Hayat
      // Başvurusu" (fonksiyon adlari/ic mantik degismedi, sadece gorunen metin).
      if (userText === "Elementer Teklif Al") {
        await yeniTalepUrunSec(from, session);
        return;
      }
      if (userText === "BES Hayat Başvurusu") {
        await satisBaslat(from, session);
        return;
      }
      if (userText === "Bekleyen İş") {
        await anaMenuGoster(from, session);
        return;
      }
      if (userText === "Destek Talebi Oluştur") {
        await destekTalebiAciklamaGoster(from, session);
        return;
      }
      if (userText === "Yaklaşan Yenilemeler") {
        await yenilemelerimGoster(from, session);
        return;
      }
      if (userText === "Yenileme Takibi Ekle") {
        await yenilemeBaslat(from, session);
        return;
      }
      if (userText === "BES Fonları") {
        await besFonListesiGoster(from, session);
        return;
      }
      if (userText === "Doküman Merkezi") {
        await formUrunSec(from, session);
        return;
      }
      if (userText === "SSS") {
        await sssGoster(from, session);
        return;
      }
      if (userText === "Performansım") {
        await performansGoster(from, session);
        return;
      }
      // "Senin için yapabileceğim başka bir şey var mı?" sorusuna "hayır yok
      // teşekkürler" tarzı bir kapanış cevabi gelirse, ana menuyu tekrar
      // basa donup gostermek yerine sicak bir kapanis cumlesiyle karsilik
      // veriyoruz.
      if (KARSILAMA_KAPANIS_REGEX.test(userText)) {
        await sendText(from, "Rica ederim, her zaman buradayım 🙌 Yeni satışlarını bekliyorum!");
        return;
      }
      await karsilamaGoster(from, session);
      return;
    }

    // --- Satis kaydi: urun secimi (Hayat / BES) ---
    case "DANISMAN_SATIS_URUN_SEC": {
      userText = matchOption(userText, SATIS_URUN_SECENEKLERI) || userText;
      if (userText === "Hayat Sigortası") {
        await sendText(from, "📝 Prim İadeli Hayat Sigortası satış kaydı başlatıyoruz.");
        await satisAkisiBaslat(from, session, "hayat", SATIS_SORULARI_HAYAT);
        return;
      }
      if (userText === "BES") {
        session.state = "DANISMAN_SATIS_BES_TIP_SEC";
        await sendButtons(from, "BES için Yeni İş mi, yoksa Aktarım mı?", ["Yeni İş", "Aktarım"]);
        return;
      }
      await satisBaslat(from, session);
      return;
    }

    // --- Satis kaydi: BES icin Yeni Is / Aktarim secimi ---
    case "DANISMAN_SATIS_BES_TIP_SEC": {
      userText = matchOption(userText, ["Yeni İş", "Aktarım"]) || userText;
      if (userText === "Yeni İş") {
        await sendText(from, "📝 Bireysel Emeklilik Sistemi (BES) - Yeni İş satış kaydı başlatıyoruz.");
        await satisAkisiBaslat(from, session, "bes_yeni_is", SATIS_SORULARI_BES_YENI_IS);
        return;
      }
      if (userText === "Aktarım") {
        await sendText(from, "📝 Bireysel Emeklilik Sistemi (BES) - Aktarım satış kaydı başlatıyoruz.");
        await satisAkisiBaslat(from, session, "bes_aktarim", SATIS_SORULARI_BES_AKTARIM);
        return;
      }
      await sendButtons(from, "BES için Yeni İş mi, yoksa Aktarım mı?", ["Yeni İş", "Aktarım"]);
      return;
    }

    case "DANISMAN_FORM_URUN_SEC": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await formUrunSec(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const urunKey = (session.danismanFormUrunAnahtarlari || [])[index];
      const urun = urunKey && flows[urunKey];
      if (!urun) {
        await formUrunSec(from, session);
        return;
      }
      const dokuman = dokumanStore.dokumanGetir(urunKey);
      if (!dokuman) {
        await sendText(
          from,
          `${urun.label} için henüz bir form/doküman yüklenmemiş. Panelden yüklenmesini isteyebilirsiniz.`
        );
      } else {
        try {
          const buffer = Buffer.from(dokuman.veriBase64, "base64");
          await sendDocument(from, buffer, dokuman.mimeType, dokuman.dosyaAdi);
        } catch (err) {
          console.error("Form gonderilemedi:", err?.response?.data || err.message);
          await sendText(from, "Formu gönderirken bir sorun oluştu, tekrar dener misiniz?");
        }
      }
      await devamMenuGoster(from, session);
      return;
    }

    case "DANISMAN_LEAD_SECIMI": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await anaMenuGoster(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const leadId = (session.danismanLeadListesi || [])[index];
      const lead = leadId && leadStore.leadGetir(leadId);
      if (!lead) {
        await anaMenuGoster(from, session);
        return;
      }
      await leadDetayGoster(from, session, lead);
      return;
    }

    case "DANISMAN_LEAD_DETAY": {
      userText = matchOption(userText, ["Not Ekle", "Durum Değiştir", "Hatırlatma Kur", "🚫 Numarayı Engelle"]) || userText;
      if (userText === "Not Ekle") {
        session.state = "DANISMAN_NOT_BEKLE";
        await sendText(from, "Notunuzu yazar mısınız?");
        return;
      }
      if (userText === "Durum Değiştir") {
        session.state = "DANISMAN_DURUM_BEKLE";
        await sendList(from, "Yeni durumu seçin:", "Durum Seç", leadStore.DURUMLAR);
        return;
      }
      if (userText === "Hatırlatma Kur") {
        session.state = "DANISMAN_HATIRLATMA_TARIH_BEKLE";
        await sendText(
          from,
          "Hangi tarih ve saatte hatırlatalım? (GG.AA.YYYY SS:DD formatında, örn: 16.07.2026 09:00)"
        );
        return;
      }
      // 29.07.2026 eklendi: kullanicinin talebi uzerine - bir talebin
      // musterisinin numarasini, panele hic girmeden dogrudan WhatsApp'tan
      // KALICI olarak engelleyebilme. Yanlislikla tetiklenmesin diye once
      // bir onay soruluyor (bkz. DANISMAN_LEAD_ENGELLE_ONAY) - panel.html'deki
      // ayni ozellik icin kullanilan window.confirm ile AYNI guvenlik onlemi.
      if (userText === "🚫 Numarayı Engelle") {
        const lead = leadStore.leadGetir(session.danismanSeciliLeadId);
        if (!lead) {
          await devamMenuGoster(from, session);
          return;
        }
        session.state = "DANISMAN_LEAD_ENGELLE_ONAY";
        await sendButtons(
          from,
          `${lead.telefon} (${lead.musteriAdi || "isimsiz"}) numarasını KALICI olarak engellemek istediğinize emin misiniz? Bu numaradan gelen mesajlara bot bir daha asla cevap vermeyecek. Geri almak isterseniz daha sonra "engel kaldır ${lead.telefon}" yazabilirsiniz.`,
          ["Evet, Engelle", "Vazgeç"]
        );
        return;
      }
      await karsilamaGoster(from, session);
      return;
    }

    case "DANISMAN_LEAD_ENGELLE_ONAY": {
      userText = matchOption(userText, ["Evet, Engelle", "Vazgeç"]) || userText;
      const lead = leadStore.leadGetir(session.danismanSeciliLeadId);
      if (userText === "Evet, Engelle" && lead) {
        const ekleyen = danismaniBul(from);
        engelliNumaralarStore.numarayiEngelle(lead.telefon, `Talep üzerinden engellendi (${lead.urun})`, ekleyen ? ekleyen.name : null);
        await sendText(from, `🚫 ${lead.telefon} numarası kalıcı olarak engellendi. Bot bu numaraya bir daha cevap vermeyecek.`);
        await leadDetayGoster(from, session, lead);
        return;
      }
      if (lead) {
        await sendText(from, "Vazgeçildi, numara engellenmedi.");
        await leadDetayGoster(from, session, lead);
      } else {
        await devamMenuGoster(from, session);
      }
      return;
    }

    case "DANISMAN_NOT_BEKLE": {
      const lead = leadStore.notEkle(session.danismanSeciliLeadId, userText);
      await sendText(from, "Not eklendi ✅");
      if (lead) {
        // 27.07.2026 eklendi: WhatsApp'tan (herhangi bir danisman/Bahadır/Enbel
        // tarafindan) not eklendiginde de ilgili herkese bilgilendirme gitsin.
        const ekleyen = danismaniBul(from);
        conversationEngine
          .notEklendiBildirimiGonder(lead, userText, ekleyen ? ekleyen.name : null, from)
          .catch((err) => console.error("WhatsApp'tan not bildirimi gonderilemedi:", err));
        await leadDetayGoster(from, session, lead);
      } else {
        await devamMenuGoster(from, session);
      }
      return;
    }

    case "DANISMAN_DURUM_BEKLE": {
      userText = matchOption(userText, leadStore.DURUMLAR) || userText;
      if (!leadStore.DURUMLAR.includes(userText)) {
        await sendList(from, "Lütfen listeden bir durum seçin:", "Durum Seç", leadStore.DURUMLAR);
        return;
      }
      const lead = leadStore.durumGuncelle(session.danismanSeciliLeadId, userText);
      await sendText(from, `Durum "${userText}" olarak güncellendi ✅`);
      if (userText === "Olumlu Kapandı" || userText === "Olumsuz Kapandı" || !lead) {
        await devamMenuGoster(from, session);
      } else {
        await leadDetayGoster(from, session, lead);
      }
      return;
    }

    case "DANISMAN_HATIRLATMA_TARIH_BEKLE": {
      const zamanMs = tarihSaatDogrula(userText);
      if (!zamanMs) {
        await sendText(
          from,
          "Lütfen GG.AA.YYYY SS:DD formatında yazar mısınız? (Örn: 16.07.2026 09:00)"
        );
        return;
      }
      if (zamanMs < Date.now()) {
        await sendText(from, "Bu tarih geçmişte kalmış görünüyor, lütfen ileri bir tarih yazar mısınız?");
        return;
      }
      session.danismanHatirlatmaZamanMs = zamanMs;
      session.state = "DANISMAN_HATIRLATMA_NOT_BEKLE";
      await sendText(from, "Hatırlatma notu nedir? (Örn: 'Çarşamba sabahı aramamı istedi')");
      return;
    }

    case "DANISMAN_HATIRLATMA_NOT_BEKLE": {
      const lead = leadStore.hatirlatmaKur(
        session.danismanSeciliLeadId,
        session.danismanHatirlatmaZamanMs,
        userText
      );
      await sendText(from, "Hatırlatma kuruldu ⏰ Zamanı gelince otomatik haber vereceğim.");
      if (lead) await leadDetayGoster(from, session, lead);
      else await devamMenuGoster(from, session);
      return;
    }

    // --- Yeni talep olusturma akisi ---
    case "DANISMAN_YENI_URUN_SEC": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await yeniTalepUrunSec(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const urunKey = (session.danismanUrunAnahtarlari || [])[index];
      if (!urunKey || !flows[urunKey]) {
        await yeniTalepUrunSec(from, session);
        return;
      }
      session.danismanYeniUrunKey = urunKey;
      session.danismanYeniAnswers = {};
      // Onceki bir "yeni talep" akisindan kalmis olabilecek belge/aile_dongu
      // durumunu temizliyoruz - aksi halde onceki talepteki proforma/ruhsat
      // belgeleri ya da yarim kalmis aile toplama asamasi yeni talebe sizabilir.
      session.danismanYeniEkBelgeler = [];
      session.danismanSaglikAileAsama = null;
      session.danismanSaglikAileGecici = null;
      session.state = "DANISMAN_YENI_TELEFON_BEKLE";
      await sendText(
        from,
        "Sigortalının telefon numarasını (başında ülke koduyla, örn: 905551234567 şeklinde) paylaşır mısınız?"
      );
      return;
    }

    case "DANISMAN_YENI_TELEFON_BEKLE": {
      const temiz = (userText || "").replace(/\D/g, "");
      if (temiz.length < 10 || temiz.length > 15) {
        await sendText(
          from,
          "Lütfen geçerli bir telefon numarası yazar mısınız? (Başında ülke koduyla, örn: 905551234567 şeklinde)"
        );
        return;
      }
      session.danismanYeniTelefon = temiz;
      const flow = flows[session.danismanYeniUrunKey];
      session.danismanYeniSoruIndex = sonrakiGecerliIndex(flow.questions, session.danismanYeniAnswers, 0);
      session.state = "DANISMAN_YENI_SORU";
      await danismanSoruSor(from, session);
      return;
    }

    case "DANISMAN_YENI_SORU": {
      const flow = flows[session.danismanYeniUrunKey];

      // "geri al" - bkz. DANISMAN_SATIS_SORU'daki ayni ozellik icin yorum.
      if (GERI_AL_REGEX.test(userText)) {
        // Su anki soru "aile_dongu" ise ve aile toplama alt-akisi yarim
        // kalmissa, once bu alt-akisin durumunu temizliyoruz - aksi halde
        // bu soruya tekrar gelindiginde (or. baska bir "geri al" ya da ileri
        // gidip tekrar donulmesiyle) yarim kalmis asamadan devam eder,
        // basa (ES_SORULUYOR'dan) baslamaz.
        const suankiSoru = flow.questions[session.danismanYeniSoruIndex];
        if (suankiSoru && suankiSoru.type === "aile_dongu" && session.danismanSaglikAileAsama) {
          session.danismanSaglikAileAsama = null;
          session.danismanSaglikAileGecici = null;
        }
        const oncekiIndex = oncekiGecerliIndex(
          flow.questions,
          session.danismanYeniAnswers,
          session.danismanYeniSoruIndex - 1
        );
        if (oncekiIndex < 0) {
          await sendText(from, "Geri alınacak bir önceki adım yok, bu ilk soru 🙂");
          await danismanSoruSor(from, session);
          return;
        }
        const oncekiSoru = flow.questions[oncekiIndex];
        delete session.danismanYeniAnswers[oncekiSoru.id];
        session.danismanYeniSoruIndex = oncekiIndex;
        await sendText(from, "Tamam, bir önceki adıma dönüyorum ⏪");
        await danismanSoruSor(from, session);
        return;
      }

      const soru = flow.questions[session.danismanYeniSoruIndex];

      // "belge" tipi (Trafik/Kasko proforma/ruhsat OCR) - cevap SADECE bir
      // fotograf/PDF gonderilerek verilebilir (bkz. handleAdvisorMessage'daki
      // media isleyici), yaziyla gelen bir cevabi kabul etmiyoruz.
      if (soru.type === "belge") {
        await sendText(
          from,
          "Bu adımda bir belge (fotoğraf ya da PDF) göndermeniz gerekiyor, lütfen belgeyi WhatsApp üzerinden gönderir misiniz? 📎"
        );
        return;
      }

      // "aile_dongu" tipi (Ozel Saglik/TSS esin/cocuklarin toplanmasi) - gercek
      // soru-cevap akisi tamamen conversationEngine.js'deki motora devrediliyor
      // (bkz. danismanAileShimOlustur yorumu). Motor "true" donduren kadar
      // (yani aile toplama TAMAMEN bitene kadar) her cevap burada islenip
      // sonraki alt-soru zaten motorun kendisi tarafindan gonderiliyor.
      if (soru.type === "aile_dongu") {
        const tamamlandiMi = await conversationEngine.saglikAileCevabiIsle(
          from,
          danismanAileShimOlustur(session),
          userText
        );
        if (!tamamlandiMi) return;
        session.danismanSaglikAileAsama = null;
        session.danismanSaglikAileGecici = null;
        // Soru cevaplanmis sayilsin diye isaretliyoruz (gercek veri zaten
        // yukarida answers.saglik_kisiler dizisine yazildi - bu true degeri
        // sadece ozette bu sorunun kendisinin GORUNMEMESI icin
        // ozetlenecekSorular tarafindan zaten filtreleniyor).
        session.danismanYeniAnswers[soru.id] = true;
        session.danismanYeniSoruIndex = sonrakiGecerliIndex(
          flow.questions,
          session.danismanYeniAnswers,
          session.danismanYeniSoruIndex + 1
        );
        if (session.danismanYeniSoruIndex >= flow.questions.length) {
          await danismanYeniTalepiTamamla(from, session);
        } else {
          await danismanSoruSor(from, session);
        }
        return;
      }

      if (soru.type === "choice") {
        const secilen = matchOption(userText, soru.options);
        if (!secilen) {
          const metin = conversationEngine.resolveDanismanText(soru, session.danismanYeniAnswers);
          if (soru.options.length > 3) await sendList(from, metin, "Seçin", soru.options);
          else await sendButtons(from, metin, soru.options);
          return;
        }
        session.danismanYeniAnswers[soru.id] = secilen;
      } else {
        if (soru.validate && !soru.validate(userText, session.danismanYeniAnswers)) {
          const hint =
            typeof soru.validationError === "function"
              ? soru.validationError(userText, session.danismanYeniAnswers)
              : soru.validationError || "Bu bilgi doğru formatta görünmüyor, lütfen tekrar dener misiniz?";
          await sendText(from, hint);
          return;
        }
        session.danismanYeniAnswers[soru.id] = userText;
      }

      if (soru.tepki) {
        const tepkiMesaji = soru.tepki(session.danismanYeniAnswers[soru.id]);
        if (tepkiMesaji) await sendText(from, tepkiMesaji);
      }

      session.danismanYeniSoruIndex = sonrakiGecerliIndex(
        flow.questions,
        session.danismanYeniAnswers,
        session.danismanYeniSoruIndex + 1
      );

      if (session.danismanYeniSoruIndex >= flow.questions.length) {
        await danismanYeniTalepiTamamla(from, session);
      } else {
        await danismanSoruSor(from, session);
      }
      return;
    }

    // --- Satis kaydi akisi ---
    // Musteri kendi kendine satis talebi olustururken (MUSTERI_SATIS_SORU)
    // AYNI soru/cevap/geri-al mantigini paylasiyor - tek fark hangi soru
    // listesinin (session.satisSorular icindeki 2. sahis metinleri, bkz.
    // hitapEt) ve hangi tamamlanma davranisinin (satisTamamla icindeki
    // musteriKendiKendine kontrolu) kullanildigi, o da session.satisAnswers
    // uzerinden zaten otomatik cozuluyor.
    case "DANISMAN_SATIS_SORU":
    case "MUSTERI_SATIS_SORU": {
      // "bitti"/"tamam" - su an sayfa sayfa yuklenmekte olan (en az 1 sayfasi
      // kabul edilmis ama azami sayfa sayisina henuz ulasilmamis) bir cok
      // sayfali belge varsa (orn. Hesap Ozeti Cetveli), bu komut o belgeyi
      // tamamlanmis sayar ve akisa devam eder. Boyle bir belge yoksa (orn.
      // kullanici baska bir soruya "tamam" yazdiysa) bu blok atlanir ve
      // metin normal soru cevabi olarak islenmeye devam eder.
      if (BELGE_BITTI_REGEX.test(userText)) {
        const acikBelge = devamEdenCokSayfaliBelgeyiBul(session);
        if (acikBelge) {
          session.satisBelgeTamamlanan = session.satisBelgeTamamlanan || [];
          session.satisBelgeTamamlanan.push(acikBelge.id);
          const sayfaSayisi = (session.satisCokSayfaliSayilar && session.satisCokSayfaliSayilar[acikBelge.id]) || 0;
          await belgeTamamlandiMesajiGonderVeDevamEt(
            from,
            session,
            acikBelge,
            `"${belgeKisaEtiket(acikBelge)}" tamamlandı (${sayfaSayisi} sayfa)`
          );
          return;
        }
      }

      // "geri al" - bir onceki soruda yazdigi/sectigi cevabi duzeltmek
      // isterse (orn. eposta yanlis yazildiysa), bir onceki gecerli (skipIf
      // ile atlanmamis) soruya donup o soruyu tekrar sorar.
      // Foto/belge sorularina donulurse, o adimda yuklenen belge de
      // (satisBelgeler'den dosyaAdi'na gore) geri alinir ki tekrar
      // yuklenebilsin.
      if (GERI_AL_REGEX.test(userText)) {
        const oncekiIndex = oncekiGecerliIndex(session.satisSorular, session.satisAnswers, session.satisSoruIndex - 1);
        if (oncekiIndex < 0) {
          await sendText(from, "Geri alınacak bir önceki adım yok, bu ilk soru 🙂");
          await satisSoruSor(from, session);
          return;
        }
        const oncekiSoru = session.satisSorular[oncekiIndex];
        if (oncekiSoru.type === "tekli_foto_belge") {
          const belgeIdx = session.satisBelgeler.findIndex((b) => b.dosyaAdi === oncekiSoru.dosyaAdi);
          if (belgeIdx >= 0) session.satisBelgeler.splice(belgeIdx, 1);
          // Belgeler artik sirayla degil id'ye gore takip edildigi icin
          // (bkz. kalanBelgeSorulariniBul), "tamamlandi" listesinden de
          // cikarmamiz lazim - yoksa bu belge hala "kabul edilmis" sayılıp
          // tekrar istenemez.
          if (session.satisBelgeTamamlanan) {
            session.satisBelgeTamamlanan = session.satisBelgeTamamlanan.filter((id) => id !== oncekiSoru.id);
          }
        } else if (oncekiSoru.type === "cok_sayfali_foto_belge") {
          // Cok sayfali belgenin TUM sayfalarini (dosyaAdi_1, dosyaAdi_2, ...)
          // kaldiriyoruz ve sayfa sayacini sifirliyoruz ki belge basindan
          // tekrar yuklenebilsin.
          session.satisBelgeler = session.satisBelgeler.filter(
            (b) => !b.dosyaAdi.startsWith(`${oncekiSoru.dosyaAdi}_`)
          );
          if (session.satisCokSayfaliSayilar) session.satisCokSayfaliSayilar[oncekiSoru.id] = 0;
          if (session.satisBelgeTamamlanan) {
            session.satisBelgeTamamlanan = session.satisBelgeTamamlanan.filter((id) => id !== oncekiSoru.id);
          }
        } else {
          delete session.satisAnswers[oncekiSoru.id];
        }
        session.satisSoruIndex = oncekiIndex;
        await sendText(from, "Tamam, bir önceki adıma dönüyorum ⏪");
        await satisSoruSor(from, session);
        return;
      }

      const soru = session.satisSorular[session.satisSoruIndex];

      if (soru.type === "tekli_foto_belge") {
        const metin = typeof soru.text === "function" ? soru.text(session.satisAnswers) : soru.text;
        await sendText(from, `Bu adımda bir fotoğraf göndermenizi bekliyorum 📸\n\n${metin}`);
        return;
      }

      if (soru.type === "cok_sayfali_foto_belge") {
        const sayfaSayisi = (session.satisCokSayfaliSayilar && session.satisCokSayfaliSayilar[soru.id]) || 0;
        const metin = typeof soru.text === "function" ? soru.text(session.satisAnswers) : soru.text;
        await sendText(
          from,
          sayfaSayisi > 0
            ? `Bu belgenin başka sayfası varsa fotoğrafını gönderebilirsiniz, hepsi bittiyse *"bitti"* yazmanız yeterli 📸`
            : `Bu adımda bir fotoğraf göndermenizi bekliyorum 📸\n\n${metin}`
        );
        return;
      }

      if (soru.type === "choice") {
        const secilen = secilenSecenegiCoz(userText, soru, session.satisAnswers);
        if (!secilen) {
          const metin = typeof soru.text === "function" ? soru.text(session.satisAnswers) : soru.text;
          const kisaSecenekler = secenekleriCoz(soru.kisaSecenekler, session.satisAnswers);
          const options = secenekleriCoz(soru.options, session.satisAnswers);
          const gosterilecekler = kisaSecenekler || options;
          if (gosterilecekler.length > 3) await sendList(from, metin, "Seçin", gosterilecekler);
          else await sendButtons(from, metin, gosterilecekler);
          return;
        }
        session.satisAnswers[soru.id] = secilen;
      } else {
        if (soru.validate && !soru.validate(userText, session.satisAnswers)) {
          const hint =
            typeof soru.validationError === "function"
              ? soru.validationError(userText, session.satisAnswers)
              : soru.validationError;
          await sendText(from, hint || "Bu bilgi doğru formatta görünmüyor, lütfen tekrar dener misiniz?");
          return;
        }
        session.satisAnswers[soru.id] = soru.normalize ? soru.normalize(userText, session.satisAnswers) : userText;
      }

      session.satisSoruIndex = sonrakiGecerliIndex(
        session.satisSorular,
        session.satisAnswers,
        session.satisSoruIndex + 1
      );
      if (session.satisSoruIndex >= session.satisSorular.length) {
        await satisTamamla(from, session);
      } else {
        await satisSoruSor(from, session);
      }
      return;
    }

    // --- Destek talebi akisi ---
    case "DANISMAN_DESTEK_LEAD_SECIMI": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await destekLeadSecimiGoster(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const leadId = (session.danismanDestekLeadListesi || [])[index];
      const lead = leadId && leadStore.leadGetir(leadId);
      if (!lead) {
        await destekLeadSecimiGoster(from, session);
        return;
      }
      await destekBaslikIste(from, session, lead);
      return;
    }

    case "DANISMAN_DESTEK_BASLIK_BEKLE": {
      if (!userText) {
        await sendText(from, "Lütfen bu destek talebi için kısa bir başlık yazar mısınız?");
        return;
      }
      await destekMetniIste(from, session, userText);
      return;
    }

    case "DANISMAN_DESTEK_METIN_BEKLE": {
      if (!userText) {
        await sendText(from, "Sorununuzu kısaca yazar mısınız?");
        return;
      }
      await destekTalebiGonder(from, session, userText);
      return;
    }

    // --- Yenileme ekleme akisi ---
    case "DANISMAN_YENILEME_MUSTERI_BEKLE": {
      if (!userText) {
        await sendText(from, "Sigortalının adını ve soyadını paylaşır mısınız?");
        return;
      }
      session.yenilemeVerisi.musteriAdi = userText;
      await yenilemeUrunSor(from, session);
      return;
    }

    case "DANISMAN_YENILEME_URUN_SEC": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await yenilemeUrunSor(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const urunKey = (session.yenilemeUrunAnahtarlari || [])[index];
      if (!urunKey || !flows[urunKey]) {
        await yenilemeUrunSor(from, session);
        return;
      }
      session.yenilemeVerisi.urunLabel = flows[urunKey].label;

      if (PLAKA_ISTENEN_URUN_ETIKETLERI.includes(flows[urunKey].label)) {
        session.state = "DANISMAN_YENILEME_PLAKA_BEKLE";
        await sendText(from, "Aracın plakasını paylaşır mısınız? (Örn: 34 ABC 123)");
      } else {
        await yenilemeTarihSor(from, session);
      }
      return;
    }

    case "DANISMAN_YENILEME_PLAKA_BEKLE": {
      if (!plakaGecerliMi(userText)) {
        await sendText(from, "Girilen plaka geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 34 ABC 123)");
        return;
      }
      session.yenilemeVerisi.plaka = userText.trim().toUpperCase();
      await yenilemeTarihSor(from, session);
      return;
    }

    case "DANISMAN_YENILEME_TARIH_BEKLE": {
      if (!yenilemeTarihiGecerliMi(userText)) {
        await sendText(from, "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 12.09.2026)");
        return;
      }
      session.yenilemeVerisi.bitisTarihiMs = tarihiMsYap(userText);
      await yenilemeTamamla(from, session);
      return;
    }

    default: {
      await karsilamaGoster(from, session);
    }
  }
}

// 27.07.2026 eklendi: yeni bir ELEMENTER talep bildiriminin hemen ardindan
// (bkz. conversationEngine.js'deki finishFlow + yeniTalepAksiyonHookAyarla)
// ilgili numaraya "Ne yapmak istersiniz?" (Not Ekle/Durum Değiştir/Hatırlatma
// Kur) sorusunu göstermek icin disaridan cagirilan giris noktasi. Mevcut
// leadDetayGoster ile AYNI ekrani kullanir, boylece kisi "Not Ekle" derse
// normal WhatsApp danisman akisi (DANISMAN_LEAD_DETAY state'i) sorunsuzca
// devam eder.
async function yeniTalepIcinAksiyonSor(numara, lead) {
  const session = getSession(numara);
  await sendText(numara, `🆕 Az önce oluşturulan bu talep için hemen bir aksiyon almak ister misiniz?`);
  await leadDetayGoster(numara, session, lead);
}

module.exports = { isDanisman, handleAdvisorMessage, musteriSatisBaslat, yeniTalepIcinAksiyonSor };
