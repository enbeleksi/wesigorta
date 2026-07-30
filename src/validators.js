// Serbest metin sorularina girilen cevaplarin makul bir formatta olup
// olmadigini kontrol eden yardimci fonksiyonlar. Her fonksiyon (metin) => true/false doner.

// T.C. kimlik numarasi resmi algoritmaya gore dogrulanir (11 hane, checksum kontrolu).
function tcKimlikGecerliMi(value) {
  const v = (value || "").replace(/\s/g, "");
  if (!/^[1-9][0-9]{10}$/.test(v)) return false;

  const digits = v.split("").map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  // NOT: (oddSum*7 - evenSum) bazen negatif cikabiliyor (orn. ilk hane kucuk,
  // cift hanelerin toplami buyukse) - JS'in % operatoru negatif sayilarda
  // negatif sonuc dondurdugu icin ((x % 10) + 10) % 10 ile resmi algoritmadaki
  // gercek (hep 0-9 araliginda) mod 10 sonucuna normallestiriyoruz. Bu
  // normallestirme olmadan bazi GERCEK/GECERLI T.C. kimlik numaralari yanlisla
  // reddediliyordu (bkz. formlar/malpraktis-teklif-formu.html'deki ayni
  // fonksiyonla tutarlilik icin de bu duzeltme yapildi).
  const digit10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  const digit11 = (digits.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;

  return digit10 === digits[9] && digit11 === digits[10];
}

// Esnek bir GG.AA.YYYY tarih metnini { gun, ay, yil } seklinde ayristirir -
// gun/ay tek ya da cift haneli olabilir (2.5.1999 ya da 02.05.1999), yil 2 ya
// da 4 haneli olabilir (2.5.99 de kabul edilir). 2 haneli yil icin makul bir
// "pivot" kullanilir: dogum tarihi gecmiste olmak ZORUNDA oldugu icin, YY+2000
// bu yildan buyukse (yani gelecekte kalirsa) 19YY, degilse 20YY olarak
// yorumlanir (orn. bu yil 2026 ise: "99" -> 1999, "05" -> 2005).
// Ayristirilamiyorsa null doner.
function tarihiAyristir(value) {
  const match = (value || "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  let yil = Number(match[3]);
  if (match[3].length === 2) {
    const buYilIkiHane = new Date().getFullYear() % 100;
    yil = yil <= buYilIkiHane ? 2000 + yil : 1900 + yil;
  }
  return { gun, ay, yil };
}

// Esnek formatta (bkz. tarihiAyristir) girilen bir tarihin gercekci olup
// olmadigini kontrol eder (orn. 31.02.YYYY gibi olmayan bir tarihi reddeder).
function tarihGecerliMi(value) {
  const ayristirilan = tarihiAyristir(value);
  if (!ayristirilan) return false;
  const { gun, ay, yil } = ayristirilan;
  if (yil < 1900 || yil > new Date().getFullYear()) return false;
  if (ay < 1 || ay > 12) return false;
  const ayinGunSayisi = new Date(yil, ay, 0).getDate();
  return gun >= 1 && gun <= ayinGunSayisi;
}

// tarihGecerliMi ile onaylanmis (gecerli) bir tarih metnini, gorunumden
// bagimsiz olarak her zaman kanonik "GG.AA.YYYY" formatina cevirir - "2.5.99"
// da yazsa "02.05.1999" da yazsa, kaydedilen/maile giden deger hep ayni temiz
// formatta olsun diye (bkz. saatAraligiNormallestir ile ayni yaklasim).
function tarihiNormallestir(value) {
  const ayristirilan = tarihiAyristir(value);
  if (!ayristirilan) return value;
  const ikiHane = (n) => String(n).padStart(2, "0");
  return `${ikiHane(ayristirilan.gun)}.${ikiHane(ayristirilan.ay)}.${ayristirilan.yil}`;
}

// Basit bir yas kontrolu (1-120 arasi tam sayi).
function yasGecerliMi(value) {
  const v = (value || "").trim();
  if (!/^\d{1,3}$/.test(v)) return false;
  const n = Number(v);
  return n >= 1 && n <= 120;
}

// Pozitif bir tam sayi mi (metrekare, kat sayisi, hasta sayisi gibi alanlar icin).
function pozitifSayiMi(value) {
  const v = (value || "").trim();
  return /^\d{1,9}$/.test(v) && Number(v) > 0;
}

// Bir yil bilgisi mi (insaat yili, tescil tarihindeki yil gibi - 1900 ile bu yil arasi).
function yilGecerliMi(value) {
  const v = (value || "").trim();
  if (!/^\d{4}$/.test(v)) return false;
  const n = Number(v);
  return n >= 1900 && n <= new Date().getFullYear();
}

// Turkiye plaka formatina gevsek bir kontrol (orn. "34 ABC 123", "06 A 1234").
// Amac kesin resmi format kontrolu degil, tamamen anlamsiz bir girisi elemek.
function plakaGecerliMi(value) {
  const v = (value || "").trim().toUpperCase();
  return /^\d{2}\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}$/.test(v);
}

// Ruhsat belge seri numarasi: harflerle baslar, rakamlarla devam eder
// (orn. "AE123456"). Amac kesin resmi format kontrolu degil, tamamen
// anlamsiz bir girisi (orn. sadece rakam ya da "yok" gibi) elemek.
function ruhsatSeriNoGecerliMi(value) {
  const v = (value || "").trim().toUpperCase();
  return /^[A-ZÇĞİÖŞÜ]{1,3}\s?\d{4,8}$/.test(v);
}

// GG.AA.YYYY formatinda, police yenileme/bitis tarihi gibi GELECEKTEKI
// tarihleri de kabul eden bir kontrol (tarihGecerliMi'nin aksine gelecek
// yillari reddetmez). Makul bir aralikta tutmak icin gecmiste 1 yil, ileride
// 15 yila kadar olan tarihleri gecerli sayar.
function yenilemeTarihiGecerliMi(value) {
  const match = (value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  const yil = Number(match[3]);
  const buYil = new Date().getFullYear();
  if (yil < buYil - 1 || yil > buYil + 15) return false;
  if (ay < 1 || ay > 12) return false;
  const ayinGunSayisi = new Date(yil, ay, 0).getDate();
  return gun >= 1 && gun <= ayinGunSayisi;
}

// GG.AA.YYYY formatindaki bir metni ogle 12:00'ye sabitlenmis bir zaman
// damgasina (ms) cevirir - gun icinde saat dilimi kaymasi yuzunden yanlis
// gune duşmesin diye ogle vakti kullaniliyor. Format hataliysa null doner.
function tarihiMsYap(value) {
  const match = (value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  const yil = Number(match[3]);
  return new Date(yil, ay - 1, gun, 12, 0, 0).getTime();
}

// Bos ya da sadece bosluktan olusan bir cevap degil mi (genel amacli, serbest
// metin alanlari icin - orn. uyruk, dogum yeri).
function bosDegilMi(value) {
  return !!(value || "").trim();
}

// Ad Soyad gibi alanlar icin: en az iki kelimeden olusmali (ad + soyad),
// tek basina "asdf" ya da "-" gibi anlamsiz tek kelimelik girisleri eler.
function adSoyadGecerliMi(value) {
  const v = (value || "").trim();
  if (v.length < 3) return false;
  const kelimeler = v.split(/\s+/).filter(Boolean);
  return kelimeler.length >= 2;
}

// Turkiye cep telefonu: basinda istege bagli +90/90/0, sonrasinda 5 ile
// baslayan 10 haneli numara (orn. 05551234567, +905551234567, 5551234567).
function telefonGecerliMi(value) {
  const v = (value || "").replace(/[\s()\-]/g, "");
  return /^(\+90|90|0)?5\d{9}$/.test(v);
}

// Basit ama pratik bir e-posta format kontrolu.
function epostaGecerliMi(value) {
  const v = (value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// WhatsApp Cloud API'ye mesaj gonderirken numaranin basinda ulke kodu
// OLMAK ZORUNDA (orn. 905551234567) - danismanlarin girdigi yerel formatlari
// ("0555 123 45 67", "5551234567" vb.) bu sekle ceviriyoruz. Musteriye satis
// sonrasi bilgilendirme mesaji gonderirken kullanilir (bkz. advisorEngine.js
// satisTamamla / musteriyeSatisBildirimiGonder).
function telefonUluslararasiFormata(value) {
  const v = (value || "").replace(/[\s()\-]/g, "");
  if (/^\+90\d{10}$/.test(v)) return v.slice(1);
  if (/^90\d{10}$/.test(v)) return v;
  if (/^0\d{10}$/.test(v)) return `90${v.slice(1)}`;
  if (/^5\d{9}$/.test(v)) return `90${v}`;
  return v; // beklenmedik bir format - oldugu gibi denenir
}

// Prim tutari gibi serbest metin girilen ama icinde mutlaka bir rakam
// gecmesi gereken alanlar icin (orn. "USD 450,00"). Kesin bir para formati
// zorlamiyoruz (doviz/TL, ondalik ayraci degisebiliyor), sadece bos ya da
// tamamen rakamsiz bir giris ("yok", "-" gibi) elenir.
function primTutariGecerliMi(value) {
  const v = (value || "").trim();
  return v.length > 0 && /\d/.test(v);
}

// Musterinin "ne zaman aranmasini istiyoruz" tarihini kontrol eder: bugunden
// ONCEKI bir tarih kabul edilmez (gecmis bir tarihte arama talep etmenin
// anlami yok), bugun ve sonrasi (makul bir ust sinira kadar) kabul edilir.
function aramaTarihiGecerliMi(value) {
  const match = (value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  const yil = Number(match[3]);
  const buYil = new Date().getFullYear();
  if (yil < buYil || yil > buYil + 2) return false;
  if (ay < 1 || ay > 12) return false;
  const ayinGunSayisi = new Date(yil, ay, 0).getDate();
  if (gun < 1 || gun > ayinGunSayisi) return false;

  const girilenTarih = new Date(yil, ay - 1, gun);
  girilenTarih.setHours(0, 0, 0, 0);
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);

  return girilenTarih.getTime() >= bugun.getTime();
}

// value'daki tarih (GG.AA.YYYY) bugune mi denk geliyor kontrol eder.
function aramaTarihiBugunMu(value) {
  const match = (value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const gun = Number(match[1]);
  const ay = Number(match[2]);
  const yil = Number(match[3]);
  const bugun = new Date();
  return gun === bugun.getDate() && ay === bugun.getMonth() + 1 && yil === bugun.getFullYear();
}

// Garanti Emeklilik cagri merkezinin musteriyi aramasi istenen saat araligi.
// Yaziliş bicimi konusunda esnek davraniyoruz cunku danismanlar hizlica
// yaziyor: saat-dakika ayraci olarak ":" ya da "." kabul edilir ("14:00" ya
// da "14.00"), dakika hic yazilmadan sadece saat de yazilabilir ("16-18"),
// sonuna "arası" gibi bir kelime eklenmesi de sorun olmaz. Cagri merkezi
// sadece 08:00-18:00 arasi calistigi icin, girilen araligin bu pencerenin
// icinde ve baslangicin bitisten once oldugundan da emin oluyoruz.
const ARAMA_PENCERESI_BASLANGIC_DK = 8 * 60; // 08:00
const ARAMA_PENCERESI_BITIS_DK = 18 * 60; // 18:00

// value'yu { baslangicDk, bitisDk } seklinde ayristirir (gun icindeki dakika
// olarak), tanimlanamiyorsa null doner. Hem validasyonda hem de kaydedilecek
// degeri "HH:MM-HH:MM" seklinde normallestirmek icin kullanilir (bkz.
// saatAraligiNormallestir).
function saatAraligiParseEt(value) {
  const v = (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*aras[ıi]\s*$/i, "")
    .trim();

  // "SS:DD-SS:DD" ya da "SS.DD-SS.DD" (dakika belirtilmis)
  let eslesme = v.match(/^([01]?\d|2[0-3])[.:]([0-5]\d)\s*-\s*([01]?\d|2[0-3])[.:]([0-5]\d)$/);
  if (eslesme) {
    return {
      baslangicDk: Number(eslesme[1]) * 60 + Number(eslesme[2]),
      bitisDk: Number(eslesme[3]) * 60 + Number(eslesme[4])
    };
  }

  // "SS-SS" (sadece saat, dakikasiz - orn. "16-18")
  eslesme = v.match(/^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/);
  if (eslesme) {
    return {
      baslangicDk: Number(eslesme[1]) * 60,
      bitisDk: Number(eslesme[2]) * 60
    };
  }

  return null;
}

function saatAraligiGecerliMi(value, answers) {
  const parsed = saatAraligiParseEt(value);
  if (!parsed) return false;

  const { baslangicDk, bitisDk } = parsed;
  if (baslangicDk >= bitisDk) return false;
  if (baslangicDk < ARAMA_PENCERESI_BASLANGIC_DK || bitisDk > ARAMA_PENCERESI_BITIS_DK) return false;

  // Secilen arama tarihi bugunse, aramanin baslangici su andan en az 2 saat
  // sonra olmali - cagri merkezine yetismeyecek kadar yakin bir saat
  // araligi girilmesini engeller.
  if (answers && answers.arama_tarihi && aramaTarihiBugunMu(answers.arama_tarihi)) {
    const simdi = new Date();
    const simdiDk = simdi.getHours() * 60 + simdi.getMinutes();
    if (baslangicDk < simdiDk + 120) return false;
  }

  return true;
}

// Gecerliligi onaylanmis (saatAraligiGecerliMi === true) bir degeri, gorunumden
// bagimsiz olarak her zaman "HH:MM-HH:MM" seklinde tek tip bir metne cevirir -
// mail'e giden deger, danismanin "16-18" mi "16.00-18.00 arası" mi yazdigindan
// bagimsiz olarak hep ayni temiz formatta olsun diye.
function saatAraligiNormallestir(value) {
  const parsed = saatAraligiParseEt(value);
  if (!parsed) return value;
  const ikiHane = (n) => String(n).padStart(2, "0");
  const bicimle = (dk) => `${ikiHane(Math.floor(dk / 60))}:${ikiHane(dk % 60)}`;
  return `${bicimle(parsed.baslangicDk)}-${bicimle(parsed.bitisDk)}`;
}

module.exports = {
  tcKimlikGecerliMi,
  tarihGecerliMi,
  tarihiNormallestir,
  yasGecerliMi,
  pozitifSayiMi,
  yilGecerliMi,
  plakaGecerliMi,
  ruhsatSeriNoGecerliMi,
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
};
