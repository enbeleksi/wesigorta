// TEK SEFERLİK içe aktarma script'i - "ELEMENTER ÜRETİM TAKİP.xlsx" dosyasından
// (26.07.2026'da Enbel tarafından paylaşıldı) temizlenip scripts/veri/
// elementer_veri.json'a çevrilen 3 sayfayı (üretim, teklif verilecekler,
// bekleyen işler) canlı sisteme (leadStore + yenilemeStore) aktarır.
//
// NASIL ÇALIŞTIRILIR (Railway/production veritabanına karşı):
//   1) Railway panelinden projenizin DATABASE_URL değerini kopyalayın
//      (Postgres eklentisi > Variables sekmesi).
//   2) Bu klasörde: DATABASE_URL="postgres://..." node scripts/elementerVeriIceAktar.js
//      (Railway CLI kuruluysa alternatif olarak: railway run node scripts/elementerVeriIceAktar.js)
//   3) Script bitince bir özet yazdırır (kaç kayıt eklendi, kaç tanesi zaten
//      vardı diye atlandı) ve kendiliğinden kapanır.
//
// GÜVENLİ TEKRAR ÇALIŞTIRMA: Script idempotenttir - her lead/yenileme kaydına
// "disKaynakId" (leadStore) ya da musteriAdi+urun+kaynak eşleşmesi
// (yenilemeStore) üzerinden bir dış-kaynak kimliği/kontrolü uygulanır. Script
// yanlışlıkla iki kez çalıştırılırsa (ya da yarıda kesilip tekrar başlatılırsa)
// zaten aktarılmış kayıtlar TEKRAR eklenmez, sadece eksik kalanlar tamamlanır.
//
// NELERİ AKTARMAZ: Bu script müşteri TELEFON NUMARASI içermez (Excel'de hiç
// yok) - bu yüzden aktarılan kayıtlar musteriProfilStore'a (botun kalıcı
// müşteri hafızası) BAĞLANAMAZ, sadece panelde isim/danışman bazında
// görüntülenebilir/aranabilir hale gelir.

const path = require("path");
const fs = require("fs");

const db = require("../src/db");
const leadStore = require("../src/leadStore");
const yenilemeStore = require("../src/yenilemeStore");

const VERI_YOLU = path.join(__dirname, "veri", "elementer_veri.json");

// 26.07.2026 Enbel'in geri bildirimi uzerine DUZELTILDI: eskiden bu fonksiyon
// tanzim tarihinden itibaren BUGUNE kadar yil yil ilerleyip "en yakin
// GELECEK" tarihi buluyordu - bu, 2023'te yapilip BIR DAHA HIC yenilenmemis
// (musteri kaybedilmis/baska yere gitmis) bir poliçe icin bile 2027 gibi
// "sanki hala aktifmis" bir tarih uretiyordu, ki bu YANLIS ve anlamsiz bir
// hatirlatmaya yol acardi (Enbel'in ozetle belirttigi tam olarak bu sorun).
//
// Artik SADECE tanzim tarihinden TAM 1 YIL SONRASI (beklenen ilk/dogal
// yenileme tarihi) hesaplanir. Bu tarih bugunden YENILEME_TOLERANS_MS'den
// (90 gun / ~3 ay) DAHA FAZLA gecmisse, bu sure icinde YENI bir tanzim
// kaydi da gorulmedigi icin (aksi halde o kayit zaten "en son tanzim"
// olarak secilirdi), poliçenin muhtemelen yenilenmedigini/musterinin
// kaybedildigini varsayiyoruz ve NULL donuyoruz - cagiran taraf bu durumda
// HICBIR yenileme kaydi olusturmaz. Tolerans ici gecikmelerde (orn. 20 gun
// gecmis) ise hala o (gecikmis) tarih kullanilir - Trafik gibi zorunlu
// surekliligi olan urunlerde kisa bir gecikme genelde "yenileme suresi
// yaklasti/bekleniyor" anlamina gelir, "musteri kaybedildi" anlamina gelmez.
const YENILEME_TOLERANS_MS = 90 * 24 * 60 * 60 * 1000;

function sonrakiYenilemeTarihiHesaplaVeyaNull(tanzimMs) {
  const d = new Date(tanzimMs);
  const birYilSonra = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).getTime();
  if (birYilSonra < Date.now() - YENILEME_TOLERANS_MS) {
    return null; // muhtemelen yenilenmedi/musteri kaybedildi - yenileme kaydi olusturma
  }
  return birYilSonra;
}

function paraFormatla(n) {
  if (typeof n !== "number") return "?";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " TL";
}

function tarihFormatla(ms) {
  if (!ms) return "?";
  return new Date(ms).toLocaleDateString("tr-TR");
}

async function main() {
  if (!fs.existsSync(VERI_YOLU)) {
    console.error(`Veri dosyası bulunamadı: ${VERI_YOLU}`);
    process.exit(1);
  }
  const veri = JSON.parse(fs.readFileSync(VERI_YOLU, "utf-8"));
  const araciNumaralari = veri.araciNumaralari || {};

  await db.init();
  await leadStore.yukle();
  await yenilemeStore.yukle();

  const mevcutDisKaynakIdler = new Set(
    leadStore.tumLeadleriGetir().map((l) => l.disKaynakId).filter(Boolean)
  );

  // --- 1) Üretim (Sayfa1) -> gecmis "kapanmış" leadler ---
  let uretimEklenen = 0;
  let uretimAtlanan = 0;
  for (const r of veri.uretim) {
    if (!r.musteriAdi) continue;
    // NOT: sadece policeNo YETERLI degil - ayni police no altinda birden
    // fazla satir olabiliyor (orn. bir "Trafik" poliçesi + sonra ona ait bir
    // "Trafik Zeyil" ayni police numarasini paylasabiliyor, farkli tarih/urun
    // ile). Bu yuzden tanzim tarihi ve urun de anahtara dahil edildi - aksi
    // halde zeyil satiri "zaten var" sanilip YANLISLIKLA atlanirdi.
    const disKaynakId = `EXCEL:URETIM:${r.policeNo || r.musteriAdi}|${r.urunHam}|${r.tanzimTarihiMs}`;
    if (mevcutDisKaynakIdler.has(disKaynakId)) {
      uretimAtlanan += 1;
      continue;
    }
    const danismanNumarasi = araciNumaralari[r.araci] || null;
    const ozet =
      `[Excel'den aktarıldı - Üretim] ${r.urunHam} • ${r.sirket || "?"} • ` +
      `Poliçe No: ${r.policeNo || "?"} • Tanzim: ${tarihFormatla(r.tanzimTarihiMs)} • ` +
      `Ödeme: ${r.odemeYontemi || "?"} • Net Prim: ${paraFormatla(r.netPrim)} • Acente: ${r.acente || "?"}`;
    leadStore.gecmisLeadEkle({
      telefon: null,
      musteriAdi: r.musteriAdi,
      urun: r.urunHam,
      danismanAdi: r.araci,
      danismanNumarasi,
      ozet,
      durum: r.iptalMi ? "Olumsuz Kapandı" : "Olumlu Kapandı",
      olusturulmaZamani: r.tanzimTarihiMs || Date.now(),
      netPrim: typeof r.netPrim === "number" ? r.netPrim : null,
      disKaynakId
    });
    mevcutDisKaynakIdler.add(disKaynakId);
    uretimEklenen += 1;
  }

  // --- 2) Teklif Verilecekler Listesi (Sayfa2) -> "Açık" leadler ---
  // NOT: Bu listedeki TUM hedef tarihler zaten GECMISTE (script yazıldığı
  // tarih itibariyle) - otomatik bir hatırlatma kurulursa hepsi AYNI ANDA
  // "gecikmiş" olarak bildirim üretir (23 kayıt). Bilinçli olarak hatırlatma
  // KURULMUYOR - kayıtlar panelde görünür/aranabilir olacak, danışman uygun
  // gördüğünde panelden manuel bir hatırlatma kurabilir.
  let teklifEklenen = 0;
  let teklifAtlanan = 0;
  for (const r of veri.teklifVerilecekler) {
    if (!r.musteriAdi) continue;
    const disKaynakId = `EXCEL:TEKLIF:${r.policeNo || `${r.musteriAdi}|${r.plaka || ""}|${r.hedefTarihMs}`}`;
    if (mevcutDisKaynakIdler.has(disKaynakId)) {
      teklifAtlanan += 1;
      continue;
    }
    const ozet =
      `[Excel'den aktarıldı - Teklif Verilecekler] Hedef tarih: ${tarihFormatla(r.hedefTarihMs)}` +
      (r.plaka ? ` • Plaka: ${r.plaka}` : "") +
      (r.ruhsatNo ? ` • Ruhsat No: ${r.ruhsatNo}` : "") +
      (r.tc ? ` • TC/VKN: ${r.tc}` : "") +
      ` • (Bu hedef tarih muhtemelen geçmiş - manuel kontrol edip yeni bir hatırlatma kurabilirsiniz.)`;
    leadStore.gecmisLeadEkle({
      telefon: null,
      musteriAdi: r.musteriAdi,
      urun: r.urun || "Belirtilmemiş",
      danismanAdi: null,
      danismanNumarasi: null,
      ozet,
      durum: "Açık",
      olusturulmaZamani: r.hedefTarihMs || Date.now(),
      netPrim: null,
      disKaynakId
    });
    mevcutDisKaynakIdler.add(disKaynakId);
    teklifEklenen += 1;
  }

  // --- 3) Bekleyen İşler (Sayfa3) -> "Açık" leadler + (varsa) hatırlatma ---
  let bekleyenEklenen = 0;
  let bekleyenAtlanan = 0;
  for (const r of veri.bekleyenIsler) {
    if (!r.musteriAdi) continue;
    const disKaynakId = `EXCEL:BEKLEYEN:${r.araci || ""}|${r.musteriAdi}|${r.urun || ""}|${r.sonTarihMs || "none"}`;
    if (mevcutDisKaynakIdler.has(disKaynakId)) {
      bekleyenAtlanan += 1;
      continue;
    }
    const danismanNumarasi = araciNumaralari[r.araci] || null;
    const ozet =
      `[Excel'den aktarıldı - Bekleyen İşler] ${r.urun || "?"}` +
      (r.fiyat ? ` • Fiyat: ${paraFormatla(r.fiyat)}` : "") +
      (r.indirimliFiyat ? ` • İndirimli: ${paraFormatla(r.indirimliFiyat)}` : "") +
      (r.sirket ? ` • Şirket: ${r.sirket}` : "") +
      (r.sonTarihMs ? ` • Son Tarih: ${tarihFormatla(r.sonTarihMs)}` : "") +
      (r.ekBilgi ? ` • Not: ${r.ekBilgi}` : "");
    const yeniLead = leadStore.gecmisLeadEkle({
      telefon: null,
      musteriAdi: r.musteriAdi,
      urun: r.urun || "Belirtilmemiş",
      danismanAdi: r.araci,
      danismanNumarasi,
      ozet,
      durum: "Açık",
      olusturulmaZamani: Date.now(),
      netPrim: typeof r.fiyat === "number" ? r.fiyat : null,
      disKaynakId
    });
    if (r.sonTarihMs) {
      leadStore.hatirlatmaKur(yeniLead.id, r.sonTarihMs, r.ekBilgi || "Bekleyen iş - Excel'den aktarıldı");
    }
    mevcutDisKaynakIdler.add(disKaynakId);
    bekleyenEklenen += 1;
  }

  // --- 4) Üretimden yenileme kayıtları türet (Sayfa1, sadece yıllık yenilenen
  //        branşlar: Trafik/Kasko/DASK/Konut/TSS/ÖSS/Hekim/İşyeri) ---
  // Aynı müşteri+ürün ailesi için BIRDEN FAZLA satır olabilir (her yıl yeniden
  // tanzim edilmiş olabilir) - sadece EN SON tanzim edilen satırı temel
  // alıyoruz, ve o satır İPTAL ise (yani müşteri son kez o poliçeyi iptal
  // etmiş ve bir daha yenilememiş) o müşteri+ürün için HİÇ yenileme kaydı
  // OLUŞTURMUYORUZ - aksi halde iptal edilmiş bir poliçe için yanlışlıkla
  // "yenileme zamanı geldi" bildirimi gitmiş olurdu.
  const gruplar = new Map(); // "musteriAdi|urunAilesi" -> en son satir
  for (const r of veri.uretim) {
    if (!r.musteriAdi || !r.yenilemeUygun || !r.tanzimTarihiMs) continue;
    const anahtar = `${r.musteriAdi}|${r.urunAilesi}`;
    const mevcut = gruplar.get(anahtar);
    if (!mevcut || r.tanzimTarihiMs > mevcut.tanzimTarihiMs) {
      gruplar.set(anahtar, r);
    }
  }

  const mevcutYenilemeAnahtarlari = new Set(
    yenilemeStore
      .tumYenilemeleriGetir()
      .filter((y) => y.kaynak === "excel_import")
      .map((y) => `${y.musteriAdi}|${y.urun}`)
  );

  let yenilemeEklenen = 0;
  let yenilemeAtlananIptal = 0;
  let yenilemeAtlananMevcut = 0;
  let yenilemeAtlananMuhtemelenKaybedilen = 0;
  for (const [anahtar, r] of gruplar) {
    if (r.iptalMi) {
      yenilemeAtlananIptal += 1;
      continue;
    }
    if (mevcutYenilemeAnahtarlari.has(anahtar)) {
      yenilemeAtlananMevcut += 1;
      continue;
    }
    const bitisTarihi = sonrakiYenilemeTarihiHesaplaVeyaNull(r.tanzimTarihiMs);
    if (bitisTarihi === null) {
      // 1 yil + 90 gunluk tolerans icinde HICBIR yeni tanzim kaydi
      // gorulmemis - muhtemelen musteri bu urunu bir daha yenilememis
      // (kaybedilmis). Yanlis bir "hala aktif" hatirlatmasi gondermemek
      // icin bu musteri+urun icin HICBIR yenileme kaydi olusturmuyoruz.
      yenilemeAtlananMuhtemelenKaybedilen += 1;
      continue;
    }
    yenilemeStore.yeniYenilemeOlustur({
      danismanNumarasi: araciNumaralari[r.araci] || null,
      danismanAdi: r.araci,
      musteriAdi: r.musteriAdi,
      urun: r.urunAilesi,
      plaka: null,
      bitisTarihi,
      kaynak: "excel_import"
    });
    mevcutYenilemeAnahtarlari.add(anahtar);
    yenilemeEklenen += 1;
  }

  await leadStore.kaydet();
  await yenilemeStore.kaydet();

  console.log("--- İçe aktarma tamamlandı ---");
  console.log(`Üretim (Sayfa1)          : ${uretimEklenen} eklendi, ${uretimAtlanan} zaten vardı (atlandı)`);
  console.log(`Teklif Verilecekler      : ${teklifEklenen} eklendi, ${teklifAtlanan} zaten vardı (atlandı)`);
  console.log(`Bekleyen İşler           : ${bekleyenEklenen} eklendi, ${bekleyenAtlanan} zaten vardı (atlandı)`);
  console.log(
    `Yenileme kayıtları       : ${yenilemeEklenen} eklendi, ${yenilemeAtlananMevcut} zaten vardı, ` +
      `${yenilemeAtlananIptal} iptal olduğu için atlandı, ${yenilemeAtlananMuhtemelenKaybedilen} muhtemelen yenilenmediği (müşteri kaybedildiği) için atlandı`
  );
  console.log("Panelden 'Talepler' ve WhatsApp'tan 'Yaklaşan Yenilemeler' menüsünden kontrol edebilirsiniz.");
  console.log(
    // NOT: buradaki "15 gün" değeri server.js'deki YENILEME_BEKLEYEN_IS_ESIK_GUN
    // sabitiyle senkron olmalı - sadece bilgilendirme amaçlı, script bu eşiği
    // kendisi UYGULAMAZ (bkz. server.js'deki yenilemeleriBekleyenIseAktar).
    `Yenilemeler bitiş tarihinden 15 gün önce otomatik olarak "Bekleyen İş" haline gelecek ve her gün 09:30'da ilgili danışmana (ve Bahadır/Enbel'e toplu olarak) hatırlatılacak.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("İçe aktarma sırasında hata oluştu:", err);
  process.exit(1);
});
