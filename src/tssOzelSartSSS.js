// =====================================================================
// TSS (Tamamlayıcı Sağlık Sigortası) - Aksigorta/Medisa Özel Şartları
// Soru-Cevap Motoru
// ---------------------------------------------------------------------
// 30.07.2026 eklendi: Müşteriler WhatsApp'tan sürekli "şu hastalığı
// karşılıyor musunuz?", "kuluçka/bekleme süresi ne kadar?" gibi TSS
// poliçesinin kapsamıyla ilgili sorular soruyor. Bu dosya, kullanıcının
// yüklediği "Aksigorta_TSS_Ozel_Sart.pdf" belgesinin TAM METNİNİ
// (aşağıdaki OZEL_SART_METNI) referans olarak Anthropic API'sine (mevcut
// anthropicMesaj.js yardımcı fonksiyonu üzerinden - ruhsat/proforma/kimlik
// analizinde kullanılan AYNI desen) göndererek, müşterinin sorusuna
// SADECE bu belgeye dayanarak cevap verir.
//
// ÖNEMLİ TASARIM KARARI: sozlukSSS.js'teki gibi sabit anahtar-kelime
// eşleştirmeli bir sözlük DEĞİL - kullanıcının istediği gibi serbest
// metinle soru sorabildiği, belgeye dayalı (grounded) bir soru-cevap
// motoru (kullanıcının kendi talebi: "sözlükten ziyade soru cevap
// şeklinde bir bot yapmamız lazım"). Belgede cevabı bulunamayan bir soru
// için modelin KENDİ UYDURMASINI engellemek amacıyla, modelden belgede
// yoksa TAM OLARAK "YANIT_YOK" yazması isteniyor - bu sabit işareti
// yakalayıp kendi belirlediğimiz, marka diline uygun "danışmanınızla
// görüşün" mesajını döndürüyoruz (modelin serbest biçimde "bulamadım"
// demesine güvenmek yerine).
// =====================================================================

const { mesajGonder } = require("./anthropicMesaj");

const OZEL_SART_METNI = `
AKSİGORTA TAMAMLAYICI SAĞLIK SİGORTASI ÖZEL ŞARTLARI

1. SİGORTANIN KONUSU VE KAPSAMI
İşbu sigorta ile, AkSigorta A.Ş. (bundan sonra "Sigortacı" olarak anılacaktır), Sigortalı'nın sigorta başlangıç tarihinden sonra ortaya çıkan hastalık ve rahatsızlıklarına ait sigorta süresi içinde gerçekleşen, GSS kapsamına alınan sağlık giderlerini;
- Anlaşmalı Kurum ile Sigortacı arasında yapılan anlaşmaya göre, Sağlık Uygulama Tebliği (SUT) fiyatları üzerinde kalan tutarlarını,
- Otelcilik ücreti gibi Sigortalı'dan alınabilecek tutarları ve işbu Özel Şartlar ile sınırlı olmak koşulu ile Sosyal Güvenlik Kurumu (SGK) tarafından finansmanı sağlanmayan sağlık hizmetlerine ait bedellerini
İşbu Özel Şartlar ile Sağlık Sigortası Genel Şartları ve Poliçe ekinde yer alan teminat tablosu doğrultusunda güvence altına almaktadır.
Poliçe kapsamında yer alan teminatlar, sadece poliçede sigortalı olarak belirtilen kişiler için ayrı ayrı geçerli olup, poliçede sigortalı olarak yer almayan kişiler sigorta teminat kapsamından yararlanamazlar.

2. TANIMLAR
Anlaşmalı Sağlık Kurumları: Sigortacı ile Sağlık Kurumu (GSS kapsamında SGK ile sözleşmesi olan) arasında yapılan anlaşmalı kurum sözleşmesi kapsamında ve Sigortacı tarafından sigorta sözleşmesi ve/veya ilgili teminat için geçerli olduğu belirtilmiş olan sağlık kurumlarını, Sigortacı ile Sağlık Kurumu arasındaki anlaşmalı kurum sözleşme şartlarını kabul ederek, anlaşmalı sağlık kurumunun faturasında yer almak suretiyle bu kurumlar bünyesinde hizmet veren, aynı zamanda SGK ve Sigortacı ile de anlaşması olan Kadrolu Doktorları kapsamaktadır.
Anlaşmasız Sağlık Kurumları Ve Doktor: Sigortacı ile arasında bir anlaşmalı kurum sözleşmesi bulunmayan, SGK ile anlaşması olup Sigortacı ile anlaşması olmayan sağlık kurumlarını, Sigortacı ile Sağlık Kurumu arasındaki anlaşmalı kurum sözleşme şartlarını kabul etmeyen ve kendi faturasını düzenleyen doktorları ifade eder.
Anlaşmalı Sağlık Kurumları Ağı/Network: Sigortalı tarafından tercih edilen poliçede Sigortacının yer verilmesine uygun gördüğü anlaşmalı sağlık kurumlarını ifade eder.
Azami İyi Niyet Prensibi: Sigortacı bu sigorta sözleşmesini ve sözleşme şartlarını Sigorta Ettiren'in beyanına dayalı olarak oluşturmaktadır. Bu nedenle Sigorta Ettiren, başvuru ve beyan formu ile bunu tamamlayıcı belgelerde doğru bilgi vermek/ beyanda bulunmak ve sigorta sözleşmesinin konusunu teşkil eden, sigorta sözleşmesi talebinin değerlendirilmesinde etkili olacak hususları beyan etmekle yükümlüdür. Sonuç olarak azami iyi niyet; sorulmuş olsa da olmasa da Sigorta Ettiren'in, sigorta sözleşmesinden yararlanacak tüm Sigortalıların, geçmiş ve mevcut hastalıkları ve sağlık durumu ile ilgili tüm bilgileri tam ve yanılmaya mahal vermeyecek şekilde, gönüllü olarak Sigortacı'ya bildirmesidir.
Bireysel (Ferdi) Sağlık Sigortası: Bireyin tek başına veya eş ve çocuklarından oluşan ailenin bir arada yer alabileceği sağlık sigortası türüdür.
Deneysel veya Araştırma Amaçlı İşlem: Hastalığın tanı ve tedavisindeki gereklilik, etkinlik ve güvenilirliğini ortaya koyacak sayıda ve kalitede kontrollü klinik çalışmanın yayınlanmadığı veya yerli ve yabancı otoriteler (Amerikan Gıda ve İlaç Dairesi (FDA), tıp fakülteleri, ilgili kürsü bilim kurulları, Sağlık Bakanlığı, uzmanlık dernekleri vb.) tarafından kabul görmüş olmayan, tıbbi cemiyet veya otoritelerin yapılacak işlemin deneysel aşamada olduğuna veya aynı işlem için bir başka kurumun deneysel çalışmalarını sürdürdüğüne dair yazılı bildirimleri tespit edilen veya herhangi bir rahatsızlık olmadan araştırma, kontrol (check-up) amacıyla uygulandığına Sigortacı tarafından karar verilen tetkik ve tedavilerdir.
Doğuştan Gelen Hastalık (Konjenital Hastalık): Belirtileri ileri yaşta ortaya çıksa ve tanısı ileri yaşta konulsa dahi, kromozom anomalileri, genetik bozukluklar, yapısal kusurlar ile prenatal (gebelik öncesi), perinatal (gebelik sırasında) ve doğum eylemi esnasında ortaya çıkabilen fiziksel, metabolik, genetik ve kimyasal nedenlere bağlı oluşan her türlü sakatlık, motor ve mental gelişim bozuklukları, metabolik ve genetik tüm hastalıklar, yapısal anomaliler ve kusurlardır.
Doktor: Sağlık hizmetinin verildiği Coğrafi Bölgede geçerli olan yasalar çerçevesinde resmi olarak tıp doktoru unvanı ve belgesi verilmiş olan kişidir.
Grup (Kurumsal) Sağlık Sigortası: Sigorta Ettiren tüzel kişilik ile, bordro, öğrencilik, üyelik gibi ilişkisi olan kişiler ile eş ve çocuklarının aynı poliçe kapsamında sigortalandığı sağlık sigortası türüdür.
Genel Şartlar: Sigortacılık ve Özel Emeklilik Düzenleme ve Denetleme Kurumu tarafından belirlenen Sağlık Sigortası Genel Esasları'dır. Genel Şartların en güncel hali www.tsb.org.tr web sitesinde yer almaktadır.
İlk Sigortalanma Tarihi: Sigortalının özel sağlık sigortası kapsamına ilk giriş yaptığı ve Sigortacı tarafından kabul edilen ilk sigortalanma tarihini ifade eder.
İstisna: Sigorta sözleşmesinin kapsamı dışında bırakılan durumlardır.
Kadrolu Doktor: İlgili il Sağlık Müdürlüğü'ne Sağlık Kurumu tarafından bildirilen ve Sağlık Kurumu'nun tam zamanlı çalışanı durumunda bulunan Doktorları ifade eder.
Kabul Edilebilir Sağlık Gideri: Poliçe Özel ve Genel Şartları dikkate alınarak, sağlık gideri olarak gönderilen toplam fatura tutarından varsa kapsam dışı giderler çıkarıldıktan sonra, onaylanan toplam tutardır. Onaylanan toplam tutara, varsa sigortalı katılım payı ve muafiyet tutarı da dâhildir.
SGK Katılım Payı: 5510 sayılı Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu'nda öngörülen ve sağlık hizmetlerinden yararlanabilmek için, genel sağlık sigortalısı veya bakmakla yükümlü olduğu kişiler tarafından muayene işleminde ödenecek tutarı ifade eder.
Kaza: Ani, beklenmeyen, istenmeyen, önceden engellenemeyen veya planlanamayan olaylar ve bu olaylardan kaynaklanan hastalık veya yaralanmalardır.
Kazanılmış Haklar: Bu sigorta sözleşmesinde kazanılmış haklar, İlk Sigortalanma Tarihi ve Ömür Boyu Yenileme Garantisi haklarını ifade eder.
Limit: Sigortacı'nın teminat kapsamında bulunan ve işbu özel şartlara göre ödemeyi üstlendiği maksimum, kabul edilebilir sağlık giderini ifade eder.
Önceden Mevcut Hastalık: Bu sigorta sözleşmesinin yapılması için sağlık beyan ve başvuru formunda sorulmuş olmasına rağmen veya sorulmasa dahi Sigortacı'ya beyan edilmeyen, belirtisinin/bulgusunun veya teşhisinin/tedavisinin başlangıcı, sigorta başlangıç tarihi öncesine dayanan rahatsızlıklar ve bunlara bağlı olarak gelişen komplikasyonlardır.
Muafiyet: Sağlık Sigortası Genel ve Özel Şartları gereği teminat kapsamında değerlendirilen sağlık giderlerinden Sigortalı'nın üstleneceği kısmı ifade eder. Muafiyet bilgisi, sigorta sözleşmesi ekinde verilen teminat tablosunda belirtilir.
Özel Sağlık Sigortası (ÖSS) Hasta Bilgi Formu: Sağlık Kurumlarından hizmet alınması durumunda Doktor tarafından doldurulması gereken formdur. İlgili form, Anlaşmalı Sağlık Kurumları'nda mevcut olup, anlaşmasız sağlık kurumları için www.aksigorta.com.tr adresinden ulaşılabilir.
Poliçe: Sigorta Ettiren ve/veya Sigortalı ve Sigortacı'nın sigorta sözleşmesinden doğan hak ve yükümlülüklerini gösteren bir ispat vasıtasıdır.
Provizyon: Sigortalı'nın tedavisiyle ilgili Anlaşmalı Sağlık Kurumu tarafından Sigortacı'nın 7/24 provizyon merkezinden istenen ön onayı ifade etmektedir.
Provizyon Ön Onayı: Anlaşmalı Sağlık Kurumlarında yapılacak sağlık giderleri için; teminat tablosunda belirtilen limit, katılım payı ve muafiyet doğrultusunda, Sigortacı ile Anlaşmalı Sağlık Kurumu arasında yapılan sözleşme kapsamında, doğrudan Anlaşmalı Sağlık Kurumu'na Sigortacı tarafından ödeme yapılacağını gösteren ön onayı ifade etmektedir. Sigortacı'nın ödemeye ilişkin Provizyon Ön Onayı vermiş olması, sonradan tespit edilen beyan eksikliği nedeniyle Sigortacı'nın haklarını kullanmasına engel teşkil etmez.
Provizyon Şartlı Onayı: Sonuçlanan Provizyon Ön Onayı son onay olmakla birlikte, Sigortacı onay konusu teşhis ve tedavi işleminin yapılması sırasında/sonrasında buna ilişkin sağlık giderlerini yeniden değerlendirebilir. Sigortacı, tıbbi kayıtlar üzerinden ek değerlendirme yaparak gerek teminat gerekse ödeme bakımından farklı bir şekilde karar verebilir. Yapılacak değerlendirme sonucunda ön onaya konu işlem ve sağlık giderinin teminat kapsamı dışında olduğuna karar verilerek, nihai onay verilmezse, tedavi giderleri Sigortalı/Sigorta Ettiren tarafından karşılanır.
Provizyon Rakam Onayı: Provizyon Ön Onayı verilen sağlık giderlerinin değerlendirilmesi sonucunda ödeme kararı verilmesi halinde, nihai karar doğrultusunda Anlaşmalı Sağlık Kurumu'na Sigortacı tarafından ödeme yapılacağını gösteren onayı ifade etmektedir.
Referans Doktor: İşbu sözleşme kapsamında değerlendirilecek sağlık giderlerinin tıbbi gerekliliğine dair uzman görüşü alınan ve Sigortacı tarafından belirlenen anlaşmalı Doktordur.
Risk Değerlendirme Birimi: Sigorta Ettiren veya Sigortalı'nın beyanlarını ve/veya sağlık bilgilerini değerlendirerek, hangi şart ve koşullarda sigorta sözleşmesinin kurulacağına ya da sigorta sözleşmesinin kurulmamasına karar veren birimdir.
Sağlık Gideri: Sağlık Sigortası Genel ve Özel Şartları'na göre teminat kapsamında olduğu tespit edilen, sigorta süresi içerisinde gerçekleşen, Sigortacı'nın Tıbbi Gereklilik koşuluna uygun olan, Doktor tarafından yazılı olarak planlanan tetkik ve/veya tedavi işlemlerine ait giderleri ifade eder.
Sağlık Hizmet Tarifesi: Sağlık hizmeti veren kurumlarda, tıbbi hizmet ücretlerinin belirlenmesinde kullanılan birim ve uygulama ilkelerini gösteren referans tarifedir. (Türk Tabipler Birliği Tarifesi (TTB), Hekimlik Uygulamaları Veritabanı (HUV), Sağlık Uygulama Tebliği (SUT) vb.)
Sağlık Uygulama Tebliği (SUT): SGK'lı sigortalı ve bakmakla yükümlü olduğu kişilerin, SGK tarafından sağlık hizmetleri, yol, gündelik ve refakatçi giderleri gibi sağlık hizmetlerine bağlı harcamalarının karşılanması esas ve usulleri ile bu hizmetlere ilişkin bedellerin tayin ve tespit edildiği Sosyal Güvenlik Kurumu Sağlık Uygulama Tebliği'ni ifade eder.
Sağlık Kurumu: Sağlık Bakanlığı'nca yasal mevzuata uygun olarak çalışma ruhsatı ile faaliyet gösteren, tıbbi bakım ve tedavi hizmeti veren hastane, klinik, poliklinik, muayenehane, teşhis ve tedavi merkezlerini ifade eder. "Sağlık Kurumu" deyimi; otel, huzurevi, bakımevi, nekahethane, yetimhane ve darülacezeleri, esas olarak uyuşturucu bağımlıları ile alkoliklerin tecrit ve tedavisi için kullanılan yerleri, sanatoryumları, kaplıcaları, sağlık hidrolarını, zayıflama merkezlerini içermez.
Sigortacı: Bu sigorta sözleşmesinin tanzim edildiği ülkede tescil edilmiş ve işletme ruhsatı almış sigorta şirketidir.
Sigorta Ettiren: Sigorta Ettiren, sigorta sözleşmesini yapan ve prim ödemek dahil sigorta sözleşmesinden kaynaklanan yükümlülükleri yerine getirme sorumluluğunu taşıyan kişidir.
Sigortalı/Sigortalılar: Sigortalı/Sigortalılar, Poliçede ismi/isimleri belirtilen ve sigorta sözleşmesi ile menfaatleri teminat altına alınan ve sağlık giderlerini talep hakkı bulunan kişilerdir.
Tarife Primi: Bilimsel kabul görmüş ya da şirketin tecrübe edilen aktüeryal metodolojileri baz alınarak geçmişin, bugünün ve geleceğin frekans, şiddet ve benzeri etkileri gözetilerek hesaplanan baz primdir.
Tazminat: Sağlık Sigortası Genel ve Özel Şartları gereği teminat kapsamında değerlendirilen sağlık giderlerinin, ilgili Poliçe döneminde yer alan teminat, limit, Muafiyet ve Katılım Payı dikkate alınarak ödenen tutarıdır.
Teminat: Sigortacı'nın Sağlık Sigortası Genel ve Özel Şartları gereği, sigorta süresi içerisinde oluşan sağlık giderleri için Sigortalı'ya verdiği güvencedir.
Tıbbi Gereklilik: Tetkik ve tedavi işlemlerinin bir hastalığın ve/veya rahatsızlığın tedavisi için gerekli ve etkili olması durumudur. Tetkik veya tedavinin bir Doktor tarafından uygulanmış olması, tek başına Tıbbi Gereklilik koşulunun bulunduğu şeklinde yorumlanamaz. Uyuşmazlık durumlarında Tıbbi Gereklilik, Sigortacı'nın Referans Doktoru tarafından belirlenmektedir.
Genel Sağlık Sigortası (GSS): 31/5/2006 tarihli ve 5510 sayılı Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu'nun 98. maddesine dayanılarak hazırlanan ve bu kanunun 60. maddesinde sayılan genel sağlık sigortalısı ve bakmakla yükümlü olduğu kişileri kapsayan sağlık sigortası sistemidir.
Endikasyon Dışı İşlemler: Sigortalı'nın sağlığını tehlikeye sokmaksızın hastaneye yatırılmadan da yürütülebileceği, tarafsız bir hekim tarafından da kabul edilen, tedavi, inceleme ve işlemlerin hastaneye yatırılarak yapılması ve/veya hastanın mevcut tablosu ile uyumlu olmayan ve endikasyonu bulunmayan teşhis ve tedavi işlemlerinin yapılmasıdır.
Triyaj Uygulaması: Hasta ve yaralıların acil serviste görülme zaman ve sırasının, müdahale ile muayene aciliyetinin ve niteliklerinin belirlendiği kısa bir klinik değerlendirme işlemidir. Triajda hastanın klinik durumunu ve tedavi önceliğini belirtmekte kırmızı, sarı ve yeşil renkler kullanılır.
- Kırmızı Alan: En yüksek öncelik sırasına sahiptir. Tedavi edilebilir, hayatı tehdit eden yaralanma ve hastalığı olan kritik durumdaki kişiler bu gruba girer. Bu nitelikteki hastalara zaman kaybetmeden acil müdahale gerekir.
- Sarı Alan: Zaman geçirilmeden müdahale ve muayenelerinin yapılması gereken, ciddi fakat hayatı tehdit etmeyen yaralanma ve hastalığı olan kritik durumdaki kişiler bu gruba girer.
- Yeşil Alan: En düşük önceliğe sahiptir. Acil müdahale gereksinimi olmayıp; bekleyebilecek, muayene ve tedavileri poliklinik şartlarında da yapılabilecek kişiler bu gruba girer.
Teminat Dışı Kalan Kurumlar: Sigortalı'nın sağlık giderlerinin teminatları gereği kapsam dahilinde olmasına rağmen, geri ödeme alamayacağı kurum ve/veya hekimleri ifade eder. Yanlış Sigorta uygulamalarından, gereksiz tetkik ve tedavi ile Sigorta suistimali yaptığı tespit edilen bu kurum ve/veya hekimlerde yapılan işlemler poliçe kapsamı dışındadır. Teminat dışı kalan kurumların güncel listesine www.aksigorta.com.tr adresi üzerinden ulaşılabilir.

3. TEMİNATLAR
Aşağıda yer alan teminat grubu veya teminatlardan birisi veya bir kısmı veya tamamı, Poliçe ve teminat tablosu üzerinde açıkça yazılması ve priminin ödenmesi karşılığında GSS kapsamında alınan sağlık hizmetleri için işbu Özel Şartlar ile Sağlık Sigortası Genel Şartları'ndaki hüküm ve şartlar çerçevesinde verilir.

3.1. Yatarak Tedavi Teminat Grubu
Bu teminat grubu ile, Sigortalı'nın, ameliyat ve hastanede yatarak yapılan tedavileri için, hastaneye yatış-çıkış tarihleri arasındaki doktor, ameliyathane, oda yemek, refakatçi (bir kişi ile sınırlıdır), tıbbi malzeme, ilaç ve hastalığın komplikasyonlarının tedavisi için tıbbi gerekliliği bulunan tıbbi hizmetlere ait giderleri ile yoğun bakım giderleri işbu Özel Şartlar'da tanımlı Teminat Uygulama Usül ve Esasları uyarınca karşılanır. Yatarak Tedavi Teminat Grubu aşağıdaki teminatları içermektedir. Triyaj uygulamasında Kırmızı Alan'a giren vakalara ait giderler de bu teminat kapsamında değerlendirilmektedir.
- Cerrahi Yatış
- Dahili Yatış
- Küçük Müdahale
- Evde Tıbbi Bakım
- Suni Uzuv
- Ambulans
- Yardımcı Tıbbi Malzemeler
Tetkik amaçlı yatışlar, yatarak tedavi teminatı kapsamı dışındadır.
Sigorta süresinin sona ermesi ve poliçenin yenilenmemesi durumunda, sona erme tarihinden önce Sigortacı'ya bildirilen ve Sigortacı tarafından kabul edilen hastalık ve/veya rahatsızlıklar için, aşağıdaki şartlar altında teminat devam eder. Sağlık kurumunda yatışın sigorta süresi sonrasında da devam etmesi durumunda, teminat tablosu ve işbu Özel Şartlar'a tabi olmak şartıyla Hastanede yatarak tedavi gören sigortalı için işbu teminat, anılan yatış ve ilişkin olduğu hastalık ve/veya rahatsızlığın tedavisinin sonuna kadar devam eder. Ancak bu süre, hiçbir şekilde poliçe bitiş tarihinden itibaren 10 günü geçemez.

3.1.1. Cerrahi Yatış Teminatı
Cerrahi ve ortopedik müdahalelere ilişkin sağlık giderleri bu teminat kapsamında değerlendirilir. Tedavinin ameliyat gerektirmesi durumunda; Ameliyat öncesi anestezi doktorunun istemiş olduğu rutin pre-op tetkikler, ameliyathane kirası, operatör, anestezi uzmanı ve asistan doktor ücretleri, oda, yemek, refakatçi (bir kişi ile sınırlıdır) giderleri, anestezi ilaç ve sarf malzemelerine ilişkin giderler, teminat tablosunda belirtilen limitler ile işbu Özel Şart ve Sağlık Sigortası Genel Şartları dahilinde bu teminat kapsamında değerlendirilir.
Sigortalıların, acil tıbbi durumlar haricinde planlanmış ameliyatları için ameliyatı yapacak olan doktor tarafından doldurulacak Özel Sağlık Sigortası Hasta Bilgi Formu'nu, 48 saat öncesinden Sigortacı'ya göndermesi gerekmektedir.
Teminat kapsamına giren ve girmeyen ameliyatların bir arada yapılması durumunda, işbu teminat kapsamına girmeyen ameliyat veya ameliyatlarla ilgili sağlık giderleri karşılanmaz.

3.1.2. Dahili Yatış Teminatı
Ameliyat gerektirmeyen ve tedavinin sağlık kurumunda en az 24 saat yatış (normal oda ya da yoğun bakım) gerektirmesi durumunda ilgili tüm sağlık giderler, bu teminat kapsamında değerlendirilir.

3.1.3. Küçük Müdahale Teminatı
Günübirlik tedavi kapsamındaki işlemler; sağlık kurumlarında yatış ve taburcu işlemi yapılmadan 24 saatlik zaman dilimi içinde yapılan ve SUT kapsamında günübirlik tedaviler kategorisinde aşağıda belirtilen işlemlerdir.
a) Kemoterapi tedavisi,
b) Radyoterapi tedavisi,
c) Genel anestezi, bölgesel/lokal anestezi, intravenöz veya inhalasyon ile sedasyon gerçekleştirilen tanısal veya cerrahi tüm işlemler,
d) Hemodiyaliz tedavileri,
e) Sağlık Bakanlığınca yayımlanan "Ayakta Teşhis ve Tedavi Yapılan Özel Sağlık Kuruluşları Hakkında Yönetmelik" eki "Tıp Merkezlerinde Gerçekleştirilebilecek Cerrahi Müdahaleler Listesi"nde yer alan işlemler.

3.1.4. Evde Tıbbi Bakım
Sigortalının sağlık kurumlarındaki yatarak tedavisi sonrasında, söz konusu tedavinin devamı için Sigortalı'nın sürekli veya geçici olarak ikamet ettiği yerde veya Sigortacı'nın onay vermesi halinde bir tıbbi bakım merkezinde, sadece tıp eğitimi görmüş personel (doktor, sağlık memuru, hemşire gibi) tarafından yapılan tıbbi bakım ve tedavilerine ilişkin sağlık giderleri ve tıbbi malzeme giderlerini kapsar. Evde Bakım giderleri, sigorta süresi içinde en fazla 56 güne kadar ödenir.
Sigortalının bu teminattan faydalanabilmesi için, Sigortalı'yı tedavi eden doktor tarafından yazılan ve Sigortalı hastaneden taburcu olurken tedavisinin bir tıp eğitimi görmüş personel eşliğinde Sigortalı'nın sürekli veya geçici olarak ikamet ettiği yerde sürdürülmesi gerektiğini belirten bir raporla Sigortacı'ya bildirilmesi, hizmetin hastaneye yatış nedeniyle ilgili tedavinin devamını oluşturması, bu durumun ve öngörülen tedavi süresinin evde bakım gerçekleşmeden önce Sigortacı tarafından onaylanması zorunludur.
Bu teminat sadece anlaşmalı kurumlarda geçerlidir.
Sigortalının günlük yaşam aktivitelerini tek başına yerine getiremiyor olması, yatağa bağımlı olması, yemeğinin yedirilmesinde yardıma gereksinimi olması, ağız yoluyla ilaç alıyor olması, tam banyo ihtiyacı ya da yardımla banyo yapabiliyor olması, üriner kateter bulunması, evde yalnız yaşıyor olması ve sosyal desteğe gereksinimi olması gibi nedenlerle alınan Evde Bakım Hizmetleri bu teminat kapsamına girmez.

3.1.5. Suni Uzuv
Sigorta süresi içerisinde meydana gelen hastalık ya da kaza sonucu fonksiyon kaybına uğramış organın fonksiyonlarını yerine koyma amacıyla takılan ve estetik amacı taşımayan kalp pili, insulin pompası, el, kol, bacak ve meme kanseri operasyonu sonrası takılan meme protezi olmak üzere protez giderleri gerekliliğinin doktor raporuyla belgelenmesi koşulu ile protez gideri ve protezin takılmasıyla ilgili ameliyat giderleri, poliçe ekinde yer alan teminat tablosu dikkate alınarak bu teminat kapsamında değerlendirilir.

3.1.6. Ambulans
Sigortalının hayati tehlike gösteren acil durumunda, yerinde müdahale ve/veya en yakın sağlık kurumuna nakli için AkSigorta Müşteri Hizmetleri'ni araması koşulu ile bu hizmetin verilebildiği bölgelerde Ambulans teminatından yararlanır.
Sigortalının tıbbi donanımı yeterli olan en yakın sağlık kurumuna karayolu ile ulaştırılmasının mümkün olmadığı durumlarda, Sigortacı'ya detaylı tıbbi bilgilerin ulaştırılması ve Sigortacı'nın onayı ile hasarın gerçekleştiği ülke sınırları dahilinde hava veya deniz ambulans hizmeti Sigortacı tarafından verilir.

3.1.7. Yardımcı Tıbbi Malzeme
Sigortalının poliçe süresi içerisinde meydana gelen bir kaza veya hastalık sonucu uygulanan tedavisinin bir parçası olarak, vücuda dışarıdan destek olacak şekilde ve sadece tıbbi amaçlarla kullanılan, taşınabilir, kişiye özel atel, elastik bandaj, ortopedik bot, tabanlık, korse, boyunluk, dizlik, bileklik, dirseklik, kol askısı, oturma simidi, rom walker, walker, koltuk değneği, alçı terliği, ürostomi torbası, kolostomi torbasından ibaret tıbbi malzemeler ile yanık veya yara tedavisinde kullanılan örtücü malzemeler ile hastanede yatarak gerçekleşen veya evde bakım sırasında kullanılan ürostomi torbası, kolostomi torbası ile yanık veya yara tedavisinde kullanılan örtücü malzemeler bu teminat kapsamında poliçede belirtilen "Tıbbi Malzeme" teminat limiti ve ödeme yüzdesi dahilinde karşılanır. Ayakta Tedavi ve Doğum teminatları kapsamında gerçekleşen tedavilere ait tıbbi malzemeler ancak poliçede ilgili teminatlar varsa bu teminat kapsamında karşılanır.
GSS kapsamında karşılanmayan hastanede yatarak tedavi veya ameliyat sırasında kullanılan tıbbi malzemeler, gerekliliğinin doktor raporuyla belgelenerek Sigortacı'nın onaylaması koşulu ile bu teminat kapsamında karşılanır.
GSS kullanılarak yapılan muayene sonrası tıbbi malzeme reçetelendirilir ise kapsam dahilindeki tıbbi malzemeler için teminat limiti ve ödeme yüzdesi dahilinde ödeme yapılır.

3.2. Ayakta Tedavi Teminat Grubu
Bu teminat grubu ile, tanı işlemleri, teşhis ve tedavinin hastanede yatmayı gerektirmediği hallerde, sağlık kurumlarında yapılan işlemleri kapsar. Ayakta Tedavi Teminat Grubu aşağıdaki teminatları içermektedir:
- Tamamlayıcı Ayakta Tedavi
- Fizik Tedavi

3.2.1. Tamamlayıcı Ayakta Tedavi
Sağlık kurumlarında yatış gerçekleşmeden sağlanan doktor muayene, röntgen, laboratuvar tetkikleri ve ileri tanı yöntemlerine ait giderler, poliçede tercih edilmeleri kaydıyla, bu teminat limit ve ödeme yüzdesi kapsamında karşılanır. Doktor muayenesi ile ilişkisi olmadan gerçekleşen teşhis yöntemleri ve tetkikler kapsam dışındadır. Triyaj uygulamasında Yeşil ve Sarı Alan kapsamında değerlendirilen tedaviler de bu teminat kapsamında değerlendirilir.

3.2.2. Fizik Tedavi Teminatı
Teminat kapsamındaki bir hastalığın tedavisi için tıbben gerekli görülen fizik tedavi ve rehabilitasyon giderleri, tedavinin ayakta ya da yatarak yapılmasına bakılmaksızın, fizik tedavi uzmanı tarafından düzenlenen tedavi planı ve rapor incelenerek, tedavi öncesi Sigortacı tarafından onaylanması koşulu ile teminat tablosunda belirtilen limit, muafiyet ve katılım payı dahilinde bu teminat kapsamında değerlendirilir.
Tedavinin birden fazla vücut bölgesine uygulanması durumunda her bölge bir (1) seans olarak değerlendirilir.
Fizik tedavinin sağlık kurumunda yatarak yapılması halinde, fizik tedavi giderleri dışında faturalandırılan oda, yemek, refakatçi, doktor takibi vb. giderler ödenmez.

3.3. Annelik Tedavi Teminatı
Annelik Doğum ve Annelik Rutin Kontrol teminatı poliçede yer alan kendisi veya eşi konumundaki 18 yaş üzeri kadın sigortalılar için geçerlidir.

3.3.1. Doğum Teminatı
Doğumun sonlandırılması işlemi için yapılan normal doğum veya sezaryen işlemlerine ait doktor ve hastane giderleri ile hamilelik döneminde tıbbi gereklilik halinde amniyosentez işlemi, hamilelik, tıbbi gereklilik halinde küretaj, doğum ve sezaryen komplikasyonlarına bağlı yatışlar bu teminat kapsamında, poliçede belirtilmiş olan teminat limitleri doğrultusunda karşılanmaktadır.

3.3.2. Rutin Kontroller
Hamileliği ilgilendiren her türlü kontrol muayene ve rutin tetkikler hamilelik rutin kontrol teminatı kapsamında, teminat tablosunda belirtilen oran ve limitler dahilinde ödenir.

3.4. Ek Teminatlar
3.4.1. CHECK UP
Ürüne özel belirlenmiş Check-Up Anlaşmalı Sağlık Kurumlarında yaptırılması koşulu ve teminat tablosunda belirtilen içerik dahilindeki check-up giderleri bu teminat kapsamında değerlendirilir.

4. BEKLEME SÜRESİ
İlk sigortalanma tarihinden sonra ortaya çıkan ve yatarak tedavi kapsamındaki tüm işlemler ile ayakta veya yatarak olmasına bakılmaksızın tüm fizik tedavi ve rehabilitasyon ile ilgili giderler, ilk sigortalanma tarihinden başlamak üzere 3 AYLIK BEKLEME SÜRESİ boyunca teminat kapsamı dışındadır.
Doğum teminatı bulunan poliçede gebelikle ilgili giderlerin karşılanabilmesi için, bu teminatın poliçeye dahil edilmesinden itibaren EN AZ 12 AY sigortalılık süresinin tamamlanmış olması gerekmektedir. Doğum teminatı kapsamındaki tüm giderler bu teminatın bir önceki yıl da seçilmesi kaydıyla geçerli olup, teminata ilişkin giderler, seçildiği ilk yıl kapsam dışındadır.
Yenileme döneminde; doğum teminatına ara verilmesi ve poliçeye doğum teminatının tekrar dahil edilmesi durumunda bekleme süresi yeniden başlar.
Triyaj uygulamasında Kırmızı Alan kapsamında değerlendirilen tedaviler için bekleme süresi uygulanmayacaktır.
(NOT: Bu poliçede hastalık bazlı, farklı süreli "kuluçka süreleri" YOKTUR - tek bir genel 3 aylık bekleme süresi ve doğum teminatı için ayrı 12 aylık bir sigortalılık süresi şartı vardır. Kırmızı Alan/acil durumlarda bekleme süresi hiç uygulanmaz.)

5. TEMİNAT DIŞI KALAN HALLER
Sağlık Sigortası Genel Şartları'nda belirtilen teminat dışı hallerle birlikte, aşağıda sayılan haller ve bu sebeple yapılacak her türlü sağlık gideri de teminat kapsamı dışındadır:
5.1. Sigortalının sigortacıya sigortalanırken bildirilmiş olsa dahi poliçe başlangıç tarihinden önce var olan şikayet ve hastalıklar ile ilgili her türlü sağlık harcamaları, metastazları, sigortalılık dönemi öncesinde uygulanan ameliyat ve tedavilerin nüks ve komplikasyonları (insizyonel herni, adezyolizis, implantların çıkartılması vb. giderleri) ve bunlara bağlı olarak gelişen rahatsızlıklar
5.2. Poliçe başlangıç tarihinden sonra belirlenmiş olsa dahi doğuştan gelen hastalık ve sakatlıklar, organ eksiklikleri, deformiteler ile ilgili tetkik, tedavi, komplikasyon ve kontrol giderleri
5.3. Skolyoz, Kifoz vb. her türlü omurga eğrilikleri Halluks Valgus ile ilgili tetkik ve tedaviler
5.4. HIV virüsü enfeksiyonları ile ilgili tüm giderler, AIDS ve komplikasyonları
5.5. Her tür nedenle sünnet
5.6. Penil protez, cinsel işlev bozuklukları, peyroni hastalığı ile ilgili muayene, tetkik ve tedavi giderleri, cinsiyet değiştirme
5.7. Düşük nedenlerinin araştırılması, infertilite (kısırlık) teşhis ve tedavisi (ovülasyon takibi, infertilite amaçlı yapıldığı belirlenen HSG, adhezyolizis, tuboplasti vb.), isteğe bağlı küretaj, rahim içi araç takılması (spiral gibi), vazektomi, tüp ligasyonu gibi doğum kontrol yöntemlerine ait (ilaç dahil) giderler
5.8. Demansiyel sendromlar (alzheimer hastalığı ve bunamalar), psikiyatrik, geriatrik hastalıklar ve psikoterapi gerektiren durumların tetkikleri, tedavileri ve komplikasyonları ile psikolog ve danışmanlık hizmetleri ile ilgili tüm giderler, psikiyatrik ilaçlar vb. tetkikler, her ne nedenle yapılırsa yapılsın ses ve konuşma terapileri
5.9. Kozmetik amaçlı yapılan her türlü tedavi, obezite ve metabolik sendrom ile ilgili tetkik ve tedavi giderleri, hiperhidrozis (aşırı terleme) ile ilgili giderler
5.10. Organ ve kan naklinde verici giderleri, organ ücreti ve organın ulaştırılması masrafları
5.11. Şaşılık, görme tembelliği ve gözde kırma kusuru
5.12. Kaza sonucu veya yanma sonucu olmadığı takdirde estetik ve rekonstrüktif cerrahi, jinekomasti tetkik ve tedavileri, meme küçültme ve büyütme ameliyatları
5.13. Genetik hastalıklar, genetik kusurlar ve genetik incelemeler
5.14. Alerji aşıları ve alerjik hastalıkların klasifikasyon testleri
5.15. Sağlık Bakanlığı tarafından ruhsatlı veya ruhsatsız her türlü farmasötik ürünler (ilaç) ve her türlü aşı ile bunların uygulanmasına ilişkin her türlü gider
5.16. Horlama ve uyku apne sendromu, septum deviasyonu, konka hipertrofisi, nazal valv hastalıklarına ait tüm giderler
5.17. Koroner Arter Kalsiyum Skorlama Testi, Koroner CT Anjiyo, EBT (Elektron Beam Tomografi), sanal anjiyo, sanal kolonoskopi ve buna benzer tarama amaçlı yapılan tetkiklere ait giderler
5.18. Kordon kanı ve kök hücre alınması, nakli ve işlenmesi ile ilgili tüm giderler
5.19. Tıbbi ve yardımcı tıbbi malzeme statüsünde değerlendirilemeyecek her türlü alet, cihaz ve yine her ne isim altında olursa olsun bu cihazlara ait alet kullanım bedeli, alet-cihaz kira bedeli (robotik cerrahi için robot kullanımı-kira ücreti gibi) ile ilgili tüm giderler
5.20. Doktor ve Sağlık Kurumu tanımına uymayan kişi ve/veya kurumlar tarafından düzenlenen her türlü fatura ile kaplıca kürleri, çamur banyoları, şifa kürleri, masaj, jimnastik salonları ve zayıflama merkezleriyle ilgili giderler, çocuk bakımı, çocuk maması, bezi, biberon, emzik vb. çocukla ilgili tüketim malzemeleri, alkol, kolonya, her türlü sabun, şampuan (tedavi amaçlı kullanılan medikal şampuanlar hariç), saç solüsyonu, diş macunu, tatlandırıcı, kozmetik ürünler, telefon, hasta ve refakatçi yemekleri haricindeki yiyecekler ve benzeri tüm ekstra harcamalar, süit oda farkı, Sigortacı tarafından onaylanmış Evde Bakım Teminatı dışındaki özel hemşire masrafları
5.21. Telefon, hasta ve refakatçi yemekleri haricindeki yiyecekler ve benzeri tüm ekstra harcamalar, süit oda farkı, Sigortacı tarafından onaylanmış Evde Bakım Teminatı dışındaki özel hemşire masrafları
5.22. Alkol, eroin, morfin, uyarıcı veya her türlü uyuşturucu bağımlılığının tedavisi ve bunların kullanımı sonucu oluşan zehirlenme ve hastalıklar ile bunlardan herhangi birinin bünyelerinde mevcut olduğu tespit edilen Sigortalı'nın bünyelerinde mevcut olduğu tespit edilen hastalık, kaza ve yaralanmalarına ait tanı, tedavi, kontrol ve komplikasyon giderleri
5.23. Anlaşmasız Sağlık Kurumları'nda gerçekleşen işlemlerde, Poliçe ekinde yer alan teminat tablosunda belirtilmiş limit üzerinde kalan tutar
5.24. Yapıldığı kuruma bakılmaksızın akupunktur ve PRP (Platelet Rich Plasma - Trombositten Zengin Plazma) gibi alternatif tıp uygulamaları ve her türlü estetik ve kozmetik amaçlı tedavi, ameliyat, kontrol ve komplikasyonlarına ilişkin giderler
5.25. Hiçbir semptoma bağlı olmaksızın yapılan veya tanı ve tedavi ile doğrudan ilgili olmayan işlemler ile kontrol ve tarama amaçlı yapılan işlemler
5.26. İşbu Özel Şartlar'da tanımlanmış olsun veya olmasın, teminat tablosunda yer almayan herhangi bir teminat kapsamına giren sağlık giderleri veya işlemleri
5.27. Lisanslı ve profesyonel yapılan her türlü spor sonucu meydana gelecek sakatlanma ve yaralanmalar
5.28. Tehlikeli spor faaliyetlerinde meydana gelebilecek hastalık ve/veya sakatlıklar (dağcılık, paraşütle atlama, rodeo, yamaç paraşütü, planör, rafting, sokak kızağı, yükseltten atlama sporları (base jumping gibi), uçurtma ile yapılan sporlar (kiteboarding, kitesurfing gibi), su altı sporları, mağara dalgıçlığı, dağ bisikleti, motosiklet ve otomobil sporları gibi) ile ilgili her türlü gider
5.29. Sigortalı'nın, ehliyetsiz araç kullanımı sonucu olan kazalarının gerektirdiği tedavi masrafları
5.30. Sigortalının hastalık ve/veya rahatsızlık sonucu çalışamaması nedeni ile elde edemediği kazançlar için günlük iş görememe parası
5.31. Sigortalının bakıma ihtiyaç duyması halinde, gündelik bakım parası
5.32. Sigortacı tarafından teminat kapsamında değerlendirilerek kabul edilen ambulans hariç her türlü ulaşım gideri
5.33. GSS hak sahipliği aktif olmayan sigortalılara ait tüm giderler
5.34. Sigortalıların ödemekle yükümlü oldukları SGK Katılım Payı
5.35. SGK ile anlaşmalı olmayan sağlık kurumlarında, SGK ile anlaşmalı olan sağlık kurumlarının anlaşma dışında olan branşlarında, SGK ile anlaşmalı olmayan hekimler tarafından verilen hizmetlere ait her türlü gider
5.36. Prematürite ve Düşük Doğum Ağırlığı ile ilgili sağlık giderleri
5.37. Resmen ilan edilmiş olan salgın hastalıklar ve karantina
5.38. Sağlık Uygulama Tebliği'nde (SUT) yer almayan işlemler
5.39. Uzaktan Sağlık Hizmeti (Teletıp, online verilen hizmetler) kapsamında Sigortacı tarafından bu hizmetler için belirlenen kurumlar dışında gerçekleşen giderler
5.40. Anlaşmasız Kurumlarda gerçekleşen, "Sağlık Uygulama Tebliği, Genel Sağlık Sigortası'nda 'İlave Ücret Alınmayacak Sağlık Hizmetleri'" maddesinde belirtilen sağlık hizmetleri
5.41. Doktor muayenesi ile ilişkisi olmadan gerçekleşen rutin kontrol, teşhis yöntemleri ve tetkikler
5.42. AKSİGORTA A.Ş.'ye ait www.aksigorta.com.tr adresli web sayfasında ''Online İşlemler'' adımı altında bulunan 'Teminat Dışı Kalan Kurumlar Listesi''nde yer alan kurumlara ve doktorlara ait her türlü gider
Sigortacı, uygulamaya yeni alınan, uygulamadan kaldırılan veya değiştirilen tıbbi uygulamaların değişim ve gelişmelerini göz önünde bulundurarak, işbu "Teminat Dışı Kalan Haller"de düzenlemeler yapabilir. Bu durumda yapılabilecek olan değişiklikler, poliçede bulunan, Ömür Boyu Yenileme Garantisi (ÖBYG) hakkı bulunan sigortalılar dahil olmak üzere her bir sigortalı için yeni poliçe başlangıç tarihinden itibaren geçerli olur.

6. COĞRAFİ KAPSAM
Bu sigorta sözleşmesi, Türkiye Cumhuriyeti sınırları içinde geçerlidir. Kuzey Kıbrıs Türk Cumhuriyeti (K.K.T.C.) yurtdışı olarak değerlendirilecektir.

7. SAĞLIK KURUMLARI UYGULAMA ESASLARI
7.1. Anlaşmalı Sağlık Kurumları Ve Network
Anlaşmalı Sağlık Kurumları'na ait güncel listeye, Sigortacı'nın internet sitesi olan www.aksigorta.com.tr adresinden ulaşılabilir. Sigortacı, sigorta süresi içinde, önceden herhangi bir bildirimde bulunmaksızın Anlaşmalı Sağlık Kurumları'nda ve networkte değişiklik yapabilir.
Seçilen Sağlık Kurumu'nun, Anlaşmalı Sağlık Kurumları listesinde yer alması, bu kurumun hizmetlerinin Sigortacı tarafından tavsiye edildiği anlamına gelmeyeceği gibi; bu kurumların hizmetlerinin kalitesi ve tıbbi anlamda doğacak sonuçlarına dair, Sigortacı hiçbir şekilde garanti vermemektedir.
Anlaşmalı Sağlık Kurumu'nda yapılacak sağlık giderleri için, teminat tablosunda belirtilen limit, katılım payı ve muafiyet doğrultusunda, Sigortacı ile Anlaşmalı Sağlık Kurumu arasında yapılan sözleşme kapsamında, doğrudan Anlaşmalı Sağlık Kurumu'na Sigortacı tarafından ödeme yapılacağına dair provizyon verilir.
Sigortalı, Anlaşmalı Sağlık Kurumu'nda Sigortalı olduğunu belirtmek, T.C. kimlik numarasının yazılı olduğu resimli kimlik belgesini ibraz etmek ve teminat tablosunda belirtilen katılım payı, muafiyet tutarı ve limit üzerinde kalan tutarı ödemekle yükümlüdür.

7.2. Anlaşmasız Sağlık Kurumları
SGK ile anlaşmalı olan ancak Sigortacı ile anlaşması olmayan Sağlık Kurumlarında tedavi yapılması halinde, sağlık giderleri öncelikle Sigortalı tarafından ödenir.

7.3. Ödeme Kapsamında Olmayacak Sağlık Kurumları ve Doktorlar
Sigortacı gerek provizyon verilmeyecek gerekse elden hasar olarak değerlendirme kapsamına alınmayacak Sağlık Kuruluşları ve Doktor'lar belirleyebilir.

8. TAZMİNAT ÖDEMELERİ
Anlaşmasız Sağlık Kurumları'nda gerçekleşen sağlık giderlerinin değerlendirilebilmesi için gerekli belgelerin Sigortacı'ya ulaştırılması gerekmektedir (Özel Sağlık Sigortası Hasta Bilgi Formu, fatura asılları, ameliyat raporu/epikriz raporu, tetkik sonuçları vb.).
Tazminat talepleri, işbu Özel Şartlar ile Sağlık Sigortası Genel Şartları çerçevesinde, sunulmuş olan bilgi ve belgeler dikkate alınarak değerlendirilir. Tazminata konu olan sağlık giderinin limit üstü, katılım payı ve/veya muafiyet tutarı olarak değerlendirilen bölümü için Sigortalı'ya ödeme yapılmaz.
Tazminat değerlendirmesi için gerekli tüm bilgi ve belgelerin Sigortacı'ya ulaştığı tarihten itibaren en geç 10 (on) iş günü içinde ödeme yapılır.
Anlaşmasız kurumda gerçekleşen ve tazminat ödemesine konu olan ayakta tedavi, doğum teminatı ve Genel Sağlık Sigortası'nda 'İlave Ücret Alınmayacak Sağlık Hizmetleri' maddesinde belirtilen sağlık hizmetleri kapsamındaki hizmetler poliçe kapsamı dışındadır. İlave ücret alınmayan sağlık hizmetleri: Acil servislerde verilen ve acil haller nedeniyle sunulan sağlık hizmetleri, Yoğun bakım hizmetleri, Yanık tedavisi hizmetleri, Kanser tedavisi (radyoterapi, kemoterapi, radyo izotop tedavileri), Yeni doğana verilen sağlık hizmetleri, Organ, doku ve hücre nakilleri, Doğumsal anomaliler için yapılan cerrahi işlemlere yönelik sağlık hizmetleri, Diyaliz tedavileri, Kardiyovasküler cerrahi işlemler.

9. BEYAN VE İHBAR YÜKÜMLÜLÜĞÜ
Sigortacı, sigorta sözleşmesinin kurulması aşamasında Sigortalı ve/veya Sigorta Ettiren'in ilk başvurusunda başvuru ve beyan formunda beyan ettiği tüm bilgileri, sigorta sözleşmesinin yenilenmesi aşamasında ise Sigortalı'nın yıl içindeki tazminatlarını ve sağlık durumunu esas alarak değerlendirme yapar. Beyanın gerçeğe aykırı veya eksik olması ve/veya beyan yükümlülüğünün yerine getirilmemesi durumunda ilgili durumun tespit edildiği tarih itibariyle sigorta sözleşmesi şartları yeniden düzenlenebilir; ödenen tazminatların iadesi, sözleşme şartlarının yeniden belirlenmesi (muafiyet, ek prim, limit vb.) ve sigorta sözleşmesinin iptali söz konusu olabilir.

10. SÖZLEŞMENİN YENİLENMESİ VE ÖMÜR BOYU YENİLEME GARANTİSİ
10.1. Sözleşmenin yenilenmesi, sigorta bitiş tarihinden itibaren en geç 30 gün içerisinde yeniden sözleşme yapılmasını ifade eder. Sigorta Ettiren ve/veya Sigortalı tarafından aksi yazılı olarak talep edilmedikçe Sigortacı, sona eren sözleşmeyi bitiş tarihi itibariyle otomatik olarak yenileyebilir.
10.2. Ömür Boyu Yenileme Garantisi (ÖBYG): Sigortalı'nın, kesintisiz üç yıl sigortalı kaldığı ve bu süre içerisinde "Azami İyi Niyet Prensibi" ilkesine uygun davrandığı durumlarda, Risk Değerlendirme Birimi tarafından yapılacak tıbbi ve teknik değerlendirme sonucuna göre sigortalanması uygun görülen kişilere verilebilir. ÖBYG hakkı verildikten sonra, Sigortacı, Sigortalı'nın ortaya çıkacak yeni rahatsızlık ve hastalıklarından dolayı Sigortalı'ya yeni ek şart (muafiyet, limit, ek prim, katılım, bekleme süresi vb.) uygulamayacaktır. ÖBYG kişiye özel bir hak olup, hakkı kazanmış Sigortalıya aittir.

11. PRİM TESPİTİ
İlk defa sigortalanacak kişilerin prim tespitinde, ürün tarife fiyatı baz alınır. Yenileme priminde, aynı yaş ve cinsiyetteki ilk defa sigortalanacak sağlıklı bir sigortalı için geçerli olan tarife fiyatının 5 katını geçemez. (Aile indirimi, ödeme planı indirimi, tazminat/prim oranına bağlı indirim gibi çeşitli indirim/ek prim düzenlemeleri uygulanabilir.)

12. SİGORTAYA KABUL UYGULAMALARI
Bu sigorta ile Türkiye Cumhuriyeti sınırları içerisinde ikamet eden, başvuru tarihinde 14 gün ile 65 yaş aralığındaki kişiler sigortalanabilmektedir.

13. GEÇİŞ İŞLEMLERİ VE KAZANILMIŞ HAKLAR
Diğer sigorta şirketlerinde herhangi bir Sağlık Sigorta Poliçesi kapsamında bulunan kişilerin, diğer sigorta şirketinden ayrılarak, Sigortacı'dan Tamamlayıcı Sağlık Sigortası almak istediği durumlarda, sigortalı olduğu önceki şirketinden kazanılmış haklarını gösteren belgelerin Sigortacı'ya iletilmesi gerekmektedir. Diğer sigorta şirketindeki poliçe bitiş tarihini takip eden ilk otuz (30) gün içerisinde Sigortacı'ya Başvuru ve Bilgilendirme Formu doldurularak başvurması gerekmektedir.

14. SİGORTA SÜRESİ VE SİGORTA SÖZLEŞMESİNİN SONA ERMESİ
14.1. Sigorta sözleşmesinin yürürlükte olduğu dönemi ifade eder. Sigortanın süresi 1 yıldır.
14.2. Sigorta teminatları, başvurunun Sigortacı tarafından onaylanması ve poliçe priminin tamamının veya taksitli ödenmesi kararlaştırıldı ise ilk taksitinin ödenmesi ile yürürlüğe girer.
14.3. İptal ve Çıkış İşlemleri: Sigorta Ettiren ve/veya Sigortalı, poliçenin başlangıç tarihinden itibaren ilk 30 gün içerisinde yazılı olarak iptal talebinde bulunması halinde, risk gerçekleşmemiş ve bu talep tarihine kadar yapılmış herhangi bir tazminat talebinin olmaması durumunda, ödenen primler kesintisiz olarak Sigorta Ettiren'e iade edilir.
14.4. Vefat Durumu: Sigorta Ettiren'in vefatı durumunda, sigorta sözleşmesi geçersiz hale gelir (Sigortalı'ların Sigorta Ettiren'i değiştirerek sözleşmeyi devam ettirme talebi olmadıkça).
`.trim();

const SISTEM_TALIMATI = `Sen WE Sigorta'nın WhatsApp asistanısın. Sana verilen "AKSİGORTA TAMAMLAYICI SAĞLIK SİGORTASI ÖZEL ŞARTLARI" belgesine dayanarak, müşterinin TSS (Tamamlayıcı Sağlık Sigortası) hakkındaki sorusunu cevaplıyorsun.

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
    console.error("TSS soru-cevap: ANTHROPIC_API_KEY tanımlı değil - fallback mesajı dönülüyor.");
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
    console.error("TSS soru-cevap API hatası:", err.message);
    return DANISMAN_YONLENDIRME_MESAJI;
  }
}

module.exports = { soruyaCevapVer, DANISMAN_YONLENDIRME_MESAJI };
