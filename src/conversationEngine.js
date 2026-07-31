const { getSession, resetSession } = require("./sessionStore");
const { sendText, sendButtons, sendList, sendTemplate, mediaIndir } = require("./loggedWhatsapp");
const { ruhsatFotografiAnalizEt } = require("./ruhsatAnaliz");
const { proformaAnalizEt } = require("./proformaAnaliz");
const { garantiEmekliligeGonder } = require("./eposta");
const messageLog = require("./messageLog");
const leadStore = require("./leadStore");
const musteriProfilStore = require("./musteriProfilStore");
const sozlukSSS = require("./sozlukSSS");
const tssOzelSartSSS = require("./tssOzelSartSSS");
const ozelSaglikOzelSartSSS = require("./ozelSaglikOzelSartSSS");
const dogumSigortasiOzelSartSSS = require("./dogumSigortasiOzelSartSSS");
// 31.07.2026 eklendi: "Sık Sorulan Sorular" akisinda "Bireysel Emeklilik(BES)"
// secildiginde (bkz. ASK_INFO_PRODUCT case'i), TSS/ÖSS/Doğum'un aksine serbest
// soru-cevap moduna GIRILMIYOR - onun yerine BES fon listesi (+ best-effort
// guncel getiriler) dogrudan gosteriliyor. besFonVerileri.js/tefasGetiriAnaliz.js
// "yaprak" moduller oldugu icin (advisorEngine.js'e ya da bu dosyaya bagimli
// degiller) burada dogrudan require edilebiliyor - dongusel bagimlilik riski yok.
const { BES_FONLARI, besFonMesajlariniOlustur } = require("./besFonVerileri");
const { fonGetirileriniGetir } = require("./tefasGetiriAnaliz");
const flows = require("./flows");
const { baskasiIcinMi, sehirAdiBul } = flows;
const { adSoyadGecerliMi, tcKimlikGecerliMi, tarihGecerliMi, telefonGecerliMi } = require("./validators");
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

// 28.07.2026: flows.js artik urun tanimlarinin yaninda bazi yardimci
// fonksiyonlari da (baskasiIcinMi, sehirAdiBul, saglikYetiskinMi) named
// export olarak disariya aciyor (bkz. flows.js sonu) - Object.keys(flows)
// SADECE bunlarla filtrelenmeden kullanilirsa, PRODUCT_KEYS/PRODUCT_LABELS bu
// fonksiyonlari da "urunmuş gibi" ice alir (flows[k].label => undefined),
// bu da urun secim listesinde undefined bir secenege ve matchOption'da
// normalizeTr(undefined) hatasina yol acar. Bu yuzden SADECE gercekten bir
// "questions" dizisine sahip (yani gercek bir urun tanimi olan) key'ler
// aliniyor.
const PRODUCT_KEYS = Object.keys(flows).filter(
  (k) => flows[k] && typeof flows[k] === "object" && Array.isArray(flows[k].questions)
);
// Urun secim listesinde WhatsApp'in 24 karakter siniri oldugu icin, uzun urun
// isimlerinde flows.js'deki kisa "menuLabel" kullanilir; yoksa tam "label" kullanilir.
// Ozet/bildirim mesajlarinda ise her zaman tam "label" kullanilmaya devam eder.
const PRODUCT_LABELS = PRODUCT_KEYS.map((k) => flows[k].menuLabel || flows[k].label);

// 31.07.2026: 30.07.2026'da eklenen ayri "Teklif Almak İstiyorum"/"Bilgi Almak
// İstiyorum" on-secim ekrani (ASK_INTENT) KALDIRILDI - musteri "merhaba"
// dedikten (isim/KVKK) sonra dogrudan urun secim listesine (ASK_PRODUCT)
// gidiyor, tipki bu ekran eklenmeden onceki gibi. Bilgi/SSS akisina artik bu
// TEK urun listesinin EN ALTINA eklenen "Sık Sorulan Sorular" secenegiyle
// giriliyor: secilince urun listesi TEKRAR gosteriliyor (ASK_INFO_PRODUCT),
// bir urun secilince o urunun soru-cevap moduna (varsa) giriliyor.
const SSS_ETIKETI = "Sık Sorulan Sorular";
// ASK_PRODUCT ekraninda gercek urun listesinin EN ALTINA SSS_ETIKETI de
// ekleniyor - PRODUCT_LABELS/PRODUCT_KEYS teklif (startProductFlow) akisinda
// HALA SADECE gercek urunleri icermeye devam ediyor, bu yuzden ayri bir liste.
const ASK_PRODUCT_SECENEKLERI = [...PRODUCT_LABELS, SSS_ETIKETI];

// ozel_saglik ve tss AYNI soru akisini (saglikUrunuSorulari) kullansa da,
// FARKLI sigorta urunleri/policeleridir (biri Aksigorta TSS - Tamamlayici
// Saglik, digeri Aksigorta Aksaglik - Ozel Saglik Sigortasi) - kullanicinin
// 30.07.2026'da netlestirdigi gibi ("Ayri belge, ayri cevap") her biri
// KENDI PDF'ine dayanan BAGIMSIZ bir soru-cevap modulune sahip. Buradaki
// anahtar, ASK_INFO_PRODUCT'ta hangi urun icin hangi modulun
// kullanilacagini (ve bilgi hizmeti sunulup sunulmadigini) belirler.
//
const BILGI_SORU_MODULLERI = {
  tss: tssOzelSartSSS,
  ozel_saglik: ozelSaglikOzelSartSSS,
  dogum_sigortasi_bilgi: dogumSigortasiOzelSartSSS
};

// 31.07.2026 eklendi: "Doğum Sigortası" (Acıbadem'in ayrı ürünü), "Teklif
// Almak İstiyorum" tarafında KENDİ BAŞINA bir ürün DEĞİL - ÖSS/TSS teklifiyle
// birlikte eklenebilen bir ek poliçe (bkz. flows.js'teki
// "dogum_sigortasi_eklensin" sorusu, ÖSS/TSS akışının sonuna eklendi). Ama
// "Bilgi Almak İstiyorum" tarafında kendi başına bir soru-cevap seçeneği
// olarak sunuluyor - bu yüzden PRODUCT_KEYS/PRODUCT_LABELS'a (teklif akışını
// besleyen liste) KARIŞTIRMADAN, SADECE bilgi akışı için ayrı bir liste
// oluşturuyoruz.
const DOGUM_SIGORTASI_BILGI_ANAHTARI = "dogum_sigortasi_bilgi";
const DOGUM_SIGORTASI_BILGI_ETIKETI = "Doğum Sigortası";
const INFO_PRODUCT_KEYS = [...PRODUCT_KEYS, DOGUM_SIGORTASI_BILGI_ANAHTARI];
const INFO_PRODUCT_LABELS = [...PRODUCT_LABELS, DOGUM_SIGORTASI_BILGI_ETIKETI];
// ASK_INFO_PRODUCT'ta hem "hangi urun icin bilgi hizmeti tanitim mesaji
// gosterilecek" hem de "desteklenmeyen urun" fallback mesajinda urun adini
// yazdirmak icin - flows[key].label DOGUM_SIGORTASI_BILGI_ANAHTARI icin
// calismaz (flows.js'te gercek bir urun degil), bu yuzden tek bir haritada
// topluyoruz.
const INFO_LABEL_BY_KEY = Object.fromEntries(
  INFO_PRODUCT_KEYS.map((k, i) => [k, INFO_PRODUCT_LABELS[i]])
);

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

// 31.07.2026 eklendi: "Sık Sorulan Sorular" (URUN_BILGI_SORU) serbest
// soru-cevap modunda, musterinin yazdigi metnin SADECE bir kapanis/tesekkur
// ifadesi olup olmadigini anlamak icin (bkz. URUN_BILGI_SORU case'i).
// normalizeTr uygulanmis metne karsi test edilir (ş->s, ü->u vb.) - bu yuzden
// Turkce karakter icermez. Baslangicta (istege bagli) "cok", sonunda
// (istege bagli) noktalama/emoji tolere eder, ama "teşekkürler ama..." gibi
// tesekkurun ARDINDAN baska bir seyin geldigi durumlari (gercek bir soru
// icerebilecekleri icin) kasten YAKALAMAZ - $ ile ceviri sonunu sabitliyoruz.
const KAPANIS_IFADE_REGEX = /^(cok\s+)?(tesekkur(ler)?(\s+ederim)?|sagol|saol|elinize\s+saglik)[\s!.,😊🙏👍🎉]*$/;

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

  // NOT (28.07.2026): Musterinin KENDI T.C. kimlik numarasinin (kaliciProfilAlani
  // === "tcKimlik" ile isaretli soru - su an SADECE Malpraktis'te var) kalici
  // profilden onceden doldurulmasi ARTIK BURADA yapilmiyor - Malpraktis'e
  // "hedef_kisi" ("kendiniz icin mi, baskasi icin mi") sorusu eklendigi icin,
  // bu onceden-doldurma sadece "Kendim İçin" cevabi verildiginde anlamli
  // (baskasi icinse FARKLI bir kisinin TC'si isteniyor, kendi kayitli TC'mizi
  // oraya yazmak BUYUK bir hata olurdu). Bu yuzden bu doldurma artik ASKING
  // case'inde "hedef_kisi" sorusu cevaplandigi anda, sadece "Kendim İçin"
  // durumunda yapiliyor (bkz. asagida).

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

  // Ismi zaten biliyorsak (donen musteri), session.name'i simdiden dolduruyoruz.
  // Bu sayede hem KVKK sonrasi tekrar isim sorulmaz, hem de QR akisinda urunun
  // kendi "ad_soyad" sorusu (sameAsAccountHolder ile) otomatik atlanir.
  if (bilinenIsim) {
    session.name = bilinenIsim;
  }

  if (matchedKey) {
    session.pendingProduct = matchedKey;
    await sendText(from, flows[matchedKey].qrGreeting);
  } else if (bilinenIsim) {
    // Musteriyi kayitli ismiyle karsiliyoruz - ama bu telefon numarasinin hala
    // GERCEKTEN ayni kisiye ait oldugundan emin degiliz (el degistirmis
    // olabilir). isimTeyitBekleniyor bayragini isaretliyoruz: handleIncoming
    // bu karsilamadan HEMEN SONRAKI ilk mesajda musteri "ben ... degilim" gibi
    // bir sey soylerse, kalici kaydi silip musteriyi yeni musteri gibi
    // ele alacak (bkz. handleIncoming basindaki kontrol).
    // 31.07.2026 DUZELTILDI: musteriye HICBIR ZAMAN sadece ilk adiyla hitap
    // edilmiyor (kullanicinin talebi - her zaman TAM isim-soyisim ve
    // "siz/sizli" resmi dil kullaniliyor) - bu yuzden burada artik ilkAd
    // yerine dogrudan bilinenIsim (tam ad-soyad) kullaniliyor.
    session.isimTeyitBekleniyor = true;
    await sendText(
      from,
      `${gunSelamlamasi()} ${bilinenIsim}! 😊 Yeni bir sigorta teklif talebiniz için bizi tekrar tercih ettiğiniz için teşekkür ederiz. Size nasıl yardımcı olabiliriz?`
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
      ASK_PRODUCT_SECENEKLERI
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

// --- Özel Sağlık/TSS "Ailem (Birden Fazla)" aile bireyleri toplama motoru
// (28.07.2026 eklendi) ---
// flows.js'teki sabit soru dizisi/skipIf mimarisi, calisma zamaninda
// kullanicinin cevabina gore SINIRSIZ sayida tekrar eden bir soru grubunu
// (kac cocuk oldugu onceden bilinmedigi icin) ifade edemiyor. Bu yuzden
// flows.js'teki "aile_dongu" tipindeki TEK BIR soru, asagidaki fonksiyonlarla
// yonetilen kendi ic durum makinesini kullaniyor (session.saglikAileAsama):
// once (istege bagli) esin bilgilerini, sonra (istege bagli, sinirsiz
// tekrarla, her seferinde "başka çocuk var mı" diye sorarak) her cocugun
// bilgilerini topluyor. Toplanan herkes session.answers.saglik_kisiler
// dizisine ekleniyor.
//
// ONEMLI (danisman modu notu): advisorEngine.js'deki "danisman musteri
// adina yeni talep olusturuyor" akisi (DANISMAN_YENI_SORU) sadece "choice"
// ve duz metin soru tiplerini biliyor - bu "aile_dongu" tipini (coklu_foto
// tipinde de zaten var olan AYNI onceden var olan sinirlamayla) TANIMIYOR.
// Bir danisman Ozel Saglik/TSS'de "Ailem (Birden Fazla)" secip musteri
// adina yeni talep olusturmaya calisirsa bu adimda beklenmeyen bir davranis
// olusabilir - bu, teslimat notunda ayrica belirtilmesi gereken bilinen bir
// sinirlamadir.

function karsiCinsiyet(cinsiyet) {
  if (cinsiyet === "Kadın") return "Erkek";
  if (cinsiyet === "Erkek") return "Kadın";
  return null;
}

const SAGLIK_AILE_SORU_METNI = {
  ES_SORULUYOR: "Eşinizi de poliçeye eklemek ister misiniz?",
  ES_AD_SOYAD: "Eşinizin ismini ve soyismini paylaşır mısınız?",
  ES_DOGUM_TARIHI: "Eşinizin doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
  ES_BOY_KILO: "Eşinizin boyunu ve kilosunu paylaşır mısınız? (Örn: 170 cm / 70 kg)",
  ES_TELEFON: "Eşinizin cep telefonu numarasını paylaşır mısınız? 📱",
  ES_MESLEK: "Eşinizin mesleğini paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz.",
  COCUK_SORULUYOR_ILK: "Çocuğunuzu da poliçeye eklemek ister misiniz?",
  COCUK_SORULUYOR_TEKRAR: "Başka bir çocuğunuzu da poliçeye eklemek ister misiniz?",
  COCUK_AD_SOYAD: "Çocuğunuzun ismini ve soyismini paylaşır mısınız?",
  COCUK_DOGUM_TARIHI: "Çocuğunuzun doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
  COCUK_CINSIYET: "Çocuğunuzun cinsiyeti nedir?",
  COCUK_BOY_KILO: "Çocuğunuzun boyunu ve kilosunu paylaşır mısınız? (Örn: 120 cm / 25 kg)",
  COCUK_TELEFON: "Çocuğunuz 18 yaşını doldurduğu için cep telefonu numarasını da paylaşır mısınız? 📱",
  COCUK_MESLEK: "Çocuğunuz 18 yaşını doldurduğu için mesleğini de paylaşır mısınız? 💼"
};

async function saglikAileSorusunuSor(from, session) {
  const asama = session.saglikAileAsama;
  const metin = SAGLIK_AILE_SORU_METNI[asama];
  if (asama === "ES_SORULUYOR" || asama === "COCUK_SORULUYOR_ILK" || asama === "COCUK_SORULUYOR_TEKRAR") {
    await sendChoiceQuestion(from, metin, ["Evet", "Hayır"]);
  } else if (asama === "COCUK_CINSIYET") {
    await sendChoiceQuestion(from, metin, ["Kadın", "Erkek"]);
  } else {
    await sendText(from, metin);
  }
}

// session.saglikAileGecici icinde toplanmakta olan kisiyi tamamlayip
// session.answers.saglik_kisiler dizisine ekler, sonraki asamaya gecer -
// esin ardindan HER ZAMAN "ilk çocuk" sorusuna, bir cocugun ardindan HER
// ZAMAN "başka çocuk" sorusuna gecilir.
function saglikKisiTamamla(session) {
  if (!session.answers.saglik_kisiler) session.answers.saglik_kisiler = [];
  const tamamlanan = session.saglikAileGecici;
  session.answers.saglik_kisiler.push(tamamlanan);
  session.saglikAileGecici = null;
  session.saglikAileAsama = tamamlanan.tur === "Eş" ? "COCUK_SORULUYOR_ILK" : "COCUK_SORULUYOR_TEKRAR";
}

// Kullanicinin aile_dongu sirasindaki cevabini isler. Donus degeri: true ise
// tum aile toplama sureci BITMISTIR (cagiran taraf bir sonraki flow sorusuna
// gecebilir), false ise HALA DEVAM ETMEKTEDIR (bir sonraki alt-soru zaten bu
// fonksiyon icinde gonderildi, cagiran tarafin baska bir sey yapmasina
// gerek yok).
async function saglikAileCevabiIsle(from, session, userText) {
  const asama = session.saglikAileAsama;

  const evetHayirSecimi = async () => {
    const secilen = matchOption(userText, ["Evet", "Hayır"]);
    if (!secilen) {
      await saglikAileSorusunuSor(from, session);
      return null;
    }
    return secilen;
  };

  if (asama === "ES_SORULUYOR") {
    const secilen = await evetHayirSecimi();
    if (!secilen) return false;
    if (secilen === "Hayır") {
      session.saglikAileAsama = "COCUK_SORULUYOR_ILK";
    } else {
      session.saglikAileGecici = { tur: "Eş" };
      session.saglikAileAsama = "ES_AD_SOYAD";
    }
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "ES_AD_SOYAD") {
    if (!adSoyadGecerliMi(userText)) {
      await sendText(
        from,
        "Hmm, bunu bir isim-soyisim olarak anlayamadım 🙂 Lütfen eşinizin adını ve soyadını yazar mısınız?"
      );
      return false;
    }
    session.saglikAileGecici.adSoyad = isimCevabiniTemizle(userText);
    // Turkiye'de evlilik karsi cinsler arasinda oldugu icin, musterinin kendi
    // cinsiyeti biliniyorsa esin cinsiyeti otomatik cikarilir - ayrica
    // sorulmaz (kullanicinin acik talebi). Ayni sekilde ikamet (il/ilce) de
    // ayni hane oldugu icin tekrar sorulmaz.
    session.saglikAileGecici.cinsiyet = karsiCinsiyet(session.answers.cinsiyet);
    session.saglikAileGecici.ilIlce = session.answers.il_ilce;
    session.saglikAileAsama = "ES_DOGUM_TARIHI";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "ES_DOGUM_TARIHI") {
    if (!tarihGecerliMi(userText)) {
      await sendText(from, "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.1990)");
      return false;
    }
    session.saglikAileGecici.dogumTarihi = userText.trim();
    session.saglikAileAsama = "ES_BOY_KILO";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "ES_BOY_KILO") {
    session.saglikAileGecici.boyKilo = userText.trim();
    // Es HER ZAMAN yetiskin kabul edilir - cep telefonu/meslek her zaman sorulur.
    session.saglikAileAsama = "ES_TELEFON";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "ES_TELEFON") {
    if (!telefonGecerliMi(userText)) {
      await sendText(from, "Girilen numara geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 05551234567)");
      return false;
    }
    session.saglikAileGecici.cepTelefonu = userText.trim();
    session.saglikAileAsama = "ES_MESLEK";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "ES_MESLEK") {
    session.saglikAileGecici.meslek = userText.trim();
    saglikKisiTamamla(session);
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_SORULUYOR_ILK" || asama === "COCUK_SORULUYOR_TEKRAR") {
    const secilen = await evetHayirSecimi();
    if (!secilen) return false;
    if (secilen === "Hayır") {
      return true; // aile bireyleri toplama TAMAMEN bitti
    }
    session.saglikAileGecici = { tur: "Çocuk" };
    session.saglikAileAsama = "COCUK_AD_SOYAD";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_AD_SOYAD") {
    if (!adSoyadGecerliMi(userText)) {
      await sendText(
        from,
        "Hmm, bunu bir isim-soyisim olarak anlayamadım 🙂 Lütfen çocuğunuzun adını ve soyadını yazar mısınız?"
      );
      return false;
    }
    session.saglikAileGecici.adSoyad = isimCevabiniTemizle(userText);
    // Cocugun ikamet bilgisi de ayni hane oldugu icin tekrar sorulmuyor -
    // ama cinsiyeti ebeveynlerden CIKARILAMAZ, o yuzden ayrica sorulacak.
    session.saglikAileGecici.ilIlce = session.answers.il_ilce;
    session.saglikAileAsama = "COCUK_DOGUM_TARIHI";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_DOGUM_TARIHI") {
    if (!tarihGecerliMi(userText)) {
      await sendText(from, "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.2015)");
      return false;
    }
    session.saglikAileGecici.dogumTarihi = userText.trim();
    session.saglikAileAsama = "COCUK_CINSIYET";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_CINSIYET") {
    const secilen = matchOption(userText, ["Kadın", "Erkek"]);
    if (!secilen) {
      await saglikAileSorusunuSor(from, session);
      return false;
    }
    session.saglikAileGecici.cinsiyet = secilen;
    session.saglikAileAsama = "COCUK_BOY_KILO";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_BOY_KILO") {
    session.saglikAileGecici.boyKilo = userText.trim();
    // 18 yas alti cocuklarda cep telefonu/meslek istenmiyor (kullanicinin
    // acik talebi) - flows.js'teki saglikYetiskinMi ile AYNI mantik.
    if (flows.saglikYetiskinMi(session.saglikAileGecici.dogumTarihi)) {
      session.saglikAileAsama = "COCUK_TELEFON";
      await saglikAileSorusunuSor(from, session);
    } else {
      saglikKisiTamamla(session);
      await saglikAileSorusunuSor(from, session);
    }
    return false;
  }

  if (asama === "COCUK_TELEFON") {
    if (!telefonGecerliMi(userText)) {
      await sendText(from, "Girilen numara geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 05551234567)");
      return false;
    }
    session.saglikAileGecici.cepTelefonu = userText.trim();
    session.saglikAileAsama = "COCUK_MESLEK";
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  if (asama === "COCUK_MESLEK") {
    session.saglikAileGecici.meslek = userText.trim();
    saglikKisiTamamla(session);
    await saglikAileSorusunuSor(from, session);
    return false;
  }

  // Beklenmeyen bir durum icin guvenlik agi - aile toplamayi bitmis sayip devam et.
  return true;
}

// aile_dongu ile toplanan kisileri (session.answers.saglik_kisiler) kisa,
// okunakli satirlara cevirir - kompaktDetayOlustur ve finishFlow'daki
// agentMessage/customerSummary tarafindan kullanilir. flow.questions'ta
// karsiligi olmayan bir alan oldugu icin genel soru-bazli ozet mekanizmasi
// bunu OTOMATIK GOSTERMEZ, bu yuzden ayri bir fonksiyon gerekiyor.
function saglikKisileriOzetSatirlariOlustur(session) {
  const kisiler = session.answers.saglik_kisiler;
  if (!Array.isArray(kisiler) || kisiler.length === 0) return [];
  let cocukSayaci = 0;
  return kisiler.map((k) => {
    const etiket = k.tur === "Çocuk" ? `Çocuk ${++cocukSayaci}` : k.tur;
    const parcalar = [
      k.adSoyad,
      k.dogumTarihi ? `D.Tarihi: ${k.dogumTarihi}` : null,
      k.cinsiyet,
      k.boyKilo,
      k.ilIlce ? `İkamet: ${k.ilIlce}` : null,
      k.cepTelefonu ? `Tel: ${k.cepTelefonu}` : null,
      k.meslek ? `Meslek: ${k.meslek}` : null
    ].filter(Boolean);
    return `${etiket}: ${parcalar.join(", ")}`;
  });
}

// Acente bildirimlerinde soru metni yerine kullanilan kisa, okunakli etiketler.
// Tam soru cumlesi ("Binanın toplam kaç kattan oluştuğunu belirtir misiniz?")
// yerine kisa etiket ("Kat Sayısı") kullanmak, tek bir sablon degiskenine
// sigdirmamiz gereken metni (1024 karakter siniri var) ciddi olcude kisaltir.
const ID_KISA_ETIKET = {
  danisman_gorustu_mu: "Danışmanla Görüştü mü",
  danisman_adi: "Danışman",
  // 28.07.2026: bu alan daha once bu haritada yoktu - DASK/Konut/Malpraktis'te
  // "hedef_kisi" musteri akisinda gizli DEGIL (sadece danisman akisinda
  // gizli), bu yuzden musteri "Başkası İçin" derse kompaktDetayOlustur'da
  // (panelde/bildirimlerde) cirkin bir sekilde ham id ("hedef_kisi: Başkası
  // İçin") gorunuyordu - Malpraktis web teklif formu entegrasyonu sirasinda
  // fark edildi, ayni haritayi kullanan TUM urunler icin duzeltildi.
  hedef_kisi: "Kime Ait",
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
  arac_sifir_mi: "Araç Sıfır mı",
  marka: "Marka",
  model: "Model",
  motor_no: "Motor No",
  sasi_no: "Şasi No",
  plaka: "Plaka",
  kasko_talebi: "Kasko Talebi",
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
  yillik_hasta_sayisi: "Yıllık Ortalama Hasta Sayısı",
  tescil_no: "Tescil No",
  tescil_tarihi: "Tescil Tarihi",
  asistan_mi: "Asistan mı",
  sigorta_ettiren_turu: "Sigorta Ettiren",
  saglik_kurumu: "Sağlık Kurumu",
  cep_telefonu: "Cep Telefonu",
  sigorta_ettiren_kendisi_mi: "Sigorta Ettiren Kendisi mi",
  sigorta_ettiren_ad_soyad: "Sigorta Ettiren",
  sigorta_ettiren_dogum_tarihi: "Sigorta Ettiren Doğum Tarihi",
  dogum_sigortasi_eklensin: "Doğum Sigortası Eklensin mi"
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

// "belge" tipi sorular (proforma_belgesi/ruhsat_belgesi) musteriye/danismana
// ozette AYRI bir satir olarak gosterilmez - o sorunun kendi cevabi (answers[q.id])
// sadece akisi ilerletmek icin true olarak isaretleniyor (bkz. conversationEngine.js
// media islemcisi), gercek bilgi zaten marka/model/motor_no/sasi_no/tc_kimlik/plaka
// gibi AYRI alanlara yaziliyor ve onlar zaten kendi soru satirlarinda gorunuyor.
// "aile_dongu" tipi soru da (Özel Sağlık/TSS'de "Ailem (Birden Fazla)") ayni
// sebeple haric tutulur - gercek bilgi session.answers.saglik_kisiler
// dizisinde, ayrica saglikKisileriOzetSatirlariOlustur ile ozetleniyor.
function ozetlenecekSorular(flow, answers) {
  return flow.questions.filter(
    (q) => q.type !== "belge" && q.type !== "aile_dongu" && !(q.skipIf && q.skipIf(answers))
  );
}

// 28.07.2026 eklendi: Trafik/Kasko'da proforma/ruhsat OCR'inden gelen ama
// musteriye AYRICA bir soru olarak sorulmayan (flow.questions'ta karsiligi
// olmayan) ek referans bilgiler - danisman/Enbel/Bahadır bildirimlerinde
// gorunsun diye kompaktDetayOlustur ve finishFlow'daki agentMessage'a
// EKLENIYOR (musteriye gonderilen ozete DAHIL EDILMIYOR).
const ARAC_EK_BILGI_ETIKETLERI = {
  ruhsat_ad_soyad: "Ruhsattaki İsim",
  proforma_ad_soyad: "Proformadaki İsim",
  model_yili: "Model Yılı"
};
function aracEkBilgiSatirlariOlustur(session, ayrac) {
  return Object.entries(ARAC_EK_BILGI_ETIKETLERI)
    .filter(([id]) => session.answers[id])
    .map(([id, etiket]) => `${etiket}${ayrac}${session.answers[id]}`);
}

function kompaktDetayOlustur(flow, session, telefon) {
  const askedQuestions = ozetlenecekSorular(flow, session.answers);
  const alanlar = askedQuestions.map((q) => {
    const etiket = ID_KISA_ETIKET[q.id] || q.id;
    return `${etiket}: ${cevabiMetneCevir(session.answers[q.id])}`;
  });
  alanlar.push(...aracEkBilgiSatirlariOlustur(session, ": "));
  alanlar.push(...saglikKisileriOzetSatirlariOlustur(session));
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
  // (orn. kasko arac fotograflari) ya da "belge" tipindeyse (orn. Trafik/Kasko'da
  // proforma/ruhsat) kabul edilir, aksi halde nazikce "su an fotograf beklemiyoruz" denir.
  if (message.type === "media") {
    const flow = session.product ? flows[session.product] : null;
    const currentQuestion = session.state === "ASKING" && flow ? flow.questions[session.questionIndex] : null;
    const belgeSorusuMu = currentQuestion && currentQuestion.type === "belge";
    const fotoKabulEdilir = currentQuestion && (currentQuestion.type === "coklu_foto" || belgeSorusuMu);

    if (!fotoKabulEdilir) {
      await sendText(
        from,
        "Şu an bir fotoğraf beklemiyoruz, iletmek istediğiniz bilgiyi yazılı olarak paylaşabilir misiniz? 🙏"
      );
      return;
    }

    // "belge" tipi sorularda (proforma) hem fotograf hem PDF kabul edilir -
    // diger foto sorularinda (coklu_foto) eskisi gibi sadece fotograf gecerlidir.
    const mimeGecerliMi =
      message.mimeType &&
      (message.mimeType.startsWith("image/") || (belgeSorusuMu && message.mimeType === "application/pdf"));
    if (!mimeGecerliMi) {
      await sendText(
        from,
        belgeSorusuMu
          ? "Lütfen belgeyi fotoğraf ya da PDF olarak gönderir misiniz? 🙏"
          : "Lütfen sadece fotoğraf gönderin (belge/PDF değil)."
      );
      return;
    }

    // --- Belge analizi (proforma / ruhsat - Claude gorsel/dokuman analiziyle
    // marka/model/motor no/sasi no/TC kimlik/(varsa)plaka TEK SEFERDE okunur) ---
    if (belgeSorusuMu) {
      try {
        const { buffer, mimeType } = await mediaIndir(message.mediaId);
        const gercekMime = message.mimeType || mimeType;
        await sendText(from, "Belgenizi inceliyorum, bir saniye... 🔍");

        if (currentQuestion.belgeTuru === "proforma") {
          const sonuc = await proformaAnalizEt(buffer, gercekMime);
          if (!sonuc.okunabilir) {
            await sendText(
              from,
              `Belgeyi net okuyamadım 😕 ${sonuc.aciklama || ""}\n\n` +
                "Proforma belgenizi (fotoğraf ya da PDF olarak) tekrar gönderir misiniz?"
            );
            return;
          }
          if (sonuc.marka) session.answers.marka = sonuc.marka;
          if (sonuc.model) session.answers.model = sonuc.model;
          if (sonuc.motorNo) session.answers.motor_no = sonuc.motorNo;
          if (sonuc.sasiNo) session.answers.sasi_no = sonuc.sasiNo;
          if (sonuc.modelYili) session.answers.model_yili = sonuc.modelYili;
          if (sonuc.adSoyad) session.answers.proforma_ad_soyad = sonuc.adSoyad;
          if (sonuc.tcKimlik && tcKimlikGecerliMi(sonuc.tcKimlik)) session.answers.tc_kimlik = sonuc.tcKimlik;
          if (sonuc.plaka) session.answers.plaka = sonuc.plaka;

          if (!session.ekBelgeler) session.ekBelgeler = [];
          session.ekBelgeler.push({
            dosyaAdi: gercekMime === "application/pdf" ? "proforma.pdf" : "proforma.jpg",
            mimeType: gercekMime,
            veriBase64: buffer.toString("base64")
          });
          await sendText(from, "Proforma belgenizi inceledim, teşekkürler ✅");
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
          if (sonuc.plaka) session.answers.plaka = sonuc.plaka;
          if (sonuc.marka) session.answers.marka = sonuc.marka;
          if (sonuc.model) session.answers.model = sonuc.model;
          if (sonuc.motorNo) session.answers.motor_no = sonuc.motorNo;
          if (sonuc.sasiNo) session.answers.sasi_no = sonuc.sasiNo;
          if (sonuc.adSoyad) session.answers.ruhsat_ad_soyad = sonuc.adSoyad;
          if (sonuc.tcKimlik && tcKimlikGecerliMi(sonuc.tcKimlik)) session.answers.tc_kimlik = sonuc.tcKimlik;

          if (!session.ekBelgeler) session.ekBelgeler = [];
          session.ekBelgeler.push({ dosyaAdi: "ruhsat.jpg", mimeType: gercekMime, veriBase64: buffer.toString("base64") });
          await sendText(from, "Ruhsat fotoğrafınızı inceledim, teşekkürler ✅");
        }

        // Soru cevaplanmis sayilsin diye isaretliyoruz (gercek veri yukarida
        // ayri alanlara - marka/model/motor_no/sasi_no/tc_kimlik/plaka - zaten
        // yazildi; bu true degeri sadece ozette "belge" sorusunun kendisinin
        // GORUNMEMESI icin ozetlenecekSorular tarafindan zaten filtreleniyor).
        session.answers[currentQuestion.id] = true;

        session.questionIndex = nextValidIndex(flow, session.answers, session.questionIndex + 1);
        if (session.questionIndex >= flow.questions.length) {
          await finishFlow(from, session);
        } else {
          await askCurrentQuestion(from, session);
        }
      } catch (err) {
        console.error("Belge analizi hatasi:", err?.response?.data || err.message);
        await sendText(from, "Belgeyi analiz ederken bir sorun oluştu 🙏 Lütfen tekrar gönderir misiniz?");
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
  // 31.07.2026 eklendi: "URUN_BILGI_SORU" durumundayken (Sık Sorulan Sorular /
  // PDF'e dayali serbest soru-cevap modunda) musterinin yazdigi HER SEY
  // dogrudan ilgili urunun soru-cevap modulune (bkz. asagida switch icindeki
  // "URUN_BILGI_SORU" case'i) gitmeli - asagidaki SIRKET/ADRES anahtar
  // kelime kontrolu ve sozlukSSS statik SSS sozlugu bu asamada ARADA
  // KESINLIKLE DEVREYE GIRMEMELI. Aksi halde, ornegin musteri "Deviasyon
  // hakkında bilgin var mı?" gibi TAMAMEN dogal bir hastalik/teminat sorusu
  // sorduğunda (normalize edilince "hakkinda bilgi" alt dizesini icerdigi
  // icin) yanlislikla sirket tanitim metni donuyor, musterinin asil sorusu
  // hic soru-cevap motoruna ulasmiyordu (gercek musteri sikayeti). Bu yuzden
  // bu kontrolleri sadece URUN_BILGI_SORU DISINDAKI durumlarda calistiriyoruz.
  if (session.state !== "URUN_BILGI_SORU") {
    const SIRKET_ANAHTAR_KELIMELER = [
      "kimdir",
      "kimsiniz",
      "hakkinizda",
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
  }

  // Kullanıcı her an "iptal" yazarak sıfırlayabilsin
  if (/^iptal$/i.test(userText)) {
    resetSession(from);
    await sendText(from, "Talebiniz iptal edildi. Yeni bir talep için istediğiniz zaman yazabilirsiniz. 😊");
    return;
  }

  // 27.07.2026 eklendi: musteri bir sorunun ortasinda takilip kaldigini
  // hissettiginde ("Menü", "Merhaba", "Geri al", "Baştan" gibi) en basa
  // donmeyi/sifirlamayi bekliyor, ama bunlarin HICBIRI taninmiyordu - bot
  // sadece o an bekledigi soruyu (orn. secenekli bir soruyu) oldugu gibi
  // tekrar gonderiyordu (kullanicinin ekran goruntusuyle bildirdigi durum:
  // "Sigortalanacak konut size mi ait, yoksa kiracı mısınız?" sorusunda
  // "Merhaba"/"Menü"/"Geri al" yazinca soru degismeden ayni sekilde tekrar
  // geliyordu). Asagidaki kelimelerden biri TEK BASINA (baska bir cevabin
  // PARCASI degil, tam esit) yazilirsa oturumu sifirlayip musteriyi
  // baslaYeniKonusma ile yeniden karsiliyoruz - bu musteri zaten biliniyorsa
  // (ismi/KVKK onayi kalici profilde varsa) dogrudan urun secimine donuyor,
  // bilinmiyorsa normal karsilama akisindan devam ediyor. NEW durumundayken
  // zaten ayni fonksiyon cagriliyor oldugu icin (case "NEW"), tekrar
  // tetiklememek adina sadece NEW DISI durumlarda calisiyor.
  const SIFIRLAMA_KELIMELERI = [
    "menu", // "menü" -> normalizeTr sonrasi
    "ana menu",
    "anamenu",
    "anasayfa",
    "bastan",
    "yeniden basla",
    "geri al",
    "geri",
    "merhaba",
    "selam"
  ];
  if (session.state !== "NEW" && SIFIRLAMA_KELIMELERI.includes(normalizedUserText.trim())) {
    resetSession(from);
    await baslaYeniKonusma(from, getSession(from), userText);
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
        ASK_PRODUCT_SECENEKLERI
      );
      break;
    }

    case "ASK_PRODUCT": {
      // WhatsApp liste mesajlarinda secenekler 24 karakterle sinirli, uzun urun
      // isimleri (orn. "Prim Iadeli Hayat Sigortasi") kesilerek geri donebiliyor.
      // Bu yuzden tam eslesme yerine matchOption'in esnek/on-ek toleransli
      // eslestirmesini kullaniyoruz. Liste, gercek urunlere ek olarak EN ALTA
      // "Sık Sorulan Sorular" secenegini de iceriyor (bkz. ASK_PRODUCT_SECENEKLERI) -
      // bu secilirse musteri urun-secimli SSS akisina (ASK_INFO_PRODUCT) yonlendirilir.
      const matchedLabel = matchOption(userText, ASK_PRODUCT_SECENEKLERI);
      if (!matchedLabel) {
        await sendList(
          from,
          "Üzgünüm, listeden bir seçenek seçmeniz gerekiyor. Lütfen tekrar seçin:",
          "Ürün Seç",
          ASK_PRODUCT_SECENEKLERI
        );
        break;
      }
      if (matchedLabel === SSS_ETIKETI) {
        session.state = "ASK_INFO_PRODUCT";
        await sendList(
          from,
          "Hangi ürünle ilgili sorunuz var?",
          "Ürün Seç",
          INFO_PRODUCT_LABELS
        );
        break;
      }
      const idx = PRODUCT_LABELS.indexOf(matchedLabel);
      const devredildi = await startProductFlow(from, session, PRODUCT_KEYS[idx]);
      if (!devredildi) await askCurrentQuestion(from, session);
      break;
    }

    case "ASK_INFO_PRODUCT": {
      const matchedInfoLabel = matchOption(userText, INFO_PRODUCT_LABELS);
      if (!matchedInfoLabel) {
        await sendList(
          from,
          "Üzgünüm, listeden bir seçenek seçmeniz gerekiyor. Lütfen tekrar seçin:",
          "Ürün Seç",
          INFO_PRODUCT_LABELS
        );
        break;
      }
      const infoIdx = INFO_PRODUCT_LABELS.indexOf(matchedInfoLabel);
      const infoKey = INFO_PRODUCT_KEYS[infoIdx];

      // 31.07.2026 eklendi: "Bireysel Emeklilik(BES)" secildiginde, TSS/ÖSS/
      // Doğum'un aksine serbest soru-cevap moduna GIRILMIYOR (BES icin PDF'e
      // dayanan boyle bir motor yok) - onun yerine eskiden SADECE danismanlara
      // ozel bir menu secenegi olan "BES Fonları" icerigi (fon listesi + best-
      // effort guncel getiriler) artik musterilere de dogrudan gosteriliyor
      // (kullanicinin talebi), sonra urun listesi tekrar sunuluyor.
      if (infoKey === "bes") {
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
        await sendList(
          from,
          "Başka bir ürünle ilgili bilgi almak ister misiniz? Yoksa ana menüye dönmek için \"ana menü\" yazabilirsiniz.",
          "Ürün Seç",
          INFO_PRODUCT_LABELS
        );
        break;
      }

      if (BILGI_SORU_MODULLERI[infoKey]) {
        session.state = "URUN_BILGI_SORU";
        // Hangi urunun (dolayisiyla hangi PDF'e dayanan modulun) secildigini
        // sakliyoruz - TSS ve ÖSS artik AYRI belgelere dayandigi icin, soru
        // geldiginde dogru modulu cagirabilmemiz gerekiyor (bkz. asagida
        // "URUN_BILGI_SORU" case'i).
        session.bilgiUrunAnahtari = infoKey;
        await sendText(
          from,
          `${INFO_LABEL_BY_KEY[infoKey]} ile ilgili merak ettiğiniz her şeyi sorabilirsiniz - ` +
            "örneğin bir hastalığın/tedavinin poliçe kapsamında olup olmadığı, bekleme süreleri, " +
            "istisnalar vb. 😊\n\nSorunuzu yazabilirsiniz."
        );
      } else {
        await sendText(
          from,
          `${INFO_LABEL_BY_KEY[infoKey]} için şu an otomatik bilgi hizmetimiz bulunmuyor. ` +
            "Bu konuyla ilgili danışmanınızla görüşmenizi öneririz 🙏"
        );
        await sendList(
          from,
          "Başka bir ürünle ilgili bilgi almak ister misiniz? Yoksa ana menüye dönmek için \"ana menü\" yazabilirsiniz.",
          "Ürün Seç",
          INFO_PRODUCT_LABELS
        );
      }
      break;
    }

    case "URUN_BILGI_SORU": {
      // 31.07.2026 eklendi: musteri sadece "teşekkürler" gibi bir kapanis
      // ifadesi yazdiginda, bu metin YANLISLIKLA soru-cevap moduluna (AI)
      // gonderiliyordu - AI kibarca "Rica ederim..." gibi bir cevap
      // uretiyordu, ardindan kod HER ZAMAN ekledigi "Başka bir sorunuz var
      // mı?..." takip mesajini da gonderiyordu - musteriye ust uste iki mesaj
      // gidiyordu (kullanicinin bildirdigi hata). Artik boyle bir kapanis
      // ifadesi TEK BASINA gelirse AI'a hic sorulmuyor, TEK bir kisa tesekkur
      // cevabi gonderiliyor.
      if (KAPANIS_IFADE_REGEX.test(normalizeTr(userText.trim()))) {
        await sendText(
          from,
          "Rica ederim, her zaman yardımcı olmaktan memnuniyet duyarız! 😊 Başka bir sorunuz olursa buradayım."
        );
        break;
      }
      // session.bilgiUrunAnahtari, ASK_INFO_PRODUCT'ta hangi urun secildigini
      // (dolayisiyla hangi PDF'e dayanan modulun kullanilacagini) tutuyor.
      // Beklenmedik sekilde bos gelirse (orn. eski bir oturumdan kalma), TSS'e
      // dusuyoruz - ama normal akiste bu alan her zaman dolu olmali.
      const modul = BILGI_SORU_MODULLERI[session.bilgiUrunAnahtari] || tssOzelSartSSS;
      const cevap = await modul.soruyaCevapVer(userText);
      await sendText(from, cevap);
      await sendText(
        from,
        "Başka bir sorunuz var mı? Yoksa ana menüye dönmek için \"ana menü\" yazabilirsiniz. 😊"
      );
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

      // "Ailem (Birden Fazla)" secilen Özel Sağlık/TSS akışında devreye giren
      // esin/cocuklarin bilgilerini toplama dongusu - tamamen kendi ic durum
      // makinesini (session.saglikAileAsama) yoneten saglikAileCevabiIsle
      // fonksiyonuna devrediliyor (bkz. o fonksiyonun ustundeki genis yorum).
      if (currentQuestion.type === "aile_dongu") {
        const tamamlandiMi = await saglikAileCevabiIsle(from, session, userText);
        if (tamamlandiMi) {
          session.answers[currentQuestion.id] = true;
          session.questionIndex = nextValidIndex(flow, session.answers, session.questionIndex + 1);
          if (session.questionIndex >= flow.questions.length) {
            await finishFlow(from, session);
          } else {
            await askCurrentQuestion(from, session);
          }
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

        // 28.07.2026 eklendi: DASK/Konut/Malpraktis'teki "hedef_kisi" ("kendiniz
        // için mi, başkası için mi") sorusuna "Kendim İçin" cevabi verildiyse,
        // musterinin ismi zaten biliniyor (session.name - "Merhaba" akisinda
        // alinmisti) - flows.js'teki bu urunlerin "ad_soyad" sorusunda artik
        // sameAsAccountHolder KULLANILMIYOR (cunku hangi ismin gecerli oldugu
        // hedef_kisi cevabina bagli, flow BASLARKEN henuz bilinmiyordu) - onun
        // yerine burada, hedef_kisi cevaplanir cevaplanmaz, "Kendim İçin"
        // ise ad_soyad'i simdi dolduruyoruz ki nextValidIndex bu soruyu
        // (zaten cevaplanmis sayarak) atlasin. "Başkası İçin" ise hicbir sey
        // yapmiyoruz, ad_soyad sorusu normal sekilde (o kisinin ismini
        // isteyerek) sorulacak.
        if (currentQuestion.id === "hedef_kisi" && validOption === "Kendim İçin" && session.name) {
          session.answers.ad_soyad = session.name;

          // 28.07.2026: "Kendim İçin" ise VE bu urunde kaliciProfilAlani ===
          // "tcKimlik" ile isaretli bir soru varsa (su an sadece Malpraktis'te),
          // musterinin daha once kaydedilmis T.C. kimlik numarasini simdi
          // onceden dolduruyoruz ki tekrar sorulmasin. "Başkası İçin" durumunda
          // BU KISIM HIC CALISMAZ (yukaridaki if kosulu "Kendim İçin"e
          // ozel) - baskasi icin her zaman TC yeniden sorulur, kendi kayitli
          // TC'mizi baskasina yazma hatasi bu sayede engellenmis olur.
          const flow = flows[session.product];
          const kaliciProfil = musteriProfilStore.profilGetir(from);
          const tcKimlikSorusu = flow && flow.questions.find((q) => q.kaliciProfilAlani === "tcKimlik");
          if (kaliciProfil && kaliciProfil.tcKimlik && tcKimlikSorusu) {
            session.answers[tcKimlikSorusu.id] = kaliciProfil.tcKimlik;
          }
        }

        // 28.07.2026 eklendi: Özel Sağlık/TSS'te "kimin_icin" sorusuna "Kendim"
        // ya da "Ailem (Birden Fazla)" cevabi verildiyse (her iki durumda da
        // ilk sigortalanacak kisi musterinin KENDISIDIR), ismi zaten
        // biliniyor - "sigortalanacak kişi kendisiyse müşteriye yeniden isim
        // soyisim sormaya gerek yok" (kullanicinin acik talebi). "Eşim"/
        // "Çocuğum" durumunda bu blok calismaz, ad_soyad sorusu normal
        // sekilde (o kisinin ismini isteyerek) sorulur.
        if (
          currentQuestion.id === "kimin_icin" &&
          (validOption === "Kendim" || validOption === "Ailem (Birden Fazla)") &&
          session.name
        ) {
          session.answers.ad_soyad = session.name;
        }

        // 28.07.2026 eklendi: "sigorta ettiren siz mi olacaksınız" sorusuna
        // "Evet" cevabi verildiyse VE ilk sigortalanan kisi zaten musterinin
        // kendisiyse (kimin_icin === Kendim/Ailem - yani dogum_tarihi zaten
        // musterinin KENDI dogum tarihidir), "kendi kendini sigorta
        // ettirecekse tc doğum tarihini zaten bir kere sorarız" (kullanicinin
        // acik talebi) - dogum tarihi tekrar sorulmadan kopyalanir, ayrica
        // kalici profilde TC varsa o da onceden doldurulur. "Eşim"/"Çocuğum"
        // tek basina secildiyse musterinin KENDI dogum tarihi hic
        // sorulmadigindan (sigortalanan kisi baskasi) bu kisayol
        // UYGULANMAZ - sigorta ettirenin (musterinin kendisinin) dogum
        // tarihi ve TC'si bu durumda normal sekilde/fresh sorulur.
        if (currentQuestion.id === "sigorta_ettiren_kendisi_mi" && validOption === "Evet") {
          const kendiBilgisiBilinior =
            session.answers.kimin_icin === "Kendim" || session.answers.kimin_icin === "Ailem (Birden Fazla)";
          if (kendiBilgisiBilinior) {
            session.answers.sigorta_ettiren_dogum_tarihi = session.answers.dogum_tarihi;
            const kaliciProfil = musteriProfilStore.profilGetir(from);
            if (kaliciProfil && kaliciProfil.tcKimlik) {
              session.answers.tc_kimlik = kaliciProfil.tcKimlik;
            }
          }
        }
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
        // ONEMLI (28.07.2026): "Başkası İçin" durumunda burada girilen TC
        // musterinin KENDI TC'si DEGIL, sigortalanan baska birinin TC'sidir -
        // bu durumda ASLA musteriProfilStore'a (bu telefon numarasinin kendi
        // profiline) kaydetmiyoruz, aksi halde bir dahaki sefere musteri
        // KENDI adina bir sey yaptirmak istediginde yanlislikla baskasinin
        // TC'si onceden doldurulmus olurdu. AYNI riskin Özel Sağlık/TSS
        // esdegeri: "sigorta ettiren" musterinin KENDISI degilse (sigorta_ettiren_kendisi_mi
        // === "Hayır"), buradaki TC musterinin degil BASKA bir "sigorta
        // ettiren"in TC'sidir - o durumda da ASLA kaydetmiyoruz.
        if (
          currentQuestion.kaliciProfilAlani === "tcKimlik" &&
          !baskasiIcinMi(session.answers) &&
          session.answers.sigorta_ettiren_kendisi_mi !== "Hayır"
        ) {
          musteriProfilStore.profilGuncelle(from, { tcKimlik: session.answers[currentQuestion.id] });
        }

        // 28.07.2026: Malpraktis'te "bağlı olduğunuz sağlık kurumu" cevabinda
        // zaten bir sehir adi geciyorsa (orn. "İstanbul Üniversitesi Hastanesi"),
        // ayrica sehir sormaya gerek yok - cevaptan sehri otomatik cikarip
        // dolduruyoruz ki SEHIR_SORU (nextValidIndex'in "already answered"
        // kontrolu sayesinde) otomatik atlansin.
        if (currentQuestion.id === "saglik_kurumu") {
          const bulunanSehir = sehirAdiBul(session.answers.saglik_kurumu);
          if (bulunanSehir) {
            session.answers.sehir = bulunanSehir;
          }
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

  // "aile_dongu" tipi soruya ILK defa gelindiginde ic durum makinesini
  // baslatiyoruz (bkz. saglikAileSorusunuSor/saglikAileCevabiIsle'in
  // ustundeki genis yorum) - gercek metin/secenekler bu ozel fonksiyondan
  // gonderiliyor, q.text/q.options burada KULLANILMAZ.
  if (q.type === "aile_dongu") {
    if (!session.saglikAileAsama) session.saglikAileAsama = "ES_SORULUYOR";
    await saglikAileSorusunuSor(from, session);
    return;
  }

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
  // "belge" tipi sorular da (proforma_belgesi/ruhsat_belgesi) haric tutulur -
  // bkz. ozetlenecekSorular yorumu.
  const askedQuestions = ozetlenecekSorular(flow, session.answers);
  const summaryLines = askedQuestions.map((q) => {
    const questionText = resolveText(q, session.answers);
    return `- ${questionText.replace(/\?$/, "")}: ${cevabiMetneCevir(session.answers[q.id])}`;
  });
  // Bazi urunlerde (orn. Malpraktis'te hekimlere) isim+soyisimden sonra
  // "Hocam" diye hitap ediyoruz. flow.hitapHocam true ise bunu uygula.
  // 29.07.2026 DUZELTILDI: eskiden burada sadece ILK AD kullanilip soyisim
  // atiliyordu ("Mehmet Hocam") - kullanicinin talebi uzerine ("Başkası İçin"
  // durumunda/genel olarak sadece isimle hitap etmek olmaz) artik TAM isim
  // (isim + soyisim) korunuyor ("Mehmet Yılmaz Hocam").
  const hitapIsmi = flow.hitapHocam && session.name ? `${session.name} Hocam` : session.name;

  // Özel Sağlık/TSS'te "Ailem (Birden Fazla)" ile toplanan eş/çocuk bilgileri
  // (session.answers.saglik_kisiler) flow.questions'ta karsiligi olmadigi
  // icin summaryLines'a dahil DEGIL - musteriye kendi ozetinde de (kendi
  // ailesi oldugu icin sakincasi yok) gorunsun diye ayrica ekleniyor.
  const saglikKisiSatirlari = saglikKisileriOzetSatirlariOlustur(session).map((satir) => `- ${satir}`);

  const customerSummary =
    `Teşekkürler ${hitapIsmi}! ${flow.label} talebiniz için gerekli bilgileri aldık. ` +
    `Ekibimiz en kısa sürede sizinle iletişime geçip teklifinizi iletecek. 🙏\n\n` +
    `Özet:\n${summaryLines.join("\n")}` +
    (saglikKisiSatirlari.length ? "\n" + saglikKisiSatirlari.join("\n") : "");

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
  // Trafik/Kasko'da proforma/ruhsat OCR'inden gelen ama musteriye ayrica
  // sorulmayan referans bilgiler (orn. ruhsattaki isim musterinin verdigi
  // isimden farkliysa) sadece bu ekip bildirimine ekleniyor, musteriye
  // gonderilen customerSummary'ye DAHIL EDILMIYOR.
  const aracEkBilgiSatirlari = aracEkBilgiSatirlariOlustur(session, ": ").map((satir) => `- ${satir}`);
  const agentMessage =
    `\u{1F4CB} Yeni iş talebi geldi\n` +
    `Müşteri: ${session.name}\n` +
    `Telefon: ${from}\n` +
    `Ürün: ${flow.label}\n` +
    (belirtilenDanismanAdi ? `Danışman: ${belirtilenDanismanAdi}\n` : "") +
    `\n` +
    summaryLines.join("\n") +
    (aracEkBilgiSatirlari.length ? "\n" + aracEkBilgiSatirlari.join("\n") : "") +
    (saglikKisiSatirlari.length ? "\n" + saglikKisiSatirlari.join("\n") : "");
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

// 31.07.2026 eklendi: gunluk 09:30 "Bekleyen İşler" ozeti icin AYRI bir
// gonderim fonksiyonu. Bu ozet bir sure hatirlatmaGonder ile (yani
// AGENT_DETAY_TEMPLATE_NAME sablonuyla) gonderiliyordu - bu, mesajin HER GUN
// kesin ulasmasini sagliyordu (bkz. server.js'teki 31.07.2026 tarihli detayli
// yorum, 131047 "Re-engagement message" hatasi), AMA o sablonun basligi
// "YENI TALEP" bildirimleri icin onaylanmisti ("Yeni bir talep geldi!" gibi) -
// sabah sabah gelen bir gunluk ozetin basinda bu baslik anlamsiz/tuhaf
// duruyordu (kullanicinin 31.07.2026 geri bildirimi). Bu yuzden GUNLUK OZETE
// OZEL, dogru basliga sahip AYRI bir sablon (GUNLUK_OZET_TEMPLATE_NAME - bkz.
// server.js'teki /api/panel/gunluk-ozet-sablonu-olustur, .env.example)
// hazirlandi. Meta onayi ZAMAN alabilecegi (ve her ortamda hemen
// ayarlanmis olmayabilecegi) icin: ONCE bu YENI ozel sablon denenir (dogru
// baslik + guvenilir teslimat), o basarisiz olursa VEYA henuz
// tanimlanmamissa (env degiskeni bos, yani sablon Meta onayini bekliyor
// olabilir) ESKI genel AGENT_DETAY_TEMPLATE_NAME'e (hatirlatmaGonder)
// dusulur - boylece gecis surecinde bile guvenilirlik HIC kaybedilmez,
// sadece baslik gecici olarak eski/yanlis kalir.
async function gunlukOzetGonder(numara, metin) {
  const gunlukSablonAdi = process.env.GUNLUK_OZET_TEMPLATE_NAME;
  if (gunlukSablonAdi) {
    try {
      await sendTemplate(numara, gunlukSablonAdi, "tr", { detay: sablonParametresiIcinTemizle(metin) }, metin);
      return;
    } catch (err) {
      console.error(
        "Günlük özet şablonu gönderilemedi, genel hatırlatma şablonuna düşülüyor:",
        err?.response?.data || err.message
      );
    }
  }
  await hatirlatmaGonder(numara, metin); // basarisiz olursa hata cagirana ULASIR (hatirlatmaGonder'daki NOT'a bakin)
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
  // 31.07.2026 DUZELTILDI: musteriye HICBIR ZAMAN sadece ilk adiyla hitap
  // edilmiyor (kullanicinin talebi - her zaman TAM isim-soyisim ve "siz"li
  // resmi dil kullaniliyor) - bu yuzden ilk ad KIRPILMIYOR, musteriAdi (tam
  // ad-soyad) oldugu gibi kullaniliyor.
  const tamAd = (musteriAdi || "").trim();
  const metin =
    `Merhaba ${tamAd}! 😊 ${urunAdi} işleminizin üzerinden birkaç gün geçti, umarız her şey yolundadır.\n\n` +
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
  gunlukOzetGonder,
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
  sablonParametresiIcinTemizle,
  // 28.07.2026 eklendi: danismanin musteri adina WhatsApp'tan yeni talep
  // olusturdugu akis (advisorEngine.js -> DANISMAN_YENI_SORU), Trafik/Kasko'nun
  // "belge" (proforma/ruhsat OCR) ve Ozel Saglik/TSS'nin "aile_dongu" (esin/
  // cocuklarin toplanmasi) soru tiplerini DE desteklemesi icin bu yardimci
  // fonksiyonlar disari aciliyor - boylece ayni mantik iki yerde ayri ayri
  // yazilip birbirinden sapmiyor. saglikAileSorusunuSor/saglikAileCevabiIsle
  // "session" olarak SADECE .answers/.saglikAileAsama/.saglikAileGecici
  // alanlarina ihtiyac duyuyor - advisorEngine.js kendi session'i (danismanin
  // KENDI oturumu) uzerinde bu isimlerle CATISMAMASI icin bir "shim" (vekil
  // nesne, get/set ile session.danismanYeniAnswers/danismanSaglikAileAsama/
  // danismanSaglikAileGecici alanlarina yonlendiren) kullanarak cagiriyor.
  ozetlenecekSorular,
  aracEkBilgiSatirlariOlustur,
  saglikAileSorusunuSor,
  saglikAileCevabiIsle,
  saglikKisileriOzetSatirlariOlustur,
  // 31.07.2026 eklendi: danismanlarin WhatsApp panelindeki "Sık Sorulan
  // Sorular" ozelligi (advisorEngine.js -> sssUrunSecBaslat/DANISMAN_SSS_*),
  // musteri tarafindakiyle AYNI urun listesini ve AYNI PDF'e dayanan
  // soru-cevap modullerini kullaniyor - boylece iki tarafta ayri ayri
  // bakim gerektiren, birbirinden sapabilecek iki liste/mantik olmuyor.
  BILGI_SORU_MODULLERI,
  INFO_PRODUCT_KEYS,
  INFO_PRODUCT_LABELS,
  INFO_LABEL_BY_KEY
};
