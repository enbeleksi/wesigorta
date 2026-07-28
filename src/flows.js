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
  telefonGecerliMi,
  tarihiMsYap
} = require("./validators");
// 28.07.2026 eklendi: rastgele bir musteri/ucuncu-sahis ismine "'ın/'in/'un/'ün"
// (tamlayan) ya da "'a/'e" (yonelme) eki eklerken artik sabit bir ek yerine
// ismin gercek son unlusune gore dogru eki hesaplayan kucuk gramer modulu
// kullaniliyor - bkz. turkceGramer.js'teki genis yorum (neden bagimsiz bir npm
// paketi degil de burada yazildigi dahil).
const { tamlayanEkiUygula, yonelmeEkiUygula } = require("./turkceGramer");

const MESLEK_SORU = {
  id: "meslek",
  // 28.07.2026: DASK/Konut'ta "başkası için" secilmisse meslek de o kisi
  // uzerinden soruluyor (bkz. asagida kisiyeGoreMetin) - Trafik/Kasko gibi
  // hedef_kisi kavrami OLMAYAN urunlerde answers.hedef_kisi hic set
  // edilmeyecegi icin kisiyeGoreMetin dogal olarak ikinci sahis metnine duser,
  // bu urunlerde davranis DEGISMEZ.
  text: (answers) =>
    kisiyeGoreMetin(
      answers,
      "Mesleğinizi paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz, bu yüzden soruyoruz 😊",
      (isim) =>
        `${tamlayanEkiUygula(isim)} mesleğini paylaşır mısınız? 💼 Bazı meslek gruplarına özel indirimler uygulayabiliyoruz, bu yüzden soruyoruz 😊`
    ),
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
  type: "text",
  // 28.07.2026: Ozel Saglik/TSS'de kullanicinin talebi geregi - 18 yas alti
  // cocuklarda meslek bilgisi istenmiyor. Bu sabit SADECE bu iki urunde
  // kullanildigi icin skipIf'i buraya (genel tanima) eklemek guvenli.
  skipIf: (answers) => !saglikYetiskinMi(answers.dogum_tarihi)
};

// --- Özel Sağlık/TSS yeniden tasarim yardimcilari (28.07.2026 eklendi) ---
// dogumTarihi GG.AA.YYYY formatinda gecerli bir tarihse yasini hesaplayip 18
// ve uzeri mi diye bakar (cep telefonu/meslek sorulari SADECE yetiskinlerden
// isteniyor). Tarih ayristirilamiyorsa (beklenmeyen bir durum) guvenli
// tarafta kalip yetiskin kabul eder - soru gereksiz yere atlanmasin diye.
function saglikYetiskinMi(dogumTarihi) {
  const ms = tarihiMsYap(dogumTarihi);
  if (ms === null) return true;
  const yasYil = (Date.now() - ms) / (365.25 * 24 * 60 * 60 * 1000);
  return yasYil >= 18;
}

// Ozel Saglik/TSS'de "kimin_icin" cevabina gore (Kendim/Eşim/Çocuğum/Ailem)
// soru metnini secer. "Kendim" ve "Ailem (Birden Fazla)" AYNI davranir, cunku
// "Ailem" durumunda bu STATIK sorular (ad_soyad/dogum_tarihi/cinsiyet/boy_kilo/
// il_ilce/cep_telefonu/meslek) HER ZAMAN musterinin KENDI bilgilerini soruyor -
// esin ve cocuklarin bilgileri AYRI bir mekanizmayla (asagidaki "aile_dongu"
// tipi soru, bkz. conversationEngine.js) toplanıyor.
function saglikKisiyeGoreMetin(answers, kendimMetni, esinMetni, cocugunMetni) {
  if (answers.kimin_icin === "Eşim") return esinMetni;
  if (answers.kimin_icin === "Çocuğum") return cocugunMetni;
  return kendimMetni;
}

const CEP_TELEFONU_SORU_SAGLIK = {
  id: "cep_telefonu",
  text: (answers) =>
    saglikKisiyeGoreMetin(
      answers,
      "Cep telefonu numaranızı paylaşır mısınız? 📱",
      "Eşinizin cep telefonu numarasını paylaşır mısınız? 📱",
      "Çocuğunuzun cep telefonu numarasını paylaşır mısınız? 📱"
    ),
  danismanText: "Sigortalının cep telefonu numarasını paylaşır mısınız?",
  type: "text",
  validate: telefonGecerliMi,
  validationError: "Girilen numara geçerli görünmüyor, lütfen tekrar yazar mısınız? (Örn: 05551234567)",
  // Kullanicinin talebi geregi: 18 yas alti cocuklardan cep telefonu istenmiyor.
  skipIf: (answers) => !saglikYetiskinMi(answers.dogum_tarihi)
};

// "Ailem (Birden Fazla)" secildiginde, musterinin KENDI bilgilerinden sonra
// devreye giren, esin (istege bagli) ve SINIRSIZ SAYIDA cocugun bilgilerini
// toplayan ozel soru tipi. Gercek soru-cevap dongusu tamamen
// conversationEngine.js'teki saglikAileSorusunuSor/saglikAileCevabiIsle
// fonksiyonlarinda yonetiliyor (bkz. o dosyadaki genis yorum) - buradaki
// "text" alani sadece guvenlik agi/danisman-modu icin bir yer tutucudur,
// musteriye ASLA bu haliyle gosterilmez.
const AILE_BIREYLERI_DONGUSU_SORUSU = {
  id: "aile_bireyleri",
  text: "Eşinizi ve çocuklarınızı da poliçeye eklemek ister misiniz?",
  danismanText: "Sigortalıyla birlikte poliçeye eklenecek eş/çocuk var mı?",
  type: "aile_dongu",
  skipIf: (answers) => answers.kimin_icin !== "Ailem (Birden Fazla)"
};

const SIGORTA_ETTIREN_KENDISI_MI_SORU = {
  id: "sigorta_ettiren_kendisi_mi",
  text:
    "Bu arada, sigorta ettiren (poliçenin sahibi/ödeyicisi) siz mi olacaksınız? 💰 Sigorta ettiren olan kişi, " +
    "ödediği primler için vergi avantajından yararlanabiliyor - bu yüzden bu bilgiyi ayrıca soruyoruz.",
  danismanText: "Sigorta ettiren (poliçenin sahibi/ödeyicisi) sigortalının kendisi mi olacak?",
  type: "choice",
  options: ["Evet", "Hayır"]
};

const SIGORTA_ETTIREN_AD_SOYAD_SORU = {
  id: "sigorta_ettiren_ad_soyad",
  text: "Sigorta ettirenin ismini ve soyismini paylaşır mısınız?",
  danismanText: "Sigorta ettirenin ismini ve soyismini paylaşır mısınız?",
  type: "text",
  skipIf: (answers) => answers.sigorta_ettiren_kendisi_mi !== "Hayır"
};

// Sigorta ettiren kendisiyse (Evet) VE musterinin kendi dogum tarihi zaten
// biliniyorsa (kimin_icin === Kendim/Ailem - yani yukarida zaten bir kere
// soruldu), conversationEngine.js bu soruyu OTOMATIK dolduruyor (tekrar
// sorulmuyor - kullanicinin acik talebi: "kendi kendini sigorta ettirecekse
// tc doğum tarihini zaten bir kere sorarız"). Diger tum durumlarda normal
// sekilde sorulur.
const SIGORTA_ETTIREN_DOGUM_TARIHI_SORU = {
  id: "sigorta_ettiren_dogum_tarihi",
  text: (answers) =>
    answers.sigorta_ettiren_kendisi_mi === "Hayır"
      ? "Sigorta ettirenin doğum tarihini paylaşır mısınız? (GG.AA.YYYY)"
      : "Doğum tarihinizi paylaşır mısınız? (GG.AA.YYYY)",
  danismanText: "Sigorta ettirenin doğum tarihini paylaşır mısınız? (GG.AA.YYYY)",
  type: "text",
  validate: tarihGecerliMi,
  validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.1990)"
};

// TC kimlik artik ACIKCA "sigorta ettiren"e ait - sigortalanan kisiden farkli
// olabilir (orn. baba cocugunu sigortalatiyor ama primi kendisi odeyip vergi
// avantajindan kendisi yararlaniyor). kaliciProfilAlani ile isaretlendigi icin
// conversationEngine.js bunu musterinin kalici profiline kaydediyor - AMA
// SADECE sigorta ettiren gercekten musterinin kendisiyse (bkz.
// conversationEngine.js'deki ek kontrol, DASK/Konut/Malpraktis'teki
// baskasiIcinMi kontrolunun saglik urunlerindeki esdegeri).
const SIGORTA_ETTIREN_TC_KIMLIK_SORU = {
  id: "tc_kimlik",
  text: (answers) =>
    answers.sigorta_ettiren_kendisi_mi === "Hayır"
      ? "Teklifinizi hazırlayabilmemiz için son olarak sigorta ettirenin T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır."
      : "Teklifinizi hazırlayabilmemiz için son olarak T.C. kimlik numaranıza ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
  danismanText:
    "Teklifi hazırlayabilmemiz için son olarak sigorta ettirenin T.C. kimlik numarasına ihtiyacımız var. Bu bilgi sadece teklif hazırlığı amacıyla kullanılacak ve güvenle saklanacaktır.",
  type: "text",
  validate: tcKimlikGecerliMi,
  validationError:
    "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?",
  kaliciProfilAlani: "tcKimlik"
};

// ozel_saglik ve tss TAMAMEN ayni soru dizisini kullaniyor (sadece
// urun etiketi/danisman numarasi farkli) - kopya/kayma riskini onlemek icin
// TEK bir fonksiyondan uretiliyor, her cagirimda TAZE bir dizi donduruluyor.
function saglikUrunuSorulari() {
  return [
    ...DANISMAN_SORULARI,
    {
      id: "kimin_icin",
      text: "Kimin için sigorta yaptırmak istiyorsunuz?",
      type: "choice",
      options: ["Kendim", "Eşim", "Çocuğum", "Ailem (Birden Fazla)"],
      danismandaGizle: true
    },
    {
      id: "ad_soyad",
      text: (answers) =>
        saglikKisiyeGoreMetin(
          answers,
          "İsim ve soyisminizi paylaşır mısınız?",
          "Eşinizin ismini ve soyismini paylaşır mısınız?",
          "Çocuğunuzun ismini ve soyismini paylaşır mısınız?"
        ),
      type: "text"
      // NOT: "Kendim" ve "Ailem (Birden Fazla)" durumunda bu soru
      // conversationEngine.js'deki ozel bir kanca ile OTOMATIK dolduruluyor
      // (musterinin ismi zaten biliniyor - kullanicinin acik talebi:
      // "sigortalanacak kişi kendisiyse müşteriye yeniden isim soyisim
      // sormaya gerek yok"), bu yuzden burada skipIf'e gerek YOK -
      // nextValidIndex'teki "already answered" kontrolu otomatik atliyor.
    },
    {
      id: "dogum_tarihi",
      text: (answers) =>
        saglikKisiyeGoreMetin(
          answers,
          "Doğum tarihinizi belirtir misiniz? (GG.AA.YYYY)",
          "Eşinizin doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
          "Çocuğunuzun doğum tarihini belirtir misiniz? (GG.AA.YYYY)"
        ),
      danismanText: "Doğum tarihini belirtir misiniz? (GG.AA.YYYY)",
      type: "text",
      validate: tarihGecerliMi,
      validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.1990)"
    },
    {
      id: "cinsiyet",
      text: (answers) =>
        saglikKisiyeGoreMetin(answers, "Cinsiyetiniz nedir?", "Eşinizin cinsiyeti nedir?", "Çocuğunuzun cinsiyeti nedir?"),
      danismanText: "Sigortalanacak kişinin cinsiyeti nedir?",
      type: "choice",
      options: ["Kadın", "Erkek"]
    },
    {
      id: "boy_kilo",
      text: (answers) =>
        saglikKisiyeGoreMetin(
          answers,
          "Boyunuzu ve kilonuzu paylaşır mısınız? (Örn: 170 cm / 70 kg)",
          "Eşinizin boyunu ve kilosunu paylaşır mısınız? (Örn: 170 cm / 70 kg)",
          "Çocuğunuzun boyunu ve kilosunu paylaşır mısınız? (Örn: 120 cm / 25 kg)"
        ),
      danismanText: "Boyunu ve kilosunu paylaşır mısınız? (Örn: 170 cm / 70 kg)",
      type: "text"
    },
    {
      id: "il_ilce",
      text: (answers) =>
        saglikKisiyeGoreMetin(
          answers,
          "İkamet ettiğiniz il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)",
          "Eşinizin ikamet ettiği il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)",
          "Çocuğunuzun ikamet ettiği il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)"
        ),
      danismanText: "İkamet ettiği il ve ilçeyi belirtir misiniz? (Örn: İstanbul / Kadıköy)",
      type: "text"
    },
    { ...CEP_TELEFONU_SORU_SAGLIK },
    { ...MESLEK_SORU_UCUNCU_SAHIS },
    { ...AILE_BIREYLERI_DONGUSU_SORUSU },
    { ...SIGORTA_ETTIREN_KENDISI_MI_SORU },
    { ...SIGORTA_ETTIREN_AD_SOYAD_SORU },
    { ...SIGORTA_ETTIREN_DOGUM_TARIHI_SORU },
    { ...SIGORTA_ETTIREN_TC_KIMLIK_SORU }
  ];
}

const TC_KIMLIK_SORU = {
  id: "tc_kimlik",
  // 28.07.2026: Malpraktis'te "başkası için" durumunda hedef kisinin T.C.
  // kimlik numarasi isteniyor - diger urunlerde (hedef_kisi hic set
  // edilmedigi icin) davranis degismiyor.
  text: (answers) =>
    kisiyeGoreMetin(
      answers,
      "Son olarak T.C. kimlik numaranızı yazar mısınız?",
      (isim) => `Son olarak ${tamlayanEkiUygula(isim)} T.C. kimlik numarasını yazar mısınız?`
    ),
  danismanText: "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız?",
  type: "text",
  validate: tcKimlikGecerliMi,
  validationError:
    "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?",
  // Bu soru ACIKCA musterinin KENDI T.C. kimligini soruyor (Trafik/Kasko'daki
  // TC_KIMLIK_ISIMLE_SORU'nun aksine - orada arac/ruhsat baskasina ait olabilir,
  // ya da proforma uzerindeki isim ustunden soruluyor olabilir). Bu yuzden SADECE burada
  // kaliciProfilAlani isaretlenir: conversationEngine.js bu cevabi musterinin
  // kalici profiline (musteriProfilStore) kaydedip, bir sonraki HER urunde
  // otomatik doldurur, boylece ayni musteriye TC'si bir daha sorulmaz.
  kaliciProfilAlani: "tcKimlik"
};

// --- Trafik/Kasko yeniden tasarim yardimcilari (28.07.2026 eklendi) ---
// Eskiden Trafik/Kasko'da plaka + ruhsat seri no (yazarak ya da tek-alanlik
// foto analiziyle) + ruhsat sahibinin TC'si AYRI AYRI sorulurdu. Artik once
// aracin sifir mi ikinci el mi oldugu soruluyor, sonrasinda TEK BIR belge
// (sifirsa proforma, ikinci else ruhsat fotografi) istenip Claude'un gorsel
// analiziyle plaka/marka/model/motor no/sasi no/TC kimlik gibi TUM bilgiler
// TEK SEFERDE okunuyor (bkz. ruhsatAnaliz.js / proformaAnaliz.js). Asagidaki
// "fallback" sorular, OCR bir alani net okuyamadiysa (orn. gorsel bulanik,
// proformada TC kimlik hic yer almiyor) devreye giriyor - nextValidIndex'teki
// "already answered" kontrolu sayesinde, OCR ile zaten dolan bir alan icin bu
// sorular otomatik atlaniyor, sadece EKSIK kalan alanlar icin gosteriliyor.
const ARAC_SIFIR_MI_SORU = {
  id: "arac_sifir_mi",
  text: "Aracınız sıfır mı, yoksa ikinci el mi?",
  danismanText: "Sigortalının aracı sıfır mı, yoksa ikinci el mi?",
  type: "choice",
  options: ["Sıfır", "İkinci El"]
};

// type: "belge" - musteriden bir belge (fotograf ya da PDF) istenen, Claude'un
// gorsel/dokuman analiziyle OKUNAN yeni bir soru tipi. conversationEngine.js'deki
// "media" mesaj islemcisinde ozel olarak ele alinir (bkz. o dosyadaki ilgili blok).
// belgeTuru: "proforma" | "ruhsat" - hangi analiz fonksiyonunun (proformaAnalizEt /
// ruhsatFotografiAnalizEt) cagrilacagini belirler.
const PROFORMA_BELGESI_SORU = {
  id: "proforma_belgesi",
  text:
    "Aracınız sıfır olduğu için bayiden aldığınız proforma belgesini paylaşır mısınız? Fotoğraf ya da PDF " +
    "olarak gönderebilirsiniz, sizin için okuruz. 📄",
  danismanText: "Sigortalının proforma belgesini (fotoğraf ya da PDF) paylaşır mısınız?",
  type: "belge",
  belgeTuru: "proforma",
  skipIf: (answers) => answers.arac_sifir_mi !== "Sıfır"
};

const RUHSAT_BELGESI_SORU = {
  id: "ruhsat_belgesi",
  text:
    "Aracınız ikinci el olduğu için ruhsatınızın fotoğrafını paylaşır mısınız? Tüm bilgilerin net okunabilmesi " +
    "için iyi ışıkta, net bir fotoğraf çeker misiniz? 📸",
  danismanText: "Sigortalının ruhsat fotoğrafını paylaşır mısınız?",
  type: "belge",
  belgeTuru: "ruhsat",
  skipIf: (answers) => answers.arac_sifir_mi !== "İkinci El"
};

const MARKA_FALLBACK_SORU = {
  id: "marka",
  text: "Aracınızın markasını belirtir misiniz? (Belgeden bu bilgiyi net okuyamadım)",
  danismanText: "Sigortalının aracının markasını belirtir misiniz?",
  type: "text"
};

const MODEL_FALLBACK_SORU = {
  id: "model",
  text: "Aracınızın modelini belirtir misiniz? (Belgeden bu bilgiyi net okuyamadım)",
  danismanText: "Sigortalının aracının modelini belirtir misiniz?",
  type: "text"
};

const MOTOR_NO_FALLBACK_SORU = {
  id: "motor_no",
  text:
    "Aracınızın motor numarasını belirtir misiniz? (Belgeden bu bilgiyi net okuyamadım - bazı ruhsatlarda bu " +
    "alan boş olabilir, öyleyse 'yok' yazabilirsiniz)",
  danismanText: "Sigortalının aracının motor numarasını belirtir misiniz? Yoksa 'yok' yazabilirsiniz.",
  type: "text"
};

const SASI_NO_FALLBACK_SORU = {
  id: "sasi_no",
  text: "Aracınızın şasi numarasını belirtir misiniz? (Belgeden bu bilgiyi net okuyamadım)",
  danismanText: "Sigortalının aracının şasi numarasını belirtir misiniz?",
  type: "text"
};

// Sifir arac henuz tescil edilmedigi icin plakasi yoktur - bu soru SADECE
// ikinci el arac icin, ruhsat OCR'i plakayi okuyamadiysa devreye girer.
const PLAKA_FALLBACK_SORU = {
  id: "plaka",
  text: "Aracınızın plakasını belirtir misiniz? (Örn: 34 ABC 123) (Belgeden bu bilgiyi net okuyamadım)",
  danismanText: "Sigortalının aracının plakasını belirtir misiniz? (Örn: 34 ABC 123)",
  type: "text",
  validate: plakaGecerliMi,
  validationError: "Lütfen plakayı doğru formatta yazar mısınız? (Örn: 34 ABC 123)",
  skipIf: (answers) => answers.arac_sifir_mi === "Sıfır"
};

// TC kimlik OCR ile (ruhsattan ya da bazen proformadan) otomotik okunuyor.
// Bu soru sadece OCR bu alani bulamadiysa devreye giriyor - en sik proforma
// belgelerinde (sifir arac musteri adina henuz tescillenmedigi icin proformada
// TC kimlik yer almaz). Boyle bir durumda, belgede bir isim yakalanabildiyse
// (proforma_ad_soyad) o isimle hitap ederiz, yakalanamadiysa musterinin kendi
// ad_soyad cevabiyla.
const TC_KIMLIK_ISIMLE_SORU = {
  id: "tc_kimlik",
  text: (answers) => {
    const isim = answers.proforma_ad_soyad || answers.ad_soyad;
    return isim
      ? `Son olarak ${tamlayanEkiUygula(isim)} T.C. kimlik numarasını yazar mısınız?`
      : "Son olarak T.C. kimlik numaranızı yazar mısınız?";
  },
  danismanText: "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız?",
  type: "text",
  validate: tcKimlikGecerliMi,
  validationError:
    "Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"
};

// Sadece Trafik'te sorulur (kullanicinin talebi): musteri trafik sigortasi
// isterken capraz satis olarak Kasko teklifi de sorulur, cevap bildirimde
// "Kasko Talebi: Evet/Hayır" olarak ayrica gosterilir (bkz. ID_KISA_ETIKET).
const KASKO_TEKLIFI_SORUSU = {
  id: "kasko_talebi",
  text: "Bu arada, sizin için Kasko sigortası teklifi de hazırlamamızı ister misiniz?",
  danismanText: "Sigortalı için Kasko sigortası teklifi de hazırlanmasını ister misiniz?",
  type: "choice",
  options: ["Evet", "Hayır"]
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

// 28.07.2026 eklendi: Malpraktis'te "bağlı olduğunuz sağlık kurumu" cevabinda
// (orn. "İstanbul Üniversitesi Hastanesi") zaten bir sehir adi geciyorsa,
// conversationEngine.js bu sehri otomatik cikarip ayrica SEHIR_SORU'yu atlar.
// SEHIR_ESPRILERI ile ayni anahtar kumesini kullanir ama DUZGUN (Turkce
// karakterli, sadece ilk harfi buyuk) sehir adini dondurur.
const SEHIR_DUZGUN_ADI = {
  istanbul: "İstanbul",
  ankara: "Ankara",
  izmir: "İzmir",
  bursa: "Bursa",
  antalya: "Antalya",
  eskisehir: "Eskişehir",
  adana: "Adana",
  konya: "Konya",
  gaziantep: "Gaziantep",
  mersin: "Mersin",
  kayseri: "Kayseri",
  trabzon: "Trabzon",
  samsun: "Samsun",
  denizli: "Denizli",
  sanliurfa: "Şanlıurfa",
  urfa: "Şanlıurfa",
  malatya: "Malatya",
  van: "Van",
  diyarbakir: "Diyarbakır",
  sakarya: "Sakarya",
  mugla: "Muğla",
  kocaeli: "Kocaeli",
  izmit: "Kocaeli",
  balikesir: "Balıkesir",
  manisa: "Manisa",
  aydin: "Aydın",
  tekirdag: "Tekirdağ",
  canakkale: "Çanakkale",
  erzurum: "Erzurum",
  sivas: "Sivas",
  elazig: "Elazığ",
  rize: "Rize"
};
function sehirAdiBul(metin) {
  const normalized = sehirIcinNormalize(metin || "");
  for (const [anahtar, duzgunAd] of Object.entries(SEHIR_DUZGUN_ADI)) {
    if (normalized.includes(anahtar)) return duzgunAd;
  }
  return null;
}

const SEHIR_SORU = {
  id: "sehir",
  // 28.07.2026: Malpraktis'te "başkası için" durumunda hedef kisinin sehri
  // soruluyor - diger urunlerde (hedef_kisi hic set edilmedigi icin) davranis
  // degismiyor.
  text: (answers) =>
    kisiyeGoreMetin(
      answers,
      "Hangi şehirden bize ulaştığınızı öğrenebilir miyim?",
      (isim) => `${isim} hangi şehirde bulunuyor, öğrenebilir miyim?`
    ),
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
  text: (answers) =>
    kisiyeGoreMetin(answers, "Peki daireniz kaçıncı katta?", (isim) => `Peki ${tamlayanEkiUygula(isim)} dairesi kaçıncı katta?`),
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
  { name: "Fırat", number: "905527902616" },
  // 27.07.2026 eklendi (numara kullanicidan geldi: 0532 395 96 12 -> 90 ile normallestirildi).
  { name: "Furkan", number: "905323959612" },
  // 28.07.2026 eklendi (numaralar kullanicidan geldi).
  { name: "Şevval", number: "905539241775" },
  { name: "Nilşah", number: "905411149895" }
  // Yasemin, Simge, Tuğçe - telefon numaralari henuz bizde yok.
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
  "Şevval",
  "Nilşah",
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

// --- "Kendiniz için mi, başkası için mi" ortak deseni (28.07.2026 eklendi) ---
// DASK, Konut ve Malpraktis'te kullanilir: danisman sorularindan hemen sonra
// musteriye policenin kendisi icin mi yoksa baska biri icin mi oldugu sorulur.
// "Başkası İçin" derse sigortalanacak kisinin adi "ad_soyad" sorusuyla alinir
// (bu soru normalde musterinin KENDI ismini sorardi, sameAsAccountHolder ile
// otomatik doldurulurdu - o mekanizma bu urunlerde artik KULLANILMIYOR, cunku
// hangi ismin gecerli oldugu hedef_kisi cevabina bagli; onun yerine
// conversationEngine.js'deki ASKING case'inde "hedef_kisi" sorusu
// cevaplandigi an, "Kendim İçin" ise session.name otomatik ad_soyad'a
// yaziliyor - bkz. o dosyadaki ilgili yorum). "Başkası İçin" durumunda ise
// sonraki TUM soru metinleri bu isim uzerinden (3. sahis) sorulur.
function baskasiIcinMi(answers) {
  return answers.hedef_kisi === "Başkası İçin";
}
// answers.ad_soyad - "Kendim İçin" ise session.name'den otomatik dolan, "Başkası
// İçin" ise ayrica sorulan isim - sigortalanacak kisinin adini dondurur.
// "Kendim İçin" durumunda null doner (metin uretiminde ikinci sahis kullanilsin diye).
function hedefKisiAdi(answers) {
  return baskasiIcinMi(answers) ? answers.ad_soyad || null : null;
}
// ikinciSahisMetni: "siz/sizin" formunda metin (kendisi icin gecerli).
// ucuncuSahisUret: (isim) => isim uzerinden kurulmus metni donduren fonksiyon
// (baskasi icin gecerli, sadece isim biliniyorsa cagrilir).
function kisiyeGoreMetin(answers, ikinciSahisMetni, ucuncuSahisUret) {
  const isim = hedefKisiAdi(answers);
  return isim ? ucuncuSahisUret(isim) : ikinciSahisMetni;
}
// urunEtiketi: "DASK", "Konut sigortası" gibi - soru metnine gomulur.
function hedefKisiSorusu(urunEtiketi) {
  return {
    id: "hedef_kisi",
    text: `${urunEtiketi} poliçesini kendiniz için mi yaptıracaksınız yoksa bir başkası için mi?`,
    type: "choice",
    options: ["Kendim İçin", "Başkası İçin"],
    // Bir danisman musterisi adina yeni talep olustururken bu ayrimi zaten
    // kendisi biliyor (DANISMAN_SORULARI ile ayni mantik) - o akiste sorulmaz.
    danismandaGizle: true
  };
}
// ad_soyad sorusunun metni - hedef_kisi cevabina gore degisir. Not: bu soru
// "Kendim İçin" durumunda conversationEngine.js tarafindan otomatik
// doldurulup atlandigi icin, bu metin fiilen SADECE "Başkası İçin"
// durumunda gosterilir.
function hedefAdSoyadSorusuMetni(answers) {
  return baskasiIcinMi(answers)
    ? "Sigortayı kimin adına yaptıracaksınız? İsim ve soyismini paylaşır mısınız?"
    : "İsim ve soyisminizi paylaşır mısınız?";
}

// --- Malpraktis'e ozel "hocam" hitap deseni (28.07.2026 eklendi) ---
// Malpraktis'te musteri (hekim) her zaman ilk adi + "hocam" ile hitap
// ediliyor. "Kendim İçin" durumunda ikinci sahis ("...mısınız?" gibi), "Başkası
// İçin" durumunda ucuncu sahis ("...mı?" gibi) kullanilir - kullanicinin
// verdigi ornek: "Ahmet hocam, asistan mısınız?" (kendi) / "Ahmet hocam
// asistan mı?" (baskasi).
function malpraktisIlkAd(answers) {
  const isim = baskasiIcinMi(answers) ? hedefKisiAdi(answers) : answers.ad_soyad;
  return isim ? isim.trim().split(/\s+/)[0] : null;
}
// ikinciSahisUret/ucuncuSahisUret: (hocaEtiketi) => "metin" - hocaEtiketi
// "Ahmet hocam" formatinda gelir (isim bilinmiyorsa emniyetli bir fallback
// olarak sadece "Hocam" kullanilir, pratikte bu durum olusmamali cunku isim
// hedef_kisi/ASK_NAME asamasinda zaten alinmis oluyor).
function malpraktisMetin(answers, ikinciSahisUret, ucuncuSahisUret) {
  const ilkAd = malpraktisIlkAd(answers);
  const hocaEtiketi = ilkAd ? `${ilkAd} hocam` : "Hocam";
  return baskasiIcinMi(answers) ? ucuncuSahisUret(hocaEtiketi) : ikinciSahisUret(hocaEtiketi);
}

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
      hedefKisiSorusu("DASK"),
      {
        id: "ad_soyad",
        text: hedefAdSoyadSorusuMetni,
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text"
      },
      {
        id: "mulkiyet_durumu",
        text: (answers) =>
          kisiyeGoreMetin(
            answers,
            "Sigortalanacak konut size mi ait, yoksa kiracı mısınız?",
            (isim) => `Sigortalanacak konut ${yonelmeEkiUygula(isim)} mı ait, yoksa kendisi kiracı mı?`
          ),
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
        // 28.07.2026: "başkası için" ise ve kiraciysa mulk sahibi zaten
        // sigortalanacak kisiden FARKLI, uculcu bir kisi oldugu icin isimsiz
        // ("mülk sahibinin") kaliyor; ev sahibiyse dogrudan hedef kisinin
        // ismiyle soruluyor - bkz. kullanicinin verdigi tam ornek.
        text: (answers) => {
          const kiraci = answers.mulkiyet_durumu === "Kiracıyım";
          if (baskasiIcinMi(answers)) {
            const isim = hedefKisiAdi(answers);
            return kiraci
              ? "Son olarak mülk sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
              : `Son olarak ${tamlayanEkiUygula(isim)} T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)`;
          }
          return kiraci
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak T.C. kimlik numaranızı yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)";
        },
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
      hedefKisiSorusu("Konut sigortası"),
      {
        id: "ad_soyad",
        text: hedefAdSoyadSorusuMetni,
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text"
      },
      // DASK'in aksine Konut Sigortasi mutlaka ev sahibinin uzerine olmak
      // zorunda degil - kiraci da kendi uzerine yaptirabilir. Bu yuzden
      // "kiracı mısınız" yerine dogrudan police kimin uzerine sorusu soruyoruz.
      {
        id: "police_kimin_uzerine",
        text: (answers) =>
          kisiyeGoreMetin(
            answers,
            "Konut sigortasını kendi üzerinize mi, yoksa ev sahibinin üzerine mi yaptıracaksınız?",
            (isim) => `Konut sigortasını ${tamlayanEkiUygula(isim)} kendi üzerine mi, yoksa ev sahibinin üzerine mi yaptıracaksınız?`
          ),
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
        text: (answers) => {
          const evSahibininUzerine = answers.police_kimin_uzerine === "Ev Sahibinin Üzerine";
          if (baskasiIcinMi(answers)) {
            const isim = hedefKisiAdi(answers);
            return evSahibininUzerine
              ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
              : `Son olarak ${tamlayanEkiUygula(isim)} T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)`;
          }
          return evSahibininUzerine
            ? "Son olarak ev sahibinin T.C. kimlik numarasını yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)"
            : "Son olarak T.C. kimlik numaranızı yazar mısınız? (Poliçeyi bu bilgiyle hazırlayacağız)";
        },
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
      { ...ARAC_SIFIR_MI_SORU },
      { ...PROFORMA_BELGESI_SORU },
      { ...RUHSAT_BELGESI_SORU },
      { ...MARKA_FALLBACK_SORU },
      { ...MODEL_FALLBACK_SORU },
      { ...MOTOR_NO_FALLBACK_SORU },
      { ...SASI_NO_FALLBACK_SORU },
      { ...PLAKA_FALLBACK_SORU },
      { ...SEHIR_SORU },
      { ...MESLEK_SORU },
      { ...TC_KIMLIK_ISIMLE_SORU },
      // Sadece Trafik'te: musteri trafik isterken capraz satis olarak kasko
      // teklifi de sorulur (kullanicinin talebi) - Kasko'nun kendi urununde
      // bu soru tekrar sorulmaz, anlamsiz olurdu.
      { ...KASKO_TEKLIFI_SORUSU }
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
      { ...ARAC_SIFIR_MI_SORU },
      { ...PROFORMA_BELGESI_SORU },
      { ...RUHSAT_BELGESI_SORU },
      { ...MARKA_FALLBACK_SORU },
      { ...MODEL_FALLBACK_SORU },
      { ...MOTOR_NO_FALLBACK_SORU },
      { ...SASI_NO_FALLBACK_SORU },
      { ...PLAKA_FALLBACK_SORU },
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
        options: ["Düzenli Yeniliyorum", "Kaskosuzum"],
        // 28.07.2026: kullanicinin acik talebi geregi ("İkisi bir arada
        // kalsın") bu ESKI kaskonuz-var-mi/4-yonlu-foto akisi kaldirilmadi,
        // yeni sifir/ikinci-el+proforma/ruhsat akisiyla BIRLIKTE korunuyor.
        // Ancak sifir bir aracin (henuz hic kullanilmamis) "kaskosu" ya da
        // gecmis kaza/hasar durumu olamayacagi icin bu soru SADECE ikinci el
        // arac secildiyse soruluyor - bu, bu oturumda benim onerdigim ama
        // kullaniciya ayrica teyit ettirilmemis bir yorum/varsayimdir, teslimat
        // ozetinde ayrica belirtilmesi gerekir.
        skipIf: (answers) => answers.arac_sifir_mi === "Sıfır"
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
        // kasko_durumu sifir arac icin zaten atlandigindan (yukarida), bu
        // durumda answers.kasko_durumu undefined olur ve asagidaki kosul
        // (undefined !== "Kaskosuzum") true doner - yani bu soru sifir arac
        // icin de otomatik atlanmis olur, EK bir arac_sifir_mi kontrolune
        // gerek yok.
        skipIf: (answers) => answers.kasko_durumu !== "Kaskosuzum"
      },
      { ...SEHIR_SORU },
      { ...MESLEK_SORU },
      { ...TC_KIMLIK_ISIMLE_SORU }
    ]
  },

  ozel_saglik: {
    label: "Özel Sağlık Sigortası",
    agentNumber: "905380711711", // Bahadır - elementer branş (Özel Sağlık)
    advisors: DANISMANLAR,
    questions: saglikUrunuSorulari()
  },

  tss: {
    label: "TSS (Tamamlayıcı Sağlık Sigortası)",
    menuLabel: "TSS (Tamamlayıcı Sig.)", // Urun secim listesinde WhatsApp'in 24 karakter siniri var
    agentNumber: "905380711711", // Bahadır - elementer branş (TSS)
    advisors: DANISMANLAR,
    questions: saglikUrunuSorulari()
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
      hedefKisiSorusu("Hekim Sorumluluk Sigortası"),
      {
        id: "ad_soyad",
        text: hedefAdSoyadSorusuMetni,
        danismanText: "Sigortalının ismini ve soyismini paylaşır mısınız?",
        type: "text"
      },
      {
        id: "asistan_mi",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, asistan mısınız?`,
            (hoca) => `${hoca} asistan mı?`
          ),
        danismanText: "Sigortalı asistan mı?",
        type: "choice",
        options: ["Evet", "Hayır"]
      },
      {
        id: "uzman_mi",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, uzman mısınız?`,
            (hoca) => `${hoca} uzman mı?`
          ),
        danismanText: "Sigortalı uzman mı?",
        type: "choice",
        options: ["Evet", "Hayır"],
        // Asistansa zaten uzman degildir, bu soru gereksiz - atlanir.
        skipIf: (answers) => answers.asistan_mi === "Evet"
      },
      {
        id: "uzmanlik_dali",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, uzmanlık dalınızı belirtir misiniz?`,
            (hoca) => `${hoca}ın uzmanlık dalını belirtir misiniz?`
          ),
        danismanText: "Sigortalının uzmanlık dalını belirtir misiniz?",
        type: "text",
        // Asistan ya da uzmansa uzmanlik dali vardir; ikisi de degilse (tabip) sorulmaz.
        skipIf: (answers) => !(answers.asistan_mi === "Evet" || answers.uzman_mi === "Evet")
      },
      {
        id: "hasta_bakiyor_mu",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, aktif olarak hasta bakıyor musunuz?`,
            (hoca) => `${hoca} aktif olarak hasta bakıyor mu?`
          ),
        danismanText: "Sigortalı aktif olarak hasta bakıyor mu?",
        type: "choice",
        options: ["Evet", "Hayır"]
      },
      {
        id: "yillik_hasta_sayisi",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, yıllık hasta sayınızı yaklaşık olarak söyler misiniz?`,
            (hoca) => `${hoca}ın yıllık hasta sayısını yaklaşık olarak söyler misiniz?`
          ),
        danismanText: "Sigortalının yıllık hasta sayısını yaklaşık olarak söyler misiniz?",
        type: "text",
        validate: pozitifSayiMi,
        validationError: "Lütfen hasta sayısını sadece rakamla yazar mısınız? (Örn: 500)",
        // Hasta bakmiyorsa (sadece idari gorevliyse) bu soru anlamsiz, atlanir.
        skipIf: (answers) => answers.hasta_bakiyor_mu === "Hayır"
      },
      {
        id: "is_adresi",
        // 28.07.2026: kullanicinin istegiyle "(muayenehane/kurum)" ibaresi
        // kaldirildi - sade bir "is adresi" sorusu yeterli.
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, iş adresinizi paylaşır mısınız?`,
            (hoca) => `${hoca}ın iş adresini paylaşır mısınız?`
          ),
        danismanText: "Sigortalının iş adresini paylaşır mısınız?",
        type: "text"
      },
      {
        id: "tescil_no",
        // Tescil turu ayrica sorulmuyor, uzman olup olmadigina gore otomatik belirleniyor:
        // uzmansa "uzmanlık tescil", degilse (asistan ya da tabip) "diploma tescil".
        text: (answers) => {
          const tescilTuru = answers.uzman_mi === "Evet" ? "Uzmanlık" : "Diploma";
          return malpraktisMetin(
            answers,
            (hoca) => `${hoca}, ${tescilTuru.toLocaleLowerCase("tr")} tescil numaranızı paylaşır mısınız?`,
            (hoca) => `${hoca}ın ${tescilTuru.toLocaleLowerCase("tr")} tescil numarasını paylaşır mısınız?`
          );
        },
        danismanText: (answers) =>
          answers.uzman_mi === "Evet"
            ? "Sigortalının uzmanlık tescil numarasını paylaşır mısınız?"
            : "Sigortalının diploma tescil numarasını paylaşır mısınız?",
        type: "text"
      },
      {
        id: "tescil_tarihi",
        // 28.07.2026: kullanicinin istegiyle hangi tescilin (uzmanlik/diploma)
        // tarihi oldugu aciklandi - eskiden sadece "Tescil tarihinizi" diyordu,
        // hangi tescil oldugu belirsizdi.
        text: (answers) => {
          const tescilTuru = answers.uzman_mi === "Evet" ? "Uzmanlık" : "Diploma";
          return malpraktisMetin(
            answers,
            (hoca) => `${hoca}, ${tescilTuru.toLocaleLowerCase("tr")} tescil tarihinizi belirtir misiniz? (GG.AA.YYYY)`,
            (hoca) => `${hoca}ın ${tescilTuru.toLocaleLowerCase("tr")} tescil tarihini belirtir misiniz? (GG.AA.YYYY)`
          );
        },
        danismanText: (answers) => {
          const tescilTuru = answers.uzman_mi === "Evet" ? "uzmanlık" : "diploma";
          return `Sigortalının ${tescilTuru} tescil tarihini belirtir misiniz? (GG.AA.YYYY)`;
        },
        type: "text",
        validate: tarihGecerliMi,
        validationError: "Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.2015)"
      },
      {
        id: "sigorta_ettiren_turu",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, sigorta ettiren türünüz nedir?`,
            (hoca) => `${hoca}ın sigorta ettiren türü nedir?`
          ),
        danismanText: "Sigortalının sigorta ettiren türü nedir?",
        type: "choice",
        options: ["Serbest Çalışan", "Kamu Çalışanı"]
      },
      {
        id: "saglik_kurumu",
        text: (answers) =>
          malpraktisMetin(
            answers,
            (hoca) => `${hoca}, bağlı olduğunuz sağlık kurumunu söyler misiniz?`,
            (hoca) => `${hoca}ın bağlı olduğu sağlık kurumunu söyler misiniz?`
          ),
        danismanText: "Sigortalının bağlı olduğu sağlık kurumunu söyler misiniz?",
        type: "text"
      },
      { ...SEHIR_SORU },
      { ...TC_KIMLIK_SORU }
    ]
  }
};

// "Kendiniz için mi, başkası için mi" ve sehir-otomatik-cikarma yardimcilari,
// conversationEngine.js'in de kullanabilmesi icin urun nesnelerinin yaninda
// ayrica named export olarak da disariya aciliyor.
module.exports.baskasiIcinMi = baskasiIcinMi;
module.exports.sehirAdiBul = sehirAdiBul;
module.exports.saglikYetiskinMi = saglikYetiskinMi;
