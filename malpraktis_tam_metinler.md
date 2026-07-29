# Hekim Sorumluluk Sigortası (Malpraktis) — Sorulan Tüm Metinlerin Son Hali

Bu belge, `src/flows.js` içindeki `malpraktis` ürününün şu anki (28.07.2026) tam
sorulan metinlerini, hiçbir kısaltma/özetleme yapılmadan, birebir olduğu gibi
listeler. Her soru için üç farklı hâl olabilir:

- **Kendim İçin** — hekim, poliçeyi kendi adına yaptırıyorsa müşteriye görünen metin (2. şahıs, "-mısınız?").
- **Başkası İçin** — hekim, başka bir meslektaşı adına yaptırıyorsa müşteriye görünen metin (3. şahıs, isim + "hocam" hitabıyla).
- **Danışman** — bir danışmanın WhatsApp'tan "müşteri adına yeni talep oluştur" akışında gördüğü, sigortalıdan bahseden nötr/3. şahıs metin.

"Hocam" hitabı SADECE Malpraktis'te kullanılır (`hitapHocam: true`) — hekimin
ismi + "hocam" (örn. "Ahmet hocam"), isim henüz bilinmiyorsa sade "Hocam".

---

## 1) Ürün girişi (intro)

Müşteri Malpraktis akışına girdiğinde ilk gördüğü tanıtım mesajı:

> Hekim Sorumluluk Sigortası, mesleki uygulamalarınız sırasında oluşabilecek olası taleplere karşı sizi güvence altına alır. Teklifinizi hazırlamak için birkaç bilgi alalım. 🩺

(Bu metin danışman akışında gösterilmez — danışman zaten ürünü kendisi seçtiği için tanıtıma ihtiyacı yoktur.)

---

## 2) Ortak baştaki iki soru (tüm ürünlerde aynı, danışmandan gizli)

Bu iki soru **sadece müşteri** akışında sorulur; danışman "müşteri adına yeni talep" akışında hiç görünmez (`danismandaGizle: true` — danışman zaten kendisiyle görüşüldüğünü bildiği için anlamsız).

**Soru 1 — `danisman_gorustu_mu`:**
> Daha önce acentemiz bünyesindeki danışmanlarımızdan biriyle görüşme fırsatınız oldu mu?

Seçenekler: `Evet` / `Hayır`

**Soru 2 — `danisman_adi`** (sadece bir önceki soruya "Evet" denirse sorulur):
> Hangi danışmanımızla görüşme fırsatınız oldu?

Seçenekler: Enbel, Seda, Bahadır, Fırat, Furkan, Şevval, Nilşah, Yasemin, Simge, Tuğçe

---

## 3) `hedef_kisi` — Kendim / Başkası ayrımı (danışmandan gizli)

> Hekim Sorumluluk Sigortası poliçesini kendiniz için mi yaptıracaksınız yoksa bir başkası için mi?

Seçenekler: `Kendim İçin` / `Başkası İçin`

Danışman akışında bu soru hiç sorulmaz (`danismandaGizle: true`) — danışman zaten bir başkası (kendi müşterisi) adına talep oluşturduğunu bildiği için bu ayrıma gerek yoktur. Bu, aşağıdaki tüm soruların "Başkası İçin" (3. şahıs) hâline eşdeğer sabit bir `danismanText` ile sorulmasını sağlar.

---

## 4) `ad_soyad`

- **Kendim İçin:** İsim ve soyisminizi paylaşır mısınız?
- **Başkası İçin:** Sigortayı kimin adına yaptıracaksınız? İsim ve soyismini paylaşır mısınız?
- **Danışman:** Sigortalının ismini ve soyismini paylaşır mısınız?

---

## 5) `asistan_mi`

- **Kendim İçin:** *{İsim} hocam*, asistan mısınız?
- **Başkası İçin:** *{İsim} hocam* asistan mı?
- **Danışman:** Sigortalı asistan mı?

Seçenekler: `Evet` / `Hayır`

---

## 6) `uzman_mi`

*(Asistansa zaten uzman olamayacağı için, `asistan_mi = Evet` ise bu soru hiç sorulmaz.)*

- **Kendim İçin:** *{İsim} hocam*, uzman mısınız?
- **Başkası İçin:** *{İsim} hocam* uzman mı?
- **Danışman:** Sigortalı uzman mı?

Seçenekler: `Evet` / `Hayır`

---

## 7) `uzmanlik_dali`

*(Ne asistan ne uzmansa — yani sade tabipse — bu soru hiç sorulmaz.)*

- **Kendim İçin:** *{İsim} hocam*, uzmanlık dalınızı belirtir misiniz?
- **Başkası İçin:** *{İsim} hocam*ın uzmanlık dalını belirtir misiniz?
- **Danışman:** Sigortalının uzmanlık dalını belirtir misiniz?

---

## 8) `hasta_bakiyor_mu`

- **Kendim İçin:** *{İsim} hocam*, aktif olarak hasta bakıyor musunuz?
- **Başkası İçin:** *{İsim} hocam* aktif olarak hasta bakıyor mu?
- **Danışman:** Sigortalı aktif olarak hasta bakıyor mu?

Seçenekler: `Evet` / `Hayır`

---

## 9) `yillik_hasta_sayisi`

*("Hayır" denirse — yani sadece idari görevliyse — bu soru hiç sorulmaz.)*

- **Kendim İçin:** *{İsim} hocam*, yıllık hasta sayınızı yaklaşık olarak söyler misiniz?
- **Başkası İçin:** *{İsim} hocam*ın yıllık hasta sayısını yaklaşık olarak söyler misiniz?
- **Danışman:** Sigortalının yıllık hasta sayısını yaklaşık olarak söyler misiniz?

Geçersiz (rakam olmayan) bir cevap gelirse: *"Lütfen hasta sayısını sadece rakamla yazar mısınız? (Örn: 500)"*

---

## 10) `is_adresi`

- **Kendim İçin:** *{İsim} hocam*, iş adresinizi paylaşır mısınız?
- **Başkası İçin:** *{İsim} hocam*ın iş adresini paylaşır mısınız?
- **Danışman:** Sigortalının iş adresini paylaşır mısınız?

*(28.07.2026'da kullanıcının isteğiyle "(muayenehane/kurum)" ibaresi kaldırıldı — sade bir "iş adresi" sorusu.)*

---

## 11) `tescil_no`

Tescil türü ayrıca sorulmaz; `uzman_mi` cevabına göre otomatik belirlenir: uzmansa **"Uzmanlık"**, değilse (asistan ya da tabip) **"Diploma"**.

- **Kendim İçin:** *{İsim} hocam*, {uzmanlık/diploma} tescil numaranızı paylaşır mısınız?
- **Başkası İçin:** *{İsim} hocam*ın {uzmanlık/diploma} tescil numarasını paylaşır mısınız?
- **Danışman (uzmansa):** Sigortalının uzmanlık tescil numarasını paylaşır mısınız?
- **Danışman (uzman değilse):** Sigortalının diploma tescil numarasını paylaşır mısınız?

---

## 12) `tescil_tarihi`

Aynı şekilde `uzman_mi` cevabına göre "Uzmanlık" ya da "Diploma" tescili olduğu açıkça belirtilir (28.07.2026'da eklendi — eskiden hangi tescilin tarihi olduğu belirsizdi).

- **Kendim İçin:** *{İsim} hocam*, {uzmanlık/diploma} tescil tarihinizi belirtir misiniz? (GG.AA.YYYY)
- **Başkası İçin:** *{İsim} hocam*ın {uzmanlık/diploma} tescil tarihini belirtir misiniz? (GG.AA.YYYY)
- **Danışman (uzmansa):** Sigortalının uzmanlık tescil tarihini belirtir misiniz? (GG.AA.YYYY)
- **Danışman (uzman değilse):** Sigortalının diploma tescil tarihini belirtir misiniz? (GG.AA.YYYY)

Geçersiz tarih formatı için: *"Lütfen tarihi GG.AA.YYYY formatında yazar mısınız? (Örn: 15.05.2015)"*

---

## 13) `sigorta_ettiren_turu`

- **Kendim İçin:** *{İsim} hocam*, sigorta ettiren türünüz nedir?
- **Başkası İçin:** *{İsim} hocam*ın sigorta ettiren türü nedir?
- **Danışman:** Sigortalının sigorta ettiren türü nedir?

Seçenekler: `Serbest Çalışan` / `Kamu Çalışanı`

---

## 14) `saglik_kurumu`

- **Kendim İçin:** *{İsim} hocam*, bağlı olduğunuz sağlık kurumunu söyler misiniz?
- **Başkası İçin:** *{İsim} hocam*ın bağlı olduğu sağlık kurumunu söyler misiniz?
- **Danışman:** Sigortalının bağlı olduğu sağlık kurumunu söyler misiniz?

---

## 15) `sehir` (SEHIR_SORU — DASK/Konut/Trafik/Kasko ile ortak soru bileşeni)

- **Kendim İçin:** Hangi şehirden bize ulaştığınızı öğrenebilir miyim?
- **Başkası İçin:** *{İsim}* hangi şehirde bulunuyor, öğrenebilir miyim?
- **Danışman:** Sigortalı hangi şehirde, öğrenebilir miyim?

Not: Eğer bir önceki soruda (`saglik_kurumu`) cevap içinde zaten tanınan bir şehir adı geçiyorsa (örn. "İstanbul Üniversitesi Hastanesi"), bu soru otomatik atlanır ve şehir oradan çıkarılır. Ayrıca bazı şehir isimleri için (İstanbul, Ankara, İzmir vb.) kısa, esprili bir karşılama mesajı (`tepki`) da gönderilir — bu mesajlar şehre özel olduğu için burada ayrıca listelenmemiştir.

---

## 16) `tc_kimlik` (TC_KIMLIK_SORU — birçok üründe ortak soru bileşeni)

- **Kendim İçin:** Son olarak T.C. kimlik numaranızı yazar mısınız?
- **Başkası İçin:** Son olarak *{İsim}*'{ın/in/un/ün} T.C. kimlik numarasını yazar mısınız? *(ek, `turkceGramer.js`'teki ünlü uyumu kuralına göre otomatik seçilir — örn. "Ahmet Yılmaz'ın", "Ayşe'nin", "Mehmet Öztürk'ün")*
- **Danışman:** Son olarak sigortalının T.C. kimlik numarasını yazar mısınız?

Geçersiz T.C. kimlik için: *"Girdiğiniz T.C. kimlik numarası geçerli görünmüyor, lütfen 11 haneli olarak tekrar yazar mısınız?"*

Bu, akıştaki **son sorudur**. Cevaplandıktan sonra müşteriye özet + aşağıdaki çapraz satış mesajı gönderilir:

> 🩺 Bu arada, doktorlarımızın ülkemizde en yüksek vergi dilimlerinde yer aldığını biliyoruz. Prim İadeli Hayat Sigortamız ile ödediğiniz primler ciddi bir vergi avantajı sağlıyor, üstelik vade sonunda bir talebiniz olmazsa ödediğiniz primler aynen size geri iade ediliyor. 💰
>
> Detaylı bilgi ve teklif için: https://www.wesigorta.com.tr/primiadeli/

---

## Akış sırası özeti (atlanabilen adımlar dahil)

1. danisman_gorustu_mu *(sadece müşteri)*
2. danisman_adi *(sadece müşteri, sadece "Evet" ise)*
3. hedef_kisi *(sadece müşteri)*
4. ad_soyad
5. asistan_mi
6. uzman_mi *(asistansa atlanır)*
7. uzmanlik_dali *(ne asistan ne uzmansa atlanır)*
8. hasta_bakiyor_mu
9. yillik_hasta_sayisi *("Hayır" ise atlanır)*
10. is_adresi
11. tescil_no
12. tescil_tarihi
13. sigorta_ettiren_turu
14. saglik_kurumu
15. sehir *(sağlık kurumu cevabında şehir zaten geçiyorsa atlanır)*
16. tc_kimlik

Danışman akışında yalnızca 1-3. adımlar hiç sorulmaz; geri kalan 4-16 arası tüm sorular (kendi skip kuralları geçerli olmak üzere) aynen sorulur.
