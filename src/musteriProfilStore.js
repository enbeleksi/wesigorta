// Musterilerin telefon numarasina bagli KALICI profilini tutar (ad soyad, TC
// kimlik, KVKK onayi) - boylece ayni musteri GUNLER/HAFTALAR sonra tekrar
// yazdiginda (oturumu tamamen sifirlanmis, sunucu yeniden baslamis olsa bile)
// bu bilgiler yeniden sorulmaz. session/leadStore ile AYNI kalicilik desenini
// kullanir: bellek-ici Map + DATABASE_URL tanimliysa PostgreSQL'e periyodik
// yedekleme (bkz. db.js).
//
// 26.07.2026 eklendi. NOT: dogum tarihi BILEREK burada tutulmuyor - bazi
// urunlerde (orn. Ozel Saglik/TSS) bu soru musterinin KENDI dogum tarihini
// degil, sigortalanacak baska bir kisinin (esi/cocugu) dogum tarihini
// sorabiliyor ("kimin_icin" sorusuna bagli) - musterinin kendi profiline
// yanlislikla baskasinin dogum tarihini kaydetmek, ileride yanlis bir kisiye
// ait bilgiyle bir police hazirlanmasi riskini dogurur. TC kimlik icin de
// ayni temkinlilik uygulanir: sadece SORUNUN ACIKCA "sizin/sizin kimliginiz"
// diye musterinin KENDI kimligini sordugu (question.kaliciProfilAlani ===
// "tcKimlik") durumlarda kaydedilir - arac/ruhsat sahibi TC'si gibi
// baskasina ait olabilecek TC numaralari ASLA buraya yazilmaz.

const db = require("./db");

const profiller = new Map(); // telefon -> { adSoyad, tcKimlik, kvkkOnayVerildi, kvkkOnayZamani, guncellenmeZamani }

function profilGetir(telefon) {
  return profiller.get(telefon) || null;
}

// alanlar icindeki SADECE tanimli (undefined olmayan) alanlar guncellenir,
// digerleri (varsa) oldugu gibi korunur.
function profilGuncelle(telefon, alanlar) {
  const mevcut = profiller.get(telefon) || {};
  const guncel = { ...mevcut };
  Object.keys(alanlar).forEach((k) => {
    if (alanlar[k] !== undefined) guncel[k] = alanlar[k];
  });
  guncel.guncellenmeZamani = Date.now();
  profiller.set(telefon, guncel);
  return guncel;
}

function kvkkOnayVer(telefon) {
  return profilGuncelle(telefon, { kvkkOnayVerildi: true, kvkkOnayZamani: Date.now() });
}

function kvkkOnayVerildiMi(telefon) {
  const p = profiller.get(telefon);
  return !!(p && p.kvkkOnayVerildi);
}

// Musteri "ben bu kisi degilim" gibi bir sey soylerse (numara el degistirmis
// olabilir), o numaraya ait TUM kalici kaydi siler - bir sonraki mesajinda
// tamamen yeni bir musteri gibi muamele gorur.
function profilSil(telefon) {
  profiller.delete(telefon);
}

async function yukle() {
  const veri = await db.oku("musteriProfilleri");
  if (veri) {
    Object.entries(veri).forEach(([telefon, profil]) => profiller.set(telefon, profil));
    console.log(`${Object.keys(veri).length} musteri profili veritabanindan yuklendi.`);
  }
}

async function kaydet() {
  const obj = Object.fromEntries(profiller);
  await db.yaz("musteriProfilleri", obj);
}

module.exports = {
  profilGetir,
  profilGuncelle,
  kvkkOnayVer,
  kvkkOnayVerildiMi,
  profilSil,
  yukle,
  kaydet
};
