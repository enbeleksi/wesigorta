const { getSession, resetSession } = require("./sessionStore");
const { sendText, sendButtons, sendList, sendTemplate, mediaIndir } = require("./loggedWhatsapp");
const { ruhsatFotografiAnalizEt } = require("./ruhsatAnaliz");
const { garantiEmekliligeGonder } = require("./eposta");
const messageLog = require("./messageLog");
const leadStore = require("./leadStore");
const musteriProfilStore = require("./musteriProfilStore");
const sozlukSSS = require("./sozlukSSS");
const flows = require("./flows");
const { adSoyadGecerliMi } = require("./validators");
const { gunSelamlamasi } = require("./gunSelamlama");

// Enbel/Bahadır'in numaralari birden fazla yerde (guvenlik agi, not bildirimi,
// yeni elementer talep sonrasi aksiyon sorma) kullanildigi icin TEK YERDEN
// tanimlaniyor.
const ENBEL_NUMARASI = "905326876126";
const BAHADIR_NUMARASI = "905380711711";

// 27.07.2026 eklendi: yeni bir elementer talep bildiriminin hemen ardindan
// "Ne yapmak istersiniz?" sorusunu gostermek icin advisorEngine.js'deki
// danisman-oturum mantigina ihtiyac var, ama advisorEngine.js zaten BU
// dosyayi (conversationEngine.js) import ettigi icin tersi yonde bir
// require dongusel bagimliliga (ve eksik/undefined export'lara) yol acardi.
// Bunun yerine server.js (ikisini de import eden ust seviye), baslangicta
// yeniTalepAksiyonHookAyarla(...) ile advisorEngine.js'deki fonksiyonu
// buraya "enjekte" ediyor - bkz. finishFlow icindeki kullanim ve server.js.
let yeniTalepAksiyonHook = null;
function yeniTalepAksiyonHookAyarla(fn) {
  yeniTalepAksiyonHook = fn;
}

const PRODUCT_KEYS = Object.keys(flows);
// Urun secim listesinde WhatsApp'in 24 karakter siniri oldugu icin, uzun urun
// isimlerinde flows.js'deki kisa "menuLabel" kullanilir; yoksa tam "label" kullanilir.
// Ozet/bildirim mesajlarinda ise her zaman tam "label" kullanilmaya devam eder.
const PRODUCT_LABELS = PRODUCT_KEYS.map((k) => flows[k].menuLabel || flows[k].label);

// KVKK (Kisisel Verilerin Korunmasi Kanunu) onay metni. Musteriden herhangi bir
// kisisel veri (ad, TC kimlik no vb.) toplanmadan once bu onayin alinmasi gerekir.
const KVKK_METNI =
  "Bilgilerinizi işleyebilmemiz için önce kısa bir onayınıza ihtiyacımız var. 📄\n\n" +
  "6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında; paylaşacağınız isim-soyisim, " +
  "T.C. kimlik no, iletişim ve talep bilgileriniz yalnızca sigorta teklifi hazırlama ve sizinle " +
  "iletişime geçme amacıyla WE Sigorta Aracılığı Anonim Şirketi tarafından işlenecek, üçüncü kişilerle paylaşılmayacaktır.\n\n" +
  "Devam etmek için onayınızı bekliyoruz.";
const KVKK_SECENEKLERI = ["Kabul Ediyorum", "Kabul Etmiyorum"];

// q.text bazen sabit bir string, bazen de onceki cevaplara gore degisen bir
// fonksiyon olabilir ( (answers) => "soru metni" ). Ikisini de tek tip stringe cevirir.
function resolveText(question, answers) {
  return typeof question.text === "function" ? question.text(answers) : question.text;
}

// Danisman modunda (musteri adina yeni talep olustururken) kullanilan metni
// cozer. question.danismanText tanimliysa onu kullanir, tanimli degilse
// normal text'e (musteri modu) geri duser - cunku bazi sorular zaten notr/3.
// sahis oldugu icin ayrica yazmaya gerek yoktur.
function resolveDanismanText(question, answers) {
  if (question.danismanText) {
    return typeof question.danismanText === "function" ? question.danismanText(answers) : question.danismanText;
  }
  return resolveText(question, answers);
}

// Secenekli bir soruyu gonderir. WhatsApp buton mesajlari en fazla 3 secenek
// destekler, daha fazlasi icin liste (list) mesaji kullanilir.
async function sendChoiceQuestion(to, text, options) {
  if (options.length > 3) {
    await sendList(to, text, "Secin", options);
  } else {
    await sendButtons(to, text, options);
  }
}

// Turkce klavyesi olmayan kullanicilar bazen "Hayir" (Hayır yerine), "Kadin"
// (Kadın yerine) gibi Turkce karakter kullanmadan yazabilir. Karsilastirma
// yaparken bu farkliligi tolere etmek icin ozel karakterleri sadelestirir.
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

// Kullanicinin yazdigi metni bir secenekle esler. Tam esleseni tercih eder,
// bulamazsa "icinde geciyor mu" mantigiyla (orn. "Enbel Eksi" -> "Enbel",
// "Kadinim" -> "Kadin") esnek bir eslestirme dener. Turkce karakter
// farkliliklarini (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c) da tolere eder.
function matchOption(userText, options) {
  const normalized = normalizeTr(userText.trim());
  if (!normalized) return null;

  const exact = options.find((opt) => normalizeTr(opt) === normalized);
  if (exact) return exact;

  return (
    options.find(
      (opt) =>
        normalized.includes(normalizeTr(opt)) || normalizeTr(opt).includes(normalized)
    ) || null
  );
}

// Bazi sorular onceki cevaba gore atlanabilir (question.skipIf(answers) => true/false),
// bazilari da onceden zaten cevaplanmis olabilir (orn. isim zaten alinmissa "ad_soyad"
// sorusu tekrar sorulmaz). Verilen index'ten baslayarak atlanmasi gereken sorular
// varsa ileri kaydirir.
function nextValidIndex(flow, answers, fromIndex) {
  let idx = fromIndex;
  while (idx < flow.questions.length) {
    const q = flow.questions[idx];
    const skippedByRule = q.skipIf && q.skipIf(answers);
    const alreadyAnswered = Object.prototype.hasOwnProperty.call(answers, q.id) && answers[q.id];
    if (!skippedByRule && !alreadyAnswered) break;
    idx += 1;
  }
  return idx;
}

// Bir urunun soru akisini baslatir. Musterinin adi zaten biliniyorsa (session.name)
// ve o urunun ad_soyad sorusu hesap sahibinin kendi adini soruyorsa (sameAsAccountHolder),
// bu soruyu tekrar sormadan otomatik doldurur. Urunun "intro" metni varsa,
// direkt soru sormaya baslamadan once kisa bir tanitim mesaji gonderir - ancak
// QR ile giriste (skipIntro=true) bu atlanir, cunku o zaten kendi karsilama
// mesajini (qrGreeting) gostermis oluyor.
// "hayat" ve "bes" icin, eskiden burada kisa/hafif bir "teklif" sorusu
// dizisi (flows.js'teki questions) calisirdi - artik bunun yerine
// advisorEngine.js'deki TAM satis kaydi akisini (TC kimlik, prim/katkı payı
// tutarı, belgeler, aranma tarihi/saati vb.) musterinin kendisi icin
// baslatiyoruz, boylece musteri araya bir danisman girmeden dogrudan satis
// talebinde bulunabiliyor. advisorEngine.js da bu dosyayi (conversationEngine)
// modul-seviyesinde require ettigi icin, dairesel bagimliliga (require
// dongusune) girmemek adina advisorEngine'i BURADA, fonksiyon icinde ve
// SADECE ihtiyac aninda require ediyoruz (Node bu noktada her iki modul de
// tam yuklenmis oldugu icin guvenli calisir - modul-seviyesinde yapilsaydi
// yarim yuklenmis/bos bir exports nesnesi yakalanirdi).
const MUSTERI_SATIS_URUN_TIPLERI = { hayat: "hayat", bes: "bes_yeni_is" };

// Bir urunun soru akisini baslatir. Musterinin adi zaten biliniyorsa (session.name)
// ve o urunun ad_soyad sorusu hesap sahibinin kendi adini soruyorsa (sameAsAccountHolder),
// bu soruyu tekrar sormadan otomatik doldurur. Urunun "intro" metni varsa,
// direkt soru sormaya baslamadan once kisa bir tanitim mesaji gonderir - ancak
// QR ile giriste (skipIntro=true) bu atlanir, cunku o zaten kendi karsilama
// mesajini (qrGreeting) gostermis oluyor.
// Donus degeri: true ise cagiran taraf askCurrentQuestion'i AYRICA
// COGIRMAMALI - advisorEngine'e devredilen bir akista ilk soru zaten
// gonderilmis oluyor.
async function startProductFlow(from, session, productKey, { skipIntro = false } = {}) {
  if (MUSTERI_SATIS_URUN_TIPLERI[productKey]) {
    const advisorEngine = require("./advisorEngine");
    await advisorEngine.musteriSatisBaslat(from, session, MUSTERI_SATIS_URUN_TIPLERI[productKey]);
    return true;
  }

  const flow = flows[productKey];
  session.product = productKey;
  session.answers = {};

  const adSoyadQuestion = flow.questions.find((q) => q.id === "ad_soyad");
  if (session.name && adSoyadQuestion && adSoyadQuestion.sameAsAccountHolder) {
    session.answers.ad_soyad = session.name;
  }

  // Musterinin KENDI T.C. kimlik numarasi (arac/ruhsat sahibi TC'si DEGIL -
  // sadece question.kaliciProfilAlani === "tcKimlik" ile isaretli bare soru,
  // bkz. flows.js ve musteriProfilStore.js'deki aciklamalar) daha once kalici
  // profile kaydedilmisse, bu urunde de ayni tur soru varsa tekrar sormadan
  // onceden dolduruyoruz.
  const kaliciProfil = musteriProfilStore.profilGetir(from);
  const tcKimlikSorusu = flow.questions.find((q) => q.kaliciProfilAlani === "tcKimlik");
  if (kaliciProfil && kaliciProfil.tcKimlik && tcKimlikSorusu) {
    session.answers[tcKimlikSorusu.id] = kaliciProfil.tcKimlik;
  }

  session.questionIndex = nextValidIndex(flow, session.answers, 0);
  session.state = "ASKING";

  if (flow.intro && !skipIntro) {
    await sendText(from, flow.intro);
  }
  return false;
}

// Yeni bir konusma baslatir (KVKK oncesi karsilama). QR kodundan gelen hazir
// mesajlardan biriyle eslesiyor mu diye bakar (orn. "Merhaba, acil dask
// yaptirmak istiyorum."), eslesirse o urune ozel sicak karsilamayi gonderir.
// Bu fonksiyon NEW durumunda oldugu kadar, DONE/default durumlarindan sifirlanan
// bir oturumda da cagrilir - boylece daha once bizimle konusmus/tamamlamis bir
// musteri QR okutup tekrar geldiginde de dogru QR muamelesini gorur.
// oncekiIsim: eger musteri daha once bizimle konusup ismini vermisse (DONE'dan
// sifirlanan bir oturumda), o ismi biliyoruz demektir - varsa dogrudan ismiyle
// hitap ederek karsilariz.
async function baslaYeniKonusma(from, session, userText, oncekiIsim) {
  const matchedKey = PRODUCT_KEYS.find(
    (key) => flows[key].qrTrigger && flows[key].qrTrigger.test(userText)
  );

  // oncekiIsim parametre olarak verilmediyse (orn. sunucu yeniden basladiktan
  // sonra, uzun bir aradan sonra, ya da "iptal" sonrasi TAMAMEN yeni/bos bir
  // session'da), kalici musteri profiline (musteriProfilStore) bakariz - orada
  // bir isim kayitliysa bu musteri bizimle DAHA ONCE (gunler/haftalar once de
  // olsa) konusmus demektir.
  const kaliciProfil = musteriProfilStore.profilGetir(from);
  const bilinenIsim = oncekiIsim || (kaliciProfil && kaliciProfil.adSoyad) || null;
  const ilkAd = bilinenIsim ? bilinenIsim.trim().split(/\s+/)[0] : null;

  // Ismi zaten biliyorsak (donen musteri), session.name'i simdiden dolduruyoruz.
  // Bu sayede hem KVKK sonrasi tekrar isim sorulmaz, hem de QR akisinda urunun
  // kendi "ad_soyad" sorusu (sameAsAccountHolder ile) otomatik atlanir.
  if (bilinenIsim) {
    session.name = bilinenIsim;
  }

  if (matchedKey) {
    session.pendingProduct = matchedKey;
    await sendText(from, flows[matchedKey].qrGreeting);
  } else if (ilkAd) {
    // Musteriyi kayitli ismiyle karsiliyoruz - ama bu telefon numarasinin hala
    // GERCEKTEN ayni kisiye ait oldugundan emin degiliz (el degistirmis
    // olabilir). isimTeyitBekleniyor bayragini isaretliyoruz: handleIncoming
    // bu karsilamadan HEMEN SONRAKI ilk mesajda musteri "ben ... degilim" gibi
    // bir sey soylerse, kalici kaydi silip musteriyi yeni musteri gibi
    // ele alacak (bkz. handleIncoming basindaki kontrol).
    session.isimTeyitBekleniyor = true;
    await sendText(
      from,
      `${gunSelamlamasi()} ${ilkAd}! 😊 Yeni bir sigorta teklif talebiniz için bizi tekrar tercih ettiğiniz için teşekkür ederiz. Size nasıl yardımcı olabiliriz?`
    );
  } else {
    await sendText(
      from,
      `${gunSelamlamasi()}! 😊 WE Sigorta ailesine hoş geldiniz! Sizinle tanışmak ve size en uygun teklifi hazırlamak için sabırsızlanıyoruz. 🎉`
    );
  }

  // KVKK onayi bu musteriden (bu telefon numarasindan) DAHA ONCE zaten
  // alinmis ve kalici profile kaydedilmisse, ayni onayi tekrar tekrar sormaya
  // gerek yok - dogrudan isim/urun akisina geciyoruz.
  if (kaliciProfil && kaliciProfil.kvkkOnayVerildi) {
    await kvkkSonrasiDevamEt(from, session);
    return;
  }

  await sendChoiceQuestion(from, KVKK_METNI, KVKK_SECENEKLERI);
  session.state = "KVKK_CONSENT";
}

// KVKK onayindan hemen sonra (ya da onay bu musteriden daha once zaten
// alinmis oldugu icin baslaYeniKonusma tarafindan dogrudan) yapilacak
// yonlendirmeyi tek bir yerde toplar: QR'dan bekleyen bir urun varsa onun
// sorularina, ismi zaten biliniyorsa direkt urun secimine, hicbiri yoksa
// normal isim sorma adimina gecer.
async function kvkkSonrasiDevamEt(from, session) {
  if (session.pendingProduct) {
    const key = session.pendingProduct;
    session.pendingProduct = null;
    const devredildi = await startProductFlow(from, session, key, { skipIntro: true });
    if (!devredildi) await askCurrentQuestion(from, session);
  } else if (session.name) {
    session.state = "ASK_PRODUCT";
    await sendList(
      from,
      `Hangi sigorta ürünü için teklif almak istersiniz?`,
      "Ürün Seç",
      PRODUCT_LABELS
    );
  } else {
    session.state = "ASK_NAME";
    await sendText(from, "Teşekkürler! 😊 Size hitap edebilmek adına isminizi ve soyisminizi öğrenebilir miyim?");
  }
}

// Musteri "ismim Mahmut Yildirim", "İsmim Mahmut Yildirim" ya da "adim Mahmut
// Yildirim" gibi yazarsa, basindaki bu tanitim kelimelerini temizleyip sadece
// ismi birakir. Turkce buyuk "İ" harfi standart regex /i bayragiyla duzgun
// eslesmedigi icin (bilinen bir JS/Turkce sorunu), normalizeTr ile once
// karsilastirma yapip, ayni uzunluktaki kismi orijinal metinden kesiyoruz
// (normalizeTr karakterleri 1'e 1 degistirir, uzunluk/konum bozulmaz).
function isimCevabiniTemizle(text) {
  const trimmed = text.trim();
  const normalized = normalizeTr(trimmed);
  const eslesme = normalized.match(/^(benim\s+)?(ismim|adim)\s*[:,]?\s*/);
  if (eslesme) {
    const kalan = trimmed.slice(eslesme[0].length).trim();
    return kalan || trimmed;
  }
  return trimmed;
}

// Acente bildirimlerinde soru metni yerine kullanilan kisa, okunakli etiketler.
// Tam soru cumlesi ("Binanın toplam kaç kattan oluştuğunu belirtir misiniz?")
// yerine kisa etiket ("Kat Sayısı") kullanmak, tek bir sablon degiskenine
// sigdirmamiz gereken metni (1024 karakter siniri var) ciddi olcude kisaltir.
const ID_KISA_ETIKET = {
  danisman_gorustu_mu: "Danışmanla Görüştü mü",
  danisman_adi: "Danışman",
  ad_soyad: "İsim Soyisim",
  mulkiyet_durumu: "Mülkiyet",
  police_kimin_uzerine: "Poliçe Kimin Üzerine",
  daini_murtehin: "Dain-i Mürtehin",
  adres: "Adres",
  yuz_olcumu: "Yüz Ölçümü (m²)",
  insaat_yili: "İnşaat Yılı",
  bina_kat_sayisi: "Bina Kat Sayısı",
  dairenin_bulundugu_kat: "Daire Katı",
  meslek: "Meslek",
  tc_kimlik: "TC",
  kasko_durumu: "Kasko Durumu",
  arac_fotograflari: "Araç Fotoğrafları",
  plaka: "Plaka",
  ruhsat_seri_no: "Ruhsat Seri No",
  sehir: "Şehir",
  kimin_icin: "Kimin İçin",
  dogum_tarihi: "Doğum Tarihi",
  cinsiyet: "Cinsiyet",
  boy_kilo: "Boy/Kilo",
  il_ilce: "İl/İlçe",
  yas: "Yaş",
  bes_var_mi: "BES Var mı",
  bes_sirket: "BES Şirket",
  bes_birikim: "BES Birikim",
  uzmanlik_dali: "Uzmanlık Dalı",
  uzman_mi: "Uzman mı",
  is_adresi: "İş Adresi",
  hasta_bakiyor_mu: "Hasta Bakıyor mu",
  yillik_hasta_sayisi: "Yıllık Hasta Sayısı",
  tescil_no: "Tescil No",
  tescil_tarihi: "Tescil Tarihi",
  asistan_mi: "Asistan mı",
  sigorta_ettiren_turu: "Sigorta Ettiren",
  saglik_kurumu: "Sağlık Kurumu"
};

// Danismana WhatsApp sablonu icinde (tek bir degiskene sigacak sekilde) gonderilecek
// kompakt ozet metnini olusturur. Satir arasi degil " • " ile ayrilir, cunku sablon
// degiskenlerinde alt satira gecme karakteri sorun cikarabiliyor.
// Bir cevabi okunabilir metne cevirir. Coklu fotograf sorularinda cevap bir
// dizi (foto nesneleri) oldugu icin, ham degeri yazdirmak yerine "X fotoğraf
// eklendi" gibi kisa bir aciklama doner.
function cevabiMetneCevir(deger) {
  if (Array.isArray(deger)) {
    return deger.length > 0 ? `${deger.length} fotoğraf eklendi 📸` : "(fotoğraf eklenmedi)";
  }
  return deger;
}

function kompaktDetayOlustur(flow, session, telefon) {
  const askedQuestions = flow.questions.filter((q) => !(q.skipIf && q.skipIf(session.answers)));
  const alanlar = askedQuestions.map((q) => {
    const etiket = ID_KISA_ETIKET[q.id] || q.id;
    return `${etiket}: ${cevabiMetneCevir(session.answers[q.id])}`;
  });
  return (
    `${flow.label} • Müşteri: ${session.name} • Telefon: ${telefon} • ` + alanlar.join(" • ")
  );
}

// Bir danismana/acenteye bildirim gonderir. Uc katmanli calisir:
// 1) Eger Railway'de AGENT_DETAY_TEMPLATE_NAME ayarlanmissa (tek degiskenli,
//    tum detaylari iceren onaylanmis bir sablon), once onu dener - basariliysa
//    danisman TUM bilgiyi WhatsApp'ta gorur, panele bakmasina gerek kalmaz.
//    Basarili olursa BURADA DURULUR - ayrica baska bir mesaj gonderilmez,
//    cunku tum bilgi zaten bu tek mesajda var (gereksiz tekrari onlemek icin).
// 2) O basarisiz olursa ya da ayarlanmamissa, AGENT_TEMPLATE_NAME (kisa,
//    3 degiskenli eski sablon) varsa onu dener - sadece temel bilgiyi iletir.
// 3) Ayrica (yalnizca 1. adim basarisiz olduysa) detayli metni normal metin
//    olarak da gondermeyi dener - pencere acik ise ekstra bir kopya daha ulasir.
async function bildirimGonder(numara, urunAdi, musteriAdi, telefon, detayliMetin, kompaktDetay, danismanAdi) {
  const detayliSablonAdi = process.env.AGENT_DETAY_TEMPLATE_NAME;
  const kisaSablonAdi = process.env.AGENT_TEMPLATE_NAME;

  if (detayliSablonAdi && kompaktDetay) {
    try {
      await sendTemplate(numara, detayliSablonAdi, "tr", { detay: sablonParametresiIcinTemizle(kompaktDetay) }, detayliMetin);
      return; // basarili - tum detay zaten iletildi, baska mesaj gondermeye gerek yok
    } catch (err) {
      console.error("Detayli sablon bildirimi gonderilemedi:", err?.response?.data || err.message);
    }
  }

  if (kisaSablonAdi) {
    const kisaOzet =
      `🔔 Yeni bir ${urunAdi} talebi geldi.\n\n` +
      `Müşteri: ${musteriAdi}\n` +
      `Telefon: ${telefon}\n` +
      (danismanAdi ? `Danışman: ${danismanAdi}\n` : "") +
      `\nDetaylı bilgileri panelden görüntüleyebilirsiniz.`;
    try {
      await sendTemplate(
        numara,
        kisaSablonAdi,
        "tr",
        { urun_adi: urunAdi, musteri_adi: musteriAdi, telefon: telefon },
        kisaOzet
      );
    } catch (err) {
      console.error("Sablon bildirimi gonderilemedi:", err?.response?.data || err.message);
    }
  }

  try {
    await sendText(numara, detayliMetin);
  } catch (err) {
    console.error("Detayli bildirim mesaji gonderilemedi:", err?.response?.data || err.message);
  }
}

// 1) Musteri belirli bir danismanla gorustugunu soyleduyse (flows.js'deki
//    "advisors" listesiyle eslesirse), o danismana gider.
// 2) Yoksa, urune ozel bir numara (flows.js icindeki agentNumber) var mi bak.
// 3) O da yoksa/placeholder ise genel AGENT_WHATSAPP_NUMBER'a duser.
function resolveAgentNumber(flow, session) {
  const isPlaceholder = (num) => !num || /X/i.test(num);

  if (flow) {
    const chosenAdvisor =
      flow.advisors && session.answers && session.answers.danisman_adi
        ? flow.advisors.find((a) => a.name === session.answers.danisman_adi)
        : null;
    if (chosenAdvisor) return chosenAdvisor.number;
    if (!isPlaceholder(flow.agentNumber)) return flow.agentNumber;
  }

  return process.env.AGENT_WHATSAPP_NUMBER;
}

// Kullanicidan gelen bir mesaji (metin veya interaktif secim) isler.
// message = { type: "text" | "interactive", text?, interactiveId?, interactiveTitle? }
async function handleIncoming(from, message) {
  const session = getSession(from);
  const previousUpdatedAt = session.updatedAt;
  session.updatedAt = Date.now();

  const userText =
    message.type === "interactive" ? message.interactiveTitle : (message.text || "").trim();

  // Gelen mesaji panelde gorunmesi icin kaydet
  messageLog.logMessage(from, "in", userText);
  if (session.name) {
    messageLog.setName(from, session.name);
  }

  // Bot duraklatilmissa (temsilci devraldiysa) hicbir otomatik islem yapma,
  // sadece mesaji panelde gorunecek sekilde kaydet ve cik.
  if (session.paused) {
    return;
  }

  // Musteriyi kayitli ismiyle karsiladiktan HEMEN SONRAKI ilk mesajinda,
  // musteri "ben Ahmet Yılmaz değilim" gibi bir seyle bu ismin kendisine ait
  // OLMADIGINI belirtirse (telefon numarasi el degistirmis olabilir), o
  // numaraya ait TUM kalici kaydi (musteriProfilStore) ve mevcut oturumu
  // silip, hicbir sey bilmiyormus gibi sifirdan yeni bir musteri olarak
  // karsiliyoruz. Eslesmezse (musteri normal sekilde devam ettiyse) bayragi
  // sessizce temizleyip islemeye devam ediyoruz - bu kontrol SADECE
  // karsilamadan hemen sonraki ilk mesaj icin gecerlidir.
  if (session.isimTeyitBekleniyor) {
    session.isimTeyitBekleniyor = false;
    const KIMLIK_INKAR_KELIMELERI = ["degilim", "yanlis numara", "farkli biriyim", "baska biriyim", "baskasiyim"];
    const normalizedIdentityText = normalizeTr(userText);
    const kimlikInkarEdiliyorMu = KIMLIK_INKAR_KELIMELERI.some((k) => normalizedIdentityText.includes(k));
    if (kimlikInkarEdiliyorMu) {
      musteriProfilStore.profilSil(from);
      resetSession(from);
      await sendText(
        from,
        "Özür dileriz, karışıklığa mahal verdiğimiz için teşekkürler! 🙏"
      );
      await baslaYeniKonusma(from, getSession(from), userText);
      return;
    }
  }

  // Musteri kendi kendine satis talebi akisindaysa (startProductFlow'un
  // "hayat"/"bes" icin advisorEngine'e devrettigi durum - bkz. o dosyadaki
  // musteriSatisBaslat), BUNDAN SONRAKI TUM mesajlari (metin/interaktif/
  // fotograf, "geri al" dahil) advisorEngine'in kendi soru-cevap motoruna
  // devrediyoruz - o motor zaten bu durumu (MUSTERI_SATIS_SORU) tamamen
  // kendi icinde yonetiyor, burada tekrar bir mantik kurmuyoruz. Lazy
  // require (yorumdaki dairesel bagimlilik notuna bkz. startProductFlow).
  if (session.state === "MUSTERI_SATIS_SORU") {
    const advisorEngine = require("./advisorEngine");
    await advisorEngine.handleAdvisorMessage(from, message);
    return;
  }

  // Musteri bir fotograf/belge gonderdiyse: su anki soru "coklu_foto" tipindeyse
  // (orn. kasko arac fotograflari) ya da "fotoIleAlinabilir" ozelligine
  // sahipse (orn. ruhsat seri no) kabul edilir, aksi halde nazikce "su an
  // fotograf beklemiyoruz" denir.
  if (message.type === "media") {
    const flow = session.product ? flows[session.product] : null;
    const currentQuestion = session.state === "ASKING" && flow ? flow.questions[session.questionIndex] : null;
    const fotoKabulEdilir =
      currentQuestion && (currentQuestion.type === "coklu_foto" || currentQuestion.fotoIleAlinabilir);

    if (!fotoKabulEdilir) {
      await sendText(
        from,
        "Şu an bir fotoğraf beklemiyoruz, iletmek istediğiniz bilgiyi yazılı olarak paylaşabilir misiniz? 🙏"
      );
      return;
    }

    if (!message.mimeType || !message.mimeType.startsWith("image/")) {
      await sendText(from, "Lütfen sadece fotoğraf gönderin (belge/PDF değil).");
      return;
    }

    // --- Ruhsat foto analizi (Claude gorsel analiziyle seri no okuma) ---
    if (currentQuestion.fotoIleAlinabilir) {
      try {
        const { buffer, mimeType } = await mediaIndir(message.mediaId);
        await sendText(from, "Fotoğrafınızı inceliyorum, bir saniye... 🔍");
        const sonuc = await ruhsatFotografiAnalizEt(buffer, message.mimeType || mimeType);

        if (sonuc.okunabilir && sonuc.seriNo && currentQuestion.validate(sonuc.seriNo)) {
          session.answers[currentQuestion.id] = sonuc.seriNo.toUpperCase();
          // Fotografin kendisini de saklayip, talep olusunca belge olarak ekleyecegiz
          // (danisman gerekirse gozle de kontrol edebilsin diye).
          if (!session.ekBelgeler) session.ekBelgeler = [];
          session.ekBelgeler.push({
            dosyaAdi: "ruhsat.jpg",
            mimeType: message.mimeType || mimeType,
            veriBase64: buffer.toString("base64")
          });
          await sendText(from, `Ruhsat seri numaranızı *${sonuc.seriNo.toUpperCase()}* olarak okudum ✅`);
          session.questionIndex = nextValidIndex(flow, session.answers, session.questionIndex + 1);
          if (session.questionIndex >= flow.questions.length) {
            await finishFlow(from, session);
          } else {
            await askCurrentQuestion(from, session);
          }
        } else {
          await sendText(
            from,
            `Fotoğrafı net okuyamadım 😕 ${sonuc.aciklama || ""}\n\n` +
              "Ruhsatın sağ alt köşesindeki seri numarasının tamamı görünecek şekilde, iyi ışıkta tekrar bir " +
              "fotoğraf çeker misiniz? İsterseniz seri numarasını yazarak da girebilirsiniz."
          );
        }
      } catch (err) {
        console.error("Ruhsat foto analizi hatasi:", err?.response?.data || err.message);
        await sendText(
          from,
          "Fotoğrafı analiz ederken bir sorun oluştu 🙏 Lütfen tekrar deneyin, ya da seri numarasını yazarak girebilirsiniz."
        );
      }
      return;
    }

    // --- Coklu fotograf toplama (orn. kasko arac fotograflari) ---
    try {
      const { buffer, mimeType } = await mediaIndir(message.mediaId);
      if (!session.answers[currentQuestion.id]) session.answers[currentQuestion.id] = [];
      session.answers[currentQuestion.id].push({
        dosyaAdi: message.dosyaAdi || `foto_${session.answers[currentQuestion.id].length + 1}.jpg`,
        mimeType: message.mimeType || mimeType,
        veriBase64: buffer.toString("base64")
      });
      const sayi = session.answers[currentQuestion.id].length;
      await sendText(
        from,
        `📸 Fotoğraf alındı (${sayi}. fotoğraf). Başka fotoğraf gönderebilirsiniz, bitirdiyseniz "tamam" yazabilirsiniz.`
      );
    } catch (err) {
      console.error("Foto indirilemedi:", err?.response?.data || err.message);
      await sendText(from, "Fotoğrafı kaydederken bir sorun oluştu, tekrar gönderir misiniz?");
    }
    return;
  }

  // Müşteri istediği an "temsilci" ya da "insan" yazarak her zaman bir
  // insanla görüşmek isteyebilir - bunlar acik bir kacis kelimesi oldugu icin
  // her baglamda gecerlidir. "Danışman"/"sigortacı" kelimeleri de ayni
  // yonlendirmeyi tetikler, ANCAK "Daha once bir danismanla gorustunuz mu?"
  // ve "Hangi danismanimizla gorustunuz?" sorularinin cevabinda bu kelimeler
  // dogal olarak gecebildigi icin, o iki soruda bu kelimeler devre disi
  // birakilir (cevap normal sekilde islensin diye).
  const INSAN_YONLENDIRME_HER_ZAMAN = ["temsilci", "insan", "musteri temsil"];
  const INSAN_YONLENDIRME_BAGLAMSAL = ["danisman", "sigortaci"];

  const currentFlow = session.product ? flows[session.product] : null;
  const currentQuestionId =
    session.state === "ASKING" && currentFlow ? currentFlow.questions[session.questionIndex]?.id : null;
  const danismanSorusundaMiyiz =
    currentQuestionId === "danisman_gorustu_mu" || currentQuestionId === "danisman_adi";

  const normalizedUserText = normalizeTr(userText);
  const insanaYonlendirmeGerekiyorMu =
    INSAN_YONLENDIRME_HER_ZAMAN.some((k) => normalizedUserText.includes(k)) ||
    (!danismanSorusundaMiyiz && INSAN_YONLENDIRME_BAGLAMSAL.some((k) => normalizedUserText.includes(k)));

  if (insanaYonlendirmeGerekiyorMu) {
    session.paused = true;
    await sendText(
      from,
      "Sigorta danışmanınızla görüşme talebinizi kendisine ilettim. Sigorta danışmanlarımız yoğunluk durumuna göre en kısa sürede size dönüş yapacaktır. 🙏"
    );

    const flow = session.product ? flows[session.product] : null;
    const agentNumber = resolveAgentNumber(flow, session);
    if (agentNumber) {
      const notifyMessage =
        `\u{1F514} Musterinin sizinle gorusme talebi var\n` +
        `Musteri: ${session.name || "(isim henuz alinmadi)"}\n` +
        `Telefon: ${from}` +
        (flow ? `\nUrun: ${flow.label}` : "");
      await bildirimGonder(
        agentNumber,
        flow ? flow.label : "genel",
        session.name || "(isim henuz alinmadi)",
        from,
        notifyMessage
      );
    }

    // 26.07.2026 eklemesi: "temsilci" talebi eskiden panelde HİÇBİR iz
    // bırakmıyordu - sadece bir WhatsApp bildirimi gidiyordu, o mesaj
    // kaçırılırsa/gözden kaçarsa hiçbir yerde kaydı kalmıyordu. Artık tam
    // bilgi toplanmış taleplerle AYNI şekilde bir "talep" (lead) olarak da
    // paneldeki Talepler listesine düşüyor - böylece danışman/ekip panelden
    // de görüp durumunu (Açık/Olumlu/Olumsuz) takip edebiliyor, gerekirse
    // hatırlatma kurabiliyor.
    const atananDanisman = flow && flow.advisors && flow.advisors.find((a) => a.number === agentNumber);
    leadStore.yeniLeadOlustur({
      telefon: from,
      musteriAdi: session.name || "(isim henüz alınmadı)",
      urun: flow ? flow.label : "Genel (ürün seçilmemiş)",
      danismanAdi: atananDanisman ? atananDanisman.name : null,
      danismanNumarasi: agentNumber || null,
      ozet: 'Müşteri bir insanla görüşmek istedi ("temsilci" talebi).'
    });

    return;
  }

  // Musteri konusmanin herhangi bir asamasinda "WE Sigorta kimdir/nedir" ya da
  // "adresiniz nedir" gibi bir soru sorarsa, akisi bozmadan cevap veririz ve
  // (eger bir soru bekleniyorsa) o soruyu tekrar hatirlatiriz.
  const SIRKET_ANAHTAR_KELIMELER = [
    "kimdir",
    "kimsiniz",
    "hakkinizda",
    "hakkinda bilgi",
    "ne is yapiyorsunuz",
    "ne isle ugras",
    "firma hakkinda",
    "sirket hakkinda"
  ];
  const ADRES_ANAHTAR_KELIMELER = [
    "adresiniz",
    "neredesiniz",
    "konumunuz",
    "nerede bulunuyorsunuz",
    "ofisiniz nerede",
    "lokasyonunuz"
  ];

  const sirketSorusuMu = SIRKET_ANAHTAR_KELIMELER.some((k) => normalizedUserText.includes(k));
  const adresSorusuMu = ADRES_ANAHTAR_KELIMELER.some((k) => normalizedUserText.includes(k));

  if (sirketSorusuMu || adresSorusuMu) {
    if (sirketSorusuMu) {
      await sendText(
        from,
        "WE Sigorta, Ekşi Group'un 50 yılı aşkın deneyiminden güç alarak 2020 yılında Eskişehir'de kuruldu. 🏢\n\n" +
          "İnşaat, otomotiv, akaryakıt, hukuk ve tarım gibi alanlarda yarım asırdır faaliyet gösteren Ekşi Group'un güvenilirlik ve yenilikçilik mirasını sigortacılığa taşıyoruz.\n\n" +
          "10 yılı aşkın deneyimli, profesyonel ekibimizle hem sigorta hem Bireysel Emeklilik (BES) alanında hızlı, şeffaf ve güvenilir hizmet sunuyoruz. 😊"
      );
    }
    if (adresSorusuMu) {
      await sendText(from, "Adresimize buradan ulaşabilirsiniz: https://maps.app.goo.gl/TUD5pfWHQijNWetJA 📍");
    }
    // Bir soru bekleniyorsa (ASKING asamasindaysak), kaldigi yerden devam
    // edebilsin diye o soruyu nazikce tekrar hatirlatiyoruz.
    if (session.state === "ASKING") {
      await askCurrentQuestion(from, session);
    }
    return;
  }

  // Musteri sigortacilikla ilgili bir terimin ya da sundugumuz urunlerden
  // birinin ne oldugunu sorarsa (orn. "muafiyet nedir?", "kasko nedir?"),
  // akisi bozmadan kisa bir aciklama veririz - yukaridaki SIRKET/ADRES
  // kontrolleriyle AYNI davranis deseni. sozlukSSS.js'deki soru-kalibi sarti
  // sayesinde, musteri urun secim listesinde sadece urun adini SECMEK icin
  // yazdiginda (orn. ASK_PRODUCT asamasinda "Kasko Sigortası") bu
  // YANLISLIKLA bir SSS cevabina donusmez.
  const sssCevabi = sozlukSSS.sssCevabiBul(userText);
  if (sssCevabi) {
    await sendText(from, sssCevabi);
    if (session.state === "ASKING") {
      await askCurrentQuestion(from, session);
    }
    return;
  }

  // Kullanıcı her an "iptal" yazarak sıfırlayabilsin
  if (/^iptal$/i.test(userText)) {
    resetSession(from);
    await sendText(from, "Talebiniz iptal edildi. Yeni bir talep için istediğiniz zaman yazabilirsiniz. 😊");
    return;
  }

  // Musteri 1 saatten uzun sure sessiz kaldiktan sonra devam eden aktif bir
  // konusmaya geri donuyorsa, kaldigi soruyu tekrar sormadan once kisa bir
  // hatirlatma mesaji gonderelim (nereden devam ettigini hatirlamasi icin).
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const isReturningAfterGap =
    previousUpdatedAt &&
    Date.now() - previousUpdatedAt > ONE_HOUR_MS &&
    session.state !== "NEW" &&
    session.state !== "DONE" &&
    session.state !== "KVKK_CONSENT";

  if (isReturningAfterGap) {
    // NOT: buradaki kucuk harfe cevirmede JS'in locale-farkinda OLMAYAN
    // .toLowerCase()'i KULLANILMAZ - "İyi geceler".toLowerCase() Turkce
    // kurallarina gore "iyi" degil, hatali "i̇yi" (fazladan noktali bilesik
    // karakter) uretir. .toLocaleLowerCase("tr") Turkce İ/I harflerini doğru
    // sekilde kucuk i/ı'ya cevirir.
    await sendText(from, `Tekrar ${gunSelamlamasi().toLocaleLowerCase("tr")}! 😊 Kaldığımız yerden devam edelim.`);
  }

  switch (session.state) {
    case "NEW": {
      await baslaYeniKonusma(from, session, userText);
      break;
    }

    case "KVKK_CONSENT": {
      const validOption = matchOption(userText, KVKK_SECENEKLERI);
      if (!validOption) {
        await sendChoiceQuestion(from, KVKK_METNI, KVKK_SECENEKLERI);
        break;
      }

      if (validOption === "Kabul Etmiyorum") {
        await sendText(
          from,
          "Anlıyoruz. Kişisel verilerinizi işleyebilmemiz için onayınıza ihtiyacımız olduğundan şu an devam edemiyoruz. " +
            "Fikrinizi değiştirirseniz istediğiniz zaman tekrar yazabilirsiniz. 🙏"
        );
        resetSession(from);
        break;
      }

      // "Kabul Ediyorum": bu onayi kalici profile kaydediyoruz ki ayni
      // musteriden bir daha ASLA KVKK onayi istemeyelim. Ardindan QR'dan
      // gelen bir urun bekliyorsak direkt onun sorularina, ismi zaten
      // biliyorsak (donen musteri) direkt urun secimine, hicbiri yoksa normal
      // isim sorma adimina geciyoruz (bkz. kvkkSonrasiDevamEt).
      musteriProfilStore.kvkkOnayVer(from);
      await kvkkSonrasiDevamEt(from, session);
      break;
    }

    case "ASK_NAME": {
      const temizlenmisIsim = isimCevabiniTemizle(userText);
      // 27.07.2026 eklendi: bu asamada gelen metin dogrudan isim olarak
      // kaydediliyordu - eskiden/farkli bir akistan kalan, ASK_NAME'de takili
      // kalmis bir oturuma "Merhaba" gibi bir selamlama gelirse bu kelime
      // aynen isim gibi kaydediliyordu ("Teşekkürler Merhaba!"). adSoyadGecerliMi
      // en az iki kelimeden olusan makul bir isim-soyisim bekliyor - tek
      // kelimelik selamlama/dolgu kelimeleri bu kontrolden gecemez, soru tekrar
      // sorulur.
      if (!adSoyadGecerliMi(temizlenmisIsim)) {
        await sendText(
          from,
          "Hmm, bunu bir isim-soyisim olarak anlayamadım 🙂 Lütfen adınızı ve soyadınızı yazar mısınız? (örn: Ahmet Yılmaz)"
        );
        break;
      }
      session.name = temizlenmisIsim;
      // Ismi kalici profile de kaydediyoruz - boylece bu musteri gunler/haftalar
      // sonra tekrar yazdiginda (oturum tamamen sifirlanmis olsa bile) ismiyle
      // karsilanir ve isim tekrar sorulmaz.
      musteriProfilStore.profilGuncelle(from, { adSoyad: session.name });
      session.state = "ASK_PRODUCT";
      await sendList(
        from,
        `Teşekkürler ${session.name}! Hangi sigorta ürünü için teklif almak istersiniz?`,
        "Ürün Seç",
        PRODUCT_LABELS
      );
      break;
    }

    case "ASK_PRODUCT": {
      // WhatsApp liste mesajlarinda secenekler 24 karakterle sinirli, uzun urun
      // isimleri (orn. "Prim Iadeli Hayat Sigortasi") kesilerek geri donebiliyor.
      // Bu yuzden tam eslesme yerine matchOption'in esnek/on-ek toleransli
      // eslestirmesini kullaniyoruz.
      const matchedLabel = matchOption(userText, PRODUCT_LABELS);
      if (!matchedLabel) {
        await sendList(
          from,
          "Üzgünüm, listeden bir seçenek seçmeniz gerekiyor. Lütfen tekrar seçin:",
          "Ürün Seç",
          PRODUCT_LABELS
        );
        break;
      }
      const idx = PRODUCT_LABELS.indexOf(matchedLabel);
      const devredildi = await startProductFlow(from, session, PRODUCT_KEYS[idx]);
      if (!devredildi) await askCurrentQuestion(from, session);
      break;
    }

    case "ASKING": {
      const flow = flows[session.product];
      const currentQuestion = flow.questions[session.questionIndex];
      const currentText = resolveText(currentQuestion, session.answers);

      // Coklu fotograf sorusu (orn. kasko arac fotograflari): musteri fotograf
      // gonderdikce ust taraftaki "media" blogu bunlari zaten biriktiriyor.
      // Burada sadece musterinin "tamam/bitti" gibi bir kelimeyle bitirdigini
      // anlayip bir sonraki soruya geciyoruz.
      if (currentQuestion.type === "coklu_foto") {
        const BITIRME_KELIMELERI = ["tamam", "bitti", "gonderdim", "hepsi bu", "tamamdir", "bu kadar"];
        const bitirdiMi = BITIRME_KELIMELERI.some((k) => normalizedUserText.includes(k));
        if (!bitirdiMi) {
          await sendText(
            from,
            "Fotoğraf gönderebilirsiniz, bitirdiyseniz \"tamam\" yazmanız yeterli. 📸"
          );
          break;
        }
        const cekilenSayisi = (session.answers[currentQuestion.id] || []).length;
        if (cekilenSayisi === 0) {
          await sendText(from, "Devam edebilmemiz için en az bir fotoğraf göndermeniz gerekiyor. 📸");
          break;
        }
        session.questionIndex = nextValidIndex(flow, session.answers, session.questionIndex + 1);
        if (session.questionIndex >= flow.questions.length) {
          await finishFlow(from, session);
        } else {
          await askCurrentQuestion(from, session);
        }
        break;
      }

      // Secenekli soruda gecerli bir secenek secildi mi kontrol et (esnek eslestirme ile)
      if (currentQuestion.type === "choice") {
        const validOption = matchOption(userText, currentQuestion.options);
        if (!validOption) {
          await sendChoiceQuestion(from, currentText, currentQuestion.options);
          break;
        }
        session.answers[currentQuestion.id] = validOption;
      } else {
        // Serbest metin sorularinda bir dogrulama fonksiyonu tanimliysa
        // (orn. TC kimlik no, tarih, plaka, ya da onceki cevaba bagli bir kontrol
        // - orn. "daire kati, bina kat sayisindan fazla olamaz"), formatin uygun
        // olup olmadigini kontrol et. validate(deger, oncekiCevaplar) seklinde
        // cagrilir, boylece onceki cevaplara da bakabilir.
        if (currentQuestion.validate && !currentQuestion.validate(userText, session.answers)) {
          const hint =
            typeof currentQuestion.validationError === "function"
              ? currentQuestion.validationError(userText, session.answers)
              : currentQuestion.validationError ||
                "Bu bilgiyi doğru formatta yazmadınız gibi görünüyor, lütfen tekrar dener misiniz?";
          await sendText(from, hint);
          break;
        }
        session.answers[currentQuestion.id] =
          currentQuestion.id === "ad_soyad" ? isimCevabiniTemizle(userText) : userText;

        // Musterinin KENDI T.C. kimlik numarasini sordugumuz (arac/ruhsat
        // sahibi TC'si DEGIL - bkz. flows.js/musteriProfilStore.js'deki
        // kaliciProfilAlani aciklamalari) bare soru cevaplandiysa, kalici
        // profile kaydediyoruz ki bir daha hicbir urunde tekrar sorulmasin.
        if (currentQuestion.kaliciProfilAlani === "tcKimlik") {
          musteriProfilStore.profilGuncelle(from, { tcKimlik: session.answers[currentQuestion.id] });
        }
      }

      // Bazi sorularda cevaba gore kisa, sicak bir tepki metni gonderilir (orn.
      // sehir sorusunda hangi sehirden yazdigina gore bir selam mesaji).
      // question.tepki tanimliysa ve bir mesaj donduruyorsa, sonraki soruya
      // gecmeden once ayri bir mesaj olarak gonderilir.
      if (currentQuestion.tepki) {
        const tepkiMesaji = currentQuestion.tepki(session.answers[currentQuestion.id]);
        if (tepkiMesaji) {
          await sendText(from, tepkiMesaji);
        }
      }

      // QR akisinda ASK_NAME adimi atlandigi icin, "ad_soyad" sorusu
      // cevaplanınca session.name'i de dolduruyoruz (ozet/panel icin).
      if (currentQuestion.id === "ad_soyad" && !session.name) {
        session.name = session.answers.ad_soyad;
        musteriProfilStore.profilGuncelle(from, { adSoyad: session.name });
      }

      session.questionIndex = nextValidIndex(flow, session.answers, session.questionIndex + 1);

      // Hayat sigortasinda danisman sorusu tamamlaninca (Hayir dedi ya da bir
      // danisman sectiyse) direkt "kac yasindasiniz" gibi bir soruya gecmek
      // bağlami koparıyordu. Araya kisa bir tanitim + gecis mesaji ekleyelim.
      const danismanSorusuBittiMi =
        session.product === "hayat" &&
        ((currentQuestion.id === "danisman_gorustu_mu" && session.answers.danisman_gorustu_mu === "Hayır") ||
          currentQuestion.id === "danisman_adi");
      if (danismanSorusuBittiMi) {
        await sendText(
          from,
          "Prim İadeli Hayat Sigortamız, sevdiklerinizi güvence altına alırken kullanılmayan primlerinizi de size geri veriyor. 🎁\n\n" +
            "Sizi en uygun danışmanımıza yönlendirmeden önce birkaç bilgi alalım."
        );
      }

      if (session.questionIndex >= flow.questions.length) {
        await finishFlow(from, session);
      } else {
        await askCurrentQuestion(from, session);
      }
      break;
    }

    case "DONE": {
      // Talep tamamlanmış. Yeni bir talep icin oturumu sifirlayip, tekrar QR
      // kontrolu de dahil olmak uzere sifirdan baslatiyoruz (boylece daha once
      // bizimle konusmus bir musteri de QR okutunca dogru muameleyi gorur).
      // Sifirlamadan once musterinin ismini yakalayip, biliyorsak ismiyle hitap edelim.
      const oncekiIsim = session.name;
      resetSession(from);
      await baslaYeniKonusma(from, getSession(from), userText, oncekiIsim);
      break;
    }

    default: {
      resetSession(from);
      await baslaYeniKonusma(from, getSession(from), userText);
    }
  }
}

async function askCurrentQuestion(from, session) {
  const flow = flows[session.product];
  const q = flow.questions[session.questionIndex];
  const text = resolveText(q, session.answers);
  if (q.type === "choice") {
    await sendChoiceQuestion(from, text, q.options);
  } else {
    await sendText(from, text);
  }
}

// Guvenlik agi: hangi danisman birincil alici olursa olsun (musteri farkli bir
// danismanla gorustugunu soylese de, ya da bir danisman kendi olusturdugu bir
// talep icin de), asagidaki sabit numaralar her zaman ayrica bilgilendirilir -
// boylece hicbir talep gozden kacmaz:
// - Enbel: her urun icin her zaman.
// - Bahadır: sadece elementer brans urunlerinde (flow.agentNumber onun
//   numarasiysa) - yani DASK, Konut, Trafik, Kasko, Ozel Saglik, TSS, Malpraktis.
function guvenlikAgiNumaralari(flow, birincilNumara) {
  const numaralar = new Set();
  if (birincilNumara) numaralar.add(birincilNumara);
  numaralar.add(ENBEL_NUMARASI);
  if (flow.agentNumber === BAHADIR_NUMARASI) {
    numaralar.add(BAHADIR_NUMARASI);
  }
  return numaralar;
}

async function finishFlow(from, session) {
  const flow = flows[session.product];
  session.state = "DONE";
  messageLog.setName(from, session.name);

  // Atlanan (skipIf ile gecilen) sorular hic cevaplanmadigi icin ozete dahil edilmez.
  const askedQuestions = flow.questions.filter((q) => !(q.skipIf && q.skipIf(session.answers)));
  const summaryLines = askedQuestions.map((q) => {
    const questionText = resolveText(q, session.answers);
    return `- ${questionText.replace(/\?$/, "")}: ${cevabiMetneCevir(session.answers[q.id])}`;
  });
  // Bazi urunlerde (orn. Malpraktis'te hekimlere) soyisim olmadan, sadece isim
  // + "Hocam" diye hitap ediyoruz. flow.hitapHocam true ise bunu uygula.
  const hitapIsmi =
    flow.hitapHocam && session.name
      ? `${session.name.trim().split(/\s+/)[0]} Hocam`
      : session.name;

  const customerSummary =
    `Teşekkürler ${hitapIsmi}! ${flow.label} talebiniz için gerekli bilgileri aldık. ` +
    `Ekibimiz en kısa sürede sizinle iletişime geçip teklifinizi iletecek. 🙏\n\n` +
    `Özet:\n${summaryLines.join("\n")}`;

  await sendText(from, customerSummary);

  // Bazi urunlerde, tum bilgiler alindiktan sonra ek bir tanitim/capraz satis
  // mesaji gonderilir (flows.js icindeki crossSellMessage alaniyla belirlenir).
  if (flow.crossSellMessage) {
    await sendText(from, flow.crossSellMessage);
  }

  // Acenteye/ekibe otomatik ilet.
  const agentNumber = resolveAgentNumber(flow, session);
  // Musteri daha once bir danismanla gorustugunu ve ismini belirttiyse
  // (danisman_gorustu_mu === "Evet"), bu ismi bildirim mesajinda ACIKCA
  // gosteriyoruz - eskiden bu bilgi sadece uzun ozet satirlari arasinda
  // (soru cumlesiyle birlikte) kayboluyordu, bildirimi alan Enbel/Bahadır
  // hangi danismanin ilgili oldugunu tek bakista goremiyordu.
  const belirtilenDanismanAdi =
    session.answers.danisman_gorustu_mu === "Evet" ? session.answers.danisman_adi || null : null;
  const agentMessage =
    `\u{1F4CB} Yeni iş talebi geldi\n` +
    `Müşteri: ${session.name}\n` +
    `Telefon: ${from}\n` +
    `Ürün: ${flow.label}\n` +
    (belirtilenDanismanAdi ? `Danışman: ${belirtilenDanismanAdi}\n` : "") +
    `\n` +
    summaryLines.join("\n");
  const kompaktDetay = kompaktDetayOlustur(flow, session, from);
  const bildirilecekNumaralar = guvenlikAgiNumaralari(flow, agentNumber);

  for (const numara of bildirilecekNumaralar) {
    await bildirimGonder(numara, flow.label, session.name, from, agentMessage, kompaktDetay, belirtilenDanismanAdi);
  }

  // Talebi takip sistemine kaydet - danisman panelden durumunu
  // (Açık/Olumlu/Olumsuz) guncelleyebilecek, hatirlatma kurabilecek.
  const atananDanisman = flow.advisors && flow.advisors.find((a) => a.number === agentNumber);
  const yeniLead = leadStore.yeniLeadOlustur({
    telefon: from,
    musteriAdi: session.name,
    urun: flow.label,
    danismanAdi: atananDanisman ? atananDanisman.name : null,
    danismanNumarasi: agentNumber || null,
    ozet: kompaktDetay
  });

  // 27.07.2026 eklendi: musteri ELEMENTER bir urun talebi olusturduysa (yani
  // bu flow'un acentesi Bahadır ise - flows.js'deki mevcut "elementer branş"
  // atamasiyla AYNI tanim), bildirim mesajinin hemen ardindan ilgili herkese
  // (guvenlik agindaki AYNI numaralar) "Ne yapmak istersiniz?" diye sorup
  // (Not Ekle/Durum Değiştir/Hatırlatma Kur butonlariyla) dogrudan aksiyon
  // almalarini sagliyoruz - "Bekleyen İş" menusune gitmelerini beklemeden.
  // Bu, advisorEngine.js'deki danisman-taraf oturum/menu mantigina bagli
  // oldugu icin DOGRUDAN COZULEMEZ (conversationEngine.js -> advisorEngine.js
  // dongusel bagimlilik olusturur) - bunun yerine server.js baslangicta
  // yeniTalepAksiyonHookAyarla ile advisorEngine.js'deki fonksiyonu buraya
  // enjekte ediyor (bkz. asagisi ve server.js'deki baslat()).
  if (agentNumber === BAHADIR_NUMARASI && yeniTalepAksiyonHook) {
    for (const numara of bildirilecekNumaralar) {
      try {
        await yeniTalepAksiyonHook(numara, yeniLead);
      } catch (err) {
        console.error(`Yeni elementer talep sonrasi aksiyon sorusu gonderilemedi (${numara}):`, err?.response?.data || err.message);
      }
    }
  }

  // Musteriden coklu_foto tipi bir soruda fotograf toplandiysa (orn. kasko
  // arac fotograflari), bunlari da talebe belge olarak ekliyoruz.
  askedQuestions
    .filter((q) => q.type === "coklu_foto")
    .forEach((q) => {
      const fotograflar = session.answers[q.id];
      if (Array.isArray(fotograflar)) {
        fotograflar.forEach((foto) => leadStore.belgeEkle(yeniLead.id, foto));
      }
    });

  // Basariyla okunan ruhsat fotografi gibi ek belgeler varsa onlari da ekle.
  if (Array.isArray(session.ekBelgeler)) {
    session.ekBelgeler.forEach((belge) => leadStore.belgeEkle(yeniLead.id, belge));
  }

  // BES ve Prim Iadeli Hayat Sigortasi gibi bazi urunlerde, talep Garanti
  // Emeklilik'e de otomatik mail olarak yonlendirilir (bkz. eposta.js).
  // Danisman yonlendirme sorulari (danisman_gorustu_mu/danisman_adi) bizim ic
  // isimiz oldugu icin mail icerigine dahil edilmez.
  if (flow.garantiEmekliligeGonder) {
    const DANISMAN_SORU_ID_LERI = ["danisman_gorustu_mu", "danisman_adi"];
    const mailSatirlari = askedQuestions
      .filter((q) => !DANISMAN_SORU_ID_LERI.includes(q.id))
      .map((q) => {
        const questionText = resolveText(q, session.answers);
        return `- ${questionText.replace(/\?$/, "")}: ${cevabiMetneCevir(session.answers[q.id])}`;
      });
    garantiEmekliligeGonder({
      urunAdi: flow.label,
      musteriAdi: session.name,
      telefon: from,
      ozetSatirlari: mailSatirlari
    }).catch((err) => console.error("Garanti Emeklilik maili gonderilirken beklenmeyen hata:", err.message));
  }
}

// WhatsApp sablon PARAMETRELERI (degiskenleri) alt satira gecme/tab karakteri
// icermemeli ve 4'ten fazla ardisik bosluk olmamali (Meta hata 132018 ile
// reddediyor) - bu kisitlama sadece degisken DEGERLERI icin gecerli, sablonun
// kendi sabit metni icin degil. Bu yuzden template'e gonderilecek her degisken
// degerini bu fonksiyondan geciriyoruz (duz metin/panel gosterimi etkilenmez,
// orijinal - satir sonlu - metin onlarda aynen kullanilmaya devam eder).
function sablonParametresiIcinTemizle(metin) {
  return (metin || "")
    .replace(/\r\n|\r|\n/g, " • ")
    .replace(/\t/g, " ")
    .replace(/ {5,}/g, "    ")
    .replace(/(\s*•\s*){2,}/g, " • ") // ust uste gelen bosluk/bullet'lari tekillestir
    .replace(/^\s*•\s*|\s*•\s*$/g, "") // basta/sonda kalan bullet'i temizle
    .trim();
}

// Panelden kurulan bir hatirlatmanin zamani geldiginde danismana gonderilir.
// AGENT_DETAY_TEMPLATE_NAME ayarliysa onu kullanir (24 saat penceresine tabi
// degil, her zaman ulasir); yoksa duz metin dener (pencere acik olmasi gerekir).
// ONEMLI (20.07.2026 tarihli hatirlatma kaybi vakasi): bu fonksiyon eskiden
// HER IKI deneme (sablon + duz metin) basarisiz olsa BILE hatasiz (undefined)
// donuyordu - cagiran taraf (server.js -> hatirlatmalariKontrolEt) bu yuzden
// basarisiz bir gonderimi de "basarili" saniyor, hatirlatmayi "gonderildi"
// olarak isaretleyip BIR DAHA ASLA denemiyordu. Ozellikle AGENT_DETAY_TEMPLATE_NAME/
// AGENT_TEMPLATE_NAME tanimli degilse (bkz. .env.example - ikisi de varsayilan
// bos) tek secenek duz metin (sendText) oluyor, o da WhatsApp'in 24 saatlik
// musteri penceresi kapaliysa basarisiz oluyor - ve bu basarisizlik hicbir
// yere yansimiyordu. Artik HER IKI deneme de basarisiz olursa hatayi
// YUKARI FIRLATIYORUZ ki cagiran taraf hatirlatmayi "gonderildi" olarak
// ISARETLEMESIN, bir sonraki dakika tekrar denesin (bkz. server.js).
async function hatirlatmaGonder(numara, metin) {
  const detayliSablonAdi = process.env.AGENT_DETAY_TEMPLATE_NAME;
  if (detayliSablonAdi) {
    try {
      await sendTemplate(numara, detayliSablonAdi, "tr", { detay: sablonParametresiIcinTemizle(metin) }, metin);
      return;
    } catch (err) {
      console.error("Hatırlatma şablonu gönderilemedi, düz metin deneniyor:", err?.response?.data || err.message);
    }
  }
  await sendText(numara, metin); // basarisiz olursa hata cagirana ULASIR (yukaridaki NOT'a bakin)
}

// 27.07.2026 eklendi: gunluk bekleyen is ozeti gibi COK SATIRLI (birden fazla
// gercek satir sonu icheren) mesajlar icin. hatirlatmaGonder'daki
// AGENT_DETAY_TEMPLATE_NAME sablonu "YENI TALEP" bildirimleri icin Meta'ya
// onaylatilmis - sabit bir "Yeni bir talep geldi!" basligi tasiyor VE (yukaridaki
// sablonParametresiIcinTemizle fonksiyonundaki NOT'ta aciklandigi gibi) WhatsApp
// kurallari geregi sablon PARAMETRELERI gercek \n icheremiyor (Meta hata 132018
// ile reddediyor) - bu yuzden bu sablonla gonderilen COK SATIRLI bir liste hem
// yanlis/alakasiz bir baslikla hem de TUM satirlari " • " ile yapistirilip satir
// sonlari kaybolmus halde cikiyordu (27.07.2026, kullanicinin WhatsApp ekran
// goruntusuyle bildirdigi hata).
//
// Bu fonksiyon ONCE DUZ METIN dener (baslik YOK, satir sonlari TAM istendigi
// gibi kalir) - ama duz metin (session mesaji) SADECE WhatsApp'in 24 saatlik
// "musteri penceresi" acikken calisir (alici son 24 saat icinde bota bir seyler
// yazmissa). Ekip zaten gun icinde bota WhatsApp'tan menu uzerinden sik sik
// yazdigi icin bu neredeyse her zaman acik olur. Pencere KAPALIYSA (bir kisi
// uzun suredir bota hic yazmamissa), duz metin basarisiz olur - bu durumda
// mesaj TAMAMEN kaybolmasin diye (cirkin ama guvenilir) hatirlatmaGonder'a
// (sablonlu) dusuluyor. Yani: pencere acikken mukemmel gorunur, kapaliyken
// eski (sablonlu, " • " ayrimli) haliyle olsa da YINE DE ulasir.
async function cokSatirliMesajGonder(numara, metin) {
  try {
    await sendText(numara, metin);
  } catch (err) {
    console.error(
      "Çok satırlı mesaj düz metin olarak gönderilemedi (24 saatlik pencere kapalı olabilir), şablonlu hatırlatmaya düşülüyor:",
      err?.response?.data || err.message
    );
    await hatirlatmaGonder(numara, metin);
  }
}

// Bir satis basariyla Garanti Emeklilik'e iletildikten birkac gun sonra
// MUSTERIYE gonderilen kisa memnuniyet/kalite kontrolu mesaji (bkz.
// server.js'deki memnuniyetAnketleriniKontrolEt, leadStore'daki
// memnuniyetAnketiKur). 26.07.2026 eklendi.
//
// ONEMLI: MEMNUNIYET_ANKETI_TEMPLATE_NAME ayri, Meta'ya AYRICA onaylatilmasi
// gereken YENI bir sablondur - AGENT_DETAY_TEMPLATE_NAME'i (ekip/danisman
// bildirimleri icin onaylanmis) burada TEKRAR KULLANMIYORUZ, cunku o sablon
// Meta'ya "isletme-ici bildirim" amaciyla onaylatilmis olabilir, MUSTERIYE
// pazarlama/anket amacli bir mesaj icin ayni sablonu kullanmak Meta'nin
// sablon kategorisi kurallarina aykiri olabilir. Bu ortam degiskeni Railway'e
// TANIMLANMADAN bu ozellik musteriye ULASAMAZ (musteriyle son yazismadan
// GUNLER sonra gonderildigi icin WhatsApp'in 24 saatlik ucretsiz musteri
// penceresi neredeyse KESINLIKLE kapali olur - sablon olmadan duz metin
// bu durumda basarisiz olur).
async function memnuniyetAnketiGonder(numara, musteriAdi, urunAdi) {
  const ilkAd = (musteriAdi || "").trim().split(/\s+/)[0] || "";
  const metin =
    `Merhaba ${ilkAd}! 😊 ${urunAdi} işleminizin üzerinden birkaç gün geçti, umarız her şey yolundadır.\n\n` +
    `Bizimle olan deneyiminizi 1-5 arası bir puan ya da birkaç kelimeyle bizimle paylaşır mısınız? Geri bildiriminiz bizim için çok değerli. 🙏`;

  const sablonAdi = process.env.MEMNUNIYET_ANKETI_TEMPLATE_NAME;
  if (sablonAdi) {
    try {
      await sendTemplate(numara, sablonAdi, "tr", { detay: sablonParametresiIcinTemizle(metin) }, metin);
      return;
    } catch (err) {
      console.error(
        "Memnuniyet anketi şablonu gönderilemedi, düz metin deneniyor:",
        err?.response?.data || err.message
      );
    }
  }
  await sendText(numara, metin); // basarisiz olursa hata cagirana ULASIR (bkz. hatirlatmaGonder'daki NOT)
}

// server.js'deki ELEMENTER_ANAHTAR_KELIMELER/urunElementerMi ile AYNI liste -
// burada AYRICA tutuluyor cunku conversationEngine.js server.js'i (dongusel
// bagimliligi onlemek icin) import edemiyor. Ikisi de degistirilirse birlikte
// guncellenmeli.
const ELEMENTER_ANAHTAR_KELIMELER = ["trafik", "kasko", "dask", "konut", "işyeri", "isyeri", "yeşil kart", "yesil kart"];
function urunElementerMi(urun) {
  if (!urun) return false;
  const normalized = String(urun).toLocaleLowerCase("tr-TR");
  return ELEMENTER_ANAHTAR_KELIMELER.some((k) => normalized.includes(k));
}

// 27.07.2026 eklendi: "herhangi biri herhangi bir bekleyen işe/talebe not
// eklediğinde konuyla ilgili herkese bilgilendirme mesajı gitsin" (kullanicinin
// talebi). guvenlikAgiNumaralari ile AYNI "kime gitmeli" mantigini kullanir
// (danisman + her zaman Enbel + elementerse Bahadır), ama notu EKLEYEN KISI
// bu listeden CIKARILIR (kendi ekledigi notu kendine tekrar bildirmenin anlami
// yok). Panelden (Bahadır/Enbel) ya da WhatsApp'tan ("Bekleyen İş" -> "Not
// Ekle") eklenen notlarin HER İKİSİ İÇİN de cagirilir - bkz. server.js'deki
// panel not route'u ve advisorEngine.js'deki DANISMAN_NOT_BEKLE case'i.
async function notEklendiBildirimiGonder(lead, notMetni, ekleyenAdi, ekleyenNumarasi) {
  const numaralar = new Set();
  if (lead.danismanNumarasi) numaralar.add(lead.danismanNumarasi);
  numaralar.add(ENBEL_NUMARASI);
  if (urunElementerMi(lead.urun)) numaralar.add(BAHADIR_NUMARASI);
  if (ekleyenNumarasi) numaralar.delete(ekleyenNumarasi);

  if (numaralar.size === 0) return;

  const mesaj =
    `📝 ${ekleyenAdi || "Bir yetkili"} tarafından ${lead.musteriAdi || lead.telefon} (${lead.urun}) için not eklendi:\n` +
    `"${notMetni}"`;

  for (const numara of numaralar) {
    try {
      await cokSatirliMesajGonder(numara, mesaj);
    } catch (err) {
      console.error(`Not eklendi bildirimi gonderilemedi (${numara}):`, err?.response?.data || err.message);
    }
  }
}

module.exports = {
  handleIncoming,
  hatirlatmaGonder,
  cokSatirliMesajGonder,
  memnuniyetAnketiGonder,
  notEklendiBildirimiGonder,
  yeniTalepAksiyonHookAyarla,
  resolveText,
  resolveDanismanText,
  kompaktDetayOlustur,
  bildirimGonder,
  guvenlikAgiNumaralari,
  resolveAgentNumber,
  sablonParametresiIcinTemizle
};
