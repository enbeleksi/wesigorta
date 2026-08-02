// 02.08.2026 eklendi (Enbel'in talebi): "yeni talep bildirimi müşteri ismi ve
// ürün adıyla düşse, sadece detayını görmek ister misiniz diye sorsa, 'evet'
// dedikten sonra tüm detaylar ayrı satırlarla düz metin olarak gelse" - bkz.
// conversationEngine.js -> bildirimGonder ve advisorEngine.js'deki "evet"
// yakalama mantığı.
//
// WhatsApp/Meta onaylı şablon parametreleri gerçek satır sonu (\n)
// içeremediği için (bkz. sablonParametresiIcinTemizle), tam detay artık İLK
// bildirimde gitmiyor - önce kısa bir "evet yazarak detayını görebilirsiniz"
// daveti gidiyor, TAM detay (gerçek satır sonlarıyla) danışman "evet"
// yazınca ayrı bir düz metin mesajıyla gönderiliyor. Bu modül, o ana kadar
// "gönderilmeyi bekleyen" tam detay metinlerini danışman numarasına göre
// bellek-içi bir kuyrukta tutar.
//
// Sunucu yeniden başlatılırsa (deploy, restart vb.) bekleyen kayıtlar
// kaybolur - bu KABUL EDİLEBİLİR bir durum, çünkü bu sadece geçici bir
// "henüz okunmadı" bildirim kuyruğu; asıl veri (lead) zaten leadStore'da
// (ve DATABASE_URL varsa Postgres'te) güvende, panelden her zaman görülebilir.

const kuyruklar = new Map(); // danismanNumarasi -> [{ musteriAdi, urun, detayliMetin, eklenmeZamani }]

function detayEkle(danismanNumarasi, { musteriAdi, urun, detayliMetin }) {
  if (!danismanNumarasi) return;
  if (!kuyruklar.has(danismanNumarasi)) kuyruklar.set(danismanNumarasi, []);
  kuyruklar.get(danismanNumarasi).push({ musteriAdi, urun, detayliMetin, eklenmeZamani: Date.now() });
}

// Kuyruktaki EN ESKİ (ilk eklenen) detayı çıkarıp döner - kuyruk boşsa null.
function sonrakiDetayAl(danismanNumarasi) {
  const kuyruk = kuyruklar.get(danismanNumarasi);
  if (!kuyruk || kuyruk.length === 0) return null;
  return kuyruk.shift();
}

function bekleyenSayisi(danismanNumarasi) {
  const kuyruk = kuyruklar.get(danismanNumarasi);
  return kuyruk ? kuyruk.length : 0;
}

module.exports = { detayEkle, sonrakiDetayAl, bekleyenSayisi };
