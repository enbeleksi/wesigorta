// Türkçe ünlü uyumuna göre, rastgele bir isme (müşteri adı, ruhsat/proforma
// üzerinden okunan ad soyad gibi ÖNCEDEN BİLİNMEYEN metinlere) doğru ek
// (kesme işaretinden sonra gelen "-ın/-in/-un/-ün" tamlayan eki, "-a/-e"
// yönelme hali eki) ekleyen küçük, bağımsız bir "gramer kütüphanesi".
//
// 28.07.2026 EKLENDI: Daha önce flows.js'te bu ekler SABİT olarak (her zaman
// "'ın" ya da "'a") yazılıyordu - bu, ince ünlülü isimlerde (örn. "Ahmet",
// "Berber") hatalı sonuç veriyordu ("Ahmet'ın" yerine doğrusu "Ahmet'in";
// "Berber'ın" yerine doğrusu "Berber'in"). Bu dosya, ismin SON ÜNLÜSÜNE bakarak
// doğru eki hesaplar.
//
// NOT (bağımsız npm paketi yerine burada yazılmasının sebebi): Bu ortamda npm
// registry'sine ağ erişimi yok (test/doğrulama yapılamıyor), bu yüzden
// doğrulayamadığım bir üçüncü parti paketi projeye eklemek yerine - kapsamı
// zaten dar ve netlik gerektiren bu kuralı (Türkçe büyük/küçük ünlü uyumu)
// burada, tam test edilebilir küçük bir modül olarak yazdım. Boylece Railway'de
// ekstra bir npm bağımlılığına ve onun beklenmedik davranışlarına da gerek kalmadı.
//
// KAPSAM DIŞI: Özel isimlerde ünsüz yumuşaması (p/ç/t/k -> b/c/d/ğ) YAZIM
// KURALI OLARAK uygulanmaz (TDK kuralı: özel isimlere gelen ekler kesme
// işaretiyle ayrılır ve isim OLDUĞU GİBİ yazılır - örn. doğrusu "Ahmet'e"dir,
// "Ahmed'e" DEĞİL). Bu yüzden burada sadece ÜNLÜ UYUMU ve isim ünlüyle
// bitiyorsa gereken KAYNAŞTIRMA HARFİ (n/y) hesaplanıyor - ünsüz yumuşaması
// hiç uygulanmıyor, zaten uygulanmaması gerekiyor.

const UNLULER = "aeıioöuü";
const KALIN_UNLULER = "aıou"; // kalın (arka) ünlüler
const YUVARLAK_UNLULER = "oöuü"; // yuvarlak ünlüler

// Verilen kelimenin (Türkçe karaktere duyarlı küçük harfe çevrilmiş) SON
// ünlüsünü bulur - ek, kelimenin son hecesindeki ünlüye göre belirlenir.
// Ünlü bulunamazsa (beklenmeyen bir durum, örn. tamamen yabancı/ünlüsüz bir
// isim) null döner - çağıran taraf bu durumda güvenli bir varsayılana (kalın/
// düz) düşer.
function sonUnluyuBul(kelime) {
  const kucukKelime = (kelime || "").toLocaleLowerCase("tr");
  for (let i = kucukKelime.length - 1; i >= 0; i -= 1) {
    if (UNLULER.includes(kucukKelime[i])) return kucukKelime[i];
  }
  return null;
}

// Kelimenin SON HARFİ bir ünlü mü? (Öyleyse ek eklenirken bir kaynaştırma
// harfi - tamlayan ekinde "n", yönelme ekinde "y" - araya girmesi gerekir,
// örn. "Ayşe" + "in" değil "Ayşe" + "nin" -> "Ayşe'nin").
function sonHarfUnluMu(kelime) {
  const kucukKelime = (kelime || "").toLocaleLowerCase("tr");
  const sonHarf = kucukKelime[kucukKelime.length - 1];
  return UNLULER.includes(sonHarf);
}

function kalinMi(unlu) {
  return KALIN_UNLULER.includes(unlu);
}

function yuvarlakMi(unlu) {
  return YUVARLAK_UNLULER.includes(unlu);
}

// Bir ad soyad metninde ekin uygulanacağı kelime GRAMER OLARAK SON KELİMEDİR
// (örn. "Ahmet Yılmaz'ın" - ek "Yılmaz"ın son ünlüsüne göre belirlenir, ismin
// tamamına değil). Tek kelimelik bir isimde (örn. sadece "Ahmet") o kelimenin
// kendisi kullanılır.
function sonKelimeyiBul(adSoyad) {
  const kelimeler = (adSoyad || "").trim().split(/\s+/).filter(Boolean);
  return kelimeler.length > 0 ? kelimeler[kelimeler.length - 1] : adSoyad || "";
}

// Tamlayan eki (iyelik/genitif - "-ın/-in/-un/-ün"), BÜYÜK ÜNLÜ UYUMU
// (kalın/ince) VE KÜÇÜK ÜNLÜ UYUMU (düz/yuvarlak) birlikte gözetilerek 4 farklı
// biçimden doğru olanı seçer. Ünlü bulunamazsa (guvenli varsayilan) "ın" döner.
function tamlayanEkiSec(kelime) {
  const sonUnlu = sonUnluyuBul(kelime);
  if (!sonUnlu) return "ın";
  const kalin = kalinMi(sonUnlu);
  const yuvarlak = yuvarlakMi(sonUnlu);
  if (kalin && !yuvarlak) return "ın";
  if (!kalin && !yuvarlak) return "in";
  if (kalin && yuvarlak) return "un";
  return "ün";
}

// Yönelme hali eki ("-a/-e"), SADECE büyük ünlü uyumuna (kalın/ince) göre
// belirlenir (küçük ünlü uyumu bu ek için geçerli değildir).
function yonelmeEkiSec(kelime) {
  const sonUnlu = sonUnluyuBul(kelime);
  if (!sonUnlu) return "a";
  return kalinMi(sonUnlu) ? "a" : "e";
}

// "Ahmet Yılmaz" -> "Ahmet Yılmaz'ın" | "Ayşe" -> "Ayşe'nin" | "Berber" -> "Berber'in"
function tamlayanEkiUygula(adSoyad) {
  const temiz = (adSoyad || "").trim();
  if (!temiz) return temiz;
  const sonKelime = sonKelimeyiBul(temiz);
  const ek = tamlayanEkiSec(sonKelime);
  const kaynastirma = sonHarfUnluMu(sonKelime) ? "n" : "";
  return `${temiz}'${kaynastirma}${ek}`;
}

// "Ahmet Yılmaz" -> "Ahmet Yılmaz'a" | "Ayşe" -> "Ayşe'ye" | "Mehmet Öztürk" -> "Mehmet Öztürk'e"
function yonelmeEkiUygula(adSoyad) {
  const temiz = (adSoyad || "").trim();
  if (!temiz) return temiz;
  const sonKelime = sonKelimeyiBul(temiz);
  const ek = yonelmeEkiSec(sonKelime);
  const kaynastirma = sonHarfUnluMu(sonKelime) ? "y" : "";
  return `${temiz}'${kaynastirma}${ek}`;
}

module.exports = {
  tamlayanEkiUygula,
  yonelmeEkiUygula
};
