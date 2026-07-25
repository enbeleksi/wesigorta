// Danismanin satis kaydi akisinda tek tek yukledigi belge fotograflarini
// (Acik Riza Beyani/KVKK metni, Imza Karti, Yerlesim Yeri Belgesi, Kimlik
// on/arka yuz) Claude'un gorsel analiz ozelligi ile kontrol eder:
//   1) Fotograf yeterince net mi (bulanik/karanlik/okunaksiz degil mi)
//   2) Fotograf gercekten o adimda beklenen belge turune mi ait (orn.
//      danisman yanlislikla baska bir belgenin fotografini gonderirse
//      bunu yakalayip uyarabilmek icin)
//   3) (SADECE imzaGerekli=true olan belgeler icin, orn. Acik Riza Beyani,
//      Imza Karti) belge gercekten doldurulup imzalanmis mi, yoksa bos bir
//      sablon/form mu gonderilmis - bu ayri, ACIK bir JSON alani olarak
//      soruluyor cunku "dogru_belge_mi" alaninin kendi tanimi sadece belge
//      TURUNUN eslesip eslesmedigini soruyor (bos bir Acik Riza Beyani
//      sablonu da yine de bir "Acik Riza Beyani" turudur ve bu soruyu
//      guvenilir bicimde yakalamiyordu - modelin bunu ayrica, net bir
//      talimatla kontrol etmesi gerekiyor).
//
// ruhsatAnaliz.js'deki ile ayni Anthropic Vision API deseni kullanilir.
// ANTHROPIC_API_KEY tanimli degilse ya da API bir hata donerse hata firlatir;
// cagiran taraf (advisorEngine.js) bu durumda kontrolu atlayip belgeyi normal
// kabul ediyor - boylece gecici bir API sorunu satis surecini tamamen
// durdurmuyor.
async function belgeFotografiAnalizEt(buffer, mimeType, beklenenBelgeAciklamasi, imzaGerekli) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanimli degil - belge foto analizi devre disi.");
  }

  const base64 = buffer.toString("base64");

  const imzaAlaniSorusu = imzaGerekli
    ? ', "imzali_mi": true ya da false (BU ALANI DİKKATLİCE DEĞERLENDİR: bu belge türü elle doldurulmuş VE imzalanmış olmalı. ' +
      'Eğer belge boş bir şablon/form görünümündeyse, imza kutusu boşsa, içinde "ÖRNEK"/"ISLAK İMZA ÖRNEĞİ" gibi bir ' +
      "filigran ya da yer tutucu deseni varsa, ya da ad/tarih gibi doldurulması gereken alanlar boşsa false. " +
      "Gerçek el yazısıyla atılmış bir imza ve doldurulmuş bilgiler varsa true.)"
    : "";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 300,
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
                `Beklenen belge: ${beklenenBelgeAciklamasi}\n\n` +
                "Bu fotoğrafı incele ve SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir metin ekleme:\n" +
                '{"net_mi": true ya da false (fotoğraf bulanık, karanlık ya da okunaksızsa false), ' +
                '"dogru_belge_mi": true ya da false (fotoğraf yukarıda tarif edilen belge türüyle eşleşmiyorsa false)' +
                imzaAlaniSorusu +
                ', "aciklama": "sorun varsa kısa ve danışmana yönelik nazik bir açıklama (Türkçe), sorun yoksa boş string"}'
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
    netMi: sonuc.net_mi !== false,
    dogruBelgeMi: sonuc.dogru_belge_mi !== false,
    // imzaGerekli=false ise bu alan hic sorulmadi (sonuc.imzali_mi undefined
    // gelir) - bu durumda kontrol atlanmis sayilir ve true doner.
    imzaliMi: imzaGerekli ? sonuc.imzali_mi !== false : true,
    aciklama: sonuc.aciklama || ""
  };
}

// Kimligin ON ve ARKA yuzu fotograflarinin AYNI kisiye/karta ait olup
// olmadigini kontrol eder (24.07.2026 geri bildirimi - "kimliğin arkasının ön
// yüzdeki kimliğe ait olup olmadığını kontrol edelim farklı bir kimliğin arka
// yüzünü kabul etmeyelim"). Iki fotografi TEK bir Anthropic Vision cagrisinda
// karsilastirir - on yuzdeki ad/soyad/TC kimlik no ile arka yuzdeki seri no/
// diger bilgilerin ayni fiziksel karta ait gorunup gorunmedigini degerlendirir.
// ANTHROPIC_API_KEY tanimli degilse ya da API hata donerse hata firlatir;
// cagiran taraf (advisorEngine.js) bu durumda kontrolu atlayip cifti normal
// kabul ediyor - gecici bir API sorunu satis surecini durdurmasin.
async function kimlikOnArkaTutarliMi(onBuffer, onMimeType, arkaBuffer, arkaMimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanimli degil - kimlik on/arka tutarlilik kontrolu devre disi.");
  }

  const onBase64 = onBuffer.toString("base64");
  const arkaBase64 = arkaBuffer.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Bu, bir T.C. kimlik kartının ÖN yüzü:" },
            { type: "image", source: { type: "base64", media_type: onMimeType || "image/jpeg", data: onBase64 } },
            { type: "text", text: "Bu da ARKA yüzü olduğu iddia edilen fotoğraf:" },
            { type: "image", source: { type: "base64", media_type: arkaMimeType || "image/jpeg", data: arkaBase64 } },
            {
              type: "text",
              text:
                "Bu iki fotoğrafın AYNI fiziksel kimlik kartına/aynı kişiye ait olup olmadığını değerlendir " +
                "(T.C. kimlik numarası, seri numarası, isim gibi görünen bilgileri karşılaştırarak). Emin " +
                "olamıyorsan (orn. bir taraf okunaksızsa) tutarli kabul et (varsayilan true) - sadece BARIZ bir " +
                "uyuşmazlık (farklı kimlik numarası/farklı görünen kart tasarımı gibi) varsa false dön.\n\n" +
                "SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir metin ekleme:\n" +
                '{"tutarli_mi": true ya da false, "aciklama": "uyuşmazlık varsa kısa ve nazik bir açıklama (Türkçe), yoksa boş string"}'
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
    throw new Error("Kimlik on/arka tutarlilik analizi anlasilamadi: " + JSON.stringify(data));
  }
  const sonuc = JSON.parse(jsonEslesme[0]);
  return {
    tutarliMi: sonuc.tutarli_mi !== false,
    aciklama: sonuc.aciklama || ""
  };
}

module.exports = { belgeFotografiAnalizEt, kimlikOnArkaTutarliMi };
