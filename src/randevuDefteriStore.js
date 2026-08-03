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

// 02.08.2026 DUZELTME (Enbel'in gonderdigi gercek "Referans Listesi Şevval.xlsx"
// dosyasi incelenerek): danismanlarin bundan sonra gerceke gonderecegi
// dosyalarda basliklar TAM OLARAK "TC Kimlik Numarası", "Adı Soyadı",
// "Doğum Yılı", "Cep Telefonu1"/"Cep Telefonu2"/"Cep Telefonu3" (AYNI kisi
// icin BIRDEN FAZLA telefon adayi - cogu satirda bos, doluysa ilk doluyu
// kullaniyoruz), "Şirketin Adı", "Şirketin Türü", "Şirketin Vergi Numarası",
// "Ödediği Vergi" seklinde geliyor. Bu basliklarin coğu eskiden tanimli
// esanlamlilarla EŞLEŞMİYORDU (orn. "sirketinadi" != "sirketadi",
// "ceptelefonu1" != "ceptelefonu") - gercek dosyada bu yuzden TELEFON hic
// eslesmiyor, TUM satirlar "telefon eksik" diye atlaniyordu. Asagidaki liste
// hem eski (manuel/farkli kaynakli dosyalar icin) hem yeni (gercek üretim
// kaynagi) basliklari kapsayacak sekilde genisletildi.
const BASLIK_ESLESTIRME = {
  adSoyad: ["adsoyad", "isimsoyisim", "musteriadi", "adisoyadi", "isim", "ad"],
  telefon: [
    "telefon",
    "telefonnumarasi",
    "ceptelefonu",
    "gsm",
    "numara",
    "tel",
    "telefonno",
    "ceptelefonu1",
    "ceptelefonu2",
    "ceptelefonu3",
    "ceptelefon1",
    "ceptelefon2",
    "ceptelefon3",
    "telefon1",
    "telefon2",
    "telefon3",
    "gsm1",
    "gsm2",
    "gsm3"
  ],
  sirketAdi: [
    "sirketadi",
    "sirketismi",
    "firmaadi",
    "firmaismi",
    "sirket",
    "firma",
    "sirketinadi",
    "sirketinismi",
    "firmaninadi",
    "isyeriadi",
    "isyeri"
  ],
  vergiNumarasi: [
    "verginumarasi",
    "vergino",
    "vkn",
    "vergikimlikno",
    "vergikimliknumarasi",
    "sirketinverginumarasi",
    "sirketvergino",
    "sirketinvergikimlikno"
  ],
  sirketTuru: ["sirketturu", "firmaturu", "tur", "sirkettipi", "sirketinturu"],
  sonDonemVergisi: [
    "sondonemvergisi",
    "sondonemvergi",
    "odenenvergi",
    "vergitutari",
    "sondonemodenenvergi",
    "odedigivergi",
    "odedigivergisi"
  ],
  yas: ["yas", "yasi"],
  // 02.08.2026 eklendi: gercek dosyada yas DOGRUDAN verilmiyor, "Doğum Yılı"
  // olarak geliyor - bkz. asagidaki dogumYilindanYasHesapla.
  dogumYili: ["dogumyili", "dogumsenesi", "dogduguyil", "dogumtarihi"]
};

// Bir Excel satirinin (XLSX.utils.sheet_to_json ciktisindaki, orijinal
// baslik metinlerini anahtar olarak tutan) nesnesindeki basliklari kanonik
// alan adlarina esler - orn. {"Ad Soyad": "Ahmet Yılmaz", "Telefon Numarası":
// "0532..."} -> {adSoyad: "Ahmet Yılmaz", telefon: "0532..."}. Es
// anlamlilardan HICBIRIYLE eslesmeyen sutunlar yoksayilir (ne yazildigi
// onemli degil, sadece taninanlar isleniyor).
// 02.08.2026 DUZELTME: bir alan icin BIRDEN FAZLA sutun eslesebilir (orn.
// "Cep Telefonu1", "Cep Telefonu2", "Cep Telefonu3" hepsi "telefon" alanina
// esleniyor) - eskiden sadece ILK RASTLANAN sutun kullaniliyordu, o sutun bu
// satirda BOS olsa bile digerlerine (dolu olabilecek Telefonu2/3'e)
// BAKILMIYORDU. Artik ayni alana eslenen TUM sutunlar toplaniyor, aralarinda
// ilk BOS OLMAYAN deger tercih ediliyor (hicbiri dolu degilse ilk sutunun
// - bos - degeri kullanilir, boylece davranis eskisiyle tutarli kalir).
function satiriKanonikleAlanlaraCevir(satir) {
  const adaylar = {}; // alan -> [deger, deger, ...] (bu satirda eslesen tum sutunlarin degerleri, sira ile)
  for (const [baslik, deger] of Object.entries(satir)) {
    const normBaslik = basligiNormallestir(baslik);
    for (const [alan, esanlamlilar] of Object.entries(BASLIK_ESLESTIRME)) {
      if (esanlamlilar.includes(normBaslik)) {
        if (!adaylar[alan]) adaylar[alan] = [];
        adaylar[alan].push(deger);
        break;
      }
    }
  }
  const sonuc = {};
  for (const [alan, degerler] of Object.entries(adaylar)) {
    const ilkDoluDeger = degerler.find((d) => (d || "").toString().trim() !== "");
    sonuc[alan] = ilkDoluDeger !== undefined ? ilkDoluDeger : degerler[0];
  }
  // 02.08.2026 eklendi (Enbel'in talebi): "bazı müşterilerin birden fazla
  // numarası var, tamamını paylaşmamız lazım" - "telefon" alani icin YUKARIDA
  // sadece TEK (ilk dolu) deger sonuc'a kondu, ama danismana TUMUNU
  // gosterebilmemiz icin bu satirdaki (Cep Telefonu1/2/3 gibi) TUM bos
  // olmayan telefon adaylarini ayrica saklıyoruz - bkz. excelYukle'deki
  // kullanimi.
  sonuc.telefonAdaylari = (adaylar.telefon || [])
    .map((d) => (d || "").toString().trim())
    .filter((d) => d !== "");
  return sonuc;
}

// 02.08.2026 eklendi (Enbel'in talebi): "doğum yılından yaşını hesaplayıp
// yaşını ... paylaşıp arama yaptırcaz" - dogum YILI (tam tarih degil) verilen
// bir alandan yasi hesaplar. Excel'den gelen deger sayi (orn. 1996), Date
// nesnesi (bazi Excel/SheetJS ayarlarinda tarih hucreleri boyle gelebilir)
// ya da metin (orn. "1996" ya da bir tam tarih icinde gecen yil) olabilir -
// hepsini tolere eder. Makul bir yil araliginda (1900 - bu yil) degilse ya
// da hesaplanan yas mantiksiz (negatif ya da 120'den buyuk) cikarsa null
// doner - "yas bilinmiyor" anlamina gelir, cagiran taraf bu alani hic
// göstermez (bkz. advisorEngine.js -> randevuDefteriMusteriGoster).
function dogumYilindanYasHesapla(deger) {
  if (deger === null || deger === undefined || deger === "") return null;
  const buYil = new Date().getFullYear();
  let yil = null;
  if (deger instanceof Date && !Number.isNaN(deger.getTime())) {
    yil = deger.getFullYear();
  } else if (typeof deger === "number" && Number.isFinite(deger)) {
    if (deger >= 1900 && deger <= buYil) yil = Math.trunc(deger);
  } else {
    const metin = deger.toString().trim();
    const sadeceYil = metin.match(/^(\d{4})$/);
    if (sadeceYil) {
      yil = Number(sadeceYil[1]);
    } else {
      // "12.05.1996" gibi tam bir tarih icinde gecen 4 haneli yili yakala.
      const tarihIcindeYil = metin.match(/(\d{4})/);
      if (tarihIcindeYil) yil = Number(tarihIcindeYil[1]);
    }
  }
  if (yil === null || yil < 1900 || yil > buYil) return null;
  const yas = buYil - yil;
  return yas >= 0 && yas <= 120 ? yas : null;
}

// 02.08.2026 eklendi (Enbel'in talebi): "varsa ödediği vergi bilgisini
// paylaşıp arama yaptırcaz" - gercek dosyada bu alan TUTARSIZ bicimlerde
// geliyor: duz sayi (197559.12), "Matrahsız" gibi bir metin (vergi matrahi
// olmadigi/muaf oldugu anlamina gelir - OLDUGU GIBI gosterilir), ya da
// bastan/sondan bosluk+yeni satir ve "₺"/binlik nokta/ondalik virgul icheren
// onceden bicimlendirilmis bir metin (orn. "\n₺7.923,90"). Bu fonksiyon
// hepsini tek, tutarli bir goruntu bicimine ("₺123.456,78") ceviriyor;
// ayristiramadigi (beklenmedik) bir metin gelirse, veri kaybetmemek icin
// sadece bastaki/sondaki bosluklari temizleyip OLDUGU GIBI doner.
function vergiTutariBicimlendir(deger) {
  if (deger === null || deger === undefined || deger === "") return null;
  const paraBicimlendir = (sayi) =>
    `₺${sayi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (typeof deger === "number" && Number.isFinite(deger)) {
    return paraBicimlendir(deger);
  }

  const metin = deger.toString().trim();
  if (!metin) return null;
  if (basligiNormallestir(metin) === "matrahsiz") return "Matrahsız";

  const sayiyaCevrilebilirMetin = metin.replace(/[₺\s]/g, "").replace(/\./g, "").replace(",", ".");
  const sayi = Number(sayiyaCevrilebilirMetin);
  if (sayiyaCevrilebilirMetin !== "" && !Number.isNaN(sayi)) {
    return paraBicimlendir(sayi);
  }
  return metin; // taninmayan bir bicim - veri kaybetmemek icin oldugu gibi don
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

    // 02.08.2026 DUZELTME (Enbel'in talebi): "bazı müşterilerin birden fazla
    // numarası var, tamamını paylaşmamız lazım" - artik sadece TEK bir
    // telefon degil, bu satirda eslesen TUM telefon sutunlarindaki (Cep
    // Telefonu1/2/3 gibi) gecerli numaralarin HEPSI toplanir ve kayda
    // eklenir (bkz. asagidaki kayit.telefonlar). Ilk gecerli numara ("telefon"
    // alani) yine geriye donuk uyumluluk icin birincil/tek numara olarak da
    // ayrica saklanir (bkz. kayit.telefon).
    const telefonAdaylariHam =
      kanonik.telefonAdaylari && kanonik.telefonAdaylari.length
        ? kanonik.telefonAdaylari
        : [(kanonik.telefon || "").toString().trim()];
    const normalizeTelefonlar = [];
    const buSatirdaGorulmus = new Set();
    for (const aday of telefonAdaylariHam) {
      const normalize = normalizeTelefon(aday);
      if (normalize && !buSatirdaGorulmus.has(normalize)) {
        buSatirdaGorulmus.add(normalize);
        normalizeTelefonlar.push(normalize);
      }
    }

    if (normalizeTelefonlar.length === 0) {
      atlanan.push({ satirNo, sebep: "Telefon numarası eksik/geçersiz", adSoyad });
      return;
    }

    if (normalizeTelefonlar.some((t) => buDosyadaGorulenTelefonlar.has(t))) {
      atlanan.push({ satirNo, sebep: "Bu dosyada tekrar eden numara", adSoyad });
      return;
    }

    if (normalizeTelefonlar.some((t) => numaraBaskaBirKayitaAitMi(t))) {
      atlanan.push({ satirNo, sebep: "Bu numara sistemde zaten kayıtlı (başka bir danışmanda olabilir)", adSoyad });
      return;
    }

    // 02.08.2026 DUZELTME: yas ARTIK sadece dogrudan bir "Yaş" sutunundan
    // degil, cogu zaman gercek dosyada bulunan "Doğum Yılı" sutunundan da
    // hesaplanabiliyor - once dogrudan yas denenir (varsa), yoksa dogum
    // yilindan hesaplanir (bkz. dogumYilindanYasHesapla).
    const yasHam = (kanonik.yas || "").toString().trim();
    const yas = yasHam && yasGecerliMi(yasHam) ? Number(yasHam) : dogumYilindanYasHesapla(kanonik.dogumYili);

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
      telefon: normalizeTelefonlar[0], // birincil/tek numara (geriye donuk uyumluluk icin)
      telefonlar: normalizeTelefonlar, // TUM gecerli numaralar (bkz. advisorEngine.js -> randevuDefteriMusteriGoster)
      sirketAdi: bosSaKirp(kanonik.sirketAdi),
      vergiNumarasi: bosSaKirp(kanonik.vergiNumarasi),
      sirketTuru: bosSaKirp(kanonik.sirketTuru),
      // 02.08.2026 DUZELTME: artik ham metin degil, vergiTutariBicimlendir ile
      // temizlenmis/tutarli bicimde ("₺123.456,78" ya da "Matrahsız") saklanir.
      sonDonemVergisi: vergiTutariBicimlendir(kanonik.sonDonemVergisi),
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
    // 02.08.2026 DUZELTME: telefonIndex'e ARTIK bu musterinin TUM
    // numaralari kaydediliyor (sadece birincisi degil) - boylece "aynı
    // numarayı iki farklı danışman aramasın" kurali (bkz. dosya basindaki
    // NOT), musterinin ikinci/ucuncu numarasi baska bir dosyada/danismanda
    // karsimiza ciktiginda da dogru calisir.
    normalizeTelefonlar.forEach((t) => {
      telefonIndex.set(t, id);
      buDosyadaGorulenTelefonlar.add(t);
    });
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
    telefonlar: [normalizeTel], // Excel'deki cok-numarali kayitlarla AYNI sekil - tek elemanli
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

// 02.08.2026 eklendi (Enbel'in talebi): "müşterinin birden fazla numarası
// varsa bunlardan hangisinin müşteriye ait olduğunu sor ve diğerlerini
// sistemden silelim" - GORUSME OLUMLU sonuclandiginda (yani danisman
// GERCEKTEN musteriyle konustuysa) hangi numaradan ulastigini soruyoruz
// (bkz. advisorEngine.js -> randevuDefteriDogruNumaraSor), bu fonksiyon da
// SECILEN numara disindaki digerlerini hem kayittan hem de GLOBAL
// telefonIndex'ten siler - boylece o numaralar "bu musteriye ait, bir daha
// kimseye onerilmesin" diye BOSUNA bloklanmaz, ileride baska bir musterinin
// gercek numarasi olarak sisteme girilebilir.
function dogruNumarayiSec(id, seciliTelefon) {
  const kayit = kayitlar.get(id);
  if (!kayit) return null;
  const tumNumaralar = Array.isArray(kayit.telefonlar) && kayit.telefonlar.length ? kayit.telefonlar : [kayit.telefon];
  if (!tumNumaralar.includes(seciliTelefon)) return null; // beklenmedik bir numara - dokunma
  tumNumaralar
    .filter((t) => t !== seciliTelefon)
    .forEach((t) => {
      if (telefonIndex.get(t) === id) telefonIndex.delete(t);
    });
  kayit.telefon = seciliTelefon;
  kayit.telefonlar = [seciliTelefon];
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
// telefon(lar) alanindan yeniden turetiliyor (tek dogru kaynak kayitlar'dir).
async function yukle() {
  const veri = await db.oku("randevuDefteri");
  if (veri) {
    Object.entries(veri).forEach(([id, kayit]) => {
      kayitlar.set(id, kayit);
      // 02.08.2026 DUZELTME: bu degisiklikten ONCE kaydedilmis eski kayitlarda
      // "telefonlar" dizisi olmayabilir (sadece tekil "telefon" alani vardi) -
      // ikisini de destekleyip TUM numaralari indexe ekliyoruz.
      const numaralar = Array.isArray(kayit.telefonlar) && kayit.telefonlar.length ? kayit.telefonlar : [kayit.telefon];
      numaralar.filter(Boolean).forEach((t) => telefonIndex.set(t, id));
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
  dogruNumarayiSec,
  zamaniGelenTekrarAramaHatirlatmalari,
  tekrarAramaHatirlatmaGonderildiIsaretle,
  tekrarAramaHatirlatmaDenemeBasarisiz,
  zamaniGelenRandevuHatirlatmalari,
  randevuHatirlatmaGonderildiIsaretle,
  randevuHatirlatmaDenemeBasarisiz,
  yukle,
  kaydet
};
