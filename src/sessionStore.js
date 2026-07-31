// Oturum deposu. Okuma/yazma hala hizli bellek-ici (in-memory) Map uzerinden
// yapilir - mevcut kodun tamaminda hicbir degisiklik gerekmez. Ayrica:
// - Sunucu acilirken yukle() ile en son kaydedilmis durum PostgreSQL'den geri
//   yuklenir (varsa),
// - Sunucu calisirken periyodik olarak (server.js'deki zamanlayici ile)
//   kaydet() cagrilip tum oturumlar PostgreSQL'e yedeklenir.
// DATABASE_URL tanimli degilse (db.js'de pool olusmadiysa), yukle/kaydet
// sessizce hicbir sey yapmaz - sistem eskisi gibi sadece bellekte calisir.

const db = require("./db");

const sessions = new Map();

function defaultSession() {
  return {
    state: "NEW", // NEW -> ASK_NAME -> ASK_PRODUCT -> ASKING -> DONE
    //                                        \-> (Sık Sorulan Sorular secilirse) ASK_INFO_PRODUCT -> URUN_BILGI_SORU
    name: null,
    product: null,
    questionIndex: 0,
    answers: {},
    paused: false, // true olunca bot devreye girmez, sadece temsilci yazar
    updatedAt: Date.now()
  };
}

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, defaultSession());
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  sessions.delete(phone);
}

// Sunucu baslarken bir kez cagrilir - DB'de kayitli oturumlar varsa belleğe yukler.
async function yukle() {
  const veri = await db.oku("sessions");
  if (veri) {
    Object.entries(veri).forEach(([phone, session]) => sessions.set(phone, session));
    console.log(`${Object.keys(veri).length} oturum veritabanindan yuklendi.`);
  }
}

// Periyodik olarak (server.js'deki zamanlayici ile) cagrilir - tum oturumlari DB'ye yazar.
async function kaydet() {
  const obj = Object.fromEntries(sessions);
  await db.yaz("sessions", obj);
}

module.exports = { getSession, resetSession, yukle, kaydet };
