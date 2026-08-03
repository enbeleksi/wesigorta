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
// 02.08.2026 eklendi: yeni talep bildirimlerindeki "evet yazarak detayını
// görebilirsiniz" akışı icin - bkz. conversationEngine.js -> bildirimGonder
// ve asagidaki DETAY_EVET_IDLE_DURUMLARI kontrolu.
const bekleyenDetayStore = require("./bekleyenDetayStore");
const engelliNumaralarStore = require("./engelliNumaralarStore");
const dokumanStore = require("./dokumanStore");
// 31.07.2026 eklendi (Randevu Defterim ozelligi).
const randevuDefteriStore = require("./randevuDefteriStore");
// 01.08.2026 eklendi: "resmi tatillerin hiçbirinde çalışmıyoruz" kurali icin.
const resmiTatiller = require("./resmiTatiller");
const { dosyaTuruIzinliMi } = require("./izinliDosyaTurleri");
// Randevu Defterim'de yuklenen dosyanin GERCEKTEN bir Excel dosyasi olmasi
// gerekiyor (dosyaTuruIzinliMi'nin izin verdigi PDF/Word/foto turleri degil).
const RANDEVU_DEFTERI_EXCEL_MIME_TURLERI = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];
// 01.08.2026 eklendi: WhatsApp Business API bazi cihaz/uygulamalardan gelen
// .xlsx/.xls dosyalari icin beklenmedik/hatali mime type (orn.
// "application/octet-stream") bildirebiliyor - bu da yukarida ki katı mime
// kontrollerinde dosyanin SESSIZCE reddedilmesine yol aciyordu (Bahadir'in
// yukledigi uretim dosyasi ornegindeki gibi). Bu yuzden, Excel dosyasi
// beklenen state'lerde, mime type uyusmasa bile dosya adi .xlsx/.xls ile
// bitiyorsa dosyayi KABUL ediyoruz (uzanti tabanli yedek kontrol).
function dosyaAdiExcelUzantiliMi(dosyaAdi) {
  return /\.(xlsx|xls)$/i.test(dosyaAdi || "");
}
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
  telefonYerelBicimGoster,
  epostaGecerliMi,
  primTutariGecerliMi,
  saatAraligiGecerliMi,
  saatAraligiNormallestir
} = require("./validators");
const flows = require("./flows");
const conversationEngine = require("./conversationEngine");
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
const { BES_FONLARI, besFonMesajlariniOlustur } = require("./besFonVerileri");
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

function ikiHane(n) {
  return String(n).padStart(2, "0");
}

// Bir Date'in kanonik "GG.AA.YYYY" karsiligi - resmiTatiller.js'deki
// haritanin anahtar formatiyla AYNI (asagida hem gun uretiminde hem de
// tekrar arama tarihi kontrolunde kullaniliyor).
function tarihiKanonikYaz(tarih) {
  return `${ikiHane(tarih.getDate())}.${ikiHane(tarih.getMonth() + 1)}.${tarih.getFullYear()}`;
}

// Bugunden baslayarak (gerekirse yarindan), hafta sonlarini (Cumartesi/
// Pazar) VE resmi tatilleri (bkz. resmiTatiller.js - kullanicinin talebi:
// "resmi tatillerin hiçbirinde çalışmıyoruz ... randevu de almıyoruz resmi
// tatillere") ATLAYARAK ilk `adet` kadar UYGUN is gunu Date olarak dondurur
// - cagri merkezi hafta sonlari/resmi tatillerde calismiyor, bu yuzden
// secenek olarak hic sunmuyoruz. Bu fonksiyon HEM Garanti Emeklilik "arama
// randevusu" gun secimi HEM DE Randevu Defterim'in randevu gun secimi
// tarafindan ORTAK kullanildigi icin, resmi tatil hariç tutma kurali otomatik
// olarak HER IKI akista da gecerli olur.
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
    const haftaSonuMu = gun === 0 || gun === 6;
    const resmiTatilMi = !haftaSonuMu && resmiTatiller.tatilAdiGetir(tarihiKanonikYaz(cursor));
    if (!haftaSonuMu && !resmiTatilMi) {
      gunler.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return gunler;
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

// 01.08.2026 eklendi: kullanicinin talebi uzerine - Randevu Defterim'in
// randevu SAATI artik "08:00-10:00" gibi 2 saatlik bir ARALIK degil, 09:30'dan
// 18:00'a kadar yarimsar saat araliklarla DOGRUDAN SECILEBILEN bir saat
// ("09:30", "10:00", ... "18:00" - 18 adet). NOT: bu SADECE randevu
// (appointment) saati icin gecerli - Garanti Emeklilik "arama randevusu"
// akisi (aramaSaatAraligiSecenekleri/SAAT_ARALIKLARI, yukarida) DEGISTIRILMEDI,
// hala eski 2 saatlik araliklari kullaniyor - kullanicinin talebi sadece
// randevu saati icindi.
const RANDEVU_SAAT_BASLANGIC_DK = 9 * 60 + 30; // 09:30
const RANDEVU_SAAT_BITIS_DK = 18 * 60; // 18:00
const RANDEVU_SAAT_ADIM_DK = 30;

// Tum olasi randevu saatlerini ("09:30".."18:00", 18 adet) dondurur - saat
// dilimi filtrelemesinden BAGIMSIZ, sadece "bu deger gecerli bir randevu
// saati mi" kontrolu icin de kullanilir (bkz. DANISMAN_RANDEVU_DEFTERI_
// RANDEVU_SAAT case'i).
function tumRandevuSaatleri() {
  const saatler = [];
  for (let dk = RANDEVU_SAAT_BASLANGIC_DK; dk <= RANDEVU_SAAT_BITIS_DK; dk += RANDEVU_SAAT_ADIM_DK) {
    saatler.push(`${ikiHane(Math.floor(dk / 60))}:${ikiHane(dk % 60)}`);
  }
  return saatler;
}

// Secilen randevu gunu icin uygun saatleri dondurur - gun BUGUNSE, su anki
// saatten (+2 saat kurali ile, arama randevusuyla AYNI kural) once kalan
// saatler cikarilir.
function randevuSaatSecenekleri(tarihStr) {
  const tumu = tumRandevuSaatleri();
  if (!tarihStr || !aramaTarihiBugunMu(tarihStr)) {
    return tumu;
  }
  const simdi = new Date();
  const simdiDk = simdi.getHours() * 60 + simdi.getMinutes();
  return tumu.filter((s) => {
    const [saat, dk] = s.split(":").map(Number);
    return saat * 60 + dk >= simdiDk + 120;
  });
}

// WhatsApp interaktif liste mesaji TUM bolumler dahil en fazla 10 satir
// destekliyor (resmi Meta dokumantasyonu) - 18 adet yarim saatlik randevu
// saati bu siniri asiyor. Bu yuzden, uygun saat sayisi 10'u astiginda once
// "Sabah" / "Öğleden Sonra" (sendButtons, max 3 secenek destekler) sorulup,
// sadece secilen yarinin (<=9 satir kalan) saatleri listede gosteriliyor.
// Uygun saat sayisi <=10 ise (orn. gunun ilerleyen saatlerinde "bugun"
// secildiginde) bu ara adim atlanip tum liste dogrudan gosteriliyor.
const RANDEVU_YARIM_GUN_SECENEKLERI = ["Sabah", "Öğleden Sonra"];
const RANDEVU_YARIM_GUN_SINIR_DK = 14 * 60; // 14:00

function randevuYarimGunSaatleri(tarihStr, yarimGun) {
  const secenekler = randevuSaatSecenekleri(tarihStr);
  return secenekler.filter((s) => {
    const [saat, dk] = s.split(":").map(Number);
    const toplamDk = saat * 60 + dk;
    return yarimGun === "Sabah" ? toplamDk < RANDEVU_YARIM_GUN_SINIR_DK : toplamDk >= RANDEVU_YARIM_GUN_SINIR_DK;
  });
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

// 31.07.2026 eklendi (Randevu Defterim ozelligi): "Olumlu" (randevu alindi)
// sonucunda Enbel'e bilgi gitmesi gerekiyor - conversationEngine.js'deki
// ENBEL_NUMARASI disari acilmadigi icin, DANISMANLAR listesinden (tek dogru
// kaynak) ayni numarayi burada da turetiyoruz.
const ENBEL_NUMARASI = (DANISMANLAR.find((d) => d.name === "Enbel") || {}).number || "905326876126";

// 03.08.2026 eklendi (Enbel'in kendi talebi): "Bekleyen İş"/"Gecikmiş İş"
// menusunden WhatsApp uzerinden sorulunca ARTIK SADECE Enbel'in KENDI isleri
// gorunsun, ekibin TAMAMI gorunmesin - bu degisiklik SADECE bu iki menuyu
// (anaMenuGoster/gecikmisIsMenuGoster) etkiler. Sabah 09:30 gunluk ozetinde
// (bkz. server.js -> gunlukBekleyenIsOzetiKontrolEt) Enbel'e hem kendi hem
// ekibin TÜM bekleyen isleri HALA (degismeden) gonderiliyor - kullanicinin
// acik talebi buydu ("sabahki raporlarda tüm ekibinki de gelsin"), o kod
// yolu YONETICI_NUMARALARI'na hic bakmiyor, ayrica etkilenmedi. Bahadır ise
// (elementer bransin sorumlusu oldugu icin) bu iki menude HALA ekibin
// TAMAMINI goruyor - bu degisiklik SADECE Enbel icin istendi, YONETICI_NUMARALARI
// sabitinin kendisi (not ekleme/numara engelleme gibi BASKA yetkiler icin
// kullanildigindan) DEGISTIRILMEDI, sadece bu iki menu ayrica dar bir liste
// kullaniyor.
const BEKLEYEN_IS_TUM_EKIP_GOREBILEN_NUMARALAR = YONETICI_NUMARALARI.filter((n) => n !== ENBEL_NUMARASI);

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
// 31.07.2026'da kullanicinin talebiyle yeniden duzenlendi:
// - "BES Fonları" kaldirildi - artik "Sık Sorulan Sorular" > "Bireysel
//   Emeklilik(BES)" secenegi ile ayni bilgiye ulasiliyor (bkz.
//   DANISMAN_SSS_URUN_SEC case'i) - boylece musteriler de bu bilgiye
//   kendi Sık Sorulan Sorular akislarindan erisebiliyor.
// - "Doküman Merkezi" tamamen kaldirildi.
// - "Yaklaşan Yenilemeler" kaldirildi - zaten "Bekleyen İş" listesinde
//   yaklasan yenilemelere de yer veriliyor, ayri bir secenek gereksiz.
// - Yeni bir danisman-ozel hizmet olarak "Randevu Defterim" eklendi -
//   icerigi henuz detaylandirilmadi (kullaniciyla birlikte
//   netlestirilecek), simdilik "yakinda" placeholder'i gosteriyor (bkz.
//   DANISMAN_RANDEVU_DEFTERIM case'i).
// - Sira, kullanicinin belirttigi son haliyle: Bekleyen İş, BES Hayat
//   Başvurusu, Elementer Teklif Al, Yenileme Takibi Ekle, Randevu Defterim,
//   Destek Talebi Oluştur, Performansım, Sık Sorulan Sorular.
// - 02.08.2026 eklendi: "Bekleyen İş"in hemen altina "Gecikmiş İş" eklendi -
//   yenileme kaynakli, suresi dolmus (bitis tarihi gecmis) ama henuz 30 gunu
//   doldurmamis (server.js'deki YENILEME_BEKLEYEN_IS_MAKSIMUM_GECIKME_GUN)
//   isler artik "Bekleyen İş"ten cikarilip burada ayrica listeleniyor -
//   boylece suresi gecmemis isler ile suresi coktan gecmis/aciliyet gerektiren
//   isler WhatsApp listesinde karismiyor (bkz. anaMenuGoster/gecikmisIsMenuGoster).
const ANA_MENU_SECENEKLERI = [
  "Bekleyen İş",
  "Gecikmiş İş",
  "BES Hayat Başvurusu",
  "Elementer Teklif Al",
  "Yenileme Takibi Ekle",
  "Randevu Defterim",
  "Destek Talebi Oluştur",
  "Performansım",
  "Sık Sorulan Sorular"
];

// Ana menude hicbir secenekle eslesmeyen, ama "hayır", "yok", "teşekkürler"
// gibi bir kapanis/red ifadesi iceren kisa cevaplari yakalar (orn. "hayır yok
// teşekkürler", "yok teşekkürler", "hayır teşekkürler", "teşekkürler").
const KARSILAMA_KAPANIS_REGEX = /\b(hay[ıi]r|yok|te[şs]ekk[üu]r)/i;

// 02.08.2026 eklendi: yeni talep bildirimindeki "evet yazarak detayını
// görebilirsiniz" davetine cevaben gelen bir "evet"i yakalamak icin -
// yalnizca danismanin herhangi bir SORUYA cevap vermedigi, "bos"/menu
// benzeri durumlarda devreye girer. Diger TUM durumlarda (orn. yeni musteri
// talebi doldururken "Sigortalı Türkiye Cumhuriyeti vatandaşı mı?" gibi
// sorularin gercek "Evet" cevaplarinda) BILEREK devre disi - aksi halde
// danismanin normal soru cevabi burada yanlislikla "detay talebi" sanilirdi
// (bkz. asagidaki mevcut "evet" HARIC TUTMA yorumu - ayni sebep).
const DETAY_EVET_IDLE_DURUMLARI = new Set([
  "DANISMAN_KARSILAMA",
  "DANISMAN_LEAD_SECIMI",
  "DANISMAN_LEAD_DETAY",
  "DANISMAN_GECIKMIS_LEAD_SECIMI"
]);
const DETAY_EVET_REGEX = /^evet[\s!.,😊🙏👍🎉]*$/i;

// 31.07.2026 eklendi: "Sık Sorulan Sorular" (DANISMAN_SSS_SORU) serbest
// soru-cevap modunda, danismanin yazdigi metnin SADECE bir kapanis/tesekkur
// ifadesi olup olmadigini anlamak icin (bkz. DANISMAN_SSS_SORU case'i).
// normalizeTr uygulanmis metne karsi test edilir (ş->s, ü->u vb.) - bu yuzden
// Turkce karakter icermez. Baslangicta (istege bagli) "cok", sonunda
// (istege bagli) noktalama/emoji tolere eder, ama "teşekkürler ama..." gibi
// tesekkurun ARDINDAN baska bir seyin geldigi durumlari (gercek bir soru
// icerebilecekleri icin) kasten YAKALAMAZ - $ ile ceviri sonunu sabitliyoruz.
const KAPANIS_IFADE_REGEX = /^(cok\s+)?(tesekkur(ler)?(\s+ederim)?|sagol|saol|elinize\s+saglik)[\s!.,😊🙏👍🎉]*$/;

// --- Randevu Defterim (31.07.2026 eklendi) ---
// Danismanin WhatsApp'tan Excel yukleyerek musteri/lead listesi olusturup,
// bu listeden rastgele musteri secip aradiktan sonra sonucu kaydedebildigi
// ozellik. Tum is mantigi randevuDefteriStore.js'te; burada sadece WhatsApp
// menu/soru akisi var.
// 01.08.2026 DUZELTILDI: kullanicinin talebi uzerine sira ve isimler
// degistirildi ("Excel Yükle" -> "Referans Yükle", "Ana Menü" -> "Ana
// Menüye Dön") ve yeni bir "Randevu Oluştur" secenegi eklendi - artik
// randevu SADECE Excel'den cekilip aranan bir musteriyle degil, dogrudan bu
// menuden manuel ad/telefon girilerek de olusturulabiliyor (bkz.
// randevuDefteriManuelBaslat).
const RANDEVU_DEFTERI_MENU_SECENEKLERI = ["Referans Ara", "Randevu Oluştur", "Kayıtlarım", "Referans Yükle", "Ana Menüye Dön"];
const RANDEVU_DEFTERI_DURUM_SECENEKLERI = [
  "Olumlu",
  "Olumsuz",
  "Yeniden Aranacak",
  "Ulaşılamadı",
  "Yanlış Numara"
];

// 03.08.2026 eklendi (Enbel'in talebi): "danışman referans aramaya
// başladıktan sonra danışman yeterli diyene kadar her işaretlemeden sonra
// yeni referans gönderelim" - danisman "Referans Ara" moduna girdiginde,
// artik her sonuc isaretlemesinden (Olumlu/Olumsuz/Yeniden Aranacak/
// Ulaşılamadı/Yanlış Numara) SONRA ana menuye donmek yerine OTOMATIK olarak
// bir SONRAKI musteri gosteriliyor (bkz. asagidaki randevuDefteriMusteriAra
// cagrilari) - boylece pespese 50 numara aramasi gereken bir danisman her
// seferinde "Referans Ara"ya tekrar tekrar basmak zorunda kalmiyor. Bu
// dongude iken danisman istedigi an "yeterli" (ya da "yeter"/"dur"/"bu
// kadar"/"bitti" gibi bir varyasyon) yazarak ana menuye donebilir - TAM
// eslesme aranir (^...$ ile) ki bir Olumsuz aciklamasi gibi SERBEST METIN
// icinde gecebilecek "yeterli" kelimesiyle (orn. "ürünü yeterli bulmadı")
// YANLISLIKLA karismasin; bu yuzden bu kontrol SADECE asagidaki iki "kisa
// secim" durumunda (DURUM_SEC / DOGRU_NUMARA_SEC) calisiyor, serbest metin
// beklenen durumlarda (Olumsuz aciklamasi, tekrar arama tarihi vb.) DEGIL.
const REFERANS_ARAMA_DURDURMA_REGEX =
  /^(yeterli|yeter|dur|durdur|bu\s*kadar(\s*yeter)?|tamam\s*yeter|bitti|bitirdim)[\s!.,😊🙏👍🎉]*$/i;

async function referansAramaDurduruldu(from, session) {
  await sendText(from, "Tamam, aramaya burada ara verelim 👍 İstediğiniz zaman \"Referans Ara\" diyerek devam edebilirsiniz.");
  session.randevuDefteriSeciliId = null;
  await randevuDefteriMenuGoster(from, session);
}

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

// 02.08.2026 eklendi (Enbel'in talebi): uretim tablosundaki musteri isimleri
// kaynakta TAMAMI BUYUK HARF geliyor (orn. "İSMAİL KEREM GELİR") - Bekleyen
// İş ve Gecikmiş İş WhatsApp listelerinde bunun yerine sadece ilk harfleri
// buyuk gosterelim istendi ("İsmail Kerem Gelir"). Turkce'ye ozgu I/İ/ı/i
// donusumlerinin dogru calismasi icin (orn. "İ" kucuk harfe cevrilince "i"
// olmali, duz "I" kucuk harfe cevrilince "ı" olmali) toLocaleLowerCase/
// toLocaleUpperCase MUTLAKA "tr-TR" locale'iyle cagriliyor - locale'siz
// (varsayilan/İngilizce) cagri bu harfler icin yanlis sonuc uretir.
function isimIlkHarfleriBuyukYap(isim) {
  if (!isim || typeof isim !== "string") return isim;
  return isim
    .toLocaleLowerCase("tr-TR")
    .split(" ")
    .map((kelime) => (kelime ? kelime.charAt(0).toLocaleUpperCase("tr-TR") + kelime.slice(1) : kelime))
    .join(" ");
}

// Bir leadin, "Gecikmiş İş" listesine tasinmasi gereken (yenileme kaynakli,
// suresi coktan dolmus) bir kayit olup olmadigini soyler - bkz. asagidaki
// anaMenuGoster (bu kayitlari DISLAR) ve gecikmisIsMenuGoster (SADECE bu
// kayitlari gosterir) arasindaki karsilikli disleme/filtreleme mantigi.
function gecikmisYenilemeMi(lead) {
  return typeof lead.yenilemeBitisTarihi === "number" && lead.yenilemeBitisTarihi < Date.now();
}

// --- Mevcut talepleri listeleme/yonetme ---
async function anaMenuGoster(from, session) {
  const danisman = danismaniBul(from);
  // 03.08.2026 DUZELTILDI: eskiden burada YONETICI_NUMARALARI (Enbel+Bahadır)
  // kullanilirdi - Enbel'in kendi talebi uzerine artik BEKLEYEN_IS_TUM_EKIP_GOREBILEN_NUMARALAR
  // kullaniliyor (sadece Bahadır) - bkz. o sabitin yorumu.
  const yoneticiMi = BEKLEYEN_IS_TUM_EKIP_GOREBILEN_NUMARALAR.includes(from);
  // Yonetici (Bahadır) icin TUM ekibin acik isleri, digerleri icin
  // sadece kendi acik isleri (bkz. yukaridaki YONETICI_NUMARALARI yorumu).
  // 02.08.2026 eklendi: yenileme kaynakli, suresi coktan dolmus (gecikmisYenilemeMi)
  // kayitlar artik BURADA GOSTERILMIYOR - "Gecikmiş İş" menusune tasindi
  // (bkz. gecikmisIsMenuGoster), boylece "Bekleyen İş" sadece suresi henuz
  // gecmemis/normal isleri gosteriyor.
  const tumAcikLeadler = leadStore
    .tumLeadleriGetir()
    .filter((l) => (yoneticiMi ? true : l.danismanNumarasi === from) && l.durum === "Açık" && !gecikmisYenilemeMi(l));

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
    return `${ikon} ${isimIlkHarfleriBuyukYap(l.musteriAdi) || l.telefon} (${l.urun})${danismanEtiketi}`;
  });

  // 02.08.2026 eklendi (Enbel'in talebi): "toplam açık iş sayısı gibi
  // veriler sadece panele yansıyacak" - WhatsApp'ta artik TOPLAM sayi
  // SOYLENMIYOR, sadece en uzun süredir bekleyen 10 tanesi gosteriliyor;
  // tam sayi/tam liste icin panele yonlendiriliyor.
  const baslikMetni =
    yoneticiMi && tumAcikLeadler.length > 10
      ? `Ekipte en uzun süredir bekleyen 10 iş aşağıda (tüm liste ve toplam sayı için panele bakabilirsiniz). Detay görmek istediğinizi seçin:`
      : `Açık talepleriniz aşağıda, detay görmek istediğinizi seçin:`;

  await sendList(from, baslikMetni, "Talep Seç", satirlar);
}

// 02.08.2026 eklendi (Enbel'in talebi): "Bekleyen İş"in altina, suresi
// dolmus (bitis tarihi gecmis) ama henuz 30 gunu doldurmamis (server.js'deki
// YENILEME_BEKLEYEN_IS_MAKSIMUM_GECIKME_GUN siniri - o sinirdan sonra zaten
// otomatik temizleniyor, bkz. server.js'deki eskiYenilemeBekleyenIslerTemizle)
// yenileme kaynakli isleri AYRI gosteren yeni bir menu. anaMenuGoster ile
// SIMETRIK calisir (ayni yonetici/sayfalama/siralama mantigi), ama ters
// filtre kullanir (SADECE gecikmisYenilemeMi(l) true olanlar) ve KENDI
// session state'ini (DANISMAN_GECIKMIS_LEAD_SECIMI) + KENDI liste alanini
// (session.gecikmisLeadListesi) kullanir - boylece "Bekleyen İş" listesinden
// secim yapiliyormus gibi yanlis bir kayda dusulmesi (state karismasi)
// engellenir.
async function gecikmisIsMenuGoster(from, session) {
  // 03.08.2026 DUZELTILDI: anaMenuGoster ile AYNI degisiklik (bkz. o
  // sabitin/fonksiyonun yorumu) - Enbel artik burada da SADECE kendi
  // gecikmis islerini goruyor, Bahadır ekibin tamamini gormeye devam ediyor.
  const yoneticiMi = BEKLEYEN_IS_TUM_EKIP_GOREBILEN_NUMARALAR.includes(from);
  const tumGecikmisLeadler = leadStore
    .tumLeadleriGetir()
    .filter((l) => (yoneticiMi ? true : l.danismanNumarasi === from) && l.durum === "Açık" && gecikmisYenilemeMi(l));

  if (tumGecikmisLeadler.length === 0) {
    session.state = "DANISMAN_GECIKMIS_LEAD_SECIMI";
    session.gecikmisLeadListesi = [];
    await sendText(
      from,
      yoneticiMi ? `Şu an ekipte gecikmiş bir iş yok. 🎉` : `Şu an gecikmiş bir işiniz yok. 🎉`
    );
    return;
  }

  const siraliLeadler = yoneticiMi
    ? [...tumGecikmisLeadler].sort((a, b) => a.olusturulmaZamani - b.olusturulmaZamani)
    : tumGecikmisLeadler;
  const gecikmisLeadler = siraliLeadler.slice(0, 10);

  session.state = "DANISMAN_GECIKMIS_LEAD_SECIMI";
  session.gecikmisLeadListesi = gecikmisLeadler.map((l) => l.id);

  const satirlar = gecikmisLeadler.map((l) => {
    const ikon = l.hatirlatma ? "⏰" : "🔴";
    const danismanEtiketi = yoneticiMi && l.danismanAdi ? ` - ${l.danismanAdi}` : "";
    return `${ikon} ${isimIlkHarfleriBuyukYap(l.musteriAdi) || l.telefon} (${l.urun})${danismanEtiketi}`;
  });

  const baslikMetni =
    yoneticiMi && tumGecikmisLeadler.length > 10
      ? `Ekipte en uzun süredir gecikmiş 10 iş aşağıda (tüm liste için panele bakabilirsiniz). Detay görmek istediğinizi seçin:`
      : `Gecikmiş talepleriniz aşağıda, detay görmek istediğinizi seçin:`;

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

  // 03.08.2026 eklendi: beklenmedik ruhsat/proforma ile onceden doldurulmus
  // bir danisman-yeni-talep akisinda (bkz. conversationEngine.js'teki
  // askCurrentQuestion'a eklenen AYNI mantigin yorumu), TUM sorular zaten
  // cevaplanmis/atlanmis olabilir (orn. proforma -> arac_sifir_mi "Sıfır" ->
  // Kasko'nun kasko_durumu/arac_fotograflari sorulari da otomatik atlanir,
  // "İkisi de" akisinda Kasko'ya gecildiginde sorulacak hicbir soru
  // kalmayabilir) - bu durumda soru undefined olur, guvenli sekilde
  // danismanYeniTalepiTamamla'ya dusuyoruz.
  if (!soru) {
    await danismanYeniTalepiTamamla(from, session);
    return;
  }

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

  // 03.08.2026 eklendi: beklenmedik ruhsat + "İkisi de" (danisman tarafi) -
  // conversationEngine.js'deki finishFlow'un AYNI mantigi (bkz. o dosyadaki
  // yorum). Sigortalinin telefon numarasi (session.danismanYeniTelefon) ve
  // ortak cevaplar (session.danismanYeniAnswers - arac bilgileri, ad soyad,
  // sehir, meslek vb.) oldugu gibi korunuyor, telefon TEKRAR SORULMUYOR -
  // SADECE ikinci urunun kendine ozel (orn. Kasko'nun kasko_durumu/
  // arac_fotograflari) sorulari sorulacak.
  if (session.danismanYeniIkisiDeSonraki) {
    const sonrakiUrunKey = session.danismanYeniIkisiDeSonraki;
    session.danismanYeniIkisiDeSonraki = null;
    session.danismanYeniUrunKey = sonrakiUrunKey;
    const sonrakiFlow = flows[sonrakiUrunKey];
    session.danismanYeniSoruIndex = sonrakiGecerliIndex(sonrakiFlow.questions, session.danismanYeniAnswers, 0);
    session.state = "DANISMAN_YENI_SORU";
    await danismanSoruSor(from, session);
    return;
  }

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
// 01.08.2026 eklendi: kullanicinin "toplu Excel girişi" talebi uzerine, tek
// tek elle girmenin yaninda ikinci bir giris yolu eklendi - bkz.
// yenilemeExcelYuklemeBaslat/yenilemeExcelIsle.
const YENILEME_EKLEME_MENU_SECENEKLERI = ["Tek Tek Ekle", "Excel ile Toplu Yükle"];

// 01.08.2026 eklendi: "excel ile yenileme takibini enbel ve bahadır
// eklebilsin sadece şimdilik" talebi uzerine - toplu Excel yukleme ozelligi
// simdilik SADECE yonetici numaralarina (Enbel, Bahadır) aciliyor. Diger
// danismanlar yenileme kaydini hala "Tek Tek Ekle" ile girebilir.
function yenilemeExcelYuklemeYetkisiVarMi(from) {
  return YONETICI_NUMARALARI.includes(from);
}

async function yenilemeEklemeMenuGoster(from, session) {
  if (!yenilemeExcelYuklemeYetkisiVarMi(from)) {
    await yenilemeBaslat(from, session);
    return;
  }
  session.state = "DANISMAN_YENILEME_EKLEME_MENU";
  await sendButtons(
    from,
    "Yenileme kaydını nasıl eklemek istersiniz?",
    YENILEME_EKLEME_MENU_SECENEKLERI
  );
}

async function yenilemeBaslat(from, session) {
  session.state = "DANISMAN_YENILEME_MUSTERI_BEKLE";
  session.yenilemeVerisi = {};
  await sendText(from, "Sigortalının adını ve soyadını paylaşır mısınız?");
}

// 01.08.2026 eklendi: Enbel'in gercek "ELEMENTER ÜRETİM TAKİP" dosyasinin
// formatina gore (bkz. yenilemeStore.js'teki uretimExceliYukle) toplu
// yenileme kaydi olusturma/guncelleme. Danisman DOSYAYI KENDI numarasindan
// gonderse bile, her satirin sahibi dosyadaki ARACI sutunundan cozuluyor -
// yani bu dosyayi kim yuklerse yuklesin sonuc ayni (butun danismanlarin
// kayitlarini iceren TEK bir dosya, hepsi dogru kisiye atanarak isleniyor).
async function yenilemeExcelYuklemeBaslat(from, session) {
  if (!yenilemeExcelYuklemeYetkisiVarMi(from)) {
    // savunma amacli ikinci kontrol - normal akista buraya menude secenek
    // hic gosterilmedigi icin zaten girilmiyor.
    await yenilemeBaslat(from, session);
    return;
  }
  session.state = "DANISMAN_YENILEME_EXCEL_BEKLE";
  await sendText(
    from,
    "📥 Üretim takip Excel dosyanızı (ELEMENTER ÜRETİM TAKİP formatında) gönderebilirsiniz.\n\n" +
      "Dosyada şu sütunlar tanınıyor: Sigortalı Adı Soyadı, Aracı, Poliçe No, Tanzim Tarihi, Ürün, Şirket " +
      "(ilk sayfa, başlıklar hangi satırda olursa olsun otomatik bulunur).\n\n" +
      "Her ürün için yenileme tarihi \"tanzim tarihi + 1 yıl\" olarak hesaplanır; iptal/iade/satıştan zeyil " +
      "gibi işlemlerle sonlanan poliçeler otomatik olarak dışarıda bırakılır.\n\n" +
      "Hazır olduğunda dosyayı buraya (WhatsApp'tan belge/döküman olarak) gönderebilirsiniz. 📎"
  );
}

const YENILEME_EXCEL_ATLANAN_MAX_GOSTER = 8;

async function yenilemeExcelIsle(from, session, buffer, dosyaAdi) {
  console.log("Yenileme uretim excel isleniyor:", dosyaAdi, "buffer boyutu:", buffer ? buffer.length : 0);
  const sonuc = yenilemeStore.uretimExceliYukle(buffer, dosyaAdi);

  if (sonuc.hata) {
    console.log("Yenileme uretim excel islenemedi (mantiksal hata):", sonuc.hata);
    await sendText(from, `❌ ${sonuc.hata}`);
    return; // ayni state'te kaliyoruz, danisman duzeltilmis dosyayi tekrar gonderebilir
  }

  console.log(
    "Yenileme uretim excel islendi:",
    "toplamSatir=", sonuc.toplamSatir,
    "eklenen=", sonuc.eklenen.length,
    "guncellenen=", sonuc.guncellenen.length,
    "atlanan=", sonuc.atlanan.length
  );

  // 01.08.2026 DUZELTILDI: artik ARACI ismi eslesmeyen kayitlar atanmadan
  // kalmiyor (bkz. yenilemeStore.js'teki varsayilanDanisman) - bunun yerine
  // Bahadır'a dusuyor (bildirim/telefon acisindan), ama gosterilen
  // danismanAdi dogrudan o kisinin kendi ismi (Enbel'in talebi uzerine -
  // "dış kaynak yazmana gerek yok ... bahadır tanıyor hepsini anlar").
  // Kac tanesinin boyle dus-kaynakli oldugunu yine de ic raporlama icin
  // sayiyoruz - bunun icin GORUNEN isim degil, ayri disKaynak alani kullanilir.
  const disKaynakliSayisi = [...sonuc.eklenen, ...sonuc.guncellenen].filter((k) => k.disKaynak).length;
  const gecmisSayisi = [...sonuc.eklenen, ...sonuc.guncellenen].filter((k) => k.bitisTarihi < Date.now()).length;

  let mesaj =
    `Üretim dosyası işlendi ✅\n\n` +
    `Toplam satır: ${sonuc.toplamSatir}\n` +
    `Yeni yenileme kaydı: ${sonuc.eklenen.length}\n` +
    `Güncellenen kayıt: ${sonuc.guncellenen.length}\n` +
    `Atlanan (iptal/hatalı/tanınmayan): ${sonuc.atlanan.length}`;

  if (disKaynakliSayisi > 0) {
    mesaj += `\n\n👥 ${disKaynakliSayisi} kayıt, "Aracı" sütunundaki isim bizim danışmanlarımızla eşleşmediği için dış kaynak olarak Bahadır'a düştü (Enbel de ekip özetinde görecek).`;
  }
  if (gecmisSayisi > 0) {
    mesaj += `\n\n🔴 ${gecmisSayisi} kaydın hesaplanan yenileme tarihi bugünden önce görünüyor (çok eski/tek seferlik tanzimler olabilir) - bunlar önümüzdeki günlük özetlerde "gecikmiş" olarak çıkacak, gözden geçirmeniz iyi olur.`;
  }

  if (sonuc.atlanan.length > 0) {
    const gosterilecekler = sonuc.atlanan.slice(0, YENILEME_EXCEL_ATLANAN_MAX_GOSTER);
    const satirlar = gosterilecekler.map((a) => `• Satır ${a.satirNo} (${a.adSoyad} - ${a.urun}): ${a.sebep}`);
    mesaj += `\n\n${satirlar.join("\n")}`;
    if (sonuc.atlanan.length > gosterilecekler.length) {
      mesaj += `\n...ve ${sonuc.atlanan.length - gosterilecekler.length} tane daha.`;
    }
  }

  await sendText(from, mesaj);
  await devamMenuGoster(from, session);
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

// --- Sık Sorulan Sorular (danisman tarafi) ---
// 27.07.2026'da eklenen ilk versiyon, sozlukSSS.js'teki TUM terim/urun
// aciklamalarini tek seferde (soru kalibi beklemeden) doküyordu. 31.07.2026'da
// kullanicinin talebiyle MUSTERI tarafiyla AYNI formata donduruldu: once
// hangi urunle ilgili sorusu oldugu soruluyor (conversationEngine.js'teki
// INFO_PRODUCT_LABELS - musteri tarafiyla BIREBIR AYNI liste), ardindan o
// urunun PDF'ine dayanan serbest soru-cevap moduna (BILGI_SORU_MODULLERI)
// giriliyor - boylece TSS/ÖSS/Doğum Sigortası icin danisman da musteriyle
// AYNI dogru/guncel bilgiyi, AYNI motordan alir.
async function sssUrunSecBaslat(from, session) {
  session.state = "DANISMAN_SSS_URUN_SEC";
  await sendList(
    from,
    "Hangi ürünle ilgili sorunuz var?",
    "Seçin",
    conversationEngine.INFO_PRODUCT_LABELS
  );
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
// ekonomiRaporuAnaliz.js dosyasi da bu yuzden silindi. "BES Fonları" TEK
// BASINA bir ana menu secenegi olmaktan cikip, 31.07.2026'da kullanicinin
// talebiyle "Sık Sorulan Sorular" akisindaki "Bireysel Emeklilik(BES)"
// secenegine tasindi (bkz. asagida DANISMAN_SSS_URUN_SEC case'i) - boylece
// MUSTERILER de (kendi Sık Sorulan Sorular akislarindan) fon bilgisine
// erisebiliyor (bkz. conversationEngine.js'teki ayni tasima). Fon
// bloklarinin WhatsApp karakter sinirina gore mesajlara bolunmesi (eskiden
// burada tanimliydi) artik besFonVerileri.js'teki PAYLAŞILAN
// besFonMesajlariniOlustur fonksiyonunda - boylece musteri ve danisman
// tarafi AYNI mantigi kullanir.
//
// Bu fonksiyon hala tefasGetiriAnaliz.js araciligiyla web aramasiyla GUNCEL
// GETIRI verisi cekmeye calisir, ama bu "best-effort" bir ek oldugu icin
// basarisiz olsa bile fon listesi YINE DE (getirisiz) gosterilmeye devam
// eder - o yuzden ayni guvenilirlik sorunu burada kullaniciyi
// engellemiyor/hata mesajiyla karsilastirmiyor.
async function besFonListesiGoster(from, session) {
  await sendText(from, "Fon listesini ve güncel getiri verilerini hazırlıyorum, bir saniye... 🔍");

  let getiriHaritasi = {};
  try {
    getiriHaritasi = await fonGetirileriniGetir(BES_FONLARI.map((f) => f.kod));
  } catch (err) {
    console.error("Fon getirileri alinamadi (liste yine de getirisiz gosterilecek):", err.message);
  }

  const mesajlar = besFonMesajlariniOlustur(getiriHaritasi);
  for (const mesaj of mesajlar) {
    await sendText(from, mesaj);
  }

  await devamMenuGoster(from, session);
}

// --- Randevu Defterim (31.07.2026 eklendi) ---
// Is mantiginin tamami randevuDefteriStore.js'te; burada sadece WhatsApp
// menu/soru akisi var. Akis: Excel Yükle (dosya -> kayit listesi olusur) /
// Referans Ara (listeden rastgele biri gelir) -> Olumlu/Olumsuz/Yeniden
// Aranacak/Ulaşılamadı/Yanlış Numara sonucu -> ilgiliyse ek sorular (randevu
// tarih+saat/yer ya da tekrar arama tarih+saat) -> kayit guncellenir,
// hatirlatma kurulur (bkz. server.js'deki randevuDefteriHatirlatmalariniKontrolEt).

async function randevuDefteriMenuGoster(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_MENU";
  const ist = randevuDefteriStore.danismanIstatistikleriGetir(from);
  const ozet = ist.toplam > 0 ? `\n\n📒 Kayıtlı müşteri: ${ist.toplam} (Beklemede: ${ist.beklemede})` : "";
  await sendList(
    from,
    `Randevu Defterim'e hoş geldiniz 📒 Ne yapmak istersiniz?${ozet}`,
    "Seçin",
    RANDEVU_DEFTERI_MENU_SECENEKLERI
  );
}

async function randevuDefteriExcelYuklemeBaslat(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_EXCEL_BEKLE";
  // 02.08.2026 DUZELTME (Enbel'in gonderdigi gercek "Referans Listesi
  // Şevval.xlsx" formati esas alinarak guncellendi): danisman ARTIK gercek
  // kaynak dosyanin sutunlarini goruyor, "Ad Soyad"/"Telefon" gibi ELDE
  // OLMAYAN generik isimleri degil. Bizim icin zorunlu olan SADECE Adı
  // Soyadı ve (Cep Telefonu1/2/3'ten en az biri) - digerleri (iş yeri,
  // doğum yılı, vergi bilgisi) varsa arama sirasinda ayrica gosterilir
  // (bkz. randevuDefteriMusteriGoster).
  await sendText(
    from,
    "📥 Excel dosyanızı gönderebilirsiniz.\n\n" +
      "Dosyada şu sütunlar tanınır (ilk satır başlık satırı olmalı, sütun sırası önemli değil):\n\n" +
      "• Adı Soyadı (zorunlu)\n" +
      "• Cep Telefonu1 / Cep Telefonu2 / Cep Telefonu3 (en az biri zorunlu, örn. 0532 123 45 67)\n" +
      "• Şirketin Adı (varsa - iş yeri olarak paylaşılır)\n" +
      "• Doğum Yılı (varsa - yaş buradan otomatik hesaplanır)\n" +
      "• Ödediği Vergi (varsa)\n" +
      "• Şirketin Türü, Şirketin Vergi Numarası (varsa, kayıtta tutulur)\n\n" +
      "Hazır olduğunda dosyayı buraya (WhatsApp'tan belge/döküman olarak) gönderebilirsiniz. 📎"
  );
}

// Cok sayida atlanan satir oldugunda mesajin asiri uzamasini (WhatsApp
// mesaj limitleri) onlemek icin ozette gosterilecek maksimum satir sayisi.
const RANDEVU_DEFTERI_ATLANAN_MAX_GOSTER = 10;

async function randevuDefteriExcelIsle(from, session, buffer, dosyaAdi) {
  const danisman = danismaniBul(from);
  const sonuc = randevuDefteriStore.excelYukle(from, danisman ? danisman.name : null, buffer, dosyaAdi);

  if (sonuc.hata) {
    await sendText(from, `❌ ${sonuc.hata}`);
    return; // ayni state'te kaliyoruz, danisman duzeltilmis dosyayi tekrar gonderebilir
  }

  let mesaj =
    `Excel işlendi ✅\n\n` +
    `Toplam satır: ${sonuc.toplamSatir}\n` +
    `Eklenen müşteri: ${sonuc.eklenen.length}\n` +
    `Atlanan satır: ${sonuc.atlanan.length}`;

  if (sonuc.atlanan.length > 0) {
    const gosterilecekler = sonuc.atlanan.slice(0, RANDEVU_DEFTERI_ATLANAN_MAX_GOSTER);
    const satirlar = gosterilecekler.map((a) => `• Satır ${a.satirNo} (${a.adSoyad}): ${a.sebep}`);
    mesaj += `\n\n${satirlar.join("\n")}`;
    if (sonuc.atlanan.length > gosterilecekler.length) {
      mesaj += `\n...ve ${sonuc.atlanan.length - gosterilecekler.length} tane daha.`;
    }
  }

  await sendText(from, mesaj);
  await randevuDefteriMenuGoster(from, session);
}

async function randevuDefteriMusteriAra(from, session) {
  const musteri = randevuDefteriStore.rastgeleMusteriGetir(from);
  if (!musteri) {
    await sendText(
      from,
      "Şu an aranmayı bekleyen bir müşteri kaydınız yok 🙏 Excel yükleyerek yeni müşteri ekleyebilirsiniz."
    );
    await randevuDefteriMenuGoster(from, session);
    return;
  }
  await randevuDefteriMusteriGoster(from, session, musteri);
}

async function randevuDefteriMusteriGoster(from, session, musteri) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_DURUM_SEC";
  session.randevuDefteriSeciliId = musteri.id;

  // 02.08.2026 DUZELTME (Enbel'in talebi): arama scripti icin gosterilen
  // alanlar SADECE danismanin acikca istedigi kalemlerle sinirlandi - isim
  // soyisim + telefon(lar) (her zaman), varsa is yeri (sirketAdi), varsa
  // dogum yilindan hesaplanmis yas, varsa odedigi vergi. Eskiden ayrica
  // gosterilen "Vergi No" ve "Şirket Türü" kaldirildi (danismanin telefonda
  // soylemesi gereken bilgiler arasinda degildi) - kayitta hala tutuluyor,
  // panelden/ihtiyac olursa tekrar eklenebilir.
  //
  // 02.08.2026 eklendi (Enbel'in talebi): bazi musterilerin BIRDEN FAZLA
  // numarasi olabiliyor (Excel'deki Cep Telefonu1/2/3) - hepsi
  // randevuDefteriStore.js'te musteri.telefonlar dizisinde tutuluyor, hepsi
  // ayri birer satir olarak paylasiliyor (danisman hangisiyle ulasabilirse
  // onu kullanabilsin diye). Her biri WhatsApp'a mesaj gonderebilmek icin
  // uluslararasi bicimde (90XXXXXXXXXX) saklaniyor, ama danisman bu
  // numaralari TELEFONDAN ARAYACAK - o yuzden ekrana hep tanidik yerel
  // bicimde ("0532 123 45 67") basiliyor.
  //
  // 02.08.2026 eklendi (Enbel'in talebi): kaynak veride isim/sirket adi
  // TAMAMI BUYUK (ya da tamami kucuk) harfle gelebiliyor - danismanla
  // paylasirken sadece ilk harfleri buyuk, okunakli bir bicimde gosteriyoruz
  // (bkz. isimIlkHarfleriBuyukYap - Bekleyen İş/Gecikmiş İş listelerinde de
  // kullanilan AYNI fonksiyon, Turkce İ/I/ı/i donusumlerini dogru yapiyor).
  const telefonlar =
    musteri.telefonlar && musteri.telefonlar.length ? musteri.telefonlar : [musteri.telefon].filter(Boolean);
  const satirlar = [`👤 ${isimIlkHarfleriBuyukYap(musteri.adSoyad)}`];
  telefonlar.forEach((tel) => satirlar.push(`📞 ${telefonYerelBicimGoster(tel)}`));
  if (musteri.sirketAdi) satirlar.push(`🏢 İş Yeri: ${isimIlkHarfleriBuyukYap(musteri.sirketAdi)}`);
  if (musteri.yas) satirlar.push(`🎂 Yaş: ${musteri.yas}`);
  if (musteri.sonDonemVergisi) satirlar.push(`💰 Ödediği Vergi: ${musteri.sonDonemVergisi}`);

  const tekrarNotu =
    (musteri.durum === "yeniden_aranacak" || musteri.durum === "ulasilamadi") && musteri.tekrarArama
      ? `\n\n(Bu müşteri için ${musteri.tekrarArama.zamanMetni} tekrar arama zamanı kurulmuştu.)`
      : "";

  await sendText(
    from,
    `İşte aranacak müşteri 📋\n\n${satirlar.join("\n")}${tekrarNotu}\n\nMüşteriyi aradıktan sonra görüşmenin sonucunu seçer misiniz?`
  );
  await sendList(from, "Görüşme sonucu nedir?", "Seçin", RANDEVU_DEFTERI_DURUM_SECENEKLERI);
}

async function randevuDefteriIstatistikGoster(from, session) {
  const ist = randevuDefteriStore.danismanIstatistikleriGetir(from);
  await sendText(
    from,
    `📊 Randevu Defterim Kayıtlarım\n\n` +
      `Toplam: ${ist.toplam}\n` +
      `Beklemede: ${ist.beklemede}\n` +
      `Olumlu: ${ist.olumlu}\n` +
      `Olumsuz: ${ist.olumsuz}\n` +
      `Yeniden Aranacak: ${ist.yeniden_aranacak}\n` +
      `Ulaşılamadı: ${ist.ulasilamadi}\n` +
      `Yanlış Numara: ${ist.yanlis_numara}`
  );
  await randevuDefteriMenuGoster(from, session);
}

async function randevuDefteriOlumsuzAciklamaSor(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_OLUMSUZ_ACIKLAMA";
  await sendText(from, "Anlıyorum. Kısaca nedenini paylaşır mısınız?");
}

async function randevuDefteriOlumsuzTamamla(from, session, neden) {
  const musteri = randevuDefteriStore.kayitGetir(session.randevuDefteriSeciliId);
  randevuDefteriStore.olumsuzIsaretle(session.randevuDefteriSeciliId, neden);
  await sendText(from, `Not edildi. ${musteri ? musteri.adSoyad : "Müşteri"} kaydı olumsuz olarak işaretlendi.`);
  session.randevuDefteriSeciliId = null;
  // 03.08.2026 DUZELTME (Enbel'in talebi): isaretlemeden sonra ana menuye
  // DONMEK yerine otomatik olarak bir SONRAKI musteri gosteriliyor (bkz.
  // REFERANS_ARAMA_DURDURMA_REGEX yorumu) - danisman "yeterli" diyene kadar
  // arama modu boyle devam eder.
  await randevuDefteriMusteriAra(from, session);
}

async function randevuDefteriYanlisNumaraTamamla(from, session) {
  const musteri = randevuDefteriStore.kayitGetir(session.randevuDefteriSeciliId);
  randevuDefteriStore.yanlisNumaraIsaretle(session.randevuDefteriSeciliId);
  await sendText(
    from,
    `Not edildi ✅ ${musteri ? musteri.adSoyad : "Müşteri"} kaydı "yanlış numara" olarak işaretlendi, bu numara bir daha kimseye önerilmeyecek.`
  );
  session.randevuDefteriSeciliId = null;
  // 03.08.2026 DUZELTME: bkz. randevuDefteriOlumsuzTamamla'daki AYNI not.
  await randevuDefteriMusteriAra(from, session);
}

// 01.08.2026 DUZELTILDI: kullanicinin talebi uzerine randevu gunu/saati
// artik serbest metin ("GG.AA.YYYY SS:DD" yazma) yerine, Garanti Emeklilik
// "arama randevusu" akisindaki (yukarida, "Arama tarihi/saati icin secenek
// uretimi" basligi altindaki aramaTarihiKisaSecenekleri/
// aramaSaatAraligiSecenekleri) ile AYNI liste-secim UX'i kullaniyor - once
// hafta ici 5 gunden biri (Bugün/Yarın/Gün adı), sonra o gun icin uygun
// saat araligi listeden secilir. Bu HEM danisman icin daha hizli/hatasiz
// HEM DE aslinda ayni saat dilimi guvenligini koruyor: secilen kanonik
// "GG.AA.YYYY" degeri + secilen araligin baslangic saati birlestirilip yine
// tarihSaatDogrula'ya verilir (20.07.2026 hatirlatma gecikmesi vakasindan
// sonra saat dilimine karsi ozel olarak sertlestirilmis fonksiyon) - yani
// naif bir tarih+saat birlestirme YINE yazilmadi. NOT: bu SADECE randevu
// (appointment) tarih/saati icin gecerli - "tekrar arama" (yeniden aranacak/
// ulasilamadi) hatirlaticisi hala eski serbest-metin "GG.AA.YYYY SS:DD"
// formatinda (bkz. asagidaki randevuDefteriTekrarTarihSor) - kullanicinin
// talebi sadece randevu gunu/saati icindi.
//
// Bu fonksiyon HEM "Referans Ara" -> "Olumlu" akisindan (mevcut bir kayit
// zaten session.randevuDefteriSeciliId'de secili) HEM DE "Randevu Oluştur"
// menusunden (randevuDefteriManuelTelefonAl basarili oldugunda, YENI
// olusturulan kaydin id'si session.randevuDefteriSeciliId'ye atanmis olarak)
// AYNI sekilde cagrilir - randevuDefteriRandevuTamamla'nin gormesi
// acisindan iki akis arasinda fark yoktur, ikisinde de "secili bir kayit"
// vardir.
// 02.08.2026 eklendi (Enbel'in talebi): "müşterinin birden fazla numarası
// varsa bunlardan hangisinin müşteriye ait olduğunu sor ve diğerlerini
// sistemden silelim" - SADECE goruşme "Olumlu" sonuclandiginda sorulur
// (danisman kararı: yalnizca gercek temas kurulan bir sonucta hangi
// numaranin dogru oldugu belli olur - Ulaşılamadı/Yanlış Numara'da henuz
// hangi numaranin dogru oldugu bilinmiyor, o yuzden orada SORULMUYOR,
// numaralar oldugu gibi kaliyor). Secilen numara disindakiler
// randevuDefteriStore.dogruNumarayiSec ile hem kayittan hem GLOBAL
// index'ten siliniyor (bkz. o fonksiyonun yorumu).
async function randevuDefteriDogruNumaraSor(from, session, musteri) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_DOGRU_NUMARA_SEC";
  // Secim eslesirken orijinal (uluslararasi, 90XXXXXXXXXX) degerlere geri
  // donebilmek icin session'da SIRALI olarak saklaniyor - kullaniciya
  // gosterilen ise sadece yerel bicimi (bkz. asagidaki secenekler).
  session.randevuDefteriNumaraSecenekleri = musteri.telefonlar;
  const secenekler = musteri.telefonlar.map((t) => telefonYerelBicimGoster(t));
  await sendList(
    from,
    "Tebrikler! 🎉 Bu müşterinin sistemde birden fazla numarası vardı - hangisinden ulaştınız?",
    "Seçin",
    secenekler
  );
}

async function randevuDefteriRandevuGunSor(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_RANDEVU_GUN";
  session.randevuDefteriGecici = {};
  await sendList(from, "Tebrikler! 🎉 Randevu için hangi gün uygun?", "Seçin", aramaTarihiKisaSecenekleri());
}

// 01.08.2026 DUZELTILDI: kullanicinin talebi uzerine artik "08:00-10:00" gibi
// bir ARALIK degil, dogrudan "09:30".."18:00" arasi yarim saatlik bir SAAT
// seciliyor (bkz. tumRandevuSaatleri/randevuSaatSecenekleri yukarida).
// WhatsApp'in 10 satirlik liste sinirindan dolayi, uygun saat sayisi 10'u
// asarsa once Sabah/Öğleden Sonra sorulur (bkz. RANDEVU_YARIM_GUN_SECENEKLERI).
async function randevuDefteriRandevuSaatSor(from, session) {
  const secenekler = randevuSaatSecenekleri(session.randevuDefteriGecici.tarihStr);
  if (secenekler.length === 0) {
    await sendText(from, "Bu gün için uygun bir randevu saati kalmadı 🙏 Lütfen başka bir gün seçer misiniz?");
    await randevuDefteriRandevuGunSor(from, session);
    return;
  }
  if (secenekler.length <= 10) {
    session.state = "DANISMAN_RANDEVU_DEFTERI_RANDEVU_SAAT";
    await sendList(from, "Hangi saat uygun?", "Seçin", secenekler);
    return;
  }
  session.state = "DANISMAN_RANDEVU_DEFTERI_RANDEVU_YARIM_GUN";
  await sendButtons(from, "Randevu için sabah (09:30-13:30) mı, öğleden sonra (14:00-18:00) mı uygun?", RANDEVU_YARIM_GUN_SECENEKLERI);
}

async function randevuDefteriRandevuYerSor(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_RANDEVU_YER";
  await sendText(from, "Randevu nerede olacak? (Örn: Kadıköy Ofis, müşterinin iş yeri vb.)");
}

// --- "Randevu Oluştur" menüsü (01.08.2026 eklendi) ---
// Excel'den ice aktarilmis/aranmis bir kayit olmadan, dogrudan bu menuden
// manuel olarak ad+telefon girilip randevu olusturulabilmesi icin
// (kullanicinin talebi: "illa excel'den yapılan aramalardan değil"). Ad ve
// telefon alindiktan hemen SONRA (randevu tarih/saati beklenmeden) kayit
// randevuDefteriStore'a yazilir - boylece GLOBAL numara tekrari kontrolu
// (bkz. randevuDefteriStore.js dosya basi NOT'u) en erken asamada devreye
// girer, danisman tum randevu akisini bosuna doldurmaz. Kayit olusturulur
// olusturulmaz session.randevuDefteriSeciliId bu yeni kaydin id'sine
// atanir - boylece devamindaki gun/saat/yer adimlari ve
// randevuDefteriRandevuTamamla, "Referans Ara" akisindan hicbir farki
// olmadan ayni sekilde calisir.
async function randevuDefteriManuelBaslat(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_MANUEL_AD";
  session.randevuDefteriGecici = {};
  session.randevuDefteriSeciliId = null;
  await sendText(from, "Randevu oluşturmak istediğiniz müşterinin adı soyadı nedir?");
}

async function randevuDefteriManuelTelefonSor(from, session) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_MANUEL_TELEFON";
  await sendText(from, "Müşterinin telefon numarası nedir? (Örn: 0532 123 45 67)");
}

async function randevuDefteriRandevuTamamla(from, session) {
  const musteri = randevuDefteriStore.kayitGetir(session.randevuDefteriSeciliId);
  const danisman = danismaniBul(from);
  const g = session.randevuDefteriGecici;
  const zamanMetni = turkiyeSaatiniFormatla(g.zamanMs, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  randevuDefteriStore.olumluIsaretle(session.randevuDefteriSeciliId, {
    zamanMs: g.zamanMs,
    zamanMetni,
    yer: g.yer
  });

  await sendText(
    from,
    `✅ ${musteri ? musteri.adSoyad : "Müşteri"} ile ${zamanMetni} tarihinde ${g.yer} adresinde randevu oluşturuldu! Randevu zamanı geldiğinde size hatırlatacağım. 🎉`
  );

  // Enbel'e bilgi gitmesi kullanicinin acik talebiydi ("hangi danismanin
  // randevu aldigi da yer alacak") - bu bir bildirim, danismanin kendi
  // akisini ASLA bozmamali (try/catch ile izole, bkz. bu dosyadaki diger
  // "guvenlik agi" bildirimleriyle AYNI ilke).
  try {
    // 31.07.2026 eklendi: kullanicinin "ayrı şablon daha mantıklı" geri
    // bildirimi uzerine, bu bildirim artik AGENT_DETAY_TEMPLATE_NAME'in
    // ("YENI TALEP" basligi) yerine Randevu Defterim'e ozel sablonu (varsa)
    // deneyen randevuDefteriHatirlatmaGonder ile gonderiliyor (bkz. o
    // fonksiyonun conversationEngine.js'teki yorumu).
    await conversationEngine.randevuDefteriHatirlatmaGonder(
      ENBEL_NUMARASI,
      `📅 Yeni Randevu\n\nDanışman: ${danisman ? danisman.name : from}\nMüşteri: ${musteri ? musteri.adSoyad : "?"} (${
        musteri ? telefonYerelBicimGoster(musteri.telefon) : "?"
      })\nTarih: ${zamanMetni}\nYer: ${g.yer}`
    );
  } catch (err) {
    console.error("Randevu bildirimi Enbel'e gonderilemedi:", err?.response?.data || err.message);
  }

  session.randevuDefteriGecici = null;
  session.randevuDefteriSeciliId = null;
  // 03.08.2026 DUZELTME: bkz. randevuDefteriOlumsuzTamamla'daki AYNI not -
  // ana menuye donmek yerine otomatik olarak bir sonraki musteri gosterilir.
  await randevuDefteriMusteriAra(from, session);
}

async function randevuDefteriTekrarTarihSor(from, session, durum) {
  session.state = "DANISMAN_RANDEVU_DEFTERI_TEKRAR_TARIH";
  session.randevuDefteriGecici = { durum };
  await sendText(
    from,
    "Müşteriyi ne zaman tekrar aramak istersiniz? GG.AA.YYYY SS:DD formatında yazar mısınız? (Örn: 10.08.2026 14:30)"
  );
}

async function randevuDefteriTekrarTamamla(from, session) {
  const musteri = randevuDefteriStore.kayitGetir(session.randevuDefteriSeciliId);
  const g = session.randevuDefteriGecici;
  const zamanMetni = turkiyeSaatiniFormatla(g.zamanMs, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  randevuDefteriStore.tekrarAramaIsaretle(session.randevuDefteriSeciliId, g.durum, {
    zamanMs: g.zamanMs,
    zamanMetni
  });

  await sendText(from, `Not edildi ✅ ${musteri ? musteri.adSoyad : "Müşteri"} için ${zamanMetni} tarihinde tekrar hatırlatacağım.`);

  session.randevuDefteriGecici = null;
  session.randevuDefteriSeciliId = null;
  // 03.08.2026 DUZELTME: bkz. randevuDefteriOlumsuzTamamla'daki AYNI not.
  await randevuDefteriMusteriAra(from, session);
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
    const excelBekleniyorMu =
      session.state === "DANISMAN_RANDEVU_DEFTERI_EXCEL_BEKLE" || session.state === "DANISMAN_YENILEME_EXCEL_BEKLE";
    const dosyaAdiExcelUzantili = dosyaAdiExcelUzantiliMi(parsed.dosyaAdi);
    if (!dosyaTuruIzinliMi(parsed.mimeType) && !(excelBekleniyorMu && dosyaAdiExcelUzantili)) {
      console.log(
        "Dosya turu reddedildi (genel kontrol):",
        "mimeType=", parsed.mimeType,
        "dosyaAdi=", parsed.dosyaAdi,
        "state=", session.state
      );
      await sendText(
        from,
        "Bu dosya türünü kabul edemiyoruz 🙏 Sadece PDF, Word, Excel veya fotoğraf (jpg/png) gönderebilirsiniz."
      );
      return;
    }

    // 31.07.2026 eklendi (Randevu Defterim ozelligi): danisman Excel Yükle
    // adimindaysa, gelen dosyayi (izinli genel turler icinde olsa bile,
    // orn. bir fotograf DEGIL) GERCEKTEN bir Excel dosyasi olup olmadigini
    // ayrica kontrol edip isliyoruz - digger tum durum/akislardan ONCE,
    // cunku bu state'te baska hicbir belge islemi anlamli degil.
    if (session.state === "DANISMAN_RANDEVU_DEFTERI_EXCEL_BEKLE") {
      if (!RANDEVU_DEFTERI_EXCEL_MIME_TURLERI.includes((parsed.mimeType || "").toLowerCase()) && !dosyaAdiExcelUzantili) {
        console.log(
          "Excel mime kontrolu basarisiz (randevu defteri):",
          "mimeType=", parsed.mimeType,
          "dosyaAdi=", parsed.dosyaAdi
        );
        await sendText(from, "Bu bir Excel dosyası (.xlsx/.xls) gibi görünmüyor 🙏 Lütfen Excel formatında gönderir misiniz?");
        return;
      }
      try {
        console.log("Randevu defteri excel dosyasi kabul edildi, indiriliyor:", parsed.dosyaAdi, parsed.mimeType);
        const { buffer } = await mediaIndir(parsed.mediaId);
        await sendText(from, "Excel dosyanızı işliyorum, bir saniye... 🔍");
        await randevuDefteriExcelIsle(from, session, buffer, parsed.dosyaAdi);
      } catch (err) {
        console.error("Randevu defteri excel indirilemedi/islenemedi:", err?.response?.data || err.message);
        await sendText(from, "Dosyayı işlerken bir sorun oluştu 🙏 Lütfen tekrar gönderir misiniz?");
      }
      return;
    }

    // 01.08.2026 eklendi (Yenileme Takibi - toplu Excel yukleme): AYNI mime
    // kontrolu (RANDEVU_DEFTERI_EXCEL_MIME_TURLERI genel bir "bu bir Excel
    // dosyasi mi" kontrolu, isme ragmen Randevu Defterim'e ozel degil).
    if (session.state === "DANISMAN_YENILEME_EXCEL_BEKLE") {
      if (!RANDEVU_DEFTERI_EXCEL_MIME_TURLERI.includes((parsed.mimeType || "").toLowerCase()) && !dosyaAdiExcelUzantili) {
        console.log(
          "Excel mime kontrolu basarisiz (yenileme):",
          "mimeType=", parsed.mimeType,
          "dosyaAdi=", parsed.dosyaAdi
        );
        await sendText(from, "Bu bir Excel dosyası (.xlsx/.xls) gibi görünmüyor 🙏 Lütfen Excel formatında gönderir misiniz?");
        return;
      }
      try {
        console.log("Yenileme uretim excel dosyasi kabul edildi, indiriliyor:", parsed.dosyaAdi, parsed.mimeType);
        const { buffer } = await mediaIndir(parsed.mediaId);
        await sendText(from, "Üretim dosyanızı işliyorum, bir saniye... 🔍");
        await yenilemeExcelIsle(from, session, buffer, parsed.dosyaAdi);
      } catch (err) {
        console.error("Yenileme uretim excel indirilemedi/islenemedi:", err?.response?.data || err.message);
        await sendText(from, "Dosyayı işlerken bir sorun oluştu 🙏 Lütfen tekrar gönderir misiniz?");
      }
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

    // 03.08.2026 eklendi (Enbel'in talebi, ayni gun proforma destegi de
    // eklendi): Buraya kadar gelindiyse (aktif bir soru/belge akisi yok -
    // danisman menu/bos seviyede) VE gonderilen bir belgeyse, ONCE bunun
    // beklenmedik bir ARAÇ RUHSATI YA DA PROFORMA belgesi olup olmadigina
    // bakiyoruz - musteri tarafiyla (conversationEngine.js'deki media
    // isleyicisi) AYNI paylasilan yardimci fonksiyonlari kullanarak (bkz. o
    // dosyadaki beklenmedikAracBelgesiDeneVeAnalizEt/aracBelgesiOCRSonucundanAnswersDoldur
    // yorumu). Bir arac belgesi olarak taniniyorsa (Claude "okunabilir: true"
    // donerse) Trafik/Kasko/Ikisi de sorusunu sorup, danismanin musteri
    // adina yeni talep olusturma akisini (DANISMAN_YENI_*) belgeden okunan
    // bilgilerle ONCEDEN DOLDURULMUS sekilde baslatiyoruz - taniyamazsa
    // (okunabilir false ya da analiz basarisiz olursa) SESSIZCE asagidaki
    // "Araç Satış Sözleşmesi" kontrolune (mevcut davranis) duselim - bu yeni
    // ozellik mevcut davranisi asla bozmamali.
    const beklenmedikBelgeTuruUygunMu =
      parsed.mimeType && (parsed.mimeType.startsWith("image/") || parsed.mimeType === "application/pdf");
    if (beklenmedikBelgeTuruUygunMu) {
      try {
        const { buffer, mimeType } = await mediaIndir(parsed.mediaId);
        const gercekMimeType = parsed.mimeType || mimeType;
        const belgeSonucu = await conversationEngine.beklenmedikAracBelgesiDeneVeAnalizEt(buffer, gercekMimeType);
        if (belgeSonucu) {
          session.danismanBeklenmedikAracBelgesiVeri = {
            tur: belgeSonucu.tur,
            sonuc: belgeSonucu.sonuc,
            veriBase64: buffer.toString("base64"),
            mimeType: gercekMimeType
          };
          session.state = "DANISMAN_ARAC_BELGESI_URUN_SEC";
          const tanitim = conversationEngine.ARAC_BELGESI_TANITIM_CUMLESI[belgeSonucu.tur];
          await sendList(
            from,
            `${tanitim} Bu araç için Trafik Sigortası mı, Kasko mu, yoksa ikisini birden mi oluşturmak istersiniz?`,
            "Ürün Seç",
            conversationEngine.ARAC_BELGESI_URUN_SEC_SECENEKLERI
          );
          return;
        }
      } catch (err) {
        console.error("Beklenmedik arac belgesi kontrolu basarisiz (sessizce sonraki kontrole dusuluyor):", err.message);
      }
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

  // 02.08.2026 eklendi (Enbel'in talebi): yeni talep bildiriminde artik TAM
  // detay hemen gelmiyor - once kisa bir "evet yazarak detayını görebilirsiniz"
  // daveti gidiyor (bkz. conversationEngine.js -> bildirimGonder). Danisman
  // "evet" yazinca, bekleyenDetayStore'daki EN ESKI detayi gercek satir
  // sonlariyla (duz metin) gonderiyoruz. Sadece "bos"/menu benzeri
  // durumlarda (DETAY_EVET_IDLE_DURUMLARI) yakalanir - yukaridaki mevcut
  // "evet" HARIC TUTMA yorumundaki AYNI sebeple (soru cevaplarina karismasin
  // diye) baska hicbir durumda devreye girmez.
  if (
    parsed.type === "text" &&
    DETAY_EVET_IDLE_DURUMLARI.has(session.state) &&
    DETAY_EVET_REGEX.test(userText || "")
  ) {
    const detay = bekleyenDetayStore.sonrakiDetayAl(from);
    if (detay) {
      await sendText(from, detay.detayliMetin);
      const kalan = bekleyenDetayStore.bekleyenSayisi(from);
      if (kalan > 0) {
        await sendText(
          from,
          `Ayrıca ${kalan} bekleyen talep detayı daha var, "evet" yazmaya devam edebilirsiniz.`
        );
      }
      return;
    }
    // Kuyrukta bekleyen bir detay yoksa (orn. zaten gosterildi, ya da
    // danisman bagimsiz bir sebeple "evet" yazdi), normal akisa devam - bu
    // durumda switch(session.state) mevcut durumu (orn. DANISMAN_KARSILAMA
    // icin ANA_MENU_SECENEKLERI eslesmesi) normal sekilde isler.
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
      if (userText === "Gecikmiş İş") {
        await gecikmisIsMenuGoster(from, session);
        return;
      }
      if (userText === "Destek Talebi Oluştur") {
        await destekTalebiAciklamaGoster(from, session);
        return;
      }
      if (userText === "Yenileme Takibi Ekle") {
        await yenilemeEklemeMenuGoster(from, session);
        return;
      }
      // 31.07.2026 eklendi: ilk surumde placeholder'di ("yakında burada
      // olacak"), kullanicinin ayrintili aciklamasi uzerine tam ozellik
      // (Excel yukleme + rastgele musteri arama + sonuc kaydi) eklendi.
      if (userText === "Randevu Defterim") {
        await randevuDefteriMenuGoster(from, session);
        return;
      }
      if (userText === "Sık Sorulan Sorular") {
        await sssUrunSecBaslat(from, session);
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

    // 02.08.2026 eklendi: "Gecikmiş İş" listesinden secim - DANISMAN_LEAD_SECIMI
    // ile AYNI mantik, ama KENDI liste alanini (session.gecikmisLeadListesi)
    // okur ve hata/bos durumunda "Bekleyen İş"e degil KENDI menusune
    // (gecikmisIsMenuGoster) doner - boylece yanlislikla Bekleyen İş
    // listesine karisilmaz.
    case "DANISMAN_GECIKMIS_LEAD_SECIMI": {
      if (parsed.type !== "interactive" || !parsed.interactiveId) {
        await gecikmisIsMenuGoster(from, session);
        return;
      }
      const index = parseInt(parsed.interactiveId.replace("list_", ""), 10);
      const leadId = (session.gecikmisLeadListesi || [])[index];
      const lead = leadId && leadStore.leadGetir(leadId);
      if (!lead) {
        await gecikmisIsMenuGoster(from, session);
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
    // 03.08.2026 eklendi: beklenmedik (sorulmadan gonderilen) bir ruhsat/
    // proforma belgesi taninip Trafik/Kasko/Ikisi de sorusu soruldugunda
    // gelen cevabi isler (bkz. yukaridaki media isleyicisindeki tetikleme).
    // Musteri tarafinin AKSINE, burada sigortalinin telefon numarasi henuz
    // bilinmiyor (danisman belgeyi gondermeden once bunu paylasmadi) - bu
    // yuzden urun secildikten sonra MEVCUT "DANISMAN_YENI_TELEFON_BEKLE"
    // durumuna gecip (bkz. asagisi) o durumun KENDI mantigiyla telefonu
    // soruyoruz, hicbir kod tekrarlanmiyor.
    case "DANISMAN_ARAC_BELGESI_URUN_SEC": {
      const secilen = matchOption(userText, conversationEngine.ARAC_BELGESI_URUN_SEC_SECENEKLERI);
      if (!secilen) {
        await sendList(
          from,
          "Lütfen listeden bir seçenek seçer misiniz? 🙏",
          "Ürün Seç",
          conversationEngine.ARAC_BELGESI_URUN_SEC_SECENEKLERI
        );
        return;
      }

      const veri = session.danismanBeklenmedikAracBelgesiVeri;
      session.danismanBeklenmedikAracBelgesiVeri = null;
      const oncelikliUrun = secilen === "Kasko" ? "kasko" : "trafik";

      session.danismanYeniUrunKey = oncelikliUrun;
      session.danismanYeniAnswers = {};
      session.danismanYeniEkBelgeler = [];
      session.danismanSaglikAileAsama = null;
      session.danismanSaglikAileGecici = null;

      if (veri) {
        conversationEngine.aracBelgesiOCRSonucundanAnswersDoldur(session.danismanYeniAnswers, veri.tur, veri.sonuc);
        session.danismanYeniEkBelgeler.push(
          conversationEngine.aracBelgesiEkBelgeKaydiOlustur(veri.tur, veri.mimeType, veri.veriBase64)
        );
      }

      // "İkisi de" secilirse once Trafik'i (kasko capraz satis sorusu
      // "Evet" olarak onceden isaretlenmis sekilde) tamamlatiyoruz, Trafik
      // bitince danismanYeniTalepiTamamla otomatik olarak Kasko'nun SADECE
      // henuz cevaplanmamis sorularini sormaya devam ediyor (bkz. o
      // fonksiyonun sonundaki "danismanYeniIkisiDeSonraki" kontrolu).
      if (secilen === "İkisi de") {
        session.danismanYeniAnswers.kasko_talebi = "Evet";
        session.danismanYeniIkisiDeSonraki = "kasko";
      } else {
        session.danismanYeniIkisiDeSonraki = null;
      }

      session.state = "DANISMAN_YENI_TELEFON_BEKLE";
      await sendText(
        from,
        "Sigortalının telefon numarasını (başında ülke koduyla, örn: 905551234567 şeklinde) paylaşır mısınız?"
      );
      return;
    }

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
    case "DANISMAN_YENILEME_EKLEME_MENU": {
      const secim = matchOption(userText, YENILEME_EKLEME_MENU_SECENEKLERI);
      if (secim === "Excel ile Toplu Yükle") {
        if (!yenilemeExcelYuklemeYetkisiVarMi(from)) {
          await yenilemeBaslat(from, session);
          return;
        }
        await yenilemeExcelYuklemeBaslat(from, session);
        return;
      }
      if (secim === "Tek Tek Ekle") {
        await yenilemeBaslat(from, session);
        return;
      }
      await yenilemeEklemeMenuGoster(from, session);
      return;
    }

    case "DANISMAN_YENILEME_EXCEL_BEKLE": {
      // Bu state'te sadece belge/dosya bekleniyor (bkz. handleAdvisorMessage
      // basindaki media isleme blogu) - metin geldiyse kullaniciyi tekrar
      // dosya gondermeye yonlendiriyoruz.
      await sendText(from, "Devam etmek için lütfen üretim takip Excel dosyanızı (.xlsx/.xls) belge olarak gönderir misiniz? 📎");
      return;
    }

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

    // --- Sık Sorulan Sorular: urun secimi (musteri tarafindaki ASK_INFO_PRODUCT
    // ile AYNI liste/mantik) ---
    case "DANISMAN_SSS_URUN_SEC": {
      const matchedInfoLabel = matchOption(userText, conversationEngine.INFO_PRODUCT_LABELS);
      if (!matchedInfoLabel) {
        await sendList(
          from,
          "Üzgünüm, listeden bir seçenek seçmeniz gerekiyor. Lütfen tekrar seçin:",
          "Seçin",
          conversationEngine.INFO_PRODUCT_LABELS
        );
        return;
      }
      const infoIdx = conversationEngine.INFO_PRODUCT_LABELS.indexOf(matchedInfoLabel);
      const infoKey = conversationEngine.INFO_PRODUCT_KEYS[infoIdx];

      // 31.07.2026 eklendi: "Bireysel Emeklilik(BES)" secildiginde, TSS/ÖSS/
      // Doğum'un aksine serbest soru-cevap moduna GIRILMIYOR (BES icin PDF'e
      // dayanan boyle bir motor yok) - onun yerine eskiden ayri bir ana menu
      // secenegi olan "BES Fonları" icerigi (fon listesi + guncel getiriler)
      // dogrudan gosteriliyor, sonra ana menuye donuluyor.
      if (infoKey === "bes") {
        await besFonListesiGoster(from, session);
        return;
      }

      if (conversationEngine.BILGI_SORU_MODULLERI[infoKey]) {
        session.state = "DANISMAN_SSS_SORU";
        session.danismanSssUrunAnahtari = infoKey;
        await sendText(
          from,
          `${conversationEngine.INFO_LABEL_BY_KEY[infoKey]} ile ilgili merak ettiğiniz her şeyi sorabilirsiniz - ` +
            "örneğin bir hastalığın/tedavinin poliçe kapsamında olup olmadığı, bekleme süreleri, " +
            "istisnalar vb. 😊\n\nSorunuzu yazabilirsiniz."
        );
      } else {
        await sendText(
          from,
          `${conversationEngine.INFO_LABEL_BY_KEY[infoKey]} için şu an otomatik bilgi hizmetimiz bulunmuyor. 🙏`
        );
        await devamMenuGoster(from, session);
      }
      return;
    }

    // --- Sık Sorulan Sorular: PDF'e dayanan serbest soru-cevap (musteri
    // tarafindaki URUN_BILGI_SORU ile AYNI moduller/mantik) ---
    case "DANISMAN_SSS_SORU": {
      // 31.07.2026 eklendi: danisman sadece "teşekkürler" gibi bir kapanis
      // ifadesi yazdiginda, bu metin YANLISLIKLA soru-cevap moduluna (AI)
      // gonderilip AI'nin kendi kibar cevabinin ARDINDAN asagidaki sabit
      // "Başka bir sorunuz var mı?" mesaji da gidiyordu - ust uste iki mesaj
      // (musteri tarafindaki AYNI hatanin danisman tarafindaki karsiligi,
      // bkz. conversationEngine.js'teki URUN_BILGI_SORU case'indeki AYNI
      // duzeltme). Artik boyle bir kapanis ifadesi TEK BASINA gelirse AI'a
      // hic sorulmuyor, TEK bir kisa tesekkur cevabi gonderiliyor.
      if (KAPANIS_IFADE_REGEX.test(normalizeTr(userText.trim()))) {
        await sendText(from, "Rica ederim, her zaman yardımcı olmaktan memnuniyet duyarız! 😊 Başka bir sorunuz olursa buradayım.");
        return;
      }
      const modul =
        conversationEngine.BILGI_SORU_MODULLERI[session.danismanSssUrunAnahtari] ||
        conversationEngine.BILGI_SORU_MODULLERI.tss;
      const cevap = await modul.soruyaCevapVer(userText);
      await sendText(from, cevap);
      await sendText(from, "Başka bir sorunuz var mı? Yoksa ana menüye dönmek için \"menü\" yazabilirsiniz. 😊");
      return;
    }

    // --- Randevu Defterim (31.07.2026 eklendi) ---
    case "DANISMAN_RANDEVU_DEFTERI_MENU": {
      const secim = matchOption(userText, RANDEVU_DEFTERI_MENU_SECENEKLERI) || userText;
      if (secim === "Referans Ara") {
        await randevuDefteriMusteriAra(from, session);
        return;
      }
      if (secim === "Randevu Oluştur") {
        await randevuDefteriManuelBaslat(from, session);
        return;
      }
      if (secim === "Kayıtlarım") {
        await randevuDefteriIstatistikGoster(from, session);
        return;
      }
      if (secim === "Referans Yükle") {
        await randevuDefteriExcelYuklemeBaslat(from, session);
        return;
      }
      if (secim === "Ana Menüye Dön") {
        await karsilamaGoster(from, session);
        return;
      }
      await randevuDefteriMenuGoster(from, session);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_EXCEL_BEKLE": {
      // Bu state'te asil islem media (dosya) mesajlarinda yapiliyor (bkz.
      // handleAdvisorMessage basindaki media kontrolu) - buraya sadece
      // danisman YANLISLIKLA metin yazarsa dusulur.
      await sendText(from, "Lütfen Excel dosyanızı WhatsApp üzerinden dosya (döküman) olarak gönderir misiniz? 📎");
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_DURUM_SEC": {
      if (parsed.type === "text" && REFERANS_ARAMA_DURDURMA_REGEX.test(userText || "")) {
        await referansAramaDurduruldu(from, session);
        return;
      }
      const secim = matchOption(userText, RANDEVU_DEFTERI_DURUM_SECENEKLERI) || userText;
      const musteri = randevuDefteriStore.kayitGetir(session.randevuDefteriSeciliId);
      if (!musteri) {
        await randevuDefteriMenuGoster(from, session);
        return;
      }
      if (secim === "Olumlu") {
        // 02.08.2026 eklendi: birden fazla numarasi olan bir musteride once
        // hangi numaranin dogru oldugunu soruyoruz (bkz.
        // randevuDefteriDogruNumaraSor'un yorumu) - tek numarasi varsa bu
        // adim atlanip dogrudan randevu gunu sorulur (mevcut davranis).
        if (musteri.telefonlar && musteri.telefonlar.length > 1) {
          await randevuDefteriDogruNumaraSor(from, session, musteri);
          return;
        }
        await randevuDefteriRandevuGunSor(from, session);
        return;
      }
      if (secim === "Olumsuz") {
        await randevuDefteriOlumsuzAciklamaSor(from, session);
        return;
      }
      if (secim === "Yeniden Aranacak") {
        await randevuDefteriTekrarTarihSor(from, session, "yeniden_aranacak");
        return;
      }
      if (secim === "Ulaşılamadı") {
        await randevuDefteriTekrarTarihSor(from, session, "ulasilamadi");
        return;
      }
      if (secim === "Yanlış Numara") {
        await randevuDefteriYanlisNumaraTamamla(from, session);
        return;
      }
      await sendList(from, "Lütfen listeden bir sonuç seçin:", "Seçin", RANDEVU_DEFTERI_DURUM_SECENEKLERI);
      return;
    }

    // 02.08.2026 eklendi: "Olumlu" sonucunda, birden fazla numarasi olan bir
    // musteri icin hangi numaradan ulasildigini secer - bkz.
    // randevuDefteriDogruNumaraSor/randevuDefteriStore.dogruNumarayiSec.
    case "DANISMAN_RANDEVU_DEFTERI_DOGRU_NUMARA_SEC": {
      if (parsed.type === "text" && REFERANS_ARAMA_DURDURMA_REGEX.test(userText || "")) {
        await referansAramaDurduruldu(from, session);
        return;
      }
      const secenekler = (session.randevuDefteriNumaraSecenekleri || []).map((t) => telefonYerelBicimGoster(t));
      const secilenYerel = matchOption(userText, secenekler);
      if (!secilenYerel) {
        await sendList(from, "Lütfen listeden bir numara seçer misiniz?", "Seçin", secenekler);
        return;
      }
      const index = secenekler.indexOf(secilenYerel);
      const seciliTelefon = (session.randevuDefteriNumaraSecenekleri || [])[index];
      randevuDefteriStore.dogruNumarayiSec(session.randevuDefteriSeciliId, seciliTelefon);
      session.randevuDefteriNumaraSecenekleri = null;
      await randevuDefteriRandevuGunSor(from, session);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_OLUMSUZ_ACIKLAMA": {
      if (!bosDegilMi(userText)) {
        await sendText(from, "Kısaca nedenini yazar mısınız?");
        return;
      }
      await randevuDefteriOlumsuzTamamla(from, session, userText.trim());
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_MANUEL_AD": {
      if (!bosDegilMi(userText)) {
        await sendText(from, "Müşterinin adı soyadını yazar mısınız?");
        return;
      }
      session.randevuDefteriGecici.manuelAd = userText.trim();
      await randevuDefteriManuelTelefonSor(from, session);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_MANUEL_TELEFON": {
      const danisman = danismaniBul(from);
      const sonuc = randevuDefteriStore.manuelKayitOlustur(
        from,
        danisman ? danisman.name : null,
        session.randevuDefteriGecici.manuelAd,
        userText
      );
      if (sonuc.hata) {
        await sendText(from, `❌ ${sonuc.hata} Lütfen tekrar yazar mısınız?`);
        return;
      }
      session.randevuDefteriSeciliId = sonuc.kayit.id;
      await randevuDefteriRandevuGunSor(from, session);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_RANDEVU_GUN": {
      const kisaSecenekler = aramaTarihiKisaSecenekleri();
      const options = aramaTarihiSecenekleri();
      const kisaEslesen = matchOption(userText, kisaSecenekler);
      if (!kisaEslesen) {
        await sendList(from, "Lütfen listeden bir gün seçer misiniz?", "Seçin", kisaSecenekler);
        return;
      }
      session.randevuDefteriGecici.tarihStr = options[kisaSecenekler.indexOf(kisaEslesen)];
      await randevuDefteriRandevuSaatSor(from, session);
      return;
    }

    // 01.08.2026 DUZELTILDI: bu case artik dogrudan "09:30".."18:00" arasi
    // yarim saatlik bir SAAT bekliyor (arama randevusundaki gibi bir ARALIK
    // degil) - bkz. tumRandevuSaatleri/randevuDefteriRandevuSaatSor.
    // matchOption TUM 18 olasi saate karsi calisiyor (danismana o an hangi
    // alt-liste - Sabah/Öğleden Sonra/tam liste - gosterilmis olursa olsun
    // saglam kalsin diye), gecerlilik yine de secili GUN icin uygun saatler
    // (bugunse +2 saat kurali) tarihSaatDogrula + gecmis-tarih kontroluyle
    // saglaniyor.
    case "DANISMAN_RANDEVU_DEFTERI_RANDEVU_SAAT": {
      const tumOlasi = tumRandevuSaatleri();
      const secilen = matchOption(userText, tumOlasi);
      if (!secilen) {
        await sendText(from, "Lütfen listeden bir saat seçer misiniz?");
        return;
      }
      const zamanMs = tarihSaatDogrula(`${session.randevuDefteriGecici.tarihStr} ${secilen}`);
      if (!zamanMs || zamanMs < Date.now()) {
        // Guvenlik agi: secenekler normalde zaten gecmisi filtreliyor (bkz.
        // randevuSaatSecenekleri), ama olur da saat kaymasi gibi bir durumda
        // gecmis bir saat secilmisse danismani tikanmis birakmamak icin
        // listeyi tekrar gosteriyoruz.
        await sendText(from, "Bu saat artık geçmişte kalmış görünüyor, lütfen başka bir saat seçer misiniz?");
        await randevuDefteriRandevuSaatSor(from, session);
        return;
      }
      session.randevuDefteriGecici.zamanMs = zamanMs;
      await randevuDefteriRandevuYerSor(from, session);
      return;
    }

    // 01.08.2026 eklendi: WhatsApp'in 10 satirlik liste sinirindan dolayi
    // >10 uygun saat oldugunda once Sabah/Öğleden Sonra soruluyor (bkz.
    // randevuDefteriRandevuSaatSor) - bu case o secimi cozup daralmis
    // (<=9 satirlik) saat listesini gosterir.
    case "DANISMAN_RANDEVU_DEFTERI_RANDEVU_YARIM_GUN": {
      const secim = matchOption(userText, RANDEVU_YARIM_GUN_SECENEKLERI);
      if (!secim) {
        await sendButtons(from, "Lütfen sabah mı öğleden sonra mı uygun olduğunu seçer misiniz?", RANDEVU_YARIM_GUN_SECENEKLERI);
        return;
      }
      const saatler = randevuYarimGunSaatleri(session.randevuDefteriGecici.tarihStr, secim);
      if (saatler.length === 0) {
        // Guvenlik agi: teorik olarak saat kaymasi gibi bir durumda secilen
        // yarida hic uygun saat kalmamis olabilir - danismani tikanmis
        // birakmamak icin diger yariyi denemesini istiyoruz.
        await sendText(from, "Bu aralıkta uygun saat kalmadı, lütfen diğerini seçer misiniz?");
        await sendButtons(from, "Randevu için sabah mı, öğleden sonra mı uygun?", RANDEVU_YARIM_GUN_SECENEKLERI);
        return;
      }
      session.state = "DANISMAN_RANDEVU_DEFTERI_RANDEVU_SAAT";
      await sendList(from, "Hangi saat uygun?", "Seçin", saatler);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_RANDEVU_YER": {
      if (!bosDegilMi(userText)) {
        await sendText(from, "Randevu yerini yazar mısınız?");
        return;
      }
      session.randevuDefteriGecici.yer = userText.trim();
      await randevuDefteriRandevuTamamla(from, session);
      return;
    }

    case "DANISMAN_RANDEVU_DEFTERI_TEKRAR_TARIH": {
      const zamanMs = tarihSaatDogrula(userText);
      if (!zamanMs) {
        await sendText(from, "Lütfen GG.AA.YYYY SS:DD formatında yazar mısınız? (Örn: 10.08.2026 14:30)");
        return;
      }
      if (zamanMs < Date.now()) {
        await sendText(from, "Bu tarih geçmişte kalmış görünüyor, lütfen ileri bir tarih/saat yazar mısınız?");
        return;
      }
      // 01.08.2026 eklendi: "resmi tatillerin hiçbirinde çalışmıyoruz ...
      // resmi tatillere arama talebi de oluşturmuyoruz" - tekrar arama hala
      // serbest metin oldugu icin (gun secim listesi degil), gun secim
      // listesindeki gibi otomatik hariç tutma yapilamiyor, bunun yerine
      // secilen tarih resmi tatile denk geliyorsa hangi tatil oldugu
      // belirtilerek reddediliyor.
      const tatilAdi = resmiTatiller.tatilAdiGetir(
        turkiyeSaatiniFormatla(zamanMs, { day: "2-digit", month: "2-digit", year: "numeric" })
      );
      if (tatilAdi) {
        await sendText(from, `${tatilAdi} nedeniyle o gün çalışmıyoruz 🙏 Lütfen başka bir tarih/saat yazar mısınız?`);
        return;
      }
      session.randevuDefteriGecici.zamanMs = zamanMs;
      await randevuDefteriTekrarTamamla(from, session);
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
