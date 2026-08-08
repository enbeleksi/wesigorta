// ================================================================
// WEB HESAPLAYICI - MUSTERIYE E-POSTA ILE PDF GONDERIMI (Resend API)
// Bu dosya web sitesindeki vergi avantaji hesaplayicisina aittir.
// Chatbot gelistirmeleri bu dosyaya DOKUNMAMALIDIR.
// server.js sonunda su satir bulunmalidir: require('./webEposta')(app);
// Gerekli env: TEKLIF_SECRET, RESEND_API_KEY, EPOSTA_GONDEREN_ADRESI,
//              EPOSTA_YANIT_ADRESI (istege bagli)
// ================================================================
const express = require('express');

module.exports = function (app) {
  const IZINLI = ['https://wesigorta.com.tr', 'https://www.wesigorta.com.tr'];
  function cors(req, res) {
    const o = req.headers.origin;
    if (IZINLI.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  app.post('/api/teklif/eposta', express.text({ type: 'text/plain', limit: '15mb' }), async function (req, res) {
    cors(req, res);
    try {
      var eb; try { eb = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ ok: false }); }
      if (!process.env.TEKLIF_SECRET || eb.secret !== process.env.TEKLIF_SECRET) return res.status(401).json({ ok: false });
      if (!eb.eposta || !eb.pdf || String(eb.pdf).indexOf('data:application/pdf') !== 0) return res.status(400).json({ ok: false });
      if (!process.env.RESEND_API_KEY || !process.env.EPOSTA_GONDEREN_ADRESI) return res.status(503).json({ ok: false });
      var pdfB64 = String(eb.pdf).split(',')[1] || '';
      if (pdfB64.length > 14000000) return res.status(413).json({ ok: false });
      var mAd = String(eb.ad || 'Degerli Musterimiz').slice(0, 80);
      var dTel = String(eb.danismanTel || '').replace(/\D/g, '');
      var dTelYazi = (eb.danismanTel && dTel.length === 11) ? ' (Cep: <a href="tel:+9' + dTel + '" style="color:#132F3E;text-decoration:none"><strong>' + String(eb.danismanTel).slice(0, 20) + '</strong></a>)' : '';
      var dnsSatiri = eb.danisman ? '<p>Danışmanınız <strong>' + String(eb.danisman).slice(0, 60) + '</strong>' + dTelYazi + ', dilerseniz en kısa sürede sizi arayarak simülasyonunuzu birlikte değerlendirecektir.</p>' : '<p>Danışmanlarımız, dilerseniz en kısa sürede sizi arayarak simülasyonunuzu birlikte değerlendirecektir.</p>';
      var govde = '<div style="font-family:Segoe UI,Arial,sans-serif;color:#132F3E;font-size:15px;line-height:1.7;max-width:560px">'
        + '<p>Sayın <strong>' + mAd + '</strong>,</p>'
        + '<p>WE Sigorta hesaplama aracımızı kullanarak oluşturduğunuz <strong>Prim İadeli Hayat Sigortası</strong> simülasyonunuz ekte yer almaktadır. Simülasyonunuzda; ödeyeceğiniz prim, size özel vergi avantajı, yaklaşık vefat teminatınız ve süre sonu prim iadeniz bir arada sunulmuştur.</p>'
        + dnsSatiri
        + '<p>Sorularınız için 7/24 WhatsApp hattımızdan bize ulaşabilirsiniz: <a href="https://wa.me/908502209361?text=Merhaba%2C%20prim%20iadeli%20hayat%20sigortas%C4%B1%20i%C3%A7in%20teklif%20almak%20istiyorum." style="color:#0B6E4F;text-decoration:none"><strong>0850 220 93 61</strong></a><br>Web: <a href="https://wesigorta.com.tr">wesigorta.com.tr</a></p>'
        + '<p>Sağlıklı günler dileriz.<br><strong>WE Sigorta</strong><br><span style="color:#41606F;font-size:13px">Yetkili Garanti BBVA Emeklilik Acentesi</span></p>'
        + '<p style="color:#7A8F98;font-size:11px">Bu belge bilgilendirme amaçlı bir ön çalışmadır; kesin prim, teminat ve şartlar Garanti BBVA Emeklilik ve Hayat A.Ş. tarafından poliçe teklifinde belirlenir.</p>'
        + '</div>';
      var istek = {
        from: 'WE Sigorta <' + process.env.EPOSTA_GONDEREN_ADRESI + '>',
        to: [String(eb.eposta).slice(0, 120)],
        subject: 'Prim İadeli Hayat Sigortası Simülasyonu',
        html: govde,
        attachments: [{ filename: String(eb.dosyaAdi || 'WE-Sigorta-Teklif.pdf').slice(0, 100), content: pdfB64 }]
      };
      if (process.env.EPOSTA_YANIT_ADRESI) istek.reply_to = process.env.EPOSTA_YANIT_ADRESI;
      var cevap = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(istek)
      });
      if (!cevap.ok) { console.error('Teklif e-postasi gonderilemedi:', cevap.status); return res.status(502).json({ ok: false }); }
      res.json({ ok: true });
    } catch (e) {
      console.error('Teklif e-posta endpoint hatasi:', e);
      res.status(500).json({ ok: false });
    }
  });

  console.log('✅ /api/teklif/eposta aktif (webEposta.js)');
};
