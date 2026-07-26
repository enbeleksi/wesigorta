// Musterilerin sigortacilikla ilgili genel merak ettigi TERIMLERI ve
// acentemizin sundugu URUNLERI aciklayan basit bir SSS (sikca sorulan
// sorular) sozlugu. conversationEngine.js bu sozlugu, musteri "X nedir?" /
// "X ne demek?" gibi bir SORU KALIBIYLA birlikte bilinen bir terim/urun adi
// kullandiginda tetikler - SIRKET_ANAHTAR_KELIMELER/ADRES_ANAHTAR_KELIMELER
// ile tamamen ayni davranis deseni (akisi bozmadan kisa bir cevap verir,
// bir soru bekleniyorsa o soruyu tekrar hatirlatir).
//
// 26.07.2026 eklendi.
//
// ONEMLI TASARIM KARARI: Tetikleyici SADECE bir "soru kalibi" (nedir/ne
// demek/aciklar misin vb.) ile BIRLIKTE devreye girer - kelimenin TEK BASINA
// gecmesi YETERLI DEGILDIR. Nedeni: bircok terim (orn. "kasko", "dask",
// "trafik") AYNI ZAMANDA urun secim listesindeki GERCEK urun adlaridir -
// musteri ASK_PRODUCT asamasindayken sadece "Kasko Sigortası" yazdiginda bu
// bir urun SECIMIDIR, "Kasko nedir?" sorusu degildir. Soru kalibi sarti
// olmadan bu iki durumu ayirt edemez, musterinin urun secimini
// yanlislikla bir SSS cevabina donusturmus oluruz (ve secim hic islenmez).

const SORU_KALIBI =
  /(nedir|ne demek|ne ise yarar|ne ise yariyor|aciklar misin|aciklar misiniz|hakkinda bilgi|kisaca anlat|anlatir misin|anlatir misiniz)/;

// Turkce klavyesi olmayan kullanicilar bazen Turkce karakter kullanmadan
// yazabilir (bkz. conversationEngine.js'deki ayni isimli fonksiyonun
// yorumu). Bu modul kendi icinde bagimsiz calisabilsin diye kucuk bir kopyasi
// burada da tutuluyor.
function normalizeTr(str) {
  return str
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

// anahtarKelimeler icindeki HERHANGI biri, metin icinde KELIME SINIRLARIYLA
// (\b...\b) geciyorsa eslesir - orn. "bes" kelimesi "beş" (rakam 5) ile
// karisilmasin diye sadece tam kelime olarak arandiginda eslesir, "ödedigim
// besyuz lira" gibi bir ifadenin icinde YANLISLIKLA tetiklenmez.
function keywordsMatch(normalizedText, anahtarKelimeler) {
  return anahtarKelimeler.some((kw) => new RegExp(`\\b${kw}\\b`).test(normalizedText));
}

// { anahtarKelimeler: [...], cevap: "..." }
const TERIMLER = [
  {
    anahtarKelimeler: ["prim"],
    cevap:
      "💡 *Prim*, sigorta poliçeniz karşılığında ödediğiniz tutardır. Genelde yıllık ödenir, bazı ürünlerde taksitlendirilebilir."
  },
  {
    anahtarKelimeler: ["teminat"],
    cevap:
      "💡 *Teminat*, poliçenizin karşıladığı, yani bir hasar durumunda sigorta şirketinin ödemeyi taahhüt ettiği risklerdir (örn. yangın, hırsızlık, üçüncü şahıs mali sorumluluk)."
  },
  {
    anahtarKelimeler: ["muafiyet"],
    cevap:
      "💡 *Muafiyet*, bir hasar durumunda sigortalının kendi üzerinde bıraktığı, sigorta şirketinin ödemediği kısımdır (örn. \"500 TL muafiyetli\" bir poliçede ilk 500 TL'lik hasarı siz karşılarsınız)."
  },
  {
    anahtarKelimeler: ["hasarsizlik indirimi", "hasarsizlik"],
    cevap:
      "💡 *Hasarsızlık indirimi*, bir önceki dönemde hiç hasar bildirmediyseniz bir sonraki yıl priminize uygulanan indirimdir. Kasko ve Trafik sigortasında yaygındır."
  },
  {
    anahtarKelimeler: ["police"],
    cevap:
      "💡 *Poliçe*, sigorta şirketiyle sizin aranızdaki sözleşmenin kendisidir - hangi risklere karşı, ne kadar teminatla, ne kadar prim karşılığında sigortalandığınızı gösterir."
  },
  {
    anahtarKelimeler: ["sigorta ettiren"],
    cevap:
      "💡 *Sigorta ettiren*, poliçeyi satın alan ve primi ödeyen kişidir. *Sigortalı* ise güvence altına alınan kişi/varlıktır - genelde ikisi aynı kişi olsa da (örn. bir ebeveyn çocuğu için sigorta yaptırdığında) farklı olabilir."
  },
  {
    anahtarKelimeler: ["sigortali"],
    cevap: "💡 *Sigortalı*, poliçe kapsamında güvence altına alınan kişi ya da varlıktır (örn. Kasko'da araç, Sağlık sigortasında o kişi)."
  },
  {
    anahtarKelimeler: ["riziko", "risk"],
    cevap:
      "💡 *Riziko (risk)*, sigorta konusu olan, gerçekleşme ihtimali olan olaydır (örn. yangın, kaza, hastalık). Sigorta, bu rizikolar gerçekleştiğinde oluşacak zararı karşılar."
  },
  {
    anahtarKelimeler: ["eksper"],
    cevap:
      "💡 *Eksper*, bir hasar meydana geldiğinde hasarın boyutunu ve nedenini yerinde inceleyip raporlayan uzman kişidir. Sigorta şirketi ödeme yapmadan önce genelde bir eksper değerlendirmesi ister."
  },
  {
    anahtarKelimeler: ["hasar"],
    cevap:
      "💡 *Hasar*, poliçenizin kapsadığı bir olay sonucunda oluşan maddi/bedeni zarardır. Hasar olduğunda en kısa sürede bize veya sigorta şirketine bildirmeniz (ihbar) gerekir."
  },
  {
    anahtarKelimeler: ["ihbar"],
    cevap:
      "💡 *İhbar*, bir hasar meydana geldiğinde bunu sigorta şirketine bildirme işlemidir. Hasarınız olduğunda bizimle ya da doğrudan sigorta şirketiyle iletişime geçerek ihbarınızı yapabilirsiniz."
  }
];

const URUN_ACIKLAMALARI = [
  {
    anahtarKelimeler: ["dask"],
    cevap:
      "🏠 *DASK (Doğal Afet Sigortaları Kurumu)*, deprem ve deprem sonucu oluşabilecek yangın, infilak, tsunami gibi hasarlara karşı yasal olarak zorunlu bir sigortadır. Konutunuzun temel yapısal (bina) hasarlarını karşılar."
  },
  {
    anahtarKelimeler: ["konut sigortasi"],
    cevap:
      "🏠 *Konut Sigortası*, DASK'ın kapsamadığı riskleri de (yangın, hırsızlık, su baskını, cam kırılması, eşyalarınız vb.) içine alan, konutunuzu ve içindeki eşyalarınızı daha geniş kapsamda güvence altına alan bir sigortadır."
  },
  {
    anahtarKelimeler: ["trafik sigortasi"],
    cevap:
      "🚗 *Trafik Sigortası*, karayolunda araç kullanan herkes için yasal olarak zorunlu bir sigortadır - siz bir kazaya sebep olursanız KARŞI TARAFIN (üçüncü şahısların) maddi/bedeni zararlarını karşılar. Kendi aracınızın hasarını karşılamaz (bunun için Kasko gerekir)."
  },
  {
    anahtarKelimeler: ["kasko"],
    cevap:
      "🚗 *Kasko Sigortası*, kendi aracınızın kaza, çalınma, yangın gibi durumlarda oluşan hasarını karşılayan (isteğe bağlı) bir sigortadır - Trafik Sigortası'ndan farklı olarak KENDİ aracınızı güvence altına alır."
  },
  {
    anahtarKelimeler: ["ozel saglik sigortasi", "ozel saglik"],
    cevap:
      "🩺 *Özel Sağlık Sigortası*, özel hastanelerde muayene, tetkik, ameliyat gibi sağlık giderlerinizi (poliçenizin teminatları dahilinde) karşılayan bir sigortadır."
  },
  {
    anahtarKelimeler: ["tss", "tamamlayici saglik"],
    cevap:
      "🩺 *Tamamlayıcı Sağlık Sigortası (TSS)*, SGK'lı olan kişilerin, SGK anlaşmalı özel hastanelerde SGK'nın karşılamadığı fark ücretlerini karşılayan, Özel Sağlık Sigortası'na göre daha uygun fiyatlı bir sigortadır."
  },
  {
    anahtarKelimeler: ["hayat sigortasi", "prim iadeli"],
    cevap:
      "💰 *Prim İadeli Hayat Sigortası*, sizi ve sevdiklerinizi vefat/maluliyet gibi risklere karşı güvence altına alırken, vade sonunda bir talep olmazsa ödediğiniz primlerin size geri iade edildiği bir sigorta türüdür."
  },
  {
    anahtarKelimeler: ["bes", "bireysel emeklilik"],
    cevap:
      "💰 *BES (Bireysel Emeklilik Sistemi)*, düzenli tasarruf yaparak birikim oluşturmanızı ve devletin katkı payı desteğinden yararlanmanızı sağlayan, emekliliğe yönelik bir tasarruf/yatırım sistemidir."
  },
  {
    anahtarKelimeler: ["hekim sorumluluk", "malpraktis"],
    cevap:
      "🩺 *Hekim Sorumluluk Sigortası (Malpraktis)*, hekimlerin mesleki uygulamaları sırasında oluşabilecek hatalardan doğan tazminat taleplerine karşı onları güvence altına alan bir sorumluluk sigortasıdır."
  }
];

// userText: musterinin yazdigi HAM metin (normalize edilmemis). Bir eslesme
// varsa cevap metnini, yoksa null doner.
function sssCevabiBul(userText) {
  const normalized = normalizeTr((userText || "").trim());
  if (!normalized || !SORU_KALIBI.test(normalized)) return null;

  const tumGirdiler = [...TERIMLER, ...URUN_ACIKLAMALARI];
  const eslesen = tumGirdiler.find((girdi) => keywordsMatch(normalized, girdi.anahtarKelimeler));
  return eslesen ? eslesen.cevap : null;
}

module.exports = { sssCevabiBul };
