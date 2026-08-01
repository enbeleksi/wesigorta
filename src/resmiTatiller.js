// 01.08.2026 eklendi: kullanicinin talebi uzerine - "resmi tatillerin
// hicbirinde calismiyoruz" (resmi tatillerde ne gunluk ozet gonderiliyor, ne
// randevu aliniyor, ne de tekrar arama planlaniyor - bkz. server.js'teki
// gunlukBekleyenIsOzetiKontrolEt ve advisorEngine.js'teki
// bugundenBaslayanHaftaIciGunleri / DANISMAN_RANDEVU_DEFTERI_TEKRAR_TARIH).
//
// Sabit tarihli (Yılbaşı, 23 Nisan vb.) gunler her yil AYNI, ama dini
// bayramlar (Ramazan/Kurban Bayramı) her yil Hicri takvime gore KAYAR ve
// Diyanet tarafindan resmi olarak yil oncesinden ilan edilir - otomatik/
// algoritmik olarak hesaplanamaz. Bu yuzden yil yil ELLE guncellenmesi
// GEREKEN sabit bir liste kullaniliyor. YENI BIR YILA GECILDIGINDE bu
// listeye o yilin tum resmi tatilleri eklenmelidir, aksi halde sistem o yil
// icin hicbir tatili taniyamaz ve normal bir is gunu gibi davranir (resmi
// kaynak: setur.com.tr / enuygun.com / turkcell.com.tr - 01.08.2026
// itibariyla ucu de ayni tarihleri veriyordu).
//
// Bayram ARİFELERİ resmi olarak SADECE öğleden sonra (13:00'ten itibaren)
// tatil olsa da, burada TAM GÜN olarak isaretlendi - kullanicinin talebi
// sirketin o gunler HIC calismadigi yonundeydi, kismi/yarim gun bir istisna
// belirtilmedi.
const RESMI_TATIL_LISTESI = [
  // --- 2026 ---
  { tarih: "01.01.2026", ad: "Yılbaşı" },
  { tarih: "19.03.2026", ad: "Ramazan Bayramı Arifesi" },
  { tarih: "20.03.2026", ad: "Ramazan Bayramı (1. Gün)" },
  { tarih: "21.03.2026", ad: "Ramazan Bayramı (2. Gün)" },
  { tarih: "22.03.2026", ad: "Ramazan Bayramı (3. Gün)" },
  { tarih: "23.04.2026", ad: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { tarih: "01.05.2026", ad: "Emek ve Dayanışma Günü" },
  { tarih: "19.05.2026", ad: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { tarih: "26.05.2026", ad: "Kurban Bayramı Arifesi" },
  { tarih: "27.05.2026", ad: "Kurban Bayramı (1. Gün)" },
  { tarih: "28.05.2026", ad: "Kurban Bayramı (2. Gün)" },
  { tarih: "29.05.2026", ad: "Kurban Bayramı (3. Gün)" },
  { tarih: "30.05.2026", ad: "Kurban Bayramı (4. Gün)" },
  { tarih: "15.07.2026", ad: "Demokrasi ve Milli Birlik Günü" },
  { tarih: "30.08.2026", ad: "Zafer Bayramı" },
  { tarih: "28.10.2026", ad: "Cumhuriyet Bayramı Arifesi" },
  { tarih: "29.10.2026", ad: "Cumhuriyet Bayramı" }
  // --- 2027 (ve sonrasi) --- yeni yil basladiginda buraya eklenmelidir.
];

// "GG.AA.YYYY" -> "YYYY-AA-GG" cevirimi - server.js'deki gunAnahtari
// ("YYYY-MM-DD") ile advisorEngine.js'deki kanonik tarih formatinin
// ("GG.AA.YYYY") ikisiyle de tek kaynaktan (yukaridaki liste) calisabilmek
// icin iki ayri harita once burada, modul yuklenirken bir kere turetiliyor.
function ggAaYyyydenYyyyAaGgye(tarih) {
  const [gun, ay, yil] = tarih.split(".");
  return `${yil}-${ay}-${gun}`;
}

const GG_AA_YYYY_HARITASI = {};
const YYYY_AA_GG_HARITASI = {};
RESMI_TATIL_LISTESI.forEach(({ tarih, ad }) => {
  GG_AA_YYYY_HARITASI[tarih] = ad;
  YYYY_AA_GG_HARITASI[ggAaYyyydenYyyyAaGgye(tarih)] = ad;
});

// tarih: "GG.AA.YYYY" formatinda (advisorEngine.js'in kanonik formatı).
// O gun resmi tatilse tatilin adini, degilse null dondurur.
function tatilAdiGetir(ggAaYyyyTarih) {
  return GG_AA_YYYY_HARITASI[ggAaYyyyTarih] || null;
}

// tarih: "YYYY-AA-GG" formatinda (server.js'deki gunAnahtari formatı).
function tatilAdiGetirYyyyAaGg(yyyyAaGgTarih) {
  return YYYY_AA_GG_HARITASI[yyyyAaGgTarih] || null;
}

module.exports = { tatilAdiGetir, tatilAdiGetirYyyyAaGg };
