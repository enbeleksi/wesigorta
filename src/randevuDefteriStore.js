// 31.07.2026 eklendi: "Randevu Defterim" ozelligi - danismanlarin WhatsApp
// uzerinden Excel dosyasi yukleyerek musteri/lead listesi olusturup, bu
// listeden rastgele musteri secip aradiktan sonra sonucu (Olumlu/Olumsuz/
// Yeniden Aranacak/Ulasilamadi/Yanlis Numara) kaydedebilmesini saglayan
// kalici depo. leadStore/yenilemeStore ile AYNI tasarim ilkeleri: bellek-ici
// Map + db.js araciligiyla periyodik PostgreSQL yedeklemesi (kullanicinin
// talebi uzerine - bkz. kullanicinin 31.07.2026 tarihli uzun ozellik
// aciklamasi).
//
// ONEMLI - "ayni musteriyi birden fazla danismanin aramamasi" kurali:
// kullanici acikca "herhangi bir danismanin referans listesinde yer alan
// bir numara varsa listede bot onunla ilgili arama talebi gondermeyecek
// danismana" dedi - yani bu GLOBAL (tum danismanlar capinda TEK) bir telefon
// numarasi kurali, sadece "olumlu"/basarili sonuclanan degil, HANGI DURUMDA
// olursa olsun (yanlis numara dahil) bir numara sisteme bir KERE girdiyse
// bir daha baska bir danismana atanamaz. Bunu saglamak icin telefonIndex adli
// ayri bir Map (normallestirilmis telefon -> kayit id) tutuluyor; bu index
// db'ye AYRICA yazilmiyor, uygulama her acildiginda kayitlar map'inden
// yeniden turetiliyor (tek dogru kaynak kayitlar'dir, indexin kendisi
// sadece hizli arama icin bir "cache").

const db = require("./db");
const { telefonGecerliMi, telefonUluslararasiFormata, yasGecerliMi } = require("./validators");
const XLSX = require("xlsx");

const kayitlar = new Map(); // id -> kayit
const telefonIndex = new Map(); // normallestirilmis telefon -> kayit id
let sayac = 0;

// Durumlar: null (henuz aranmadi/beklemede) | "olumlu" | "olumsuz" |
// "yeniden_aranacak" | "ulasilamadi" | "yanlis_numara"

// --- Excel basliklarini taniyabilmek icin esnek esitleme ---
// Danismanlara "Excel Yükle" adiminda tam olarak hangi basliklari
// kullanmalari gerektigi soylenir (bkz. advisorEngine.js), ama yine de
// kucuk yazim farklariyla (buyuk/kucuk harf, Turkce karakter, "Numarası" vs
// "Numarasi" vb.) esnek calisabilmesi icin basliklar normallestirilip bir
// es anlamlilar sozlugunde araniyor.
function basligiNormallestir(str) {
  return (str || "")
    .toString()
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, ""); // bosluk/noktalama vb. tamamen atilir
}

const BASLIK_ESLESTIRME = {
  adSoyad: ["adsoyad", "isimsoyisim", "musteriadi", "adisoyadi", "isim", "ad"],
  telefon: ["telefon", "telefonnumarasi", "ceptelefonu", "gsm", "numara", "tel", "telefonno"],
  sirketAdi: ["sirketadi", "sirketismi", "firmaadi", "firmaismi", "sirket", "firma"],
  vergiNumarasi: ["verginumarasi", "vergino", "vkn", "vergikimlikno", "vergikimliknumarasi"],
  sirketTuru: ["sirketturu", "firmaturu", "tur", "sirkettipi"],
  sonDonemVergisi: ["sondonemvergisi", "sondonemvergi", "odenenvergi", "vergitutari", "sondonemodenenvergi"],
  yas: ["yas", "yasi"]
};

// Bir Excel satirinin (XLSX.utils.sheet_to_json ciktisindaki, orijinal
// baslik metinlerini anahtar olarak tutan) nesnesindeki basliklari kanonik
// alan adlarina esler - orn. {"Ad Soyad": "Ahmet Yılmaz", "Telefon Numarası":
// "0532..."} -> {adSoyad: "Ahmet Yılmaz", telefon: "0532..."}. Es
// anlamlilardan HICBIRIYLE eslesmeyen sutunlar yoksayilir (ne yazildigi
// onemli degil, sadece taninanlar isleniyor).
function satiriKanonikleAlanlaraCevir(satir) {
  const sonuc = {};
  for (const [baslik, deger] of Object.entries(satir)) {
    const normBaslik = basligiNormallestir(baslik);
    for (const [alan, esanlamlilar] of Object.entries(BASLIK_ESLESTIRME)) {
      if (esanlamlilar.includes(normBaslik) && sonuc[alan] === undefined) {
        sonuc[alan] = deger;
        break;
      }
    }
  }
  return sonuc;
}

// Buffer'daki (WhatsApp'tan indirilen .xlsx/.xls dosyasi) ilk sayfayi okuyup
// satir nesneleri dizisine cevirir. Bos hucreler "" olarak gelir (defval)
// - undefined yerine, asagidaki validasyonlarda tek tip bosluk kontrolu
// yapabilmek icin.
function excelSatirlariniOku(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const ilkSayfaAdi = workbook.SheetNames[0];
  if (!ilkSayfaAdi) return [];
  const sayfa = workbook.Sheets[ilkSayfaAdi];
  return XLSX.utils.sheet_to_json(sayfa, { defval: "", raw: false });
}

function normalizeTelefon(telefon) {
  if (!telefonGecerliMi(telefon)) return null;
  return telefonUluslararasiFormata(telefon);
}

function numaraBaskaBirKayitaAitMi(normalizeTel) {
  return telefonIndex.has(normalizeTel);
}

// --- Ana Excel yukleme/isleme fonksiyonu ---
// danismanNumarasi/danismanAdi: dosyayi gonderen (ve yeni musterilerin
// sahibi olacak) danisman. buffer: WhatsApp'tan indirilen dosya. dosyaAdi:
// sadece kayit/loglama amacli.
// Doner: { eklenen: [...kayit], atlanan: [{satirNo, sebep, adSoyad}], toplamSatir }
function excelYukle(danismanNumarasi, danismanAdi, buffer, dosyaAdi) {
  let satirlar;
  try {
    satirlar = excelSatirlariniOku(buffer);
  } catch (err) {
    return { hata: `Dosya okunamadı - geçerli bir Excel (.xlsx/.xls) dosyası olduğundan emin olur musunuz? (${err.message})` };
  }

  if (satirlar.length === 0) {
    return { hata: "Excel dosyasında okunabilir bir satır bulamadım - dosya boş olabilir." };
  }

  // Ilk satirin (herhangi bir satirin) taninan en az "adSoyad" ve "telefon"
  // sutunlarina sahip olup olmadigini kontrol ediyoruz - hicbiri
  // eslesmiyorsa muhtemelen baslik satiri farkli/beklenmedik, kullaniciyi
  // erkenden (tum satirlari tek tek "gecersiz" diye atlamak yerine) net bir
  // hatayla uyariyoruz.
  const ilkKanonik = satiriKanonikleAlanlaraCevir(satirlar[0]);
  if (ilkKanonik.adSoyad === undefined && ilkKanonik.telefon === undefined) {
    return {
      hata:
        'Excel dosyanızda "Ad Soyad" ve "Telefon" sütunlarını tanıyamadım 😕 ' +
        "Lütfen ilk satırın başlık satırı olduğundan ve sütun adlarının doğru olduğundan emin olup tekrar gönderir misiniz?"
    };
  }

  const eklenen = [];
  const atlanan = [];
  const buDosyadaGorulenTelefonlar = new Set();

  satirlar.forEach((satir, i) => {
    const satirNo = i + 2; // +1 (0-index) +1 (baslik satiri) - kullaniciya gosterilen Excel satir numarasi
    const kanonik = satiriKanonikleAlanlaraCevir(satir);

    const adSoyad = (kanonik.adSoyad || "").toString().trim();
    if (!adSoyad) {
      atlanan.push({ satirNo, sebep: "Ad Soyad boş/eksik", adSoyad: adSoyad || "(isimsiz)" });
      return;
    }

    const telefonHam = (kanonik.telefon || "").toString().trim();
    const normalizeTel = normalizeTelefon(telefonHam);
    if (!normalizeTel) {
      atlanan.push({ satirNo, sebep: "Telefon numarası eksik/geçersiz", adSoyad });
      return;
    }

    if (buDosyadaGorulenTelefonlar.has(normalizeTel)) {
      atlanan.push({ satirNo, sebep: "Bu dosyada tekrar eden numara", adSoyad });
      return;
    }

    if (numaraBaskaBirKayitaAitMi(normalizeTel)) {
      atlanan.push({ satirNo, sebep: "Bu numara sistemde zaten kayıtlı (başka bir danışmanda olabilir)", adSoyad });
      return;
    }

    const yasHam = (kanonik.yas || "").toString().trim();
    const yas = yasHam && yasGecerliMi(yasHam) ? Number(yasHam) : null;

    const bosSaKirp = (v) => {
      const s = (v || "").toString().trim();
      return s ? s : null;
    };

    sayac += 1;
    const id = `RD${Date.now()}${sayac}`;
    const kayit = {
      id,
      danismanNumarasi,
      danismanAdi: danismanAdi || null,
      adSoyad,
      telefon: normalizeTel,
      sirketAdi: bosSaKirp(kanonik.sirketAdi),
      vergiNumarasi: bosSaKirp(kanonik.vergiNumarasi),
      sirketTuru: bosSaKirp(kanonik.sirketTuru),
      sonDonemVergisi: bosSaKirp(kanonik.sonDonemVergisi),
      yas,
      durum: null,
      olumsuzNedeni: null,
      randevu: null, // { zamanMs, zamanMetni, yer, hatirlatma: {...} }
      tekrarArama: null, // { zamanMs, zamanMetni, hatirlatma: {...} }
      excelKaynakDosyaAdi: dosyaAdi || null,
      eklenmeZamani: Date.now(),
      guncellenmeZamani: Date.now()
    };

    kayitlar.set(id, kayit);
    telefonIndex.set(normalizeTel, id);
    buDosyadaGorulenTelefonlar.add(normalizeTel);
    eklenen.push(kayit);
  });

  return { eklenen, atlanan, toplamSatir: satirlar.length };
}

// 01.08.2026 eklendi: "Randevu Oluştur" menüsünden - yani bir Excel dosyası
// olmadan, danışmanın WhatsApp'ta doğrudan yazdığı ad/telefon ile - TEK bir
// kayıt oluşturur. excelYukle'deki satır işleme mantığıyla AYNI kurallara
// tabidir (telefon geçerliliği, GLOBAL numara tekrarı kontrolü - bkz. dosya
// başındaki NOT) - sadece şirket/vergi/yaş gibi Excel'e özgü alanlar boş
// kalır (bu akışta hiç sorulmuyor). Kayıt "durum: null" (henüz aranmamış/
// beklemede) olarak baslar - cagiran taraf (advisorEngine.js) hemen
// ardından olumluIsaretle ile randevu bilgisini ekler.
function manuelKayitOlustur(danismanNumarasi, danismanAdi, adSoyad, telefonHam) {
  const adSoyadTemiz = (adSoyad || "").toString().trim();
  if (!adSoyadTemiz) {
    return { hata: "Ad Soyad boş olamaz." };
  }

  const normalizeTel = normalizeTelefon(telefonHam);
  if (!normalizeTel) {
    return { hata: "Telefon numarası geçersiz görünüyor - lütfen 05XX XXX XX XX formatında yazar mısınız?" };
  }

  if (numaraBaskaBirKayitaAitMi(normalizeTel)) {
    return {
      hata: "Bu numara sistemde zaten kayıtlı (başka bir danışmanda olabilir) - bu müşteriyle randevu oluşturamıyorum."
    };
  }

  sayac += 1;
  const id = `RD${Date.now()}${sayac}`;
  const kayit = {
    id,
    danismanNumarasi,
    danismanAdi: danismanAdi || null,
    adSoyad: adSoyadTemiz,
    telefon: normalizeTel,
    sirketAdi: null,
    vergiNumarasi: null,
    sirketTuru: null,
    sonDonemVergisi: null,
    yas: null,
    durum: null,
    olumsuzNedeni: null,
    randevu: null,
    tekrarArama: null,
    excelKaynakDosyaAdi: null, // Excel'den degil, "Randevu Oluştur" menüsünden manuel eklendi
    eklenmeZamani: Date.now(),
    guncellenmeZamani: Date.now()
  };

  kayitlar.set(id, kayit);
  telefonIndex.set(normalizeTel, id);
  return { kayit };
}

function danismanKayitlariGetir(danismanNumarasi) {
  return Array.from(kayitlar.values()).filter((k) => k.danismanNumarasi === danismanNumarasi);
}

function kayitGetir(id) {
  return kayitlar.get(id) || null;
}

// "Referans Ara" butonu icin (eski adi "Musteri Ara" idi, 01.08.2026'da
// yeniden adlandirildi): oncelik SIRASI onemli -
// 1) zamani gelmis (tekrarArama.zamanMs <= simdi) "yeniden_aranacak"/
//    "ulasilamadi" kayitlar (bu musteriler zaten bir kez aranmis, geri
//    donus zamanlari gelmis - reminders sadece bir "hatirlatma" mesaji
//    gonderir, session'i ZORLA degistirmez; danisman "Referans Ara" dedigi
//    an bunlarin onune gecmesi gerekir, aksi halde bu kayitlara asla
//    donulmeyip sonsuza kadar beklemede kalabilirler).
// 2) hic aranmamis (durum === null) kayitlar.
// Ikisi de yoksa null doner (danismanin su an aranacak kimsesi yok demektir).
function rastgeleMusteriGetir(danismanNumarasi) {
  const tumKayitlar = danismanKayitlariGetir(danismanNumarasi);
  const simdi = Date.now();

  const zamaniGelenler = tumKayitlar.filter(
    (k) =>
      (k.durum === "yeniden_aranacak" || k.durum === "ulasilamadi") &&
      k.tekrarArama &&
      k.tekrarArama.zamanMs <= simdi
  );
  if (zamaniGelenler.length > 0) {
    return zamaniGelenler[Math.floor(Math.random() * zamaniGelenler.length)];
  }

  const hicAranmamislar = tumKayitlar.filter((k) => k.durum === null);
  if (hicAranmamislar.length > 0) {
    return hicAranmamislar[Math.floor(Math.random() * hicAranmamislar.length)];
  }

  return null;
}

function danismanIstatistikleriGetir(danismanNumarasi) {
  const tumKayitlar = danismanKayitlariGetir(danismanNumarasi);
  const sayim = {
    toplam: tumKayitlar.length,
    beklemede: 0,
    olumlu: 0,
    olumsuz: 0,
    yeniden_aranacak: 0,
    ulasilamadi: 0,
    yanlis_numara: 0
  };
  for (const k of tumKayitlar) {
    if (k.durum === null) sayim.beklemede += 1;
    else if (sayim[k.durum] !== undefined) sayim[k.durum] += 1;
  }
  return sayim;
}

// --- Durum guncellemeleri ---

// zamanMetni: goruntuleme icin hazir, Turkiye saatiyle bicimlendirilmis
// metin (bkz. advisorEngine.js turkiyeSaatiniFormatla) - saat dilimi
// hesaplamasi BURADA degil, advisorEngine.js'deki tarihSaatDogrula/
// turkiyeSaatiniFormatla ile (20.07.2026 hatirlatma gecikmesi vakasindan
// sonra duzeltilmis, test edilmis fonksiyonlar) yapiliyor - bu dosya sadece
// zaten hesaplanmis zamanMs/zamanMetni degerlerini saklar.
function olumluIsaretle(id, { zamanMs, zamanMetni, yer }) {
  const kayit = kayitlar.get(id);
  if (!kayit) return null;
  kayit.durum = "olumlu";
  kayit.randevu = {
    zamanMs,
    zamanMetni,
    yer,
    hatirlatma: { zaman: zamanMs, gonderildi: false, basarisiz: false, denemeSayisi: 0 }
  };
  kayit.tekrarArama = null;
  kayit.guncellenmeZamani = Date.now();
  return kayit;
}

function olumsuzIsaretle(id, neden) {
  const kayit = kayitlar.get(id);
  if (!kayit) return null;
  kayit.durum = "olumsuz";
  kayit.olumsuzNedeni = neden;
  kayit.guncellenmeZamani = Date.now();
  return kayit;
}

function tekrarAramaIsaretle(id, durum, { zamanMs, zamanMetni }) {
  const kayit = kayitlar.get(id);
  if (!kayit) return null;
  kayit.durum = durum; // "yeniden_aranacak" | "ulasilamadi"
  kayit.tekrarArama = {
    zamanMs,
    zamanMetni,
    hatirlatma: { zaman: zamanMs, gonderildi: false, basarisiz: false, denemeSayisi: 0 }
  };
  kayit.guncellenmeZamani = Date.now();
  return kayit;
}

function yanlisNumaraIsaretle(id) {
  const kayit = kayitlar.get(id);
  if (!kayit) return null;
  kayit.durum = "yanlis_numara";
  kayit.guncellenmeZamani = Date.now();
  return kayit;
}

// --- Hatirlatma zamanlayicisi (server.js'den cagirilir - leadStore'daki
// hatirlatma sistemiyle AYNI "basarisiz olursa esige kadar tekrar dene, o
// zaman da pes edip sessizce isaretle" mantigi) ---

function zamaniGelenTekrarAramaHatirlatmalari() {
  const simdi = Date.now();
  return Array.from(kayitlar.values()).filter(
    (k) =>
      k.tekrarArama &&
      k.tekrarArama.hatirlatma &&
      !k.tekrarArama.hatirlatma.gonderildi &&
      k.tekrarArama.hatirlatma.zaman <= simdi
  );
}

function tekrarAramaHatirlatmaGonderildiIsaretle(id) {
  const kayit = kayitlar.get(id);
  if (!kayit || !kayit.tekrarArama) return;
  kayit.tekrarArama.hatirlatma.gonderildi = true;
}

function tekrarAramaHatirlatmaDenemeBasarisiz(id, pesGecMi) {
  const kayit = kayitlar.get(id);
  if (!kayit || !kayit.tekrarArama) return;
  kayit.tekrarArama.hatirlatma.denemeSayisi = (kayit.tekrarArama.hatirlatma.denemeSayisi || 0) + 1;
  if (pesGecMi) {
    kayit.tekrarArama.hatirlatma.gonderildi = true;
    kayit.tekrarArama.hatirlatma.basarisiz = true;
  }
}

function zamaniGelenRandevuHatirlatmalari() {
  const simdi = Date.now();
  return Array.from(kayitlar.values()).filter(
    (k) => k.randevu && k.randevu.hatirlatma && !k.randevu.hatirlatma.gonderildi && k.randevu.hatirlatma.zaman <= simdi
  );
}

function randevuHatirlatmaGonderildiIsaretle(id) {
  const kayit = kayitlar.get(id);
  if (!kayit || !kayit.randevu) return;
  kayit.randevu.hatirlatma.gonderildi = true;
}

function randevuHatirlatmaDenemeBasarisiz(id, pesGecMi) {
  const kayit = kayitlar.get(id);
  if (!kayit || !kayit.randevu) return;
  kayit.randevu.hatirlatma.denemeSayisi = (kayit.randevu.hatirlatma.denemeSayisi || 0) + 1;
  if (pesGecMi) {
    kayit.randevu.hatirlatma.gonderildi = true;
    kayit.randevu.hatirlatma.basarisiz = true;
  }
}

// --- Kalicilik (db.js araciligiyla) ---
// telefonIndex BILEREK ayrica kaydedilmiyor - yukle() sirasinda kayitlar'in
// telefon alanindan yeniden turetiliyor (tek dogru kaynak kayitlar'dir).
async function yukle() {
  const veri = await db.oku("randevuDefteri");
  if (veri) {
    Object.entries(veri).forEach(([id, kayit]) => {
      kayitlar.set(id, kayit);
      if (kayit.telefon) telefonIndex.set(kayit.telefon, id);
    });
    console.log(`${Object.keys(veri).length} randevu defteri kaydı veritabanından yüklendi.`);
  }
}

async function kaydet() {
  const obj = Object.fromEntries(kayitlar);
  await db.yaz("randevuDefteri", obj);
}

module.exports = {
  excelYukle,
  manuelKayitOlustur,
  danismanKayitlariGetir,
  kayitGetir,
  rastgeleMusteriGetir,
  danismanIstatistikleriGetir,
  olumluIsaretle,
  olumsuzIsaretle,
  tekrarAramaIsaretle,
  yanlisNumaraIsaretle,
  zamaniGelenTekrarAramaHatirlatmalari,
  tekrarAramaHatirlatmaGonderildiIsaretle,
  tekrarAramaHatirlatmaDenemeBasarisiz,
  zamaniGelenRandevuHatirlatmalari,
  randevuHatirlatmaGonderildiIsaretle,
  randevuHatirlatmaDenemeBasarisiz,
  yukle,
  kaydet
};
