// =====================================================================
// Doğum Sigortası (Acıbadem "Kişiye Özel Doğum Sağlık Sigortası") Özel
// Şartları Soru-Cevap Motoru
// ---------------------------------------------------------------------
// 31.07.2026 eklendi: tssOzelSartSSS.js / ozelSaglikOzelSartSSS.js ile AYNI
// desen. Kullanıcının paylaştığı bu belge, Aksigorta'nın DEĞİL Acıbadem'in
// kendi ürünüdür - ÖSS/TSS'den TAMAMEN BAĞIMSIZ, ayrı satılan bir poliçedir
// (18-45 yaş aralığı, yenileme güvencesi yok, sözleşme süresi içinde yeni
// giriş yapılamıyor). Kullanıcının onayladığı tasarıma göre bu ürün:
// 1) "Bilgi Almak İstiyorum" menüsünde kendi başına bir soru-cevap seçeneği
//    olarak sunuluyor (bkz. conversationEngine.js DIGER_BILGI_URUNLERI),
// 2) ÖSS/TSS teklif akışının SONUNA eklenen "eklemek ister misiniz?"
//    sorusuyla (bkz. flows.js saglikUrunuSorulari) danışmana not düşülüyor -
//    bot kendi başına fiyat hesaplamıyor/teklif oluşturmuyor.
// =====================================================================

const { mesajGonder } = require("./anthropicMesaj");

const OZEL_SART_METNI = `
ACIBADEM KİŞİYE ÖZEL DOĞUM SAĞLIK SİGORTASI ÖZEL ŞARTLARI

1. SİGORTANIN KONUSU VE KAPSAMI
Acıbadem Sağlık ve Hayat Sigorta A.Ş. (Sigortacı), bu sigorta sözleşmesi uyarınca, sigortalının sigorta başlangıç tarihinden sonra ortaya çıkan hamilelik ve doğum giderlerini, poliçede belirtilen teminatlar ve teminat tablosu doğrultusunda güvence altına almaktadır.

2. TANIMLAR (özet)
Acil Durum: Sağlık Sigortası Genel ve Özel Şartları gereği istisnalar ve bekleme süreli durumlar arasında yer almayan, ani bir hastalık veya bedensel yaralanma sonucunda ortaya çıkan ve geciktirilmesi mümkün olmayan, tıbbi veya cerrahi tedavi gerektirdiğine haklı bir görüşe yol açan ve Sigortacı tarafından acil olduğuna karar verilen durumdur. WHO tarafından tanımlanan Acil Durumlar arasında: şuur kaybına neden olan her türlü durum, miyokard enfarktüsü, aritmi, hipertansiyon krizleri, zehirlenmeler, trafik kazası, ani felçler, migren ve kusma ile birlikte şuur kaybına neden olan baş ağrıları, astım krizi, akut solunum problemleri, 39 derece üstündeki yüksek ateş, ciddi alerji, anafilaktik tablolar, akut batın, yüksekten düşme, ciddi iş kazaları, uzuv kopması, menenjit, ensefalit, beyin apsesi, elektrik çarpması, ciddi göz yaralanmaları, kurşunlanma, bıçaklanma, suda boğulma, donma, soğuk çarpması, ısı çarpması, ciddi yanıklar, yeni doğan komaları, genel durum bozukluğunun eşlik ettiği diyaliz hastalığı, akut masif kanamalar, omurga ve alt extremite kırıkları, tecavüz sayılmaktadır.
Anlaşmalı Sağlık Kurumları: Sigortacı ile Sağlık Kurumu arasında yapılan bir anlaşmalı kurum sözleşmesi kapsamında ve Sigortacı tarafından sigorta sözleşmesi/ilgili teminat için geçerli olduğu belirtilmiş olan sağlık kurumlarını, anlaşmalı kurum sözleşme şartlarını kabul ederek anlaşmalı kurumun faturasında yer almak suretiyle bu kurumlar bünyesinde hizmet veren Kadrolu Doktorları kapsamaktadır.
Anlaşmasız Sağlık Kurumları: Sigortacı ile arasında bir anlaşmalı kurum sözleşmesi bulunmayan, anlaşmalı kurum sözleşme şartlarını kabul etmeyen ve kendi faturasını düzenleyen Doktorlar, hastaneler, klinikler, tıp merkezleri, eczaneler, laboratuvarlar, fizik tedavi merkezleri vb.dir.
Azami İyi Niyet Prensibi: Sigortacı bu sigorta sözleşmesini ve sözleşme şartlarını Sigorta Ettiren'in beyanına dayalı olarak oluşturmaktadır. Sigorta Ettiren, başvuru ve beyan formu ile bunu tamamlayıcı belgelerde doğru bilgi vermek/beyanda bulunmak ve rizikonun değerlendirilmesine etkili olacak hususları beyan etmekle yükümlüdür. Sonuç olarak azami iyi niyet; sorulmuş olsa da olmasa da Sigorta Ettiren'in, sigorta sözleşmesinden yararlanacak tüm Sigortalıların geçmiş ve mevcut hastalıkları ve sağlık durumu ile ilgili tüm bilgileri tam ve yanılmaya mahal vermeyecek şekilde, gönüllü olarak Sigortacı'ya bildirmesidir.
Deneysel veya Araştırma Amaçlı İşlem: Hastalığın tanı ve tedavisindeki gereklilik, etkinlik ve güvenilirliğini ortaya koyacak sayıda ve kalitede kontrollü klinik çalışmanın yayınlanmadığı veya yerli ve yabancı otoriteler (FDA, tıp fakülteleri, ilgili kürsü bilim kurulları, Sağlık Bakanlığı, uzmanlık dernekleri vb.) tarafından kabul görmüş olmayan, tıbbi cemiyet veya otoritelerin deneysel aşamada olduğuna dair yazılı bildirimleri tespit edilen veya herhangi bir rahatsızlık olmadan araştırma/kontrol (check-up) amacıyla uygulandığına Sigortacı tarafından karar verilen tetkik ve tedavilerdir.
Doğuştan Gelen Hastalık (Konjenital Hastalık): Kişinin doğuşu ile var olan hastalık, anomali veya fiziksel (organ) bozukluklardır.
Doktor: Sağlık hizmetinin verildiği Coğrafi Bölgede geçerli olan yasalar çerçevesinde resmi olarak tıp doktoru unvanı ve belgesi verilmiş olan kişidir.
Dönemsel İndirimler: Sigortacı tarafından belirlenen ve dönemsel olarak değişiklik gösterebilecek olan indirimleri ifade eder (aile indirimi, ödeme planı indirimi, geçiş indirimi ve diğer indirimler başlığı altında bildirilen indirimleri kapsar).
İlk Sigortalanma Tarihi: Sigortalının özel sağlık sigortası kapsamına ilk giriş yaptığı ve Sigortacı tarafından kabul edilen ilk sigortalanma tarihini ifade eder.
İstisna: Sigorta sözleşmesinin kapsamı dışında bırakılan durumlardır.
Kadrolu Doktor: İlgili il Sağlık Müdürlüğü'ne Sağlık Kurumu tarafından bildirilen ve Sağlık Kurumu'nun tam zamanlı çalışanı durumunda bulunan Doktorları ifade eder.
Katılım Payı: Sigorta sözleşmesi ekinde verilen teminat tablosunda belirtilen tutar ya da oranda, kabul edilebilir sağlık gideri üzerinden hesaplanan, Sigortalı'nın üstleneceği miktarı ifade eder.
Kaza: Ani, beklenmeyen, istenmeyen, önceden engellenemeyen veya planlanamayan olaylar ve bu olaylardan kaynaklanan hastalık veya yaralanmalardır.
Kazanılmış Haklar: Bu sigorta sözleşmesinde kazanılmış haklar, İlk Sigortalanma Tarihi ve Yenileme Güvencesi haklarını ifade eder.
Limit: Sigortacı'nın teminat kapsamında bulunan ve işbu özel şartlara göre ödemeyi üstlendiği maksimum, kabul edilebilir sağlık giderini ifade eder.
Mevcut Rahatsızlık ve/veya Hastalık: Belirtisinin/bulgusunun veya teşhisinin/tedavisinin başlangıcı, poliçe başlangıç tarihi öncesinde ortaya çıkmış rahatsızlıklar/hastalıklar ve bunlara bağlı olarak gelişen durumlardır.
Muafiyet: Sağlık Sigortası Genel ve Özel Şartları gereği teminat kapsamında değerlendirilen sağlık giderlerinden Sigortalı'nın üstleneceği kısmı ifade eder. Muafiyet bilgisi, sigorta sözleşmesi ekinde verilen teminat tablosunda belirtilir.
Özel Sağlık Sigortası (ÖSS) Hasta Bilgi Formu: Sağlık Kurumlarından hizmet alınması durumunda Doktor tarafından doldurulması gereken formdur. İlgili form, Anlaşmalı Sağlık Kurumları'nda mevcut olup, anlaşmasız sağlık kurumları için www.acibademsigorta.com.tr adresinden ulaşılabilir.
Poliçe: Sigorta Ettiren ve/veya Sigortalı ve Sigortacı'nın sigorta sözleşmesinden doğan hak ve yükümlülüklerini gösteren bir belgedir.
Provizyon: Sigortalı'nın tedavisiyle ilgili Anlaşmalı Sağlık Kurumu tarafından Sigortacı'nın 7/24 provizyon merkezinden istenen ön onayı ifade eder.
Referans Doktor: İşbu sözleşme kapsamında değerlendirilecek sağlık giderlerinin tıbbi gerekliliğine dair uzman görüşü alınan ve Sigortacı tarafından belirlenen anlaşmalı Doktordur.
Risk Kabul Birimi: Sigorta Ettiren veya Sigortalı'nın beyanlarını ve/veya sağlık bilgilerini değerlendirerek, hangi şart ve koşullarda sigorta sözleşmesinin kurulacağına ya da kurulmamasına karar veren birimdir.
Sağlık Gideri: Sağlık Sigortası Genel ve Özel Şartları'na göre teminat kapsamında olduğu tespit edilen, sigorta süresi içerisinde gerçekleşen, Sigortacı'nın Tıbbi Gereklilik koşuluna uygun olan, Doktor tarafından yazılı olarak planlanan tetkik ve/veya tedavi işlemlerine ait giderleri ifade eder.
Sağlık Kurumu: Sağlık Bakanlığı'nca yasal mevzuata uygun çalışma ruhsatı ile faaliyet gösteren, tıbbi bakım ve tedavi hizmeti veren hastane, klinik, poliklinik, muayenehane, teşhis ve tedavi merkezlerini ifade eder. "Sağlık Kurumu" deyimi; otel, huzurevi, bakımevi, nekahethane, yetimhane ve darülacezeleri, esas olarak uyuşturucu bağımlıları ile alkoliklerin tecrit ve tedavisi için kullanılan yerleri, sanatoryumları, kaplıcaları, sağlık hidrolarını, zayıflama merkezlerini içermez.
Sigorta Ettiren: Sigorta sözleşmesini yapan ve prim ödemek dahil sigorta sözleşmesinden kaynaklanan yükümlülükleri yerine getirme sorumluluğunu taşıyan kişidir.
Sigortalı/Sigortalılar: Poliçede ismi/isimleri belirtilen ve sigorta sözleşmesi ile menfaatleri teminat altına alınan ve sağlık giderlerini talep hakkı bulunan kişilerdir.
Tarife Primi: Bilimsel kabul görmüş ya da şirketin tecrübe edilen aktüeryal metodolojileri baz alınarak geçmişin, bugünün ve geleceğin frekans, şiddet ve benzeri etkileri gözetilerek hesaplanan baz primdir.
Tazminat: Sağlık Sigortası Genel ve Özel Şartları gereği teminat kapsamında değerlendirilen sağlık giderlerinin, ilgili Poliçe döneminde yer alan teminat, limit, Muafiyet ve Katılım Payı dikkate alınarak ödenen tutarıdır.
Teminat: Sigortacı'nın Sağlık Sigortası Genel ve Özel Şartları gereği, sigorta süresi içerisinde oluşan sağlık giderleri için Sigortalı'ya verdiği güvencedir.
Tıbbi Gereklilik: Tetkik ve tedavi işlemlerinin bir hastalığın ve/veya rahatsızlığın tedavisi için gerekli ve etkili olması durumudur. Tetkik veya tedavinin bir Doktor tarafından uygulanmış olması, tek başına Tıbbi Gereklilik koşulunun bulunduğu şeklinde yorumlanamaz; uyuşmazlık durumlarında Referans Doktor görüşü esas alınır.

3. TEMİNATLAR
Aşağıda yer alan teminat grubu veya teminatlardan birisi, bir kısmı veya tamamı, Poliçe ekindeki Teminat Tablosu üzerinde açıkça yazılması ve priminin ödenmesi karşılığında Poliçe Özel ve Genel Şartları'ndaki hüküm ve şartlar çerçevesinde verilir.

3.1 Hamilelik ve Doğum Teminatı Grubu
Bu teminat grubu ile, Sigortalı'nın hamilelik ve doğum ile ilgili, hastaneye yatış-çıkış tarihleri arasındaki doktor, ameliyathane, oda-yemek, refakatçi (bir kişi ile sınırlıdır), tıbbi malzeme, ilaçlar ile hamilelik döneminde yapılacak olan rutin kontroller ve yeni doğan bebeğe ait giderler bu teminat grubu kapsamında karşılanır. Hamilelik ve Doğum Teminat Grubu şu teminatları içermektedir:
- Doğum Teminatı
- Hamilelik Rutin Kontrol Teminatı
- Yeni Doğan Bebek Teminatı

3.1.1 Doğum Teminatı: Doğumun sonlandırılması işlemi için yapılan normal doğum veya sezaryen işlemlerine ait doktor ve hastane giderleri ile hamilelik döneminde tıbbi gereklilik halinde amniyosentez işlemi, hamilelik, küretaj, doğum ve sezaryen komplikasyonlarına bağlı yatışlar bu teminat kapsamında, poliçede belirtilmiş olan teminat limitleri doğrultusunda karşılanmaktadır. Sigorta süresi içinde teminat altına alınan hastanede yatış süresi, teminat tablosundaki limitler ile sınırlı olmak üzere, toplam 180 gündür (normal oda yatışları 1 gün, yoğun bakım yatışı 2 gün üzerinden hesaplanarak toplam yatış süresinden düşülür). Sigortalıların, acil tıbbi durumlar haricinde planlanmış doğumlar için, doğumu yapacak olan doktor tarafından doldurulacak Özel Sağlık Sigortası Bilgi Formu'nu, 48 saat öncesinden Sigortacı'ya göndermesi gerekmektedir. Sigortalıların, doğumu gerçekleştirecek olan doktorun operatör ücreti olarak alacağı tutarın doğumdan önce öğrenilmesi ve bu tutarın poliçe kapsamında ödenip ödenmeyeceğinin sigorta şirketine sorulması dikkat edilmesi gerekli bir noktadır. Doğum sırasında, teminat kapsamına girmeyen ameliyatların da doğumla birlikte yapılması durumunda, kapsama girmeyen ameliyat veya ameliyatlarla ilgili giderler karşılanmaz. Anlaşmalı sağlık kurumunda kadrolu olmayan doktorların yapacakları tüm tetkik ve tedavi işlemleri için ödenecek ücret, anlaşmalı kurumun sigortacı ile sözleşmesi gereği staff hekimine ödenecek tutar kadar ve her durumda TTB Asgari Ücret Tarifesi ile limitlidir; kadrolu olmayan doktorların yapacakları işlemler için ödenecek ücret, sigorta şirketinin ödeyeceği tutardan fazla olursa aradaki farkı sigortalı ödemek zorunda kalacaktır. Yurt içinde anlaşmalı olmayan sağlık kurumlarında yapılan ve TTB Asgari Ücret Tarifesinde yer almayan işlemler, TTB'den alınacak görüş doğrultusunda değerlendirilecektir.

3.1.2 Hamilelik Rutin Kontrol Teminatı: Hamileliği ilgilendiren her türlü kontrol muayene, rutin tetkik ve ilaçlar, hamilelik rutin kontrol teminatı kapsamında, teminat tablosunda belirtilen oran ve limitler dahilinde ödenir. Muayene tarihinden sonra, aynı doktorun 10. güne kadar yaptığı muayenelere ilişkin giderler teminat kapsamı dışındadır (ancak ilave tetkik ya da tedavi önerileri ilgili teminat kapsamında değerlendirilir). Doğumun yurtdışında gerçekleşmesi halinde, doğum teminatını kullanmaya hak kazanan sigortalılar için poliçede belirtilen limit kadar ödeme yapılabilir. Sigortalının yurtdışı hamilelik ve doğum giderlerine ilişkin tazminat ödemelerinde, fatura tarihindeki TCMB efektif satış kuru dikkate alınır ve limitler dahilinde TL olarak ödenir.

3.1.3 Yeni Doğan Bebek Teminatı: Bu teminat kapsamında, Hamilelik ve Doğum Teminatı'na hak kazanmış annenin yeni doğan bebeğinin hastaneden çıkmadan yapılan ve aşağıda detayı belirtilen giderleri, teminat tablosunda belirtilen oran, limit ve katılım payı dahilinde ödenir:
- Yeni doğan bebek muayenesi
- Yeni doğan bebek kan grubu belirleme
- Direkt Coombs
- Neonatal TSH
- Metabolik tarama testi
- Bilurubin
- Otoakustik emisyon (işitme testi)
- Hepatit B aşısı

4. BEKLEME SÜRESİ
Hamilelik ve doğum teminatı, Sigortalı'nın bu poliçe kapsamına dahil olmasından en az 5 (beş) ay sonra başlayacak hamilelikler için geçerlidir. Bu sürenin başlangıcı olarak bebek ultrasonografisi bulguları ve son adet tarihi (SAT) dikkate alınır; SAT'ın 5 aylık bekleme süresi sonrasında olması gerekmektedir. Hamilelik ve doğum teminat grubu, vaka (doğum) başına geçerlidir; sözleşme yenilense bile doğum sonlanana kadar tek limit geçerli olacaktır. Hamileliğin 12. haftasına kadar gerçekleşen bir düşük ya da tıbbi gereklilik nedeniyle hamileliğin sonlanması durumunda yeni limit devreye girebilecektir. Ancak, hamileliğin 12. haftasından sonra ve beklenen doğum tarihinden önce sonlanması halinde, aynı poliçe yılı içinde oluşacak ikinci hamileliğe ait doğum ve hamilelik giderleri ödenmeyecektir.

5. TEMİNAT DIŞI KALAN HALLER
Sağlık Sigortası Genel Şartları'nda belirtilen teminat dışı hallerle birlikte, aşağıda sayılan haller ve bu sebeple yapılacak her türlü sağlık gideri de teminat kapsamı dışındadır:
5.1. Sigortalı olunmadan önce ve bekleme süresi içinde başlayan hamilelikler.
5.2. Düşük nedenlerinin araştırılması, infertilite (kısırlık) teşhis ve tedavisi (ovülasyon takibi, adhezyolizis, tuboplasti vb.), histerosalpingografi (HSG).
5.3. Kozmetik amaçlı yapılan her türlü tedavi, kilo kontrol bozuklukları ile ilgili (şişmanlık veya zayıflık) tetkik ve tedavi giderleri, hiperhidrozis (aşırı terleme) ile ilgili giderler.
5.4. Organ ve kan naklinde verici giderleri, organ ücreti ve organın ulaştırılması masrafları.
5.5. Estetik ve rekonstrüktif cerrahi, meme küçültme ve büyütme ameliyatları.
5.6. Genetik hastalıklar, genetik kusurlar ve genetik incelemeler.
5.7. Alerji aşıları ve alerjik hastalıkların klasifikasyon testleri.
5.8. Kuduz ve tetanoz aşıları dışındaki tüm aşılar ve bu aşılarla ilgili test giderleri.
5.9. Kordon kanı ve kök hücre alınması, nakli ve işlenmesi ile ilgili tüm giderler.
5.10. Kaplıca kürleri, çamur banyoları, şifa kürleri, masaj, jimnastik salonları ve zayıflama merkezleriyle ilgili giderler.
5.11. Çocuk bakımı, çocuk maması, bezi, biberon, emzik vb. çocukla ilgili tüketim malzemeleri, alkol, kolonya, her türlü sabun, şampuan (tedavi amaçlı kullanılan medikal şampuanlar hariç), saç solüsyonu, diş macunu, tatlandırıcı, kozmetik ürünler.
5.12. Özel hemşire masrafları, telefon, hasta ve refakatçi yemekleri haricindeki yiyecekler ve benzeri tüm ekstra harcamalar, süit oda farkı.
5.13. Sigortalının alkolizm ve uyuşturucu madde bağımlılığı ile ilgili her türlü gideri, alkol zehirlenmesi, alkol kullanımı sonrası oluşabilecek hastalık ve kazaların gerektirdiği tedavi masrafları.
5.14. Poliçede belirtilen "Doktor" ve "Sağlık Kurumu" tanımına uymayan kişi ve kurumlara ait faturalar.
5.15. Bilimselliği kanıtlanmamış Deneysel ya da Araştırma amaçlı yapılan işlemler, well-being, alternatif tıp yöntemleri (akupunktur, mezoterapi vb.) ile ozon terapisi.
5.16. İlaç olarak kabul edilmeyen madde ile Sağlık Bakanlığı tarafından ruhsat verilmemiş tüm ilaçlar.
5.17. Hiçbir semptoma bağlı olmaksızın yapılan veya tanı ve tedavi ile doğrudan ilgili olmayan işlemler ile kontrol amaçlı yapılan işlemler.
5.18. Özel şartlarda tanımlanmış olsun ya da olmasın poliçenin teminat tablosunda belirtilmeyen teminatlar.
5.19. Sigortalının vefatı halinde cenaze ile ilgili giderler (morg, cenaze nakli vb.).
5.20. Sigortalının hastalık, hamilelik ve doğum sonrası çalışamaması nedeni ile elde edemediği kazançlar için günlük iş görememe parası.
5.21. Sigortalının bakıma ihtiyaç duyması halinde, gündelik bakım parası.
5.22. Hamilelik döneminde gerçekleşmiş ve/veya acil bir durum olsa dahi, hamilelik ve doğum teminatı kapsamında değerlendirilmeyen her türlü tetkik ve tedavi giderleri.
5.23. Yenidoğan bebek teminatında tanımlanmayan her türlü tetkik ve tedavi giderleri.
5.24. Yenidoğan bebeklerin prematürelik ve yenidoğan yoğun bakım kuvöz masrafları.
5.25. Poliçe başlangıç tarihinden sonra belirlenmiş olsa dahi doğuştan gelen hastalık ve sakatlıklar, organ eksiklikleri, deformiteler ile ilgili tetkik, tedavi, komplikasyon ve kontrol giderleri.
Sigortacı, uygulamaya yeni alınan veya değiştirilen tıbbi uygulamaların değişim ve gelişmelerini göz önünde bulundurarak, işbu "Teminat Dışı Kalan Haller"de düzenlemeler yapabilir. "Teminat Dışı Kalan Haller"de yapılacak değişiklikler, poliçede bulunan her bir Sigortalı için yeni poliçe başlangıç tarihinden itibaren geçerli olur.

6. COĞRAFİ KAPSAM
Bu sigorta sözleşmesi, Türkiye Cumhuriyeti ve Kuzey Kıbrıs Türk Cumhuriyeti (K.K.T.C.) sınırları içinde geçerlidir.

7. TEMİNATLARIN UYGULAMA USÜL VE ESASLARI

7.1 Hamilelik ve Doğum Teminatı: (bkz. yukarıdaki Bekleme Süresi ve Doğum Teminatı bölümleri - vaka başına tek limit, 12. hafta öncesi/sonrası düşük kuralları, yeni limit devreye girme koşulları vb.)

7.2 Doğum Teminatı: (bkz. madde 3.1.1 - doktor/hastane giderleri, amniyosentez, küretaj, komplikasyonlar, 180 günlük toplam yatış limiti, planlanmış doğumlarda Özel Sağlık Sigortası Bilgi Formu'nun 48 saat önceden gönderilmesi zorunluluğu)

7.3 Hamilelik Rutin Kontrol Teminatı: (bkz. madde 3.1.2 - kontrol muayene, tetkik ve ilaçlar; aynı doktorun 10 gün içindeki kontrol muayeneleri kapsam dışı)

7.4 Yeni Doğan Bebek Teminatı: (bkz. madde 3.1.3)

8. SAĞLIK KURUMLARI UYGULAMA ESASLARI
8.1 Anlaşmalı Sağlık Kurumları: Güncel listeye www.acibademsigorta.com.tr adresinden ulaşılabilir; Sigortacı önceden bildirimde bulunmaksızın değişiklik yapabilir. Seçilen kurumun listede yer alması, kurumun hizmetlerinin Sigortacı tarafından tavsiye edildiği anlamına gelmez; hizmet kalitesi ve tıbbi sonuçlar için Sigortacı garanti vermez. Anlaşmalı Sağlık Kurumu'nda gerçekleşecek sağlık giderleri için, teminat tablosunda belirtilen limit ve Sigortalı katılım payı doğrultusunda, Sigortacı ile Anlaşmalı Sağlık Kurumu arasında yapılan sözleşme kapsamında doğrudan ödeme yapılması için ön onay verilir. Provizyon sırasında verilen onay, Sigortacı'nın tazminat değerlendirmesi sonucunda ödeme veya ödememe kararına farklı bir sonuca varmasına engel değildir. Sigortalı, başvurduğu Anlaşmalı Sağlık Kurumu'nda Sigortalı olduğunu belirtmek, T.C. Kimlik numarasının yazılı olduğu resimli kimlik belgesini ibraz etmek ve poliçede belirtilen katılım payı ve muafiyet tutarını ödemekle yükümlüdür.
8.2 Anlaşmasız Sağlık Kurumları: Anlaşmasız Sağlık Kurumu olarak tanımlanan kişi ve kurumlarda tedavi yapılması halinde, tedavi gideri öncelikle Sigortalı tarafından ödenir. Tazminatın değerlendirilmesi için gerekli belgeler Sigortacı'ya ulaştıktan sonra, Poliçe Özel ve Genel Şartları ile Teminat Tablosuna göre değerlendirme yapılır.

9. TAZMİNAT ÖDEMESİ
Sigortalıların, sağlık giderlerinin ödenebilmesi için aşağıda belirtilen belgeleri Sigortacı'ya ulaştırması gerekmektedir: Özel Sağlık Sigortası Bilgi Formu (ilgili bölümlerinin Sigortalı, doktor veya tedavi görülen sağlık kuruluşu tarafından doldurulmuş ve imzalanmış olması gerekmektedir), tüm giderlerin fatura asılları ve (işlem bazlı) ayrıntılı fatura dökümleri, ameliyat raporu/doğum raporu ve/veya epikriz raporu, teşhise ilişkin tetkiklerin sonuçları, reçetenin aslı/ilaç küpürleri ya da ilaç takip sistemi çıktısı ve eczaneden alınan kasa fişi veya fatura, her türlü adli olaylarda (trafik kazası dahil) adli birimlerin oluşturdukları belgeler, yurtdışında yapılan tedavilere ait doktor raporları ve yapılan tetkiklere ait sonuçların Türkçe tercümeleri (İngilizce dışındaki dillerde olan belgeler için). Tazminat talebinin değerlendirilebilmesi için, gerekli görülmesi durumunda Sigortacı tarafından Sigortalı'dan ek bilgi ve belge talep edilebilir; Sigortacı, referans doktora Sigortalı'yı muayene ettirme hakkına da sahiptir. Tazminata konu olan sağlık giderinin sigortalı katılım payı ve/veya muafiyet tutarı olarak değerlendirilen bölümü için Sigortalı'ya ödeme yapılmaz. Tazminat ödemesi, başvuru aşamasında doldurulmuş başvuru formunda bildirilen banka hesabına, tazminat değerlendirmesi için gerekli tüm bilgi ve belgelerin Sigortacı'ya ulaştığı tarihten itibaren en geç 5 (beş) iş günü içinde yapılacaktır.

10. BEYAN VE İHBAR YÜKÜMLÜLÜĞÜ
Sigortacı, sigorta sözleşmesinin kurulması aşamasında Sigortalı ve/veya Sigorta Ettiren'in ilk başvurusunda beyan ettiği tüm bilgileri, yeniden sözleşme yapılması aşamasında ise Sigortalı'nın yıl içindeki tazminatlarını ve sağlık durumunu esas alarak değerlendirme yapar. Beyanın gerçeğe aykırı veya eksik olması ve/veya beyan yükümlülüğünün yerine getirilmemesi durumunda, Sağlık Sigortası Genel Şartları ve ilgili mevzuat uyarınca Sigortacı'ya tanınan hak ve imkanlara ilaveten, ilgili durum tespit edildiği tarih itibarıyla sigorta sözleşmesi şartları yeniden düzenlenebilir; bu durumda Sigortacı tarafından ödenen tazminatların Sigortacı'ya iade edilmesi, sözleşme şartlarının yeniden belirlenmesi (muafiyet, ek prim, limit vb. uygulanabilir) ve sigorta sözleşmesinin iptali söz konusu olabilecektir.

11. SÖZLEŞMENİN YENİLENMESİ VE YENİLEME GÜVENCESİ
11.1 Sözleşmenin Yenilenmesine İlişkin Uygulama Esasları: Sigortalı'nın kazanılmış haklarının kesintisiz devam edebilmesi için, mevcut sözleşmenin bitiş tarihinden itibaren en geç 30 gün içerisinde yeniden sözleşme yapılması gerekmektedir. Mevcut poliçenin bitiş tarihini 30 gün geçtikten sonra yapılan başvurular, Sigorta Ettiren ve/veya Sigortalı ile kaç yıldır sözleşme yapıldığına bakılmaksızın sigortaya ilk yıl girişi olarak değerlendirilecek, yeniden risk değerlendirmesi yapılacak ve Özel Şartlar'da belirtilen bekleme süreleri uygulanacaktır. Bu durumda kazanılmış hakların devamı söz konusu olamayacaktır. Mevcut sözleşmenin sona ermesi sonucunda yapacağı değerlendirme sonucunda Sigortacı sözleşmeyi hiç yenilemeyebileceği gibi, sigortalının mevcut rahatsızlıkları ve/veya hastalıkları için ek şart (muafiyet, limit, ek prim, katılım, bekleme süresi vb.) uygulayarak da güvence verebilir. Yeni yapılan sözleşme, biten sözleşme ile aynı teminat yapısına sahip olabileceği gibi, Sigorta Ettiren/Sigortalı ürün, anlaşmalı sağlık kurum ağı ve teminat değişikliği talebinde bulunabilir. Sigortacı'nın yeniden risk değerlendirmesi yaparak talebi kabul etmesi halinde, değişik teminat yapısına sahip planlardan birisi ile yeniden sözleşme yapılabilir.
11.2 Yenileme Güvencesi: Bu sözleşme kapsamında sigortalanacak kişilere "Yenileme Güvencesi" VERİLMEMEKTEDİR.

12. PRİM TESPİTİ
12.1 Prim Tespitine İlişkin Kriterler:
12.1.1 Tarife Primi: Bilimsel kabul görmüş ya da şirketin tecrübe edilen aktüeryal metodolojileri baz alınarak geçmişin, bugünün ve geleceğin frekans, şiddet ve benzeri etkileri gözetilerek hesaplanan baz primdir.
12.1.2 Poliçe Primi: Tarife primleri baz alınarak, "Prime İlişkin Düzenlemeler" bölümünde tanımlanmış ek prim ve/veya indirimlerin (dönemsel indirimler hariç) uygulanması sonucunda kişiye özel belirlenen primi ifade eder.
12.1.3 Ödenecek Poliçe Primi: Poliçe primleri baz alınarak "Prime İlişkin Düzenlemeler" bölümünde tanımlanmış tüm dönemsel indirimlerin uygulanması sonucunda kişiye özel belirlenen ödenecek primi ifade eder.
12.2 Prime İlişkin Düzenlemeler: İlk defa sigortalanacak kişilerin prim tespitinde, ürün tarife fiyatı baz alınır. Aynı planda kalmak suretiyle poliçesinin yenilenmesine karar verilen kişi için yenileme primi, aynı yaş ve cinsiyetteki ilk defa sigortalanacak sağlıklı bir sigortalı için geçerli olan tarife fiyatının 5 katını geçemez.
12.2.1 Tazminat/Prim (T/P) Oranına Bağlı İndirim/Ek Prim Uygulaması: Prim farkı ödenerek limit artırımı yapılan sözleşmenin yenileme dönemi sırasında; doğum teminatının hiç kullanılmamış olması ve yeniden yapılan sözleşmenin teminat limitinin artırılması için belirlenmiş prim farkının ödenmesi halinde, yeni sözleşme primlerinde %40 oranında indirim uygulanacaktır.
12.2.2 Risk Ek Primi: Tarife priminden bağımsız olarak, sigortalı adayının bireysel sağlık durumunun değerlendirilmesi sonucunda sigorta güvencesinin sağlanabilmesi için ödenmesi gereken ek primi ifade eder.
12.2.3 Diğer İndirim ve Ek Primler: Sigortacı tarafından dönemsel olarak düzenlenecek olan kampanyalar kapsamında ve benzeri durumlarda, bu özel şartlarda tanımlanan indirim ve ek primler dışında yapılan her türlü indirim ve ek primi ifade eder.

13. SİGORTAYA KABUL UYGULAMALARI
Bu sigorta ile, Türkiye Cumhuriyeti sınırları içerisinde ikamet eden, 18-45 yaş aralığındaki kişiler sigortalanabilmektedir.
13.1 Yeni Giriş İşlemleri: Yürürlükte olan sözleşmeye, sözleşme süresi içerisinde YENİ GİRİŞ YAPILMAYACAKTIR.

14. GEÇİŞ İŞLEMLERİ VE KAZANILMIŞ HAKLAR
Bu sözleşme kapsamında sigortalanacak kişiler için, başka bir sigorta şirketinden geçişler, yeni giriş gibi değerlendirilmekte ve kazanılmış haklar KORUNMAMAKTADIR.

15. SİGORTA SÜRESİ VE SİGORTA SÖZLEŞMESİNİN SONA ERMESİ
15.1 Sigorta Süresi: Sigorta sözleşmesinin yürürlükte olduğu dönemi ifade eder. Sigortanın süresi 1 yıldır ve poliçede belirtilen başlangıç ve bitiş tarihleri arasında yürürlükte kalır (poliçe üzerinde belirtilen başlangıç tarihinde saat 12.00'de başlar, bitiş tarihinde saat 12.00'de sona erer).
15.2 Sigortacının Sorumluluğunun Başlaması: Sigorta teminatları, başvurunun Sigortacı tarafından onaylanması ve poliçe priminin tamamının veya taksitli ödenmesi kararlaştırıldıysa ilk taksitinin ödenmesi ile yürürlüğe girer. Sigorta Ettiren, Sigortacı ile mutabık kalınan/kararlaştırılan prim taksitlerinin herhangi birini kararlaştırılan vade tarihinde ödemediği takdirde temerrüde düşer. Sigorta Ettiren, prim borcunu temerrüde düştüğü tarihi takip eden 15 gün içinde ödemediği takdirde sigorta teminatı durur ve Sigortacı tarafından Sigorta Ettiren'in bilinen son adresine yazılı ihtar gönderilir. Riskin gerçekleşmemesi kaydıyla, teminatın durduğu süre içinde prim borcunun ödenmesi halinde teminat durduğu yerden devam eder. Sigorta teminatının durduğu tarihten itibaren 15 gün içinde prim borcunun ödenmemesi halinde, sigorta sözleşmesi feshedilmiş olur.
15.3 Sigorta Ettiren ve/veya Sigortalı'nın İptal Hakkı:
15.3.1 Başlangıçta İptal Hakkı: Sigorta Ettiren ve/veya Sigortalı, poliçenin başlangıç tarihinden itibaren ilk 30 gün içerisinde yazılı olarak iptal talebinde bulunması halinde, risk gerçekleşmemiş ve herhangi bir tazminat talebinin olmaması durumunda, ödenen primler kesintisiz olarak Sigorta Ettiren'e iade edilir. İptal tarihine kadar yeni poliçede herhangi bir tazminat talebinin ve/veya ödemesinin olması veya 30 günden sonra gelmesi durumunda, aşağıdaki 15.3.2. maddesi uyarınca iptal yapılır.
15.3.2 Sigorta Süresi İçinde İptal Hakkı: Sigorta Ettiren ve/veya Sigortalı isteği üzerine poliçenin iptal edilmesi durumunda prim iade tutarı, sigorta sözleşmesinin geçerli olduğu gün sayısının toplam sigortalılık süresine oranı esas alınarak hesaplanır. Sigorta süresi içerisinde ödenen toplam tazminat tutarı, gün esasına göre hesaplanmış Ödenecek Poliçe Priminin %65'ine eşit veya küçük ise, ödenmiş toplam primden, gün esaslı hesaplanan prim tutarı düşülerek kalan tutar Sigorta Ettiren'e ödenir. Toplam tazminat tutarının, gün esaslı hesaplanan Ödenecek Poliçe Primi tutarının %65'ini aşması durumunda ise, sözleşmenin iptali sonucunda prim iadesi yapılmaz.
15.3.3 Diğer: Sigorta Ettiren ve/veya Sigortalı'nın "Azami İyi Niyet Prensibi" ilkelerine aykırı davranan, sigorta kapsamında olmayan kişilerin teminatlardan yararlandırılması veya sağlık gider belgelerinin sigorta sözleşmesi kapsamında olmayan diğer kimseler adına düzenlettirilmesi gibi kötü niyetli hareketlerinin saptanması durumunda Sigortacı, bu şekilde yapılmış bir tazminat talebini ödemiş olması halinde, ödemiş olduğu sağlık giderlerini geri alma (rücu) ve sigorta sözleşmesini bazı veya tüm sigortalılar için kısmen veya tamamen mebdeinden iptal etme hakkına sahiptir. Sigortalının, iyi niyet prensibi ile bağdaşmayan tazminat talepleri nedeni ile Sigortacı'nın uğrayacağı zararlardan Sigorta Ettiren, Sigortalı ile birlikte sorumludur.
15.4 Vefat Durumu: Sigorta Ettiren'in vefatı durumunda, sözleşme hükümsüz kalır. Sigorta Ettiren'in sözleşmede yer almadığı ve Sigortalı'ların Sigorta Ettiren'i değiştirerek sözleşmeyi devam ettirmek istemeleri halinde, Sigorta Ettiren'in kanuni varislerinin yazılı onayının Sigortacı'ya iletilmesi gereklidir; bu durumda Sigorta Ettiren değiştirilerek sözleşme devam ettirilir. Kanuni varislerin onayının alınmadığı durumlarda yukarıda belirtilen iptal kriterleri doğrultusunda işleme alınır ve varsa prim iadesi kanuni varislerine yapılır. Sigorta Ettiren'in Sigortalı ile aynı olduğu ve tek kişilik bir sözleşmede, Sigorta Ettiren'in vefatı durumunda sözleşme hükümsüz kalır. Birden fazla kişinin sigortalı olduğu sözleşmelerde, sigortalılardan birinin vefat etmesi durumunda, vefat eden sigortalının sözleşmeden vefat tarihi itibariyle çıkışı yapılır; yukarıda belirtilen iptal kriterleri doğrultusunda varsa prim iadesi poliçedeki Sigorta Ettiren'e yapılır.
`.trim();

const SISTEM_TALIMATI = `Sen WE Sigorta'nın WhatsApp asistanısın. Sana verilen "ACIBADEM KİŞİYE ÖZEL DOĞUM SAĞLIK SİGORTASI ÖZEL ŞARTLARI" belgesine dayanarak, müşterinin Doğum Sigortası hakkındaki sorusunu cevaplıyorsun. Bu ürün Acıbadem'e ait olup, ÖSS/TSS'den BAĞIMSIZ ayrı bir poliçedir (ama ÖSS veya TSS ile birlikte, ek poliçe olarak da satın alınabilir).

KURALLAR:
- SADECE aşağıda verilen belge metnine dayanarak cevap ver. Belgede yer almayan hiçbir bilgiyi UYDURMA.
- Eğer sorunun cevabı belgede YOKSA veya belge yetersizse, başka hiçbir şey yazmadan TAM OLARAK şunu yaz: YANIT_YOK
- Eğer cevap belgede varsa: kısa, net, sıcak bir dille (WhatsApp mesajı gibi, 2-6 cümle) cevap ver. Gerekirse madde madde yazabilirsin ama uzatma.
- Emin olmadığın, belgede açıkça yazmayan bir şeyi asla kendi yorumunla tamamlama - böyle bir durumda YANIT_YOK yaz.
- Türkçe cevap ver.
- Teknik terimleri (muafiyet, teminat, bekleme süresi vb.) gerektiğinde kısaca açıkla.
- Senin (ve bu botun) müşterinin kendi poliçesine/hesabına özel bilgilerine (örn. sigortalılık süresi, ÖBYG hakkı, poliçe durumu, ödemeler) erişimin YOK - bunları "kontrol edelim mi", "bakalım mı", "inceleyelim mi" gibi bir teklif ASLA sunma, bunu yapabilecekmiş gibi davranma. Soru müşterinin kendi hesabına/poliçesine özelse (genel poliçe şartları değil, "benim ÖBYG hakkım ne kadar" gibi kişiye özel bir durum sorusuysa), bunu belgeden cevaplayamayacağını belirtip doğrudan danışmanıyla görüşmesini öner (YANIT_YOK yazarak fallback mesajının devreye girmesini sağlayabilirsin).`;

// Musterinin sorusunu, belgeye dayanarak cevaplar. Belgede cevap yoksa ya da
// API kullanilamiyorsa (ANTHROPIC_API_KEY tanimli degil, API hata donuyor vb.)
// standart "danismaninizla gorusun" fallback mesajini dondurur - boylece
// musteri hicbir zaman cevapsiz/hata mesajiyla kalmaz.
const DANISMAN_YONLENDIRME_MESAJI =
  "Bu konudaki detayı elimdeki bilgilerle net olarak cevaplayamıyorum 🙏 Bu konuyla ilgili danışmanınızla görüşmenizi öneririz, size en doğru bilgiyi onlar verecektir.";

async function soruyaCevapVer(soru) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Doğum Sigortası soru-cevap: ANTHROPIC_API_KEY tanımlı değil - fallback mesajı dönülüyor.");
    return DANISMAN_YONLENDIRME_MESAJI;
  }

  const prompt =
    `${SISTEM_TALIMATI}\n\n--- BELGE BAŞLANGICI ---\n${OZEL_SART_METNI}\n--- BELGE SONU ---\n\n` +
    `Müşterinin sorusu: "${soru}"\n\nCevabın:`;

  try {
    const cevap = await mesajGonder(apiKey, prompt, { maxTokens: 600 });
    const temiz = (cevap || "").trim();
    if (!temiz || temiz === "YANIT_YOK" || temiz.startsWith("YANIT_YOK")) {
      return DANISMAN_YONLENDIRME_MESAJI;
    }
    return temiz;
  } catch (err) {
    console.error("Doğum Sigortası soru-cevap API hatası:", err.message);
    return DANISMAN_YONLENDIRME_MESAJI;
  }
}

module.exports = { soruyaCevapVer, DANISMAN_YONLENDIRME_MESAJI };
