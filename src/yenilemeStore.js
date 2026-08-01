// Danismanlarin WhatsApp uzerinden manuel olarak ekledigi police
// yenileme/bitis tarihi hatirlatma kayitlarini tutar. leadStore'daki
// taleplerden tamamen bagimsizdir - bir musterinin var olan (sistemden
// satilmis olsun ya da olmasin) policesinin ne zaman yenilenecegini takip
// etmek icindir (orn. "Ahmet Bey'in trafik poliçesi 34 ABC 123 plakali
// aracı için 12.09.2026'da bitiyor").
//
// 01.08.2026 eklendi: Enbel'in gerçek "ELEMENTER ÜRETİM TAKİP" dosyasinin
// formatindan (SİGORTALI ADI SOYADI / ARACI / POLİÇE NO / TANZİM TARİHİ /
// ÜRÜN / ŞİRKET sutunlari) toplu yenileme kaydi olusturan uretimExceliYukle
// fonksiyonu eklendi - bkz. asagida. Bu, danismanlarin WhatsApp'tan tek tek
// "Yenileme Ekle" ile girdigi kayitlardan TAMAMEN AYRI bir giris yolu
// (kaynak: "excel_import"), ayni depoyu (yenilemeler Map'i) paylasir.
//
// Okuma/yazma bellek-ici (in-memory) Map uzerinden yapilir, leadStore ile
// ayni sekilde db.js araciligiyla PostgreSQL'e periyodik yedeklenir.

const db = require("./db");
const XLSX = require("xlsx");
const flows = require("./flows");

const yenilemeler = new Map(); // id -> yenileme kaydi
let sayac = 0;

function yeniYenilemeOlustur({ danismanNumarasi, danismanAdi, musteriAdi, urun, plaka, bitisTarihi, kaynak }) {
  sayac += 1;
  const id = `Y${Date.now()}${sayac}`;
  const kayit = {
    id,
    danismanNumarasi: danismanNumarasi || null,
    danismanAdi: danismanAdi || null,
    musteriAdi,
    urun,
    plaka: plaka || null,
    bitisTarihi, // ms cinsinden (validators.tarihiMsYap ile uretilir)
    kaynak: kaynak || "danisman", // "danisman" | "excel_import"
    // 26.07.2026 eklendi: bu yenilemenin bitis tarihine YENILEME_BEKLEYEN_IS_ESIK_GUN
    // (bkz. server.js) kala, OTOMATIK olarak leadStore'da bir "Bekleyen İş"
    // (Açık talep) olusturuldu mu? (bkz. server.js'deki yenilemeleriBekleyenIseAktar).
    // Danismanin kendi WhatsApp menusunden MANUEL bakmasi (yenilemelerimGoster)
    // bu alani ETKILEMEZ - o hala her zaman TUM yaklasanlari gosterir.
    bekleyenIseAktarildiMi: false,
    olusturulmaZamani: Date.now()
  };
  yenilemeler.set(id, kayit);
  return kayit;
}

function tumYenilemeleriGetir() {
  return Array.from(yenilemeler.values()).sort((a, b) => a.bitisTarihi - b.bitisTarihi);
}

// gunSayisi: bugunden itibaren kac gun ileriye kadar bakilacak (varsayilan 30).
// Gecmiste kalmis (henuz "kapatilmamis") kayitlar da "gecikmis" olarak listeye
// dahil edilir, boylece hicbir yenileme gozden kacmaz.
// danismanNumarasi verilirse sadece o danismana ait kayitlar donulur.
function yaklasanYenilemeleriGetir(gunSayisi = 30, danismanNumarasi = null) {
  const GUN_MS = 24 * 60 * 60 * 1000;
  const simdi = Date.now();
  const ufukTarihi = simdi + gunSayisi * GUN_MS;
  return tumYenilemeleriGetir().filter((y) => {
    if (danismanNumarasi && y.danismanNumarasi !== danismanNumarasi) return false;
    return y.bitisTarihi <= ufukTarihi;
  });
}

// Bitis tarihine "esikGunSayisi" (varsayilan 15) gun ya da daha az kalmis VE
// henuz bir "Bekleyen İş" kaydina DONUSTURULMEMIS (bekleyenIseAktarildiMi:
// false) yenilemeleri doner - bkz. server.js'deki yenilemeleriBekleyenIseAktar.
// Gecmiste kalmis (suresi zaten gecmis) kayitlar da dahildir - leadStore'daki
// hatirlatma/memnuniyet anketi mantigiyla AYNI ilke: gecikmis bir sey
// sessizce atlanmaz, ilk firsatta (bir sonraki kontrol dongusunde) islenir.
function zamaniGelenYenilemeler(esikGunSayisi = 15) {
  const GUN_MS = 24 * 60 * 60 * 1000;
  const ufukTarihi = Date.now() + esikGunSayisi * GUN_MS;
  return tumYenilemeleriGetir().filter((y) => !y.bekleyenIseAktarildiMi && y.bitisTarihi <= ufukTarihi);
}

function yenilemeBekleyenIseAktarildiIsaretle(id) {
  const kayit = yenilemeler.get(id);
  if (!kayit) return;
  kayit.bekleyenIseAktarildiMi = true;
}

// --- Uretim Excel'inden toplu yenileme yukleme (01.08.2026 eklendi) ---
// Enbel'in gercek "ELEMENTER ÜRETİM TAKİP" dosyasinin formatina gore -
// danismanlarin WhatsApp'tan tek tek girdigi "Yenileme Ekle" akisindan
// TAMAMEN AYRI, ikinci bir giris yolu. Asagidaki tum tasarim kararlari
// 01.08.2026'da kullaniciyla (Enbel) birlikte netlestirildi:
//
// 1) Dosyada dogrudan bir "bitis/vade tarihi" sutunu YOK, sadece TANZİM
//    TARİHİ var - Turkiye'de trafik/kasko/konut/DASK/TSS/hekim gibi
//    urunlerin buyuk cogunlugu YILLIK oldugu icin, yenileme tarihi HER
//    urun icin "tanzim tarihi + 1 yil" olarak hesaplaniyor (bkz.
//    yenilemeTarihiHesapla).
// 2) Ayni police, uretim donemi boyunca birden fazla satirda gorunebilir
//    (orn. yil icinde bir "ZEYİL" ile degisiklik yapilmis olabilir). Duz
//    "ZEYİL" satirlari (SATIŞTAN ZEYİL DEGIL) sadece mevcut policenin
//    donem ICI bir degisikligidir - policenin kendisini SONLANDIRMAZ, bu
//    yuzden yenileme tarihi hesabinda bu satirlar dikkate ALINMAZ (musteri/
//    urun grubunun "guncel" satirini belirlerken atlanir), ama policenin
//    hala aktif oldugu varsayimini BOZMAZ.
// 3) "SATIŞTAN ZEYİL" ozel bir durum: kullanicinin acikca belirttigi gibi
//    ("satıştan zeyiller o poliçe bir daha yenilenmeyecek demek") bu,
//    sigortali aracin/varligin SATILDIGI ve policenin bir daha
//    YENILENMEYECEGI anlamina geliyor - yani normal bir zeyilin aksine,
//    bu satir o musteri/urun grubu icin GORULEN EN SON islemse, o grup
//    icin HIC yenileme kaydi olusturulmuyor (İPTAL/İADE ile AYNI muamele).
// 4) Bir musteri/urun grubunun EN SON (tanzim tarihine gore) islemi
//    İPTAL/İADE/SATIŞTAN ZEYİL ise, o police artik aktif sayilmiyor ve
//    atlaniyor (yenileme kaydi olusturulmuyor/guncellenmiyor).
// 5) Ayni dosyanin (guncellenmis bir uretim raporunun) tekrar tekrar
//    yuklenebilmesi icin, "excel_import" kaynakli kayitlar musteri+urun
//    bazinda GUNCELLENIYOR (yeni bir kopya olusturulmuyor) - bkz.
//    asagidaki musteriUrunAnahtari.

// normalizeTr: advisorEngine.js'deki AYNI fonksiyonun bir kopyasi (Turkce
// karakterleri/buyuk-kucuk harf farkini yok sayarak karsilastirma yapmak
// icin) - iki modul birbirini require ETMIYOR (dongusel bagimlilik riskini
// onlemek icin), bu yuzden kucuk, bagimsiz bir kopya burada tutuluyor.
function normalizeTr(str) {
  return (str || "")
    .toString()
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

function basligiNormallestir(str) {
  return normalizeTr(str).trim().replace(/[^a-z0-9]/g, "");
}

const URETIM_BASLIK_ESLESTIRME = {
  musteriAdi: ["sigortaliadisoyadi", "sigortaliadi", "musteriadi", "adsoyad", "adisoyadi", "sigortali"],
  danismanAdi: ["araci", "danisman", "danismanadi"],
  policeNo: ["policeno", "policenumarasi"],
  tanzimTarihi: ["tanzimtarihi", "tanzimtarih"],
  urun: ["urun", "urunadi"],
  sirket: ["sirket", "sigortasirketi"]
};

// Ilk 10 satirin icinde (dosyanin basinda bos/baslik satirlari olabilir -
// gercek uretim dosyasinda ilk satir tamamen bos, asil basliklar 2. satirda)
// "musteriAdi" VE "tanzimTarihi" alanlarinin ikisini birden tanidigimiz
// satiri baslik satiri olarak kabul ediyoruz. Bulamazsa null doner.
function uretimBasligiSatiriBul(satirlarHamDizi) {
  for (let i = 0; i < Math.min(10, satirlarHamDizi.length); i++) {
    const satir = satirlarHamDizi[i] || [];
    const normalizeliHucreler = satir.map((h) => basligiNormallestir(h));
    const musteriVar = normalizeliHucreler.some((h) => URETIM_BASLIK_ESLESTIRME.musteriAdi.includes(h));
    const tarihVar = normalizeliHucreler.some((h) => URETIM_BASLIK_ESLESTIRME.tanzimTarihi.includes(h));
    if (musteriVar && tarihVar) return i;
  }
  return null;
}

function satiriKanonikleAlanlaraCevirUretim(satir) {
  const sonuc = {};
  for (const [baslik, deger] of Object.entries(satir)) {
    const normBaslik = basligiNormallestir(baslik);
    for (const [alan, esanlamlilar] of Object.entries(URETIM_BASLIK_ESLESTIRME)) {
      if (esanlamlilar.includes(normBaslik) && sonuc[alan] === undefined) {
        sonuc[alan] = deger;
        break;
      }
    }
  }
  return sonuc;
}

// Bir hucre degerini (Excel'den gelen gercek Date nesnesi, ham sayisal Excel
// tarih seri numarasi, ya da "05.08.2025" / "05/08/2025" gibi bir metin
// olabilir - gercek uretim dosyasinda UCU DE goruldu) {yil, ay, gun} olarak
// cozer. Cozemezse null doner.
function tarihiCikar(deger) {
  if (deger instanceof Date && !isNaN(deger.getTime())) {
    return { yil: deger.getFullYear(), ay: deger.getMonth() + 1, gun: deger.getDate() };
  }
  if (typeof deger === "number" && deger > 0) {
    // Excel'in 1900 tarih sistemi - epoch 30.12.1899 (25569, 01.01.1970'in
    // Excel seri numarasi, gunluk 86400 saniye).
    const ms = Math.round((deger - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return { yil: d.getUTCFullYear(), ay: d.getUTCMonth() + 1, gun: d.getUTCDate() };
  }
  const metin = (deger || "").toString().trim();
  const eslesme = metin.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (eslesme) {
    return { gun: Number(eslesme[1]), ay: Number(eslesme[2]), yil: Number(eslesme[3]) };
  }
  return null;
}

// "tanzim tarihi + 1 yil" - JS Date'in ay/yil tasmasini kendisi dogru
// yonetmesinden faydalaniyoruz (orn. 29 Subat + 1 yil -> 1 Mart, hatasiz).
function yenilemeTarihiHesapla({ yil, ay, gun }) {
  return new Date(yil + 1, ay - 1, gun).getTime();
}

// Bir urun metnini inceleyip: (a) gruplama icin "temel urun tipi"ni
// (normalize edilmis, orn. "trafik satistan zeyil" -> "trafik"), (b) bu
// satirin bir SONLANDIRMA olayi mi (iptal/iade/satistan zeyil - police bir
// daha yenilenmeyecek), (c) sadece donem-ici bir degisiklik (duz zeyil -
// policeyi sonlandirmiyor, ama yenileme tarihi hesabinda esas alinmiyor)
// olup olmadigini doner.
function urunDurumuCoz(urunHam) {
  const normalized = normalizeTr(urunHam).trim();
  const terminationEvent = /iptal|iade/.test(normalized) || (/satistan/.test(normalized) && /zey/.test(normalized));
  const sadeceDonemIciDegisiklik = !terminationEvent && /zey/.test(normalized);
  const baseTipi = normalized
    .replace(/satistan\s*zey\w*/g, "")
    .replace(/\bzey\w*\b/g, "")
    .replace(/\byenileme\b/g, "")
    .replace(/\biptal\b/g, "")
    .replace(/\biade\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { baseTipi, terminationEvent, sadeceDonemIciDegisiklik };
}

// 01.08.2026 eklendi: Enbel'in belirttigi uzere, uretim dosyasinin "ARACI"
// sutununda bazen bir danismanin adi yerine soyadi kullanilmis (orn.
// "KURAL" = Seda Kural). Dogrudan isim eslesmesi bulunamayinca burada da
// (normallestirilmis) kontrol ediliyor. Yeni bir benzer durum cikarsa
// (baska bir danismanin da soyadiyla gecmesi gibi) bu haritaya eklenmesi
// yeterli.
const DANISMAN_TAKMA_ADLAR = {
  kural: "Seda"
};

function danismanNumarasiIsimdenBul(isim) {
  const normIsim = normalizeTr(isim).trim();
  if (!normIsim) return null;
  const dogrudan = flows.dask.advisors.find((a) => normalizeTr(a.name).trim() === normIsim);
  if (dogrudan) return dogrudan;
  const takmaAd = DANISMAN_TAKMA_ADLAR[normIsim];
  if (takmaAd) {
    return flows.dask.advisors.find((a) => a.name === takmaAd) || null;
  }
  return null;
}

// 01.08.2026 eklendi: Enbel'in talebi uzerine - "ARACI" sutunundaki isim
// (dogrudan ya da takma adla) hicbir danismanla eslesmiyorsa, bu kayitlar
// ARTIK bos/atanmamis birakilmiyor. Bu isimler cogunlukla bunyede
// calismayan, sirkete disaridan is paslayan kisiler - bu yuzden varsayilan
// olarak Bahadır'a dusuyor: Bahadır zaten gunluk ozetinde "ekibin elementer
// bekleyen isleri" bolumunde bunu gorecek, Enbel de kendi ozetindeki
// "ekibin TÜM bekleyen isleri" bolumunde (server.js - danismanNumarasindan
// BAGIMSIZ, TÜM acik isler listelenir) otomatik olarak gorecegi icin ayrica
// Enbel'e de dusurmeye gerek yok - "bahadıra ve bana dussun" talebi bu
// sekilde tek bir atamayla saglanmis oluyor.
function varsayilanDanisman() {
  return flows.dask.advisors.find((a) => a.name === "Bahadır") || null;
}

// Dosyanin ilk sayfasini okuyup, baslik satirini otomatik bularak satir
// nesneleri dizisine cevirir. cellDates:true ile Excel'deki gercek tarih
// hucreleri dogrudan JS Date nesnesi olarak geliyor (metin/sayi olarak
// gelen istisnai hucreler icin tarihiCikar ayrica fallback saglıyor).
function uretimExcelSatirlariniOku(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ilkSayfaAdi = workbook.SheetNames[0];
  if (!ilkSayfaAdi) return { hata: "Dosyada okunabilir bir sayfa bulunamadı." };
  const sayfa = workbook.Sheets[ilkSayfaAdi];

  const hamDiziler = XLSX.utils.sheet_to_json(sayfa, { header: 1, defval: "", raw: false, blankrows: false });
  const baslikIndex = uretimBasligiSatiriBul(hamDiziler);
  if (baslikIndex === null) {
    return {
      hata:
        'Dosyada "Sigortalı Adı Soyadı" ve "Tanzim Tarihi" sütunlarını tanıyamadım 😕 ' +
        "Lütfen üretim takip dosyasının orijinal formatında (ilk sayfada) olduğundan emin olur musunuz?"
    };
  }

  const satirlar = XLSX.utils.sheet_to_json(sayfa, { range: baslikIndex, defval: "", raw: true });
  return { satirlar };
}

// Ana toplu yukleme fonksiyonu. Doner:
// { eklenen: [...kayit], guncellenen: [...kayit], atlanan: [{satirNo, adSoyad, urun, sebep}], toplamSatir, gruplananPolice }
function uretimExceliYukle(buffer, dosyaAdi) {
  const okuma = uretimExcelSatirlariniOku(buffer);
  if (okuma.hata) return { hata: okuma.hata };
  const { satirlar } = okuma;

  if (satirlar.length === 0) {
    return { hata: "Excel dosyasında okunabilir bir satır bulamadım - dosya boş olabilir." };
  }

  // 1) Her satiri kanonik alanlara cevir, tarihini coz, gecerli olmayanlari atla.
  const adaylar = []; // { musteriAdi, danismanAdi, policeNo, sirket, urunHam, tarih, tanzimMs, baseTipi, terminationEvent, satirNo }
  const atlanan = [];
  satirlar.forEach((satir, i) => {
    const satirNo = i + 2;
    const k = satiriKanonikleAlanlaraCevirUretim(satir);
    const musteriAdi = (k.musteriAdi || "").toString().trim();
    const urunHam = (k.urun || "").toString().trim();
    if (!musteriAdi || !urunHam) return; // basliksiz/bos/ara satirlar - sessizce atla (hata degil)

    const tarih = tarihiCikar(k.tanzimTarihi);
    if (!tarih) {
      atlanan.push({ satirNo, adSoyad: musteriAdi, urun: urunHam, sebep: "Tanzim tarihi okunamadı" });
      return;
    }

    const { baseTipi, terminationEvent, sadeceDonemIciDegisiklik } = urunDurumuCoz(urunHam);
    if (!baseTipi) {
      atlanan.push({ satirNo, adSoyad: musteriAdi, urun: urunHam, sebep: "Ürün tipi tanınamadı" });
      return;
    }
    // Duz (donem ici) zeyil satirlari, yenileme tarihi hesabinda esas
    // ALINMIYOR - kullanicinin talebi uzerine ("zeyilleri atla, sadece ana
    // poliçeyi say") aday havuzuna hic girmiyorlar. SATIŞTAN ZEYİL ise
    // terminationEvent=true oldugu icin bu bloga girmiyor, havuzda kaliyor
    // (o police artik aktif degil bilgisini tasimasi GEREKIYOR).
    if (sadeceDonemIciDegisiklik) return;

    adaylar.push({
      musteriAdi,
      danismanAdi: (k.danismanAdi || "").toString().trim(),
      policeNo: (k.policeNo || "").toString().trim() || null,
      sirket: (k.sirket || "").toString().trim() || null,
      urunHam,
      tarih,
      tanzimMs: new Date(tarih.yil, tarih.ay - 1, tarih.gun).getTime(),
      baseTipi,
      terminationEvent,
      satirNo
    });
  });

  // 2) Musteri + urun tipi bazinda grupla, her grubun EN SON (tanzim
  // tarihine gore) satirini bul.
  const gruplar = new Map(); // "musteriNorm||baseTipi" -> aday
  for (const aday of adaylar) {
    const anahtar = `${normalizeTr(aday.musteriAdi).trim()}||${aday.baseTipi}`;
    const mevcut = gruplar.get(anahtar);
    if (!mevcut || aday.tanzimMs > mevcut.tanzimMs) {
      gruplar.set(anahtar, aday);
    }
  }

  // 3) Excel'den daha once yuklenmis kayitlari (kaynak: excel_import) ayni
  // anahtarla eslestirebilmek icin bir index cikar - boylece dosya tekrar
  // yuklendiginde (guncellenmis uretim raporu) yeni kopya olusturulmak
  // yerine MEVCUT kayit guncelleniyor. Elle ("Yenileme Ekle" ile) girilmis
  // kayitlara KESINLIKLE dokunulmuyor (farkli urun adlandirma sozlugu
  // kullandiklari icin yanlislikla eslesip UZERINE YAZILMALARINI onlemek
  // amaciyla bilhassa sadece excel_import kaynaklilar taranıyor).
  const mevcutExcelKayitlari = new Map(); // anahtar -> kayit
  for (const kayit of yenilemeler.values()) {
    if (kayit.kaynak !== "excel_import" || !kayit._grupAnahtari) continue;
    mevcutExcelKayitlari.set(kayit._grupAnahtari, kayit);
  }

  const eklenen = [];
  const guncellenen = [];

  for (const [anahtar, aday] of gruplar.entries()) {
    if (aday.terminationEvent) {
      atlanan.push({
        satirNo: aday.satirNo,
        adSoyad: aday.musteriAdi,
        urun: aday.urunHam,
        sebep: "Son işlem iptal/iade/satıştan zeyil - poliçe artık aktif değil, yenileme takip edilmiyor"
      });
      continue;
    }

    // Once dogrudan/takma adla eslesmeyi dene; hicbiri tutmazsa (bu isim
    // bunyede calismayan, disaridan is paslayan biri oldugu icin) varsayilan
    // olarak Bahadır'a dus (telefon/bildirim buradan gider), AMA gosterilen
    // danismanAdi'nda "Bahadır" yerine dogrudan o kisinin kendi ismi
    // yaziliyor - 01.08.2026'da Enbel'in talebi uzerine ("dış kaynak
    // yazmana gerek yok, danışmanmış gibi isimlerini yazsan da olur, bahadır
    // tanıyor hepsini anlar"). disKaynakMi alani (goruntude GORUNMEZ, sadece
    // ic raporlama icin) ayri tutuluyor ki ozet mesaji hala bu kayitlarin
    // sayisini bilebilsin.
    const dogrudanCozulen = danismanNumarasiIsimdenBul(aday.danismanAdi);
    const danismanKaydi = dogrudanCozulen || varsayilanDanisman();
    const disKaynakMi = !dogrudanCozulen;
    const danismanAdiGosterim = dogrudanCozulen
      ? dogrudanCozulen.name
      : aday.danismanAdi || (danismanKaydi ? danismanKaydi.name : null);
    const bitisTarihi = yenilemeTarihiHesapla(aday.tarih);
    const urunGosterim = aday.urunHam; // orijinal metin - "TSS Yenileme" gibi bilgilendirici varyantlar da olsa gosterimde sorun degil

    const oncekiKayit = mevcutExcelKayitlari.get(anahtar);
    if (oncekiKayit) {
      const degisti = oncekiKayit.bitisTarihi !== bitisTarihi;
      oncekiKayit.musteriAdi = aday.musteriAdi;
      oncekiKayit.urun = urunGosterim;
      oncekiKayit.danismanNumarasi = danismanKaydi ? danismanKaydi.number : oncekiKayit.danismanNumarasi;
      oncekiKayit.danismanAdi = danismanAdiGosterim || oncekiKayit.danismanAdi;
      oncekiKayit.disKaynak = disKaynakMi;
      oncekiKayit.policeNo = aday.policeNo;
      oncekiKayit.sirket = aday.sirket;
      oncekiKayit.bitisTarihi = bitisTarihi;
      // Tarih degistiyse (yeni bir donem tespit edildiyse), daha once
      // "Bekleyen İş"e donusturulmus olsa bile bu YENI donem icin tekrar
      // 15-gun-kala kontrolune girsin diye bayragi sifirliyoruz.
      if (degisti) oncekiKayit.bekleyenIseAktarildiMi = false;
      guncellenen.push(oncekiKayit);
    } else {
      sayac += 1;
      const id = `Y${Date.now()}${sayac}`;
      const kayit = {
        id,
        danismanNumarasi: danismanKaydi ? danismanKaydi.number : null,
        danismanAdi: danismanAdiGosterim,
        disKaynak: disKaynakMi,
        musteriAdi: aday.musteriAdi,
        urun: urunGosterim,
        plaka: null,
        policeNo: aday.policeNo,
        sirket: aday.sirket,
        bitisTarihi,
        kaynak: "excel_import",
        kaynakDosyaAdi: dosyaAdi || null,
        _grupAnahtari: anahtar,
        bekleyenIseAktarildiMi: false,
        olusturulmaZamani: Date.now()
      };
      yenilemeler.set(id, kayit);
      eklenen.push(kayit);
    }
  }

  return { eklenen, guncellenen, atlanan, toplamSatir: satirlar.length };
}

// Sunucu baslarken bir kez cagrilir - DB'de kayitli yenilemeler varsa belleğe yukler.
async function yukle() {
  const veri = await db.oku("yenilemeler");
  if (veri) {
    Object.entries(veri).forEach(([id, kayit]) => yenilemeler.set(id, kayit));
    console.log(`${Object.keys(veri).length} yenileme kaydi veritabanindan yuklendi.`);
  }
}

// Periyodik olarak (server.js'deki zamanlayici ile) cagrilir - tum yenilemeleri DB'ye yazar.
async function kaydet() {
  const obj = Object.fromEntries(yenilemeler);
  await db.yaz("yenilemeler", obj);
}

module.exports = {
  yeniYenilemeOlustur,
  tumYenilemeleriGetir,
  yaklasanYenilemeleriGetir,
  zamaniGelenYenilemeler,
  yenilemeBekleyenIseAktarildiIsaretle,
  uretimExceliYukle,
  yukle,
  kaydet
};
