# Hekim Sorumluluk Sigortası (Malpraktis) Teklif Formu — Tam Senaryo

Bu doküman `malpraktis-teklif-formu.html` dosyasının güncel halindeki tüm soru akışını, dallanmaları ve gönderim davranışını baştan sona anlatır.

## 1. Soru 1 — Kendim İçin / Başkası İçin

Form açıldığında tek görünen soru budur:

> Hekim Sorumluluk Sigortası poliçesini kendiniz için mi yaptıracaksınız yoksa bir başkası için mi?

- **Kendim İçin** veya **Başkası İçin** seçilene kadar formun geri kalanı (`rest-of-form`) tamamen gizlidir.
- Bir seçim yapılır yapılmaz tüm form açılır ve aşağıdaki tüm soru metinleri bu seçime göre 2. tekil (kendiniz) ya da 3. tekil (o kişi) şahısla yeniden yazılır.

## 2. Soru 2 — İsim Soyisim + Karşılama Cümlesi

> Kendim İçin: "İsim ve soyisminizi paylaşır mısınız?"
> Başkası İçin: "Sigortayı kimin adına yaptıracaksınız? İsim ve soyismini paylaşır mısınız?"

İsim yazılır yazılmaz (her tuş vuruşunda) hemen altında bir karşılama cümlesi belirir:

- Kendim İçin: `[İlk ad] hocam, teşekkürler — devam edelim 👋`
- Başkası İçin: `[Tam ad + soyad] hocam için devam edelim 👋` (yalnızca tam isim kullanılır, sadece ilk isimle hitap edilmez)

## 3. Telefon (📞)

> "Size ulaşabileceğimiz bir telefon numarası paylaşır mısınız?"

Geçerlilik kontrolü: `05XXXXXXXXX`, `+905XXXXXXXXX` veya `905XXXXXXXXX` formatlarından biri (boşluk/parantez/tire yok sayılıyor). Format tutmazsa alanın altında kırmızı uyarı çıkar.

## 4. Soru 3 — Asistan mısınız?

> Kendim İçin: "Asistan mısınız?" / Başkası İçin: "Asistan mı?"

Evet/Hayır seçimine göre sonraki iki soru açılıp kapanıyor:

- **"Hayır"** seçilirse → **Soru 4 (Uzman mısınız?)** görünür hale gelir.
- **"Evet"** seçilirse → Uzman sorusu hiç sorulmaz (zaten asistan olduğu biliniyor).

## 5. Soru 4 — Uzman mısınız? *(yalnızca Asistan = Hayır ise sorulur)*

> Kendim İçin: "Uzman mısınız?" / Başkası İçin: "Uzman mı?"

## 6. Soru 5 — Uzmanlık Dalı *(Asistan = Evet YA DA Uzman = Evet ise sorulur)*

> Kendim İçin: "Uzmanlık dalınızı belirtir misiniz?" / Başkası İçin: "Uzmanlık dalını belirtir misiniz?"

- Serbest metin alanı — artık açılır öneri listesi (datalist) **yok**, kişi branşını doğrudan kendi yazıyor.
- Asistan = Hayır **ve** Uzman = Hayır ise bu soru tamamen atlanır (uzmanlık dalı sorulmaz).

> Not: Asistan/Uzman cevaplarına göre arka planda "tescil türü" de belirleniyor — Asistan=Hayır ve Uzman=Evet ise tescil türü **"Uzmanlık"**, diğer tüm durumlarda **"Diploma"** oluyor. Bu, Soru 9 ve Soru 10'daki metinlere yansıyor (aşağıda).

## 7. Soru 6 — Aktif Hasta Bakıyor musunuz?

> Kendim İçin: "Aktif olarak hasta bakıyor musunuz?" / Başkası İçin: "Aktif olarak hasta bakıyor mu?"

- **"Evet"** seçilirse → **Soru 7 (Yıllık Ortalama Hasta Sayısı)** açılır.
- **"Hayır"** seçilirse → Soru 7 hiç sorulmaz.

## 8. Soru 7 — Yıllık Ortalama Hasta Sayısı *(yalnızca Hasta Bakıyor = Evet ise)*

> Kendim İçin: "Yıllık ortalama hasta sayınızı söyler misiniz?" / Başkası İçin: "Yıllık ortalama hasta sayısını söyler misiniz?"

Sadece rakam kabul edilir (`^\d+$`), aksi halde uyarı çıkar.

## 9. Soru 8 — İş Adresi

> Kendim İçin: "İş adresinizi paylaşır mısınız?" / Başkası İçin: "İş adresini paylaşır mısınız?"

## 10. Soru 9 — Tescil Numarası

> `[Uzmanlık/Diploma] tescil numaranızı paylaşır mısınız?` (kendim) / `...tescil numarasını paylaşır mısınız?` (başkası)

## 11. Soru 10 — Tescil Tarihi

> `[Uzmanlık/Diploma] tescil tarihinizi belirtir misiniz? (GG.AA.YYYY)`

- Artık yalnızca format değil, **gerçek takvim geçerliliği** de kontrol ediliyor: ay 1-12 aralığında, gün o ayın/yılın (artık yıl dahil) gerçek gün sayısına uygun olmalı. Örn. `35.13.2020` veya `29.02.2023` (2023 artık yıl değil) reddedilir; `29.02.2024` (2024 artık yıl) kabul edilir. Kişi tarihi serbestçe yazıyor, bir tarih seçici/açılır liste yok.

## 12. Soru 11 — Sigorta Ettiren Türü

> "Sigorta ettiren türünüz nedir?" — **Serbest Çalışan** / **Kamu Çalışanı** (iki seçenekli buton grubu)

## 13. Soru 12 — Sağlık Kurumu

> Kendim İçin: "Bağlı olduğunuz sağlık kurumunu söyler misiniz?" / Başkası İçin: "Bağlı olduğu sağlık kurumunu söyler misiniz?"

Bu alandan çıkıldığında (blur), yazılan metin içinde 81 ilden biri geçiyorsa **şehir otomatik algılanır**:

- Şehir kutusu gizlenir, yerine "Şehir '[X]' olarak sağlık kurumu bilgisinden otomatik algılandı." kutusu çıkar.
- Kişi isterse "değiştir" bağlantısına basıp şehri elle girebilir.

## 14. Soru 13 — Şehir

> Kendim İçin: "Hangi şehirden bize ulaştığınızı öğrenebilir miyim?" / Başkası İçin: "[Tam ad] hangi şehirde bulunuyor, öğrenebilir miyim?"

Otomatik algılanmadıysa zorunlu; algılandıysa (ve "değiştir" ile iptal edilmediyse) tekrar sorulmaz.

## 15. Soru 14 — T.C. Kimlik Numarası

> Kendim İçin: "Son olarak T.C. kimlik numaranızı yazar mısınız?"
> Başkası İçin (isim girildiyse): "Son olarak [Tam Ad]'ın/'nin T.C. kimlik numarasını yazar mısınız?" (doğru iyelik eki otomatik hesaplanıyor)
> Başkası İçin (isim boşsa): "Son olarak sigortalının T.C. kimlik numarasını yazar mısınız?"

11 haneli sayı kontrolü yapılıyor.

## 16. Soru 15 — Danışman *(en son soru, isteğe bağlı)*

> "Şirketimizde daha önce görüştüğünüz bir danışman var mı? (isteğe bağlı)"

- Serbest metin kutusu — kişi danışmanın adını yazmaya başladığı anda (her tuş vuruşunda), yazdığı ön ek **tek bir** danışman adıyla eşleşiyorsa yeşil bir onay kutusu belirir: `✓ [Ad] · [Telefon] — teklif dosyanıza eklenecek.`
- Eşleşme belirsizse (örn. "S" hem Seda hem Simge ile başlıyor) veya hiç eşleşme yoksa kutu görünmez.
- Bu alan zorunlu değildir, boş bırakılabilir.

## 17. Onay Kutusu ve Gönderim

- KVKK onay kutusu işaretlenmeden gönderim yapılamaz.
- "WhatsApp ile Teklif İçin Gönder" butonuna basıldığında tüm zorunlu alanlar kontrol edilir; eksik/hatalı bir şey varsa o soruya otomatik kaydırılır ve genel bir uyarı gösterilir.
- Her şey tamamsa form arka planda `fetch` ile sunucuya gönderilir (artık eski `wa.me` linkiyle değil).
- Gönderim başarılıysa form gizlenir, yerine "✅ Teklif talebiniz alındı!" başarı paneli gösterilir (bu panel gönderim öncesinde kesinlikle görünmez).
- Gönderim başarısız olursa (sunucu hatası vb.) kullanıcıya "Talebiniz gönderilirken bir sorun oluştu 😕" mesajı gösterilir, buton tekrar aktif olur.

## Sunucuya Giden Veri (payload)

```
danisman_gorustu_mu, danisman_adi, hedef_kisi, ad_soyad, telefon,
asistan_mi, uzman_mi, uzmanlik_dali, hasta_bakiyor_mu, yillik_hasta_sayisi,
is_adresi, tescil_no, tescil_tarihi, sigorta_ettiren_turu, saglik_kurumu,
sehir, tc_kimlik
```

Sorulmayan/gizli kalan sorular (`uzman_mi`, `uzmanlik_dali`, `yillik_hasta_sayisi`) `null` olarak gönderilir.
