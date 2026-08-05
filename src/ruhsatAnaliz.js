// Musterinin gonderdigi ruhsat fotografini Anthropic API'sinin gorsel analiz
// ozelligini kullanarak "okur". ANTHROPIC_API_KEY ortam degiskeni gerektirir
// (Railway'de ayarlanmali - koda asla yazilmamali).
//
// 28.07.2026 GUNCELLEMESI: eskiden SADECE ruhsatin sag alt kosesindeki "seri
// numarasi" cikariliyordu (Trafik/Kasko akisinda ayrica soruluyordu). Artik
// Trafik/Kasko'da "araç sıfır mı" sorusuna "Hayır" (ikinci el) cevabi
// verildiginde, ruhsat fotografindan TUM asagidaki bilgiler TEK SEFERDE
// cikariliyor - boylece plaka, marka, model, motor no, sasi no ve ruhsat
// sahibinin T.C. kimlik numarasi AYRI AYRI sorulmuyor:
//   - plaka (A) alani
//   - marka (D.1)
//   - model / ticari adi (D.3)
//   - motor no (P.5) - bazi ruhsatlarda bos/"---" olabilir, o zaman null
//   - sasi no (E)
//   - ad soyad (C.1.2 ADI + C.1.1 SOYADI/TICARI UNVANI)
//   - tc kimlik no (Y.4)
// "seriNo" alani da (varsa) donduruluyor - artik Trafik/Kasko akisinda ayrica
// kullanilmiyor (flows.js'teki RUHSAT_BELGESI_SORU sadece plaka/marka/model/
// motor no/sasi no/ad soyad/tc kimlik alanlarini kullaniyor), ama fonksiyonun
// donus tipinde geriye donuk uyumluluk icin (baska bir yerden cagrilirsa diye)
// korunuyor.

async function ruhsatFotografiAnalizEt(buffer, mimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanimli degil - ruhsat foto analizi devre disi.");
  }

  const base64 = buffer.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType || "image/jpeg", data: base64 }
            },
            {
              type: "text",
              text:
                "Bu bir Türkiye araç ruhsatı (trafik tescil belgesi) fotoğrafıdır. Fotoğrafı dikkatlice incele ve " +
                "aşağıdaki bilgileri çıkar:\n" +
                "- Sağ alt köşedeki harflerle başlayıp rakamlarla devam eden 'seri numarası' (örn: AE123456)\n" +
                "- (A) Plaka\n" +
                "- (D.1) Markası\n" +
                "- (D.3) Ticari Adı (model)\n" +
                "- (P.5) Motor No (bazı ruhsatlarda boş/\"---\" olabilir, bu durumda null)\n" +
                "- (E) Şase No / Şasi No\n" +
                "- (C.1.2) Adı ve (C.1.1) Soyadı/Ticari Unvanı - ikisini birleştirip tam ad soyad olarak ver\n" +
                "- (Y.4) T.C. Kimlik No/Vergi No\n\n" +
                "ÖNEMLİ: Gönderilen görsel GERÇEKTEN resmi bir ruhsat/tescil belgesi olmalı (üzerinde yukarıdaki " +
                "alan kodları/kutucukları görünen, devlet tarafından basılmış bir belge). Eğer görsel sadece " +
                "aracın kendisinin (belgesiz) bir fotoğrafıysa, bir proforma/satış teklifi belgesiyse, ya da " +
                "ruhsat DIŞINDA başka bir şeyse, okunabilir alanını false yap ve aciklama alanında bunun bir " +
                "ruhsat olmadığını (ne olduğunu tahmin edebiliyorsan belirterek) yaz - görünen bir araç " +
                "markası/modeli varmış gibi TAHMİN ederek alanları uydurma.\n\n" +
                "SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir metin ekleme:\n" +
                '{"okunabilir": true ya da false, "seri_no": "... ya da null", "plaka": "... ya da null", ' +
                '"marka": "... ya da null", "model": "... ya da null", "motor_no": "... ya da null", ' +
                '"sasi_no": "... ya da null", "ad_soyad": "... ya da null", "tc_kimlik": "... ya da null", ' +
                '"aciklama": "okunamıyorsa ya da bazı alanlar eksikse kısa nedeni (örn: sağ alt köşe kesilmiş, görüntü bulanık)"}'
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  const metin = data?.content?.[0]?.text || "";
  const jsonEslesme = metin.match(/\{[\s\S]*\}/);
  if (!jsonEslesme) {
    throw new Error("Analiz yanıtı anlaşılamadı: " + JSON.stringify(data));
  }

  const sonuc = JSON.parse(jsonEslesme[0]);
  return {
    okunabilir: !!sonuc.okunabilir,
    seriNo: sonuc.seri_no || null,
    plaka: sonuc.plaka || null,
    marka: sonuc.marka || null,
    model: sonuc.model || null,
    motorNo: sonuc.motor_no || null,
    sasiNo: sonuc.sasi_no || null,
    adSoyad: sonuc.ad_soyad || null,
    tcKimlik: sonuc.tc_kimlik || null,
    aciklama: sonuc.aciklama || ""
  };
}

module.exports = { ruhsatFotografiAnalizEt };
