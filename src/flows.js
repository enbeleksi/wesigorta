// Her urun icin sorulacak sorular burada tanimlanir.
// Yeni bir sigorta urunu eklemek icin bu dosyaya yeni bir key eklemeniz yeterli.
//
// question.type: "text" (serbest metin) | "choice" (secenekli - WhatsApp buton/liste ile sorulur)
// question.text: normalde bir string'dir. Bazen (orn. "kiracıysanız ev sahibinin TC'si"
//   gibi) onceki cevaba gore soru metninin degismesi gerekir - bu durumda text bir
//   fonksiyon olabilir: (answers) => "soru metni". answers, o ana kadar verilen
//   tum cevaplari icerir (id -> cevap).
// question.danismanText: musteri modundaki "text" alaninin danisman-modu (3. sahis,
//   "sigortalının ..." tarzi) esdegeri. Bir danisman musterisi adina yeni talep
//   olustururken bu metin kullanilir. Belirtilmezse text ile ayni kabul edilir
//   (bazi sorular zaten notr/3. sahis oldugu icin degistirmeye gerek yok).
// question.danismandaGizle: true ise, danisman "musteri adina yeni talep" akisinda
//   bu soru hic sorulmaz (orn. "daha once danismanla gorustunuz mu" sorusu, danisman
//   zaten kendisi oldugu icin anlamsizdir).
// question.validate: (deger, answers) => true/false. Sadece "text" tipi sorularda
//   kullanilir. Onceki cevaplara da bakabilir (orn. daire kati, bina kat sayisindan
//   fazla olamaz). false donerse, bot ayni soruyu validationError mesajiyla tekrar
//   sorar (bir sonraki soruya gecmez).
// question.validationError: string ya da (deger, answers) => string. Dogrulama
//   basarisiz olunca gosterilecek mesaj.
// question.sameAsAccountHolder: true ise ve musterinin ismi zaten biliniyorsa
//   (WhatsApp konusmasinin basinda alinmis), bu soru tekrar sorulmaz, otomatik doldurulur.
//   (Sadece musteri modunda gecerlidir, danisman modunda uygulanmaz.)
//
// NOT: Nezaket ifadeleri (ogrenebilir miyim / paylasir misiniz / belirtir misiniz vb.)
// bilinçli olarak cesitlendirilmistir, ayni sohbette hep ayni kalip tekrar etmesin diye.
//
// product.agentNumber: bu urunle ilgilenen calisanin WhatsApp numarasi (basinda ulke
//   kodu, orn: 905321234567). Doldurulmazsa (yani "905XXXXXXXXX" placeholder olarak
//   kalirsa) sistem otomatik olarak Railway'deki genel AGENT_WHATSAPP_NUMBER'a duser.

const {
  tcKimlikGecerliMi,
  tarihGecerliMi,
  yasGecerliMi,
  pozitifSayiMi,
  yilGecerliMi,
  plakaGecerliMi,
  ruhsatSeriNoGecerliMi
} = require("./validators");

const MESLEK_SORU = {
  id: "meslek",
  text: "Mesleğinizi paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz, bu yüzden soruyoruz 😊",
  danismanText:
    "Sigortalının mesleğini paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz.",
  type: "text"
};

const MESLEK_SORU_SON = {
  id: "meslek",
  text: "Son olarak mesleğinizi paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz, bu yüzden soruyoruz 😊",
  danismanText:
    "Son olarak sigortalının mesleğini paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz.",
  type: "text"
};

const MESLEK_SORU_UCUNCU_SAHIS = {
  id: "meslek",
  text: "Sigortalanacak kişinin mesleğini söyler misiniz? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz, bu yüzden soruyoruz 😊",
  type: "text"
};

const TC_KIMLIK_SORU = {
  id: "tc_kimlik",
  text: "Son olarak T.C. kimlik numaranızı yazar mısınız?",
  danismanText: "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız?",
  type: "text",
  validate: tcKimlikGecerliMi,
  validationError:
    "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?",
  // Bu soru ACIKCA musterinin KENDI T.C. kimligini soruyor (RUHSAT_SAHIBI_TC_SORU'nun
  // aksine - orada arac/ruhsat baskasina ait olabilir). Bu yuzden SADECE burada
  // kaliciProfilAlani isaretlenir: conversationEngine.js bu cevabi musterinin
  // kalici profiline (musteriProfilStore) kaydedip, bir sonraki HER urunde
  // otomatik doldurur, boylece ayni musteriye TC'si bir daha sorulmaz.
  kaliciProfilAlani: "tcKimlik"
};

// Trafik/Kasko'da sorulan TC, hesap sahibinin degil ruhsat sahibinin TC'sidir
// (arac baskasi adina kayitli olabilir, poliçe ruhsat sahibi uzerinden hazirlanir).
// Zaten 3. sahis oldugu icin danisman modunda da aynen kullanilabilir.
const RUHSAT_SAHIBI_TC_SORU = {
  id: "tc_kimlik",
  text: "Son olarak ruhsat sahibinin T.C. kimlik numarasını yazar mısınız?",
  type: "text",
  validate: tcKimlikGecerliMi,
  validationError:
    "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
};

// Ruhsat belge seri no, ruhsatin sag alt kosesinde yer alir; harflerle baslayip
// rakamlarla devam eder (orn. "AE123456"). Metin zaten notr (kimseye ait "-nız"
// eki yok), danisman modunda da aynen kullanilabilir.
// fotoIleAlinabilir: true - musteri isterse yazmak yerine ruhsatin fotografini
// gonderebilir, Claude'un gorsel analiziyle seri no otomatik okunur (bkz.
// ruhsatAnaliz.js). Metinle cevaplama da her zaman calismaya devam eder.
const RUHSAT_SERI_NO_SORU = {
  id: "ruhsat_seri_no",
  text:
    "Ruhsat belge seri numarasını belirtir misiniz? (Ruhsatın sağ alt köşesinde yer alan, harflerle başlayıp rakamlarla devam eden seri numarasıdır. Örn: AE123456) İsterseniz yazmak yerine ruhsatın fotoğrafını da gönderebilirsiniz, sizin için okuruz. 📸",
  type: "text",
  validate: ruhsatSeriNoGecerliMi,
  validationError:
    "Lütfen ruhsat seri numarasını doğru formatta yazar mısınız? Harflerle başlayıp rakamlarla devam etmesi gerekiyor. (Örn: AE123456)",
  fotoIleAlinabilir: true
};

// Sehir cevabinda Turkce karakter farkliliklarini (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c)
// tolere ederek kucuk harfe cevirir - conversationEngine.js'deki normalizeTr ile
// ayni mantik, ama dongusel require olusmasin diye burada ayrica tanimlandi.
function sehirIcinNormalize(str) {
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

// Sehir cevabina gore kisa, sicak bir selam mesaji. Anahtarlar normalize
// edilmis (kucuk harf, Turkce karaktersiz) sehir isimleridir.
const SEHIR_ESPRILERI = {
  istanbul: "İki kıtayı birleştiren muhteşem İstanbul'a selam olsun! 🌉",
  ankara: "Başkentimiz Ankara'ya selam olsun! 🏛️",
  izmir: "Güzel İzmir'e selam olsun! 🌊",
  bursa: "Yeşil Bursa'ya selam olsun! 🍃",
  antalya: "Güneşli Antalya'ya selam olsun! ☀️",
  eskisehir: "Türkiye'nin en modern şehri Eskişehir'e selam olsun! 🎓",
  adana: "Sıcacık Adana'ya selam olsun! 🌶️",
  konya: "Tarihi Konya'ya selam olsun! 🕌",
  gaziantep: "Lezzetleriyle ünlü Gaziantep'e selam olsun! 🍽️",
  mersin: "Akdeniz'in incisi Mersin'e selam olsun! 🌴",
  kayseri: "Girişimci ruhlu Kayseri'ye selam olsun! 💼",
  trabzon: "Yeşilin ve denizin buluştuğu Trabzon'a selam olsun! ⛰️",
  samsun: "Karadeniz'in incisi Samsun'a selam olsun! 🌊",
  denizli: "Horozuyla ünlü Denizli'ye selam olsun! 🐓",
  sanliurfa: "Balıklıgöl'ün şehri Şanlıurfa'ya selam olsun! 🐟",
  urfa: "Balıklıgöl'ün şehri Şanlıurfa'ya selam olsun! 🐟",
  malatya: "Kayısının başkenti Malatya'ya selam olsun! 🍑",
  van: "Gölüyle meşhur Van'a selam olsun! 🏞️",
  diyarbakir: "Tarihi surlarıyla Diyarbakır'a selam olsun! 🏰",
  sakarya: "Sakarya'ya selam olsun! 🌳",
  mugla: "Cennet koylarıyla Muğla'ya selam olsun! 🏖️",
  kocaeli: "Sanayinin kalbi Kocaeli'ye selam olsun! 🏭",
  izmit: "Sanayinin kalbi Kocaeli'ye selam olsun! 🏭",
  balikesir: "Balıkesir'e selam olsun! 🌾",
  manisa: "Üzümüyle meşhur Manisa'ya selam olsun! 🍇",
  aydin: "İnciriyle meşhur Aydın'a selam olsun! 🌿",
  tekirdag: "Tekirdağ'a selam olsun! 🍇",
  canakkale: "Destansı Çanakkale'ye selam olsun! 🌊",
  erzurum: "Kar beyazı Erzurum'a selam olsun! ❄️",
  sivas: "Tarihi Sivas'a selam olsun! 🏛️",
  elazig: "Elazığ'a selam olsun! 🍒",
  rize: "Çayıyla ünlü Rize'ye selam olsun! 🍵"
};

// Sehir cevabinin icinde (tam eslesme sart degil, "Izmir'den yaziyorum" gibi
// cumleler de yakalansin diye) bilinen bir sehir adi var mi diye bakar.
// Bilinmeyen bir sehirde hicbir mesaj gonderilmez (null doner) - zaten sohbetin
// sonunda ayrica tesekkur ediliyor, burada tekrarlamaya gerek yok.
function sehirTepkisiUret(cevap) {
  const normalized = sehirIcinNormalize(cevap);
  for (const [sehirAdi, mesaj] of Object.entries(SEHIR_ESPRILERI)) {
    if (normalized.includes(sehirAdi)) {
      return mesaj;
    }
  }
  return null;
}

const SEHIR_SORU = {
  id: "sehir",
  text: "Hangi şehirden bize ulaştığınızı öğrenebilir miyim?",
  danismanText: "Sigortalı hangi şehirde, öğrenebilir miyim?",
  type: "text",
  tepki: sehirTepkisiUret
};

// Bina kat sayisi + dairenin bulundugu kat, DASK ve Konut'ta ortak kullanilan
// iki soru. Daire kati, binanin toplam kat sayisindan fazla olamaz - bunu
// kucuk, mizahi bir uyariyla kontrol ediyoruz.
const BINA_KAT_SAYISI_SORU = {
  id: "bina_kat_sayisi",
  text: "Binanın toplam kaç kattan oluştuğunu belirtir misiniz?",
  type: "text",
  validate: pozitifSayiMi,
  validationError: "Lütfen kat sayısını sadece rakamla yazar mısınız? (Örn: 5)"
};

const DAIRE_KATI_SORU = {
  id: "dairenin_bulundugu_kat",
  text: "Peki daireniz kaçıncı katta?",
  danismanText: "Peki sigortalının dairesi kaçıncı katta?",
  type: "text",
  validate: (deger, answers) => {
    if (!pozitifSayiMi(deger) && deger.trim() !== "0") return false;
    const binaKatSayisi = parseInt(answers.bina_kat_sayisi, 10);
    const daireKati = parseInt(deger, 10);
    if (!Number.isNaN(binaKatSayisi) && daireKati > binaKatSayisi) return false;
    return true;
  },
  validationError: (deger, answers) =>
    `Girilen kat, binanın toplam kat sayısından fazla olamaz 😄 Bina ${answers.bina_kat_sayisi} kattan oluşuyor, bu aralıkta tekrar yazar mısınız?`
};

// Insaat yili 1900'den once girilirse (format olarak dogru rakam olsa bile,
// orn. "1850") mizahi bir uyari gosterip gercek yili tekrar sorariz.
const INSAAT_YILI_SORU = {
  id: "insaat_yili",
  text: "Binanın inşaat yılı nedir?",
  type: "text",
  validate: yilGecerliMi,
  validationError: (deger) => {
    const sadeceRakam = /^\d{3,4}$/.test((deger || "").trim());
    const yil = parseInt((deger || "").trim(), 10);
    if (sadeceRakam && yil < 1900) {
      return "Bina o kadar eski olamaz herhalde! 😄 Taş devrinden mi kalma yoksa? Lütfen gerçek inşaat yılını (1900 sonrası) yazar mısınız?";
    }
    return "Lütfen inşaat yılını 4 haneli olarak yazar mısınız? (Örn: 2015)";
  }
};

// Tum urunlerde ortak kullanilan danisman listesi. Musteri daha once bir
// danismanla gorustuyse, toplanan bilgiler urunun varsayilan sorumlusuna degil,
// o danismanin numarasina gider. Ekip degistikce bu listeyi guncelleyebilirsiniz.
// Telefon numarasi bilinen danismanlar - resolveAgentNumber bu listeye bakarak
// yonlendirme yapar. Asagidaki TUM_DANISMAN_ISIMLERI listesindeki bir isim
// burada YOKSA (henuz telefon numarasi paylasilmadiysa), musteri o ismi secse
// bile talep otomatik olarak urunun varsayilan sorumlusuna duser - hicbir
// hata olusmaz, sadece dogrudan o kisiye iletilemez. Numarasi geldiginde
// asagiya `{ name: "Yasemin", number: "9053XXXXXXX" }` gibi eklemeniz yeterli.
const DANISMANLAR = [
  { name: "Enbel", number: "905326876126" },
  { name: "Seda", number: "905324176026" },
  { name: "Bahadır", number: "905380711711" },
  { name: "Fırat", number: "905527902616" }
  // Yasemin, Furkan, Simge, Tuğçe - telefon numaralari henuz bizde yok.
];

// Musteriye "hangi danisman" diye sorulurken gosterilen TAM liste (numarasi
// olsun olmasin tum danismanlar burada gorunur, cunku musteri kiminle
// gorustugunu soyleyebilmeli - yonlendirme ise sadece yukaridaki DANISMANLAR
// listesindeki numarasi olanlar icin otomatik calisir).
const TUM_DANISMAN_ISIMLERI = [
  "Enbel",
  "Seda",
  "Bahadır",
  "Fırat",
  "Yasemin",
  "Furkan",
  "Simge",
  "Tuğçe"
];

// Tum urunlerin basinda sorulan, daha once bir danismanla gorusulup
// gorusulmedigini soran iki soru. Ikinci soru sadece "Evet" cevabinda sorulur.
// danismandaGizle: true - bir danisman musterisi adina yeni talep olustururken
// bu iki soru hic sorulmaz (danisman zaten kendisi oldugu icin anlamsizdir).
const DANISMAN_SORULARI = [
  {
    id: "danisman_gorustu_mu",
    text: "Daha önce acentemiz bünyesindeki danışmanlarımızdan biriyle görüşme fırsatınız oldu mu?",
    type: "choice",
    options: ["Evet", "Hayır"],
    danismandaGizle: true
  },
  {
    id: "danisman_adi",
    text: "Hangi danışmanımızla görüşme fırsatınız oldu?",
    type: "choice",
    options: TUM_DANISMAN_ISIMLERI,
    // Sadece bir onceki soruya "Evet" cevabi verildiyse sorulur.
    skipIf: (answers) => answers.danisman_gorustu_mu !== "Evet",
    danismandaGizle: true
  }
];

module.exports = {
  dask: {
    label: "DASK",
    agentNumber: "905380711711", // Bahadır - elementer branş (DASK)
    advisors: DANISMANLAR,
    // QR kodundan gelen hazır mesaj bu metni içeriyorsa, bot direkt bu ürüne geçer
    // ve aşağıdaki sıcak karşılama mesajıyla başlar (ürün seçim listesi atlanır).
    qrTrigger: /dask/i,
    qrGreeting:
      "Merhaba! 😊 Yeni eviniz hayırlı olsun, içinde huzur dolu günler geçirmenizi dileriz! 🏠💛 DASK poliçenizi hemen hazırlayabilmemiz için birkaç bilgi alalım, olur mu?",
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "mulkiyet_durumu",
        text: "Sigortalanacak konut size mi ait, yoksa kiracı mısınız?",
        danismanText: "Sigortalanacak konut sigortalıya mı ait, yoksa sigortalı kiracı mı?",
        type: "choice",
        options: ["Ev Sahibiyim", "Kiracıyım"]
      },
      {
        id: "daini_murtehin",
        text:
          "Poliçe üzerinde dain-i mürtehin (ipotekli banka) var mı? Varsa Banka Adı, Banka Şubesi ve Kredi Döviz Türünü belirtir misiniz? Yoksa 'yok' yazabilirsiniz.",
        type: "text"
      },
      { id: "adres", text: "Sigortalanacak konutun açık adresini belirtir misiniz?", type: "text" },
      {
        id: "yuz_olcumu",
        text: "Konutun yüz ölçümünü (m²) söyler misiniz?",
        type: "text",
        validate: pozitifSayiMi,
        validationError: "Lütfen yüz ölçümünü sadece rakamla yazar mısınız? (Örn: 120)"
      },
      { ...INSAAT_YILI_SORU },
      { ...BINA_KAT_SAYISI_SORU },
      { ...DAIRE_KATI_SORU },
      { ...MESLEK_SORU },
      {
        id: "tc_kimlik",
        text: (answers) =>
          answers.mulkiyet_durumu === "Kiracıyım"
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak T.C. kimlik numaranızı yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)",
        danismanText: (answers) =>
          answers.mulkiyet_durumu === "Kiracıyım"
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)",
        type: "text",
        validate: tcKimlikGecerliMi,
        validationError:
          "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
      }
    ]
  },

  konut: {
    label: "Konut Sigortası",
    agentNumber: "905380711711", // Bahadır - elementer branş (Konut)
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      // DASK'in aksine Konut Sigortasi mutlaka ev sahibinin uzerine olmak
      // zorunda degil - kiraci da kendi uzerine yaptirabilir. Bu yuzden
      // "kiracı mısınız" yerine dogrudan police kimin uzerine sorusu soruyoruz.
      {
        id: "police_kimin_uzerine",
        text: "Konut sigortasını kendi üzerinize mi, yoksa ev sahibinin üzerine mi yaptıracaksınız?",
        danismanText: "Konut sigortası sigortalının kendi üzerine mi, yoksa ev sahibinin üzerine mi olacak?",
        type: "choice",
        options: ["Kendi Üzerime", "Ev Sahibinin Üzerine"]
      },
      {
        id: "daini_murtehin",
        text:
          "Poliçe üzerinde dain-i mürtehin (ipotekli banka) var mı? Varsa Banka Adı, Banka Şubesi ve Kredi Döviz Türünü belirtir misiniz? Yoksa 'yok' yazabilirsiniz.",
        type: "text"
      },
      { id: "adres", text: "Sigortalanacak konutun açık adresini belirtir misiniz?", type: "text" },
      {
        id: "yuz_olcumu",
        text: "Konutun yüz ölçümünü (m²) söyler misiniz?",
        type: "text",
        validate: pozitifSayiMi,
        validationError: "Lütfen yüz ölçümünü sadece rakamla yazar mısınız? (Örn: 120)"
      },
      { ...INSAAT_YILI_SORU },
      { ...BINA_KAT_SAYISI_SORU },
      { ...DAIRE_KATI_SORU },
      { ...MESLEK_SORU },
      {
        id: "tc_kimlik",
        text: (answers) =>
          answers.police_kimin_uzerine === "Ev Sahibinin Üzerine"
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak T.C. kimlik numaranızı yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)",
        danismanText: (answers) =>
          answers.police_kimin_uzerine === "Ev Sahibinin Üzerine"
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)",
        type: "text",
        validate: tcKimlikGecerliMi,
        validationError:
          "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
      }
    ]
  },

  trafik: {
    label: "Trafik Sigortası",
    intro:
      "Trafik Sigortası, bir kaza durumunda karşı tarafa vereceğiniz zararları güvence altına alan, yasal olarak zorunlu bir sigortadır. Teklifinizi hazırlamak için birkaç bilgi alalım. 🚗",
    agentNumber: "905380711711", // Bahadır - elementer branş (Trafik)
    advisors: DANISMANLAR,
    qrTrigger: /trafik/i,
    qrGreeting:
      "Merhaba! 😊 Yeni aracınız hayırlı olsun, güle güle kullanın! 🚗✨ Trafik sigortanızı en kısa sürede hazırlayabilmemiz için birkaç küçük bilgiye ihtiyacımız olacak, hemen başlayalım mı?",
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "plaka",
        text: "Aracınızın plakasını belirtir misiniz? (Örn: 34 ABC 123)",
        danismanText: "Sigortalının aracının plakasını belirtir misiniz? (Örn: 34 ABC 123)",
        type: "text",
        validate: plakaGecerliMi,
        validationError: "Lütfen plakayı doğru formatta yazar mısınız? (Örn: 34 ABC 123)"
      },
      { ...RUHSAT_SERI_NO_SORU },
      { ...SEHIR_SORU },
      { ...MESLEK_SORU },
      { ...RUHSAT_SAHIBI_TC_SORU }
    ]
  },

  kasko: {
    label: "Kasko Sigortası",
    intro:
      "Kasko, aracınızı kaza, hırsızlık, yangın gibi risklere karşı güvence altına alır. Teklifinizi hazırlamak için birkaç bilgi alalım. 🚗",
    agentNumber: "905380711711", // Bahadır - elementer branş (Kasko)
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "plaka",
        text: "Aracınızın plakasını belirtir misiniz? (Örn: 34 ABC 123)",
        danismanText: "Sigortalının aracının plakasını belirtir misiniz? (Örn: 34 ABC 123)",
        type: "text",
        validate: plakaGecerliMi,
        validationError: "Lütfen plakayı doğru formatta yazar mısınız? (Örn: 34 ABC 123)"
      },
      { ...RUHSAT_SERI_NO_SORU },
      {
        id: "kasko_durumu",
        text: "Kaskonuzu düzenli olarak her yıl yeniliyor musunuz, yoksa bir süredir kaskosuz mu kullanıyorsunuz?",
        danismanText:
          "Sigortalı kaskosunu düzenli olarak her yıl yeniliyor mu, yoksa bir süredir kaskosuz mu?",
        type: "choice",
        // "Bir Süredir Kaskosuzum" 22 karakterdi, WhatsApp'in dugme siniri
        // olan 20'yi asiyordu - "Kaskosuzum" olarak kisalttik (skipIf
        // asagida da guncellendi). Bu deger sadece bu akis icinde
        // kullanildigi icin (Garanti Emeklilik gibi disaridan tam metin
        // bekleyen bir sistem yok) kisaltmak guvenli.
        options: ["Düzenli Yeniliyorum", "Kaskosuzum"]
      },
      {
        id: "arac_fotograflari",
        text:
          "Bir süredir kaskonuz olmadığı için sigorta şirketleri aracınızın güncel halini görmek istiyor. " +
          "Lütfen aracınızın her yönünden (ön, arka, sağ, sol) birer fotoğraf çeker misiniz? Ayrıca ön camdan " +
          "görünen şasi numarasının fotoğrafını da ekleyin - plakanın fotoğraflarda net görünmesine dikkat edin. " +
          "Tüm fotoğrafları gönderdikten sonra \"tamam\" yazmanız yeterli. 📸",
        danismanText:
          "Sigortalının kaskosu bir süredir olmadığı için aracın güncel halini gösteren fotoğraflar gerekiyor. " +
          "Aracın her yönünden (ön, arka, sağ, sol) birer fotoğraf, ayrıca ön camdan görünen şasi numarasının " +
          "fotoğrafını gönderir misiniz? Plaka fotoğraflarda net görünsün. Bitirince \"tamam\" yazmanız yeterli. 📸",
        type: "coklu_foto",
        skipIf: (answers) => answers.kasko_durumu !== "Kaskosuzum"
      },
      { ...SEHIR_SORU },
      { ...MESLEK_SORU },
      { ...RUHSAT_SAHIBI_TC_SORU }
    ]
  },

  ozel_saglik: {
    label: "Özel Sağlık Sigortası",
    agentNumber: "905380711711", // Bahadır - elementer branş (Özel Sağlık)
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "kimin_icin",
        text: "Kimin için sigorta yaptırmak istiyorsunuz?",
        type: "choice",
        options: ["Kendim", "Eşim", "Çocuğum", "Ailem (Birden Fazla)"],
        danismandaGizle: true
      },
      { id: "ad_soyad", text: "Sigortalanacak kişinin ismini ve soyismini paylaşır mısınız?", type: "text" },
      {
        id: "dogum_tarihi",
        text: "Doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
        type: "text",
        validate: tarihGecerliMi,
        validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.1990)"
      },
      {
        id: "cinsiyet",
        text: "Sigortalanacak kişinin cinsiyeti nedir?",
        type: "choice",
        options: ["Kadın", "Erkek"]
      },
      { id: "boy_kilo", text: "Boyunu ve kilosunu paylaşır mısınız? (Örn: 170 cm / 70 kg)", type: "text" },
      {
        id: "il_ilce",
        text: "İkamet ettiği il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)",
        type: "text"
      },
      { ...MESLEK_SORU_UCUNCU_SAHIS },
      {
        id: "tc_kimlik",
        text:
          "Teklifinizi hazırlayabilmemiz için son olarak T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
        danismanText:
          "Teklifi hazırlayabilmemiz için son olarak sigortalının T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
        type: "text",
        validate: tcKimlikGecerliMi,
        validationError:
          "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
      }
    ]
  },

  tss: {
    label: "TSS (Tamamlayıcı Sağlık Sigortası)",
    menuLabel: "TSS (Tamamlayıcı Sig.)", // Urun secim listesinde WhatsApp'in 24 karakter siniri var
    agentNumber: "905380711711", // Bahadır - elementer branş (TSS)
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "kimin_icin",
        text: "Kimin için sigorta yaptırmak istiyorsunuz?",
        type: "choice",
        options: ["Kendim", "Eşim", "Çocuğum", "Ailem (Birden Fazla)"],
        danismandaGizle: true
      },
      { id: "ad_soyad", text: "Sigortalanacak kişinin ismini ve soyismini paylaşır mısınız?", type: "text" },
      {
        id: "dogum_tarihi",
        text: "Doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
        type: "text",
        validate: tarihGecerliMi,
        validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.1990)"
      },
      {
        id: "cinsiyet",
        text: "Sigortalanacak kişinin cinsiyeti nedir?",
        type: "choice",
        options: ["Kadın", "Erkek"]
      },
      { id: "boy_kilo", text: "Boyunu ve kilosunu paylaşır mısınız? (Örn: 170 cm / 70 kg)", type: "text" },
      {
        id: "il_ilce",
        text: "İkamet ettiği il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)",
        type: "text"
      },
      { ...MESLEK_SORU_UCUNCU_SAHIS },
      {
        id: "tc_kimlik",
        text:
          "Teklifinizi hazırlayabilmemiz için son olarak T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
        danismanText:
          "Teklifi hazırlayabilmemiz için son olarak sigortalının T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
        type: "text",
        validate: tcKimlikGecerliMi,
        validationError:
          "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
      }
    ]
  },

  hayat: {
    label: "Prim İadeli Hayat Sigortası",
    menuLabel: "Prim İadeli Hayat Sig.", // Urun secim listesinde WhatsApp'in 24 karakter siniri var
    agentNumber: "905326876126", // Enbel - danışman seçilmezse (Hayır derse) varsayılan buraya düşer
    // Bu urun tamamlaninca Garanti Emeklilik'e de otomatik mail gider
    // (bkz. eposta.js) - onlar kendi is akislarina ekleyip cagri merkezinden ariyor.
    garantiEmekliligeGonder: true,
    // QR/link uzerinden gelen hazır mesaj bu metni içeriyorsa, bot direkt bu ürüne geçer.
    qrTrigger: /prim iadeli|hayat sigortas/i,
    qrGreeting:
      "Merhaba! 😊 Hayat sigortası ile ilgilendiğiniz için teşekkür ederiz. Size en uygun teklifi hazırlayabilmemiz için birkaç bilgi alalım, olur mu?",
    // Bu urunle ilgilenen danismanlar. Musteri daha once bir danismanla
    // gorustuyse, toplanan bilgiler o danismanin numarasina gider.
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "yas",
        text: "Kaç yaşında olduğunuzu belirtir misiniz?",
        danismanText: "Sigortalının kaç yaşında olduğunu belirtir misiniz?",
        type: "text",
        validate: yasGecerliMi,
        validationError: "Lütfen yaşınızı sadece rakamla yazar mısınız? (Örn: 35)"
      },
      {
        id: "il_ilce",
        text: "İkamet ettiğiniz il ve ilçeyi söyler misiniz? (Örn: İstanbul / Kadıköy)",
        danismanText: "Sigortalının ikamet ettiği il ve ilçeyi söyler misiniz? (Örn: İstanbul / Kadıköy)",
        type: "text"
      },
      { ...MESLEK_SORU_SON }
    ]
  },

  bes: {
    label: "Bireysel Emeklilik Sistemi (BES)",
    menuLabel: "Bireysel Emeklilik(BES)", // Urun secim listesinde WhatsApp'in 24 karakter siniri var
    agentNumber: "905326876126", // Enbel - BES doğrudan buraya gider
    // Bu urun tamamlaninca Garanti Emeklilik'e de otomatik mail gider
    // (bkz. eposta.js) - onlar kendi is akislarina ekleyip cagri merkezinden ariyor.
    garantiEmekliligeGonder: true,
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "yas",
        text: "Kaç yaşında olduğunuzu belirtir misiniz?",
        danismanText: "Sigortalının kaç yaşında olduğunu belirtir misiniz?",
        type: "text",
        validate: yasGecerliMi,
        validationError: "Lütfen yaşınızı sadece rakamla yazar mısınız? (Örn: 35)"
      },
      {
        id: "bes_var_mi",
        text: "Herhangi bir şirkette bireysel emekliliğiniz var mı?",
        danismanText: "Sigortalının herhangi bir şirkette bireysel emekliliği var mı?",
        type: "choice",
        options: ["Evet", "Hayır"]
      },
      {
        id: "bes_sirket",
        text: "Hangi şirkette olduğunu söyler misiniz? Yoksa 'yok' yazabilirsiniz.",
        type: "text"
      },
      {
        id: "bes_birikim",
        text: "Yaklaşık birikim tutarınızı paylaşır mısınız? Yoksa 'yok' yazabilirsiniz.",
        danismanText: "Sigortalının yaklaşık birikim tutarını paylaşır mısınız? Yoksa 'yok' yazabilirsiniz.",
        type: "text"
      },
      { ...SEHIR_SORU },
      { ...MESLEK_SORU_SON }
    ]
  },

  malpraktis: {
    label: "Hekim Sorumluluk Sigortası (Malpraktis)",
    intro:
      "Hekim Sorumluluk Sigortası, mesleki uygulamalarınız sırasında oluşabilecek olası taleplere karşı sizi güvence altına alır. Teklifinizi hazırlamak için birkaç bilgi alalım. 🩺",
    menuLabel: "Hekim Sor. (Malpraktis)", // Urun secim listesinde WhatsApp'in 24 karakter siniri var
    agentNumber: "905380711711", // Bahadır - elementer branş (Malpraktis)
    // Malpraktis musterilerine (hekimlere) sadece isimleriyle ve "Hocam" diye
    // hitap ediyoruz (soyisim olmadan), daha sicak ve meslege uygun bir ton icin.
    hitapHocam: true,
    // Tum bilgiler alindiktan sonra musteriye gonderilen ozet mesajinin altina
    // eklenen ek bir tanitim mesaji (capraz satis). Baska urunlerde de ayni
    // alani kullanarak benzer bir tanitim eklenebilir.
    crossSellMessage:
      "🩺 Bu arada, doktorlarımızın ülkemizde en yüksek vergi dilimlerinde yer aldığını biliyoruz. " +
      "Prim İadeli Hayat Sigortamız ile ödediğiniz primler ciddi bir vergi avantajı sağlıyor, üstelik " +
      "vade sonunda bir talebiniz olmazsa ödediğiniz primler aynen size geri iade ediliyor. 💰\n\n" +
      "Detaylı bilgi ve teklif için: https://www.wesigorta.com.tr/primiadeli/",
    advisors: DANISMANLAR,
    questions: [
      ...DANISMAN_SORULARI,
      {
        id: "ad_soyad",
        text: "İsim ve soyisminizi paylaşır mısınız?",
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text",
        sameAsAccountHolder: true
      },
      {
        id: "asistan_mi",
        text: "Asistan mısınız?",
        danismanText: "Sigortalı asistan mı?",
        type: "choice",
        options: ["Evet", "Hayır"]
      },
      {
        id: "uzman_mi",
        text: "Uzman mısınız?",
        danismanText: "Sigortalı uzman mı?",
        type: "choice",
        options: ["Evet", "Hayır"],
        // Asistansa zaten uzman degildir, bu soru gereksiz - atlanir.
        skipIf: (answers) => answers.asistan_mi === "Evet"
      },
      {
        id: "uzmanlik_dali",
        text: "Uzmanlık dalınızı belirtir misiniz?",
        danismanText: "Sigortalının uzmanlık dalını belirtir misiniz?",
        type: "text",
        // Asistan ya da uzmansa uzmanlik dali vardir; ikisi de degilse (tabip) sorulmaz.
        skipIf: (answers) => !(answers.asistan_mi === "Evet" || answers.uzman_mi === "Evet")
      },
      {
        id: "hasta_bakiyor_mu",
        text: "Aktif olarak hasta bakıyor musunuz?",
        danismanText: "Sigortalı aktif olarak hasta bakıyor mu?",
        type: "choice",
        options: ["Evet", "Hayır"]
      },
      {
        id: "yillik_hasta_sayisi",
        text: "Yıllık hasta sayınızı yaklaşık olarak söyler misiniz?",
        danismanText: "Sigortalının yıllık hasta sayısını yaklaşık olarak söyler misiniz?",
        type: "text",
        validate: pozitifSayiMi,
        validationError: "Lütfen hasta sayısını sadece rakamla yazar mısınız? (Örn: 500)",
        // Hasta bakmiyorsa (sadece idari gorevliyse) bu soru anlamsiz, atlanir.
        skipIf: (answers) => answers.hasta_bakiyor_mu === "Hayır"
      },
      {
        id: "is_adresi",
        text: "İş adresinizi (muayenehane/kurum) paylaşır mısınız?",
        danismanText: "Sigortalının iş adresini (muayenehane/kurum) paylaşır mısınız?",
        type: "text"
      },
      {
        id: "tescil_no",
        // Tescil turu ayrica sorulmuyor, uzman olup olmadigina gore otomatik belirleniyor:
        // uzmansa "uzmanlık tescil", degilse (asistan ya da tabip) "diploma tescil".
        text: (answers) =>
          answers.uzman_mi === "Evet"
            ? "Uzmanlık tescil numaranızı paylaşır mısınız?"
            : "Diploma tescil numaranızı paylaşır mısınız?",
        danismanText: (answers) =>
          answers.uzman_mi === "Evet"
            ? "Sigortalının uzmanlık tescil numarasını paylaşır mısınız?"
            : "Sigortalının diploma tescil numarasını paylaşır mısınız?",
        type: "text"
      },
      {
        id: "tescil_tarihi",
        text: "Tescil tarihinizi belirtir misiniz? (GG.AA.YYYY)",
        danismanText: "Sigortalının tescil tarihini belirtir misiniz? (GG.AA.YYYY)",
        type: "text",
        validate: tarihGecerliMi,
        validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.2015)"
      },
      {
        id: "sigorta_ettiren_turu",
        text: "Sigorta ettiren türünüz nedir?",
        danismanText: "Sigortalının sigorta ettiren türü nedir?",
        type: "choice",
        options: ["Serbest Çalışan", "Kamu Çalışanı"]
      },
      {
        id: "saglik_kurumu",
        text: "Bağlı olduğunuz sağlık kurumunu söyler misiniz?",
        danismanText: "Sigortalının bağlı olduğu sağlık kurumunu söyler misiniz?",
        type: "text"
      },
      { ...SEHIR_SORU },
      { ...TC_KIMLIK_SORU }
    ]
  }
};
