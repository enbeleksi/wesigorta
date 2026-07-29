// 28.07.2026 eklendi: kullanicinin talebi uzerine - herhangi bir numara
// (musteri ya da baska biri) botu israrla rahatsiz ederse (spam, taciz vb.),
// o numarayi KALICI olarak engelleyebilmek icin. sessionStore'daki
// "session.paused" ile KARISTIRILMAMALI - o GECICI bir mekanizma (tek bir
// konusmayi insan devralsin diye, panelden tek tikla geri acilir), bu ise
// bilincli, ayri ve kolay yanlislikla geri alinamayacak bir "bu numaraya BIR
// DAHA ASLA cevap verme" karari icin. Engellenen bir numaradan mesaj geldiginde
// webhook seviyesinde (bkz. server.js) hem danisman hem musteri akisina hic
// girilmeden islem durdurulur - session state'i bile guncellenmez.
//
// Okuma/yazma bellek-ici (in-memory) Map uzerinden yapilir, digerleriyle ayni
// sekilde db.js araciligiyla PostgreSQL'e periyodik yedeklenir (bkz.
// server.js'deki tumVeriyiKaydet/guvenliYukle).

const db = require("./db");

const engelliNumaralar = new Map(); // numara -> engel kaydi

function numarayiEngelle(numara, not, engelleyenAdi) {
  if (!numara) return null;
  const kayit = {
    numara,
    not: not || null,
    engelleyenAdi: engelleyenAdi || null,
    engellenmeZamani: Date.now()
  };
  engelliNumaralar.set(numara, kayit);
  return kayit;
}

function engeliKaldir(numara) {
  return engelliNumaralar.delete(numara);
}

function numaraEngelliMi(numara) {
  return engelliNumaralar.has(numara);
}

function tumEngelliNumaralariGetir() {
  return Array.from(engelliNumaralar.values()).sort((a, b) => b.engellenmeZamani - a.engellenmeZamani);
}

// Sunucu baslarken bir kez cagrilir - DB'de kayitli engelli numaralar varsa belleğe yukler.
async function yukle() {
  const veri = await db.oku("engelliNumaralar");
  if (veri) {
    Object.entries(veri).forEach(([numara, kayit]) => engelliNumaralar.set(numara, kayit));
    console.log(`${Object.keys(veri).length} engelli numara veritabanindan yuklendi.`);
  }
}

// Periyodik olarak (server.js'deki zamanlayici ile) cagrilir - tum engelli numaralari DB'ye yazar.
async function kaydet() {
  const obj = Object.fromEntries(engelliNumaralar);
  await db.yaz("engelliNumaralar", obj);
}

module.exports = {
  numarayiEngelle,
  engeliKaldir,
  numaraEngelliMi,
  tumEngelliNumaralariGetir,
  yukle,
  kaydet
};
