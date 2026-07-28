// Musterinin gonderdigi proforma (sifir arac satis teklifi) belgesini Anthropic
// API'sinin gorsel/dokuman analiz ozelligini kullanarak "okur". ANTHROPIC_API_KEY
// ortam degiskeni gerektirir (Railway'de ayarlanmali - koda asla yazilmamali).
//
// 28.07.2026 EKLENDI: Trafik/Kasko akisinda "araç sıfır mı" sorusuna "Evet"
// cevabi verildiginde, musteriden ruhsat yerine PROFORMA belgesi isteniyor.
// Proforma tipik olarak yeni bayiden alinan bir satis teklifi/fatura taslagi
// oldugundan, ruhsattan FARKLI olarak genellikle su bilgileri icerir:
//   - musteri adi soyadi
//   - marka / model (genellikle fiyat kalemi satirinda gecer)
//   - motor no
//   - sasi no
//   - model yili
// Proformada GENELLIKLE T.C. kimlik no VE plaka YER ALMAZ (arac henuz tescil
// edilmemis, musterinin kimlik no'su bayi teklifine yazilmaz) - bu yuzden bu iki
// alan neredeyse her zaman null donecektir. conversationEngine.js bu durumda
// proformada gecen musteri ismiyle hitap ederek TC kimlik numarasini AYRICA soracak.

async function proformaAnalizEt(buffer, mimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanimli degil - proforma analizi devre disi.");
  }

  const base64 = buffer.toString("base64");
  const pdfMi = mimeType === "application/pdf";

  const belgeIcerigi = pdfMi
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: base64 } };

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
            belgeIcerigi,
            {
              type: "text",
              text:
                "Bu, Türkiye'de sıfır (yeni) bir araç için bayiden alınmış bir PROFORMA / satış teklifi " +
                "belgesidir. Belgeyi dikkatlice incele ve aşağıdaki bilgileri çıkar:\n" +
                "- Müşteri Adı (ve varsa Soyadı) - tam ad soyad olarak ver\n" +
                "- Aracın Markası (örn: MINI, KIA, FIAT)\n" +
                "- Aracın Modeli / Ticari Adı (örn: Countryman E, Stonic) - genellikle fiyat kalemi satırında geçer\n" +
                "- Motor No\n" +
                "- Şasi No / Şase No\n" +
                "- Model Yılı (varsa)\n" +
                "- T.C. Kimlik No (proformalarda genellikle YER ALMAZ, yoksa null döndür, uydurma)\n" +
                "- Plaka (araç henüz tescil edilmediği için genellikle YER ALMAZ, yoksa null döndür, uydurma)\n\n" +
                "SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir metin ekleme:\n" +
                '{"okunabilir": true ya da false, "ad_soyad": "... ya da null", "marka": "... ya da null", ' +
                '"model": "... ya da null", "motor_no": "... ya da null", "sasi_no": "... ya da null", ' +
                '"model_yili": "... ya da null", "tc_kimlik": "... ya da null", "plaka": "... ya da null", ' +
                '"aciklama": "okunamıyorsa ya da bazı alanlar eksikse kısa nedeni (örn: görüntü bulanık, sayfa kesilmiş)"}'
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
    adSoyad: sonuc.ad_soyad || null,
    marka: sonuc.marka || null,
    model: sonuc.model || null,
    motorNo: sonuc.motor_no || null,
    sasiNo: sonuc.sasi_no || null,
    modelYili: sonuc.model_yili || null,
    tcKimlik: sonuc.tc_kimlik || null,
    plaka: sonuc.plaka || null,
    aciklama: sonuc.aciklama || ""
  };
}

module.exports = { proformaAnalizEt };
