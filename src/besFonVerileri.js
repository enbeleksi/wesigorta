// Garanti Emeklilik'in Bireysel Emeklilik Sistemi (BES) fonlarina ait SABIT
// (yapisal) referans verileri - kullanicinin paylastigi "Emeklilik
// Fonlari.pdf" (fon fon sheet, her sayfada bir fon: Fon Kodu, aciklama,
// yonetim stratejisi, portfoy dagilimi, fon kunyesi, karsilastirma olcutu)
// baz alinarak elle cikarilmistir (cogu sayfa "Rapor Tarihi: 28.03.2025",
// GGJ "30.01.2026" tarihli).
//
// ONEMLI - bu dosyada NE VAR NE YOK:
// - Fon kodu/adi, risk degeri (1-7), kisa aciklama, karsilastirma olcutu
//   (benchmark) ve ana varlik yapisi gibi YAPISAL bilgiler burada SABIT
//   (statik) olarak tutuluyor - bunlar ay ay pek degismez (fon stratejisi
//   degismedigi surece).
// - GETIRI YUZDELERI (2021-2025 yillik getiri, YBB vb.) BURADA YOK ve
//   BILEREK EKLENMEDI - bu sayilar her gun degisir, PDF'ten kopyalanan bir
//   sayi bir kac hafta icinde yanlis/eski olur. Bunun yerine "Fon Listesini
//   Gör" secildiginde tefasGetiriAnaliz.js, Claude'un CANLI web aramasi
//   ozelligini kullanarak www.tefas.gov.tr ve ilgili kaynaklardan istek
//   anindaki guncel getiri yuzdelerini (best-effort) cekip fon listesine
//   ekler (detaylar o dosyanin basinda).
//   NOT (22.07.2026): ayrica "Ekonomiye Göre Fon" (guncel ekonomik yorum +
//   dinamik fon sepeti onerisi) ozelligi vardi - kullanici talebiyle
//   kaldirildi (guvenilir calismiyordu).
// - Risk degeri asagidaki gibi kategorilere ayrilir (fon fact sheet'lerindeki
//   renkli lejanda gore): 1-2 Dusuk Riskli, 3-4 Orta Riskli, 5-6 Yuksek
//   Riskli, 7 Cok Yuksek Riskli.
//
// Bu dosya, Garanti Emeklilik yeni bir fon cikardiginda ya da bir fonun
// stratejisini/risk seviyesini degistirdiginde elle guncellenmelidir -
// boyle bir durumda kullanicidan guncel "Emeklilik Fonlari.pdf" dosyasini
// tekrar istemek yeterlidir.

const BES_FONLARI = [
  {
    kod: "GEL",
    ad: "Para Piyasası Emeklilik Yatırım Fonu",
    riskDegeri: 2,
    aciklama: "Riski sevmeyen katılımcılar için; kısa vadeli, düşük riskli para ve sermaye piyasası araçlarından (ağırlıklı ters repo) oluşur. Fiyatları istikrarlıdır.",
    anaVarlikYapisi: "Ters Repo ağırlıklı (~%53), Tahvil/Bono (~%23), Mevduat (TL) (~%11)",
    karsilastirmaOlcutu: "%55 BIST-KYD Repo (Brüt) + %35 BIST-KYD DİBS 91 Gün + %5 BIST-KYD ÖSBA Sabit + %5 BIST-KYD 1 Aylık Mevduat TL"
  },
  {
    kod: "GKB",
    ad: "Kira Sertifikaları Katılım Emeklilik Yatırım Fonu",
    riskDegeri: 2,
    aciklama: "Faizsiz yatırımı ve düşük-orta düzeyde risk almayı tercih eden katılımcılar için; ağırlıklı olarak kamu ve özel sektör kira sertifikalarına yatırım yapar.",
    anaVarlikYapisi: "Kamu Kira Sertifikaları (TL) ağırlıklı (~%83), Özel Sektör Kira Sertifikaları (~%15)",
    karsilastirmaOlcutu: "%60 BIST-KYD Kamu Kira Sertifikaları + %30 BIST-KYD Özel Sektör Kira Sertifikaları + %10 BIST-KYD 1 Aylık Kar Payı TL"
  },
  {
    kod: "GEK",
    ad: "Borçlanma Araçları Emeklilik Yatırım Fonu",
    riskDegeri: 3,
    aciklama: "Orta düzeyde risk alabilen katılımcılar tarafından tercih edilir. Orta-uzun vadeli bonolara yatırım yapması nedeniyle faizler düşerken getirisi artar; faizlerdeki değişikliklerden en çok etkilenen fonlardandır.",
    anaVarlikYapisi: "Tahvil/Bono ağırlıklı (~%64), Finansman Bonosu (~%19), Özel Tahvil/Bono (~%8)",
    karsilastirmaOlcutu: "%75 BIST-KYD DİBS Tüm Endeksi + %10 BIST-KYD Repo (Brüt) + %10 BIST-KYD 1 Aylık Gösterge Mevduat TL + %5 BIST-KYD ÖSBA Sabit"
  },
  {
    kod: "GES",
    ad: "Katılım Standart Emeklilik Yatırım Fonu",
    riskDegeri: 3,
    aciklama: "Faizsiz yatırımı ve orta risk almayı tercih eden, birikimlerini enflasyona karşı korumayı hedefleyen katılımcılar için uygundur. Kira sertifikalarına ve gelir ortaklığı senetlerine yatırım yapar.",
    anaVarlikYapisi: "Kamu Kira Sertifikaları (TL) ağırlıklı (~%66), Hisse (~%24)",
    karsilastirmaOlcutu: "%70 BIST-KYD Kamu Kira Sertifikaları Endeksi + %20 BIST Katılım 100 Getiri Endeksi + %10 BIST-KYD 1 Aylık Kar Payı TL Endeksi"
  },
  {
    kod: "GHL",
    ad: "Katılım Katkı Emeklilik Yatırım Fonu",
    riskDegeri: 3,
    aciklama: "Faizsiz yatırımı tercih eden katılımcıların devlet katkısı tutarlarının değerlendirildiği fondur. Kamu kira sertifikaları ve BIST Katılım endeksi hisseleri ağırlıklıdır.",
    anaVarlikYapisi: "Kamu Kira Sertifikaları (TL) ağırlıklı (~%57), Hisse (~%42)",
    karsilastirmaOlcutu: "%60 BIST-KYD Kamu Kira Sertifikaları Endeksi + %20 BIST Katılım 100 Getiri Endeksi + %15 BIST Katılım 30 Getiri Endeksi + %5 BIST-KYD 1 Aylık Kar Payı TL Endeksi"
  },
  {
    kod: "GCT",
    ad: "Birinci Fon Sepeti Emeklilik Yatırım Fonu",
    riskDegeri: 4,
    aciklama: "Yüksek-çok yüksek düzeyde risk alabilen, aylık negatif getirilere hassas olmayan katılımcılar için uygundur. Borsa yatırım fonlarını (hisse, bono, döviz) aktif yöneterek orta-uzun vadede piyasa koşullarından bağımsız pozitif getiri hedefler.",
    anaVarlikYapisi: "Yatırım Fonları Katılma Payları ağırlıklı (~%79), Yabancı Borsa Yatırım Fonları (~%6), Vadeli İşlemler Nakit Teminatları (~%10)",
    karsilastirmaOlcutu: "%50 TÜFE (Tüketici Fiyat Endeksi) + %50 BIST-KYD 1 Aylık Mevduat TL"
  },
  {
    kod: "GEA",
    ad: "Katılım Değişken Emeklilik Yatırım Fonu",
    riskDegeri: 4,
    aciklama: "Faizsiz yatırımı tercih eden katılımcılar için uygundur. Hazine/özel sektör kira sertifikaları, gelir ortaklığı senetleri ve BIST Katılım endeksi hisseleri ağırlıklıdır.",
    anaVarlikYapisi: "Hisse ağırlıklı (~%59), Kamu Kira Sertifikaları (TL) (~%21), Kıymetli Maden (~%11)",
    karsilastirmaOlcutu: "%60 BIST Katılım 100 Getiri Endeksi + %20 BIST-KYD Kamu Kira Sertifikaları + %10 BIST-KYD Altın Fiyat Ağırlıklı Ortalama + %10 BIST-KYD 1 Aylık Kar Payı USD (TL)"
  },
  {
    kod: "GHD",
    ad: "Standart Emeklilik Yatırım Fonu",
    riskDegeri: 4,
    aciklama: "Risk alabilen, sabit getirili menkul kıymet ya da mevduat yatırımcılarına hitap eder. Az miktarda hisse senedi bulundurması, faiz getirisi yanında sermaye getirisi de sağlar.",
    anaVarlikYapisi: "Tahvil/Bono ağırlıklı (~%68), Hisse (~%25)",
    karsilastirmaOlcutu: "%70 BIST-KYD DİBS Tüm Endeksi + %20 BIST 100 Getiri Endeksi + %5 BIST-KYD 1 Aylık Mevduat TL Endeksi + %5 BIST-KYD ÖSBA Sabit Endeksi"
  },
  {
    kod: "GHT",
    ad: "Dengeli Değişken Emeklilik Yatırım Fonu",
    riskDegeri: 4,
    aciklama: "Orta düzeyde risk alabilen, yatırımlarında çeşitlilik tercih eden katılımcılar için uygundur. Hisse senedi ve döviz cinsi bono (eurobond) yatırımı da yaptığı için piyasalardaki dalgalanmalardan etkilenir.",
    anaVarlikYapisi: "Tahvil/Bono ağırlıklı (~%39), Hisse (~%20), Yatırım Fonları Katılma Payları (~%12)",
    karsilastirmaOlcutu: "%40 BIST 100 Getiri Endeksi + %25 BIST-KYD DİBS Kısa Endeksi + %25 BIST-KYD 1 Aylık Mevduat TL + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GEU",
    ad: "Değişken Emeklilik Yatırım Fonu",
    riskDegeri: 5,
    aciklama: "Döviz yatırımını tercih eden ve risk alabilen katılımcılar için uygundur. Hazine'nin uluslararası piyasalarda sunduğu döviz cinsi Eurobond'lara yer verir; ülke riski ve kur riski taşır.",
    anaVarlikYapisi: "Kamu Dış Borçlanma Araçları ağırlıklı (~%52), Yabancı Kamu Borçlanma Araçları (~%11), Ters Repo (~%9)",
    karsilastirmaOlcutu: "%75 BIST-KYD 1 Aylık Gösterge Mevduat USD (TL) + %25 BIST-KYD 1 Aylık Gösterge Mevduat TL"
  },
  {
    kod: "GHE",
    ad: "Dinamik Değişken Emeklilik Yatırım Fonu",
    riskDegeri: 5,
    aciklama: "Yatırımlarında çeşitliliği tercih eden katılımcılar için uygundur. Hisse senedi ve döviz cinsi bono (eurobond) yatırımı yanı sıra piyasa beklentilerine göre aktif yönetilir; ekonomi ve büyüme beklentilerinin pozitif olduğu dönemlerde getirisi artar.",
    anaVarlikYapisi: "Hisse ağırlıklı (~%64), Kamu Dış Borçlanma Araçları (~%8), Tahvil/Bono (~%11)",
    karsilastirmaOlcutu: "BIST-KYD Repo (Brüt) Endeksi"
  },
  {
    kod: "GHI",
    ad: "Katkı Emeklilik Yatırım Fonu",
    riskDegeri: 5,
    aciklama: "Faizli yatırımı tercih eden katılımcıların devlet katkısı tutarlarının değerlendirildiği fondur. Orta-uzun vadeli borçlanma araçları, hisse senetleri ve borsa yatırım fonu bulundurması nedeniyle piyasalarda yaşanan dalgalanmalara fiyatıyla yön verir.",
    anaVarlikYapisi: "Tahvil/Bono ağırlıklı (~%53), Hisse (~%43)",
    karsilastirmaOlcutu: "%30 BIST-KYD DİBS Uzun Endeksi + %30 BIST-KYD DİBS Orta Endeksi + %20 BIST 100 Getiri Endeksi + %15 BIST 30 Getiri Endeksi + %5 BIST-KYD 1 Aylık Mevduat TL Endeksi"
  },
  {
    kod: "GCN",
    ad: "Yeni Teknolojiler Hisse Senedi Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Risk alabilen, hem yurtiçi hem de yurtdışı hisse senetlerine yatırım yapmak isteyen ve dijital dünyaya ilgi duyan katılımcılar için uygundur. Yeni teknolojiyi destekleyen şirketlere (yapay zeka, biyoteknoloji, elektronik ticaret, telekomünikasyon vb.) yatırım yapar; yurt dışı hisseleri döviz olduğu için Dolar/TL'deki yükseliş fona olumlu, düşüş ise olumsuz yansır.",
    anaVarlikYapisi: "Yabancı Hisse ağırlıklı (~%46), Hisse (~%46)",
    karsilastirmaOlcutu: "%45 Russell 1000 Technology RIC 22.5/45 Capped Total Return Endeksi + %35 BIST Teknoloji Ağırlıklı Sınırlamalı Getiri Endeksi + %10 BIST İletişim Getiri Endeksi + %10 BIST-KYD Repo (Brüt) Endeksi"
  },
  {
    kod: "GCY",
    ad: "Karma Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Risk alabilen ve yatırımlarında Euro cinsi döviz getirisi elde etmek isteyen katılımcılar için uygundur. Avrupa hisse senetlerine de yer verdiği için ilgili hisse senedi piyasası düşüşlerinden olumsuz etkilenir; Euro/TL'nin yukarı hareketi fona olumlu yansır.",
    anaVarlikYapisi: "Yabancı Hisse ağırlıklı (~%42), Kamu Dış Borçlanma Araçları (~%24), Kıymetli Maden (~%21)",
    karsilastirmaOlcutu: "%45 EURO STOXX 50 Net Return EUR Endeksi + %20 BIST-KYD Kamu Eurobond (TL) Endeksi + %20 BIST-KYD Altın Fiyat Ağırlıklı Ortalama Endeksi + %10 BIST-KYD 1 Aylık Mevduat EUR Endeksi + %5 BIST-KYD Repo (Brüt) Endeksi"
  },
  {
    kod: "GED",
    ad: "Temettü Ödeyen Şirketler Hisse Senedi Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Ağırlıklı olarak BIST Temettü Endeksi'nde yer alan (son 3 yılda nakit temettü dağıtan) yerli ortaklık paylarına yatırım yapar.",
    anaVarlikYapisi: "Hisse ağırlıklı (~%93)",
    karsilastirmaOlcutu: "%90 BIST Temettü Getiri Endeksi + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GEH",
    ad: "Hisse Senedi Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Çok yüksek risk alabilen katılımcılar için uygundur. Ağırlıklı olarak BIST 100 Endeksi'ndeki hisse senetlerine yatırım yapar; ülke ekonomisinin büyüme hızına ve hisse senedi piyasasındaki artışa duyarlıdır.",
    anaVarlikYapisi: "Hisse ağırlıklı (~%92)",
    karsilastirmaOlcutu: "%90 BIST 100 Getiri + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GHA",
    ad: "Altın Katılım Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Faizsiz yatırımı tercih eden, çok yüksek risk alabilen katılımcılar için uygundur. Ulusal/uluslararası borsalarda işlem gören altın ve altına dayalı sermaye piyasası araçlarına yatırım yapar; altın fiyatlarındaki ve döviz kurundaki artış getiriyi olumlu etkiler.",
    anaVarlikYapisi: "Kıymetli Madenler Cinsinden İhraç Edilen Kamu Kira Sertifikaları ağırlıklı (~%75), Hisse (~%12)",
    karsilastirmaOlcutu: "%95 BIST-KYD Altın Fiyat Ağırlıklı Ortalama + %5 BIST-KYD 1 Aylık Gösterge Kar Payı TL"
  },
  {
    kod: "GHG",
    ad: "Dış Borçlanma Araçları Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Döviz yatırımını tercih eden yatırımcılar için uygundur. Ağırlıklı olarak Hazine'nin uluslararası piyasalarda sunduğu döviz cinsi Eurobond'lara yatırım yapar; ülke riski ve kur riski taşır.",
    anaVarlikYapisi: "Kamu Dış Borçlanma Araçları ağırlıklı (~%77), Özel Sektör Dış Borçlanma Araçları (~%7)",
    karsilastirmaOlcutu: "%65 BIST-KYD Eurobond USD (TL) + %25 BIST-KYD Eurobond EUR (TL) + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GHH",
    ad: "Sürdürülebilirlik Hisse Senedi Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Çok yüksek risk alabilen katılımcılar için uygundur. BIST Sürdürülebilirlik Endeksi'ndeki hisse senetlerine ve yabancı kamu borçlanma araçlarına yer verir; hisse senedi piyasasındaki artış ve kurdaki değer kazanımı fona olumlu yansır.",
    anaVarlikYapisi: "Hisse ağırlıklı (~%48), Yabancı Hisse (~%35)",
    karsilastirmaOlcutu: "%50 BIST Sürdürülebilirlik Getiri Endeksi + %40 S&P 500 ESG Index (USD) TR + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GHO",
    ad: "Üçüncü Değişken Emeklilik Yatırım Fonu",
    riskDegeri: 6,
    aciklama: "Değişen piyasa koşullarına göre yurt içi/yurt dışı varlıklar arasında uygun dağılım yapar. Yabancı hisse senedi taşıması nedeniyle kurdaki ve hisse piyasasındaki dalgalanmalardan etkilenir; amaç uzun vadede yüksek getiri elde etmektir.",
    anaVarlikYapisi: "Yabancı Hisse ağırlıklı (~%40), Kıymetli Madenler Cinsinden Kamu Kira Sertifikaları (~%19), Kamu Dış Borçlanma Araçları (~%17)",
    karsilastirmaOlcutu: "%45 Nasdaq 100 Endeksi (Total Return) + %20 BIST-KYD Kamu Eurobond 0-5 Yıl USD (TL) + %15 BIST-KYD Altın Fiyat Ağırlıklı Ortalama + %10 BIST-KYD 1 Aylık Gösterge Mevduat USD(TL) + %10 BIST-KYD Repo (Brüt)"
  },
  {
    kod: "GGJ",
    ad: "Gümüş Fon Sepeti Emeklilik Yatırım Fonu",
    riskDegeri: 7,
    aciklama: "Risk alabilen, yatırımlarında gümüş ve gümüşe dayalı endekslere yatırım yapan yerli/yabancı fonları tercih eden katılımcılar için uygundur. Gümüş piyasalarındaki fiyat değişimlerini yatırımcıya doğrudan yansıtmayı hedefler.",
    anaVarlikYapisi: "Yatırım Fonları Katılma Payları (~%29), Yabancı Borsa Yatırım Fonları (~%24), Kıymetli Madenler Cinsinden BYF (~%23)",
    karsilastirmaOlcutu: "%90 Bloomberg Gümüş (TL) + %10 BIST-KYD Repo (Brüt) Endeksi"
  }
];

const RISK_KATEGORILERI = [
  { anahtar: "dusuk", etiket: "Düşük Riskli (1-2)", min: 1, max: 2 },
  { anahtar: "orta", etiket: "Orta Riskli (3-4)", min: 3, max: 4 },
  { anahtar: "yuksek", etiket: "Yüksek Riskli (5-6)", min: 5, max: 6 },
  { anahtar: "cokyuksek", etiket: "Çok Yüksek Riskli (7)", min: 7, max: 7 }
];

function riskKategorisiBul(riskDegeri) {
  return RISK_KATEGORILERI.find((k) => riskDegeri >= k.min && riskDegeri <= k.max) || null;
}

function fonlariKategoriyeGoreGrupla() {
  return RISK_KATEGORILERI.map((kategori) => ({
    ...kategori,
    fonlar: BES_FONLARI.filter((f) => f.riskDegeri >= kategori.min && f.riskDegeri <= kategori.max)
  }));
}

// 31.07.2026 eklendi: WhatsApp'in gercek karakter siniri ~4096 - bir
// kategoride (orn. "Yüksek Riskli" 11 fon) tum fon bloklari tek mesaja
// sigmayabilir. Bu yuzden her kategori, bu sinirin altinda kalacak sekilde
// birden fazla mesaja bolunebilir (guvenlik payi birakmak icin sinirdan daha
// dusuk bir esik kullaniliyor). Eskiden bu fonksiyon SADECE advisorEngine.js
// icinde (besFonListesiGoster) tanimliydi; kullanicinin "BES Fonları" ozelligini
// danisman ana menusunden kaldirip musteri/danisman ORTAK "Sık Sorulan
// Sorular" akisindaki "Bireysel Emeklilik(BES)" secenegine tasima talebi
// uzerine BURAYA (besFonVerileri.js - hem conversationEngine.js hem
// advisorEngine.js'in dongusel bagimlilik olmadan erisebildigi "yaprak" bir
// modul) tasindi - boylece iki taraf da AYNI mantigi kullanir.
const WHATSAPP_MESAJ_KARAKTER_ESIGI = 3500;

function bloklariMesajGruplarinaBol(baslikUzunlugu, bloklar) {
  const gruplar = [];
  let mevcutGrup = [];
  let mevcutUzunluk = baslikUzunlugu;
  for (const blok of bloklar) {
    const ekUzunluk = blok.length + 2; // iki bos satirla birlestirilecek
    if (mevcutGrup.length > 0 && mevcutUzunluk + ekUzunluk > WHATSAPP_MESAJ_KARAKTER_ESIGI) {
      gruplar.push(mevcutGrup);
      mevcutGrup = [];
      mevcutUzunluk = baslikUzunlugu;
    }
    mevcutGrup.push(blok);
    mevcutUzunluk += ekUzunluk;
  }
  if (mevcutGrup.length > 0) gruplar.push(mevcutGrup);
  return gruplar;
}

// getiriHaritasi: { [fonKodu]: "guncel getiri metni" } (bkz. tefasGetiriAnaliz.js
// - fonGetirileriniGetir basarisiz olursa/tanimsizsa bos {} gecilebilir, bu
// fonksiyon getirisiz de calisir). Donus degeri: her biri sendText ile ayri
// ayri gonderilmesi gereken, HAZIR (WhatsApp karakter sinirina gore onceden
// bolunmus) mesaj metinlerinden olusan bir DIZI - bu fonksiyon HICBIR SEY
// GONDERMEZ, sadece metinleri hazirlar (gonderim, cagiran tarafin KENDI
// sendText'i ile yapilir - boylece bu modul WhatsApp gonderim katmanina
// bagimli olmaz).
function besFonMesajlariniOlustur(getiriHaritasi) {
  const mesajlar = [];
  const getiriBulundu = Object.keys(getiriHaritasi || {}).length > 0;
  const gruplar = fonlariKategoriyeGoreGrupla().filter((g) => g.fonlar.length > 0);
  for (const grup of gruplar) {
    const satirlar = grup.fonlar.map((f) => {
      const getiri = getiriHaritasi && getiriHaritasi[f.kod];
      const getiriSatiri = getiri ? `Güncel Getiri: ${getiri}\n` : "";
      return (
        `*${f.kod}* - ${f.ad} (Risk ${f.riskDegeri}/7)\n` +
        `${f.aciklama}\n` +
        `Ana Varlık Yapısı: ${f.anaVarlikYapisi}\n` +
        `${getiriSatiri}` +
        `Karşılaştırma Ölçütü: ${f.karsilastirmaOlcutu}`
      );
    });
    const baslikMetni = `📋 ${grup.etiket}`;
    const parcalar = bloklariMesajGruplarinaBol(baslikMetni.length + 4, satirlar);
    for (let i = 0; i < parcalar.length; i++) {
      const sayfaEki = parcalar.length > 1 ? ` (${i + 1}/${parcalar.length})` : "";
      mesajlar.push(`${baslikMetni}${sayfaEki}\n\n${parcalar[i].join("\n\n")}`);
    }
  }
  mesajlar.push(
    getiriBulundu
      ? "ℹ️ Getiri verileri isteğiniz anında web'den (Garanti BBVA Emeklilik ve TEFAS kaynakları) araştırılmıştır - yaklaşık değerlerdir. Kesin ve güncel rakamlar için garantibbvaemeklilik.com.tr/urunler/emeklilik-yatirim-fonlarimiz/bes-fon-getirileri ya da tefas.gov.tr/tr/fon-getirileri adresini kontrol ediniz."
      : "ℹ️ Şu an güncel getiri verileri alınamadı. Kesin rakamlar için garantibbvaemeklilik.com.tr/urunler/emeklilik-yatirim-fonlarimiz/bes-fon-getirileri ya da tefas.gov.tr/tr/fon-getirileri adresini kontrol ediniz."
  );
  return mesajlar;
}

module.exports = {
  BES_FONLARI,
  RISK_KATEGORILERI,
  riskKategorisiBul,
  fonlariKategoriyeGoreGrupla,
  besFonMesajlariniOlustur
};
