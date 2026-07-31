// Tum mesajlarin (gelen/giden) gecmisini bellekte tutar - panel bu sayede
// botun ve musterinin yazdigi her seyi gorebilir. Okuma/yazma hala hizli
// bellek-ici (in-memory) Map uzerinden yapilir - mevcut kodun tamaminda
// hicbir degisiklik gerekmez. Ayrica sessionStore.js'deki ayni desenle,
// yukle()/kaydet() ile PostgreSQL'e periyodik yedeklenir (DATABASE_URL
// tanimliysa).

const db = require("./db");

const conversations = new Map(); // phone -> { name, messages: [{direction, text, timestamp}] }

function ensure(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, { name: null, messages: [] });
  }
  return conversations.get(phone);
}

function logMessage(phone, direction, text) {
  const convo = ensure(phone);
  convo.messages.push({ direction, text, timestamp: Date.now() });
  // Bellek sismesin diye son 200 mesajla sinirla
  if (convo.messages.length > 200) {
    convo.messages.shift();
  }
}

function setName(phone, name) {
  ensure(phone).name = name;
}

function listConversations() {
  return Array.from(conversations.entries())
    .map(([phone, convo]) => {
      const last = convo.messages[convo.messages.length - 1];
      return {
        phone,
        name: convo.name,
        lastMessage: last ? last.text : "",
        lastDirection: last ? last.direction : null,
        lastTimestamp: last ? last.timestamp : 0
      };
    })
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

function getMessages(phone) {
  return ensure(phone).messages;
}

// Panelden bir sohbeti tamamen silmek icin (30.07.2026 eklendi) - sadece
// bellekteki mesaj gecmisini kaldirir, musterinin oturumunu (sessionStore)
// veya kalici profilini (musteriProfilStore) ETKILEMEZ; musteri tekrar yazarsa
// bot onu normal sekilde (kaldigi yerden/tanidigi musteri olarak) karsilamaya
// devam eder - sadece paneldeki eski mesaj gecmisi/onizleme temizlenmis olur.
function deleteConversation(phone) {
  conversations.delete(phone);
}

// Sunucu baslarken bir kez cagrilir - DB'de kayitli mesaj gecmisi varsa belleğe yukler.
async function yukle() {
  const veri = await db.oku("messages");
  if (veri) {
    Object.entries(veri).forEach(([phone, convo]) => conversations.set(phone, convo));
    console.log(`${Object.keys(veri).length} konusma gecmisi veritabanindan yuklendi.`);
  }
}

// Periyodik olarak (server.js'deki zamanlayici ile) cagrilir - tum mesaj gecmisini DB'ye yazar.
async function kaydet() {
  const obj = Object.fromEntries(conversations);
  await db.yaz("messages", obj);
}

module.exports = { logMessage, setName, listConversations, getMessages, deleteConversation, yukle, kaydet };
