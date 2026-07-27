// Gunun saatine gore (Turkiye saatine gore, 2016'dan beri DST olmadigi icin
// sabit +3 UTC farkiyla) uygun bir selamlama kelimesi doner - "Günaydın",
// "İyi günler", "İyi akşamlar" ya da "İyi geceler". Musteri/danisman ayrimi
// olmadan TUM karsilama mesajlarinda (conversationEngine.js ve
// advisorEngine.js) ortak kullanilsin diye ayri bir modul olarak tutuluyor.
//
// 27.07.2026 eklendi.

const TURKIYE_UTC_FARKI_MS = 3 * 60 * 60 * 1000;

function turkiyeSaatiSaat() {
  const turkiyeMs = Date.now() + TURKIYE_UTC_FARKI_MS;
  return new Date(turkiyeMs).getUTCHours();
}

// 05:00-11:59 Günaydın, 12:00-17:59 İyi günler, 18:00-21:59 İyi akşamlar,
// 22:00-04:59 İyi geceler.
function gunSelamlamasi() {
  const saat = turkiyeSaatiSaat();
  if (saat >= 5 && saat < 12) return "Günaydın";
  if (saat >= 12 && saat < 18) return "İyi günler";
  if (saat >= 18 && saat < 22) return "İyi akşamlar";
  return "İyi geceler";
}

module.exports = { gunSelamlamasi, turkiyeSaatiSaat };
