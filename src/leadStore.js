// Tamamlanan her sigorta talebini bir "kayit" (lead) olarak tutar ve takip
// eder: hangi danisman sorumlu, durum ne (acik/olumlu/olumsuz), notlar ve
// hatirlatmalar. Panel ve advisorEngine.js bu modulu kullanarak danismanlarin
// talepleri sonuclandirip sonuclandirmadigini gorur.
//
// Durumlar bilinçli olarak sade tutuldu: bir talep kapanana kadar (olumlu ya
// da olumsuz) tek bir "Açık" durumunda kalir. Eskiden "Bekliyor"/"Takipte"
// diye ikiye ayriliyordu ama danismanlar icin ikisi arasindaki fark net
// degildi - musterinin "ekim ayinda tekrar konusalim" dedigi durumlar zaten
// hatirlatma sistemiyle (asagidaki hatirlatmaKur) karsilaniyor, ayri bir
// "Takipte" durumuna gerek yok.
//
// Okuma/yazma hala hizli bellek-ici (in-memory) Map uzerinden yapilir. Ayrica
// yukle()/kaydet() ile PostgreSQL'e periyodik yedeklenir (DATABASE_URL
// tanimliysa) - detaylar icin db.js'e bakin.

const db = require("./db");

const leads = new Map(); // id -> lead
let sayac = 0;

const DURUMLAR = ["Açık", "Olumlu Kapandı", "Olumsuz Kapandı"];

function yeniLeadOlustur({ telefon, musteriAdi, urun, danismanAdi, danismanNumarasi, ozet, baslik }) {
  sayac += 1;
  const id = `L${Date.now()}${sayac}`;
  const lead = {
    id,
    telefon,
    musteriAdi,
    urun,
    danismanAdi: danismanAdi || null,
    danismanNumarasi: danismanNumarasi || null,
    ozet,
    // 27.07.2026 eklendi: destek talebi (zeyil/iştira vb.) gibi kendi basina
    // bir "is" olarak takip edilen kayitlar icin KISA BIR BASLIK - normal
    // musteri taleplerinde (urun zaten aciklayici oldugu icin) null kalir.
    // Bekleyen İş ozetinde (server.js -> acikIsSatiriOlustur) doluysa urun'un
    // yaninda/yerine gosterilir.
    baslik: baslik || null,
    durum: "Açık",
    notlar: [], // { metin, tarih }
    belgeler: [], // { dosyaAdi, mimeType, veriBase64, yuklenmeZamani }
    hatirlatma: null, // { zaman: timestamp, not: string, gonderildi: bool }
    olusturulmaZamani: Date.now(),
    guncellenmeZamani: Date.now()
  };
  leads.set(id, lead);
  return lead;
}

// 26.07.2026 eklendi: Excel'den (orn. "ELEMENTER ÜRETİM TAKİP.xlsx") toplu
// GEÇMİŞ veri aktarimi icin - normal yeniLeadOlustur'dan FARKLI olarak:
// 1) olusturulmaZamani/durum/netPrim DISARIDAN verilir (gercek police tanzim
//    tarihi/durumu yansitilsin diye - normal akista bunlar hep "simdi" ve
//    "Açık" olur, ama gecmis veri "simdi olusmus" gibi gorunmemeli, aksi
//    halde istatistiklerdeki "bu ay/son 7 gun" gibi metrikler yanlis cikar).
// 2) disKaynakId (orn. "EXCEL:<poliçe no>") alani tutulur - bu sayede import
//    script'i TEKRAR calistirilsa bile (guvenli/idempotent olsun diye) ayni
//    kayit MUKERRER eklenmez; cagiran taraf bu ID'yi kontrol edip zaten
//    var olan bir kaydi atlayabilir (bkz. scripts/elementerVeriIceAktar.js).
function gecmisLeadEkle({
  telefon,
  musteriAdi,
  urun,
  danismanAdi,
  danismanNumarasi,
  ozet,
  durum,
  olusturulmaZamani,
  netPrim,
  disKaynakId,
  // 02.08.2026 eklendi: yenileme kaynakli bir Bekleyen İş kaydinin, ilgili
  // policenin GERCEK bitis (yenileme) tarihini de tasimasi icin - bu sayede
  // "Gecikmiş İş" (suresi dolmus ama 30 gunu doldurmamis) ile "Bekleyen İş"
  // (suresi henuz dolmamis) ayrimini server.js/advisorEngine.js kolayca
  // yapabiliyor. Excel'den veya Excel-disi olusturulan (orn. destek talebi)
  // normal leadlerde bu alan null kalir - sadece yenileme donusumunde
  // (server.js -> yenilemeleriBekleyenIseAktar) doldurulur.
  yenilemeBitisTarihi
}) {
  sayac += 1;
  const id = `L${Date.now()}${sayac}`;
  const lead = {
    id,
    telefon: telefon || null,
    musteriAdi,
    urun,
    danismanAdi: danismanAdi || null,
    danismanNumarasi: danismanNumarasi || null,
    ozet,
    durum: DURUMLAR.includes(durum) ? durum : "Açık",
    notlar: [],
    belgeler: [],
    hatirlatma: null,
    olusturulmaZamani: olusturulmaZamani || Date.now(),
    guncellenmeZamani: Date.now(),
    netPrim: typeof netPrim === "number" ? netPrim : null,
    disKaynakId: disKaynakId || null,
    yenilemeBitisTarihi: typeof yenilemeBitisTarihi === "number" ? yenilemeBitisTarihi : null
  };
  leads.set(id, lead);
  return lead;
}

function tumLeadleriGetir() {
  return Array.from(leads.values()).sort((a, b) => b.olusturulmaZamani - a.olusturulmaZamani);
}

function leadGetir(id) {
  return leads.get(id) || null;
}

function durumGuncelle(id, yeniDurum) {
  const lead = leads.get(id);
  if (!lead) return null;
  if (!DURUMLAR.includes(yeniDurum)) return null;
  lead.durum = yeniDurum;
  lead.guncellenmeZamani = Date.now();
  // Talep kapandiysa (olumlu/olumsuz) bekleyen hatirlatma varsa iptal edilir.
  if (yeniDurum === "Olumlu Kapandı" || yeniDurum === "Olumsuz Kapandı") {
    lead.hatirlatma = null;
  }
  return lead;
}

function notEkle(id, metin) {
  const lead = leads.get(id);
  if (!lead || !metin) return null;
  lead.notlar.push({ metin, tarih: Date.now() });
  lead.guncellenmeZamani = Date.now();
  return lead;
}

// Bir talebe belge/fotograf ekler (danisman WhatsApp'tan gonderdiginde,
// ya da panelden yuklendiginde kullanilir).
function belgeEkle(id, { dosyaAdi, mimeType, veriBase64 }) {
  const lead = leads.get(id);
  if (!lead || !veriBase64) return null;
  if (!lead.belgeler) lead.belgeler = [];
  lead.belgeler.push({
    dosyaAdi: dosyaAdi || "belge",
    mimeType: mimeType || "application/octet-stream",
    veriBase64,
    yuklenmeZamani: Date.now()
  });
  lead.guncellenmeZamani = Date.now();
  return lead;
}

// zamanMs: hatirlatmanin gonderilecegi kesin zaman (Unix ms cinsinden).
// denemeSayisi/basarisiz alanlari, gonderim basarisiz oldugunda sessizce
// kaybolmamasi icin server.js'deki hatirlatmalariKontrolEt tarafindan
// kullanilir (bkz. asagidaki hatirlatmaDenemeBasarisiz).
function hatirlatmaKur(id, zamanMs, not) {
  const lead = leads.get(id);
  if (!lead || !zamanMs) return null;
  lead.hatirlatma = { zaman: zamanMs, not: not || "", gonderildi: false, basarisiz: false, denemeSayisi: 0 };
  lead.guncellenmeZamani = Date.now();
  return lead;
}

// Zamani gelmis (ve henuz gonderilmemis) tum hatirlatmalari doner.
function zamaniGelenHatirlatmalar() {
  const simdi = Date.now();
  return tumLeadleriGetir().filter(
    (lead) => lead.hatirlatma && !lead.hatirlatma.gonderildi && lead.hatirlatma.zaman <= simdi
  );
}

function hatirlatmaGonderildiIsaretle(id) {
  const lead = leads.get(id);
  if (!lead || !lead.hatirlatma) return;
  lead.hatirlatma.gonderildi = true;
}

// Bir hatirlatma gonderim denemesi basarisiz oldugunda cagirilir - "gonderildi"
// ISARETLENMEZ ki bir sonraki kontrol dongusunde (server.js, her 60 saniyede
// bir) TEKRAR denensin. denemeSayisi belirli bir esigi (bkz. server.js
// HATIRLATMA_MAX_DENEME) asarsa, cagiran taraf artik pes edip hatirlatmayi
// "gonderildi: true, basarisiz: true" olarak isaretler - boylece sonsuza kadar
// sessizce tekrar tekrar denenmez, ama panelde/WhatsApp'ta "basarisiz oldu,
// bu musteriyi elle kontrol edin" olarak gorunur kalir (asla sessizce kaybolmaz).
function hatirlatmaDenemeBasarisiz(id, pesGecMi) {
  const lead = leads.get(id);
  if (!lead || !lead.hatirlatma) return;
  lead.hatirlatma.denemeSayisi = (lead.hatirlatma.denemeSayisi || 0) + 1;
  if (pesGecMi) {
    lead.hatirlatma.gonderildi = true;
    lead.hatirlatma.basarisiz = true;
  }
}

// Bir danismanin kendi performans ozetini cikartir (WhatsApp'tan "Performansım"
// menusu icin) - panel'deki /api/panel/stats ile ayni donusum orani mantigini
// kullanir, sadece bu danismana ait taleplerle sinirlandirilmis haliyle.
function danismanIstatistikleri(danismanNumarasi) {
  const hepsi = tumLeadleriGetir().filter((l) => l.danismanNumarasi === danismanNumarasi);
  const simdi = new Date();
  const ayBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1).getTime();
  const buAy = hepsi.filter((l) => l.olusturulmaZamani >= ayBaslangic);

  const olumluToplam = hepsi.filter((l) => l.durum === "Olumlu Kapandı").length;
  const olumsuzToplam = hepsi.filter((l) => l.durum === "Olumsuz Kapandı").length;
  const kapananToplam = olumluToplam + olumsuzToplam;
  const donusumOrani = kapananToplam > 0 ? Math.round((olumluToplam / kapananToplam) * 100) : null;
  const olumluBuAy = buAy.filter((l) => l.durum === "Olumlu Kapandı").length;
  const acikSayisi = hepsi.filter((l) => l.durum === "Açık").length;
  // netPrim SADECE gecmis/Excel'den aktarilan kayitlarda (bkz. gecmisLeadEkle)
  // ve gercek satislarda (advisorEngine.js) doldurulur - normal musteri
  // taleplerinde (henuz fiyat belli olmadigi icin) null kalir, bu yuzden
  // toplarken null/undefined olanlar atlanir.
  const toplamNetPrim = hepsi.reduce((toplam, l) => toplam + (typeof l.netPrim === "number" ? l.netPrim : 0), 0);

  return {
    toplamTalep: hepsi.length,
    buAyTalep: buAy.length,
    acikSayisi,
    olumluToplam,
    olumluBuAy,
    donusumOrani,
    toplamNetPrim
  };
}

// --- Memnuniyet/kalite kontrolu anketi ---
// Bir satis GERCEKTEN Garanti Emeklilik'e iletildiginde (advisorEngine.js'teki
// satisTamamla, SADECE mailSonucu.basarili VE musteri-kendi-kendine-basvurmadi
// durumunda - bkz. oradaki yorum), birkac gun sonra musteriye otomatik bir
// memnuniyet mesaji gonderilmesi icin zamanlanir. hatirlatma (danismana giden)
// ile AYNI desen, ama musteriye gider ve "gonderildi" disinda ayrica bir
// basarisizlik/deneme sayaci TUTULMAZ - bu anket "nice to have" bir ozellik,
// hatirlatma gibi kritik bir is takibi degil, bu yuzden basit tutuldu.
function memnuniyetAnketiKur(id, zamanMs) {
  const lead = leads.get(id);
  if (!lead || !zamanMs) return null;
  lead.memnuniyetAnketi = { zaman: zamanMs, gonderildi: false };
  lead.guncellenmeZamani = Date.now();
  return lead;
}

// Zamani gelmis (ve henuz gonderilmemis) tum memnuniyet anketlerini doner.
function zamaniGelenMemnuniyetAnketleri() {
  const simdi = Date.now();
  return tumLeadleriGetir().filter(
    (lead) => lead.memnuniyetAnketi && !lead.memnuniyetAnketi.gonderildi && lead.memnuniyetAnketi.zaman <= simdi
  );
}

function memnuniyetAnketiGonderildiIsaretle(id) {
  const lead = leads.get(id);
  if (!lead || !lead.memnuniyetAnketi) return;
  lead.memnuniyetAnketi.gonderildi = true;
}

// Danisman bazinda GENEL ekip performans ozeti cikartir (panelin "Ekip
// Performansı" gorunumu icin, bkz. server.js /api/panel/ekip-ozeti).
// danismanIstatistikleri() TEK bir danismanin (numarasina gore) ozetini
// cikartirken, bu fonksiyon VERIDEKI TUM danismanlari (isimlerine gore
// gruplayarak) tek seferde hesaplar - boylece ekip yoneticisi tum ekibi tek
// bir tabloda karsilastirabilir. Numarasi/ismi bilinmeyen ("temsilci" talebi
// gibi henuz kimseye atanmamis) talepler "Atanmamış" adi altinda gruplanir.
function ekipOzeti() {
  const hepsi = tumLeadleriGetir();
  const simdi = new Date();
  const ayBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1).getTime();

  const gruplar = new Map(); // danismanAdi -> lead[]
  hepsi.forEach((lead) => {
    const isim = lead.danismanAdi || "Atanmamış";
    if (!gruplar.has(isim)) gruplar.set(isim, []);
    gruplar.get(isim).push(lead);
  });

  const ozet = Array.from(gruplar.entries()).map(([danismanAdi, leadler]) => {
    const buAy = leadler.filter((l) => l.olusturulmaZamani >= ayBaslangic);
    const olumluToplam = leadler.filter((l) => l.durum === "Olumlu Kapandı").length;
    const olumsuzToplam = leadler.filter((l) => l.durum === "Olumsuz Kapandı").length;
    const kapananToplam = olumluToplam + olumsuzToplam;
    const donusumOrani = kapananToplam > 0 ? Math.round((olumluToplam / kapananToplam) * 100) : null;
    const acikSayisi = leadler.filter((l) => l.durum === "Açık").length;
    const toplamNetPrim = leadler.reduce((toplam, l) => toplam + (typeof l.netPrim === "number" ? l.netPrim : 0), 0);

    return {
      danismanAdi,
      toplamTalep: leadler.length,
      buAyTalep: buAy.length,
      acikSayisi,
      olumluToplam,
      olumsuzToplam,
      donusumOrani,
      toplamNetPrim
    };
  });

  return ozet.sort((a, b) => b.toplamTalep - a.toplamTalep);
}

// 02.08.2026 eklendi: yenilemeStore'dan otomatik olusturulmus ama artik
// gecersiz hale gelmis (30 günden fazla gecikmis ya da kaynagi silinmis)
// "Bekleyen İş" kayitlarini temizlemek icin (bkz. server.js'deki
// eskiYenilemeBekleyenIslerTemizle). Normal musteri taleplerinde durum
// degistirilerek (Olumlu/Olumsuz Kapandı) kapatilir, silinmez - bu fonksiyon
// SADECE otomatik/hatali olusmus kayitlar icin kullanilmalidir.
function leadSil(id) {
  return leads.delete(id);
}

// Sunucu baslarken bir kez cagrilir - DB'de kayitli talepler varsa belleğe yukler.
async function yukle() {
  const veri = await db.oku("leads");
  if (veri) {
    Object.entries(veri).forEach(([id, lead]) => leads.set(id, lead));
    console.log(`${Object.keys(veri).length} talep veritabanindan yuklendi.`);
    // sayac'i, en yuksek mevcut ID'nin uzerine cikacak sekilde ayarlamaya gerek yok
    // cunku ID uretimi zaten Date.now() + sayac kombinasyonu, cakisma riski yok.
  }
}

// Periyodik olarak (server.js'deki zamanlayici ile) cagrilir - tum talepleri DB'ye yazar.
async function kaydet() {
  const obj = Object.fromEntries(leads);
  await db.yaz("leads", obj);
}

module.exports = {
  DURUMLAR,
  yeniLeadOlustur,
  gecmisLeadEkle,
  tumLeadleriGetir,
  leadGetir,
  durumGuncelle,
  notEkle,
  belgeEkle,
  hatirlatmaKur,
  zamaniGelenHatirlatmalar,
  hatirlatmaGonderildiIsaretle,
  hatirlatmaDenemeBasarisiz,
  leadSil,
  danismanIstatistikleri,
  ekipOzeti,
  memnuniyetAnketiKur,
  zamaniGelenMemnuniyetAnketleri,
  memnuniyetAnketiGonderildiIsaretle,
  yukle,
  kaydet
};
