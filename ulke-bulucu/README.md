# Ülke Bulucu (Android)

Ekranda seçtiğiniz küçük bir alana art arda **3 kez** dokununca ekran görüntüsünü alır,
Gemini'ye gönderir ve yerin hangi ülkede olduğunu ekranın altında **soluk bir yazıyla** gösterir.

- Android 11 ve üstü gerekir.
- API anahtarı koda yazılmaz; uygulamanın içinden girilir (bu yüzden depo herkese açık olsa bile anahtar görünmez).

## APK nasıl oluşur?
Bu depoya her dosya yüklendiğinde GitHub **Actions** sekmesinde "APK olustur" işi otomatik çalışır.
Bitince işin sayfasının altındaki **Artifacts** bölümünden `UlkeBulucu-APK` indirilir (içinden `app-debug.apk` çıkar).

## Telefonda kurulum
1. `app-debug.apk` dosyasını telefona atıp açın, "bilinmeyen kaynaklara izin ver" deyin.
2. Uygulamayı açın, Gemini anahtarını yapıştırın, alan yerini seçin, **Kaydet**.
3. **Erişilebilirlik ayarlarını aç** → Yüklü uygulamalar → **Ülke Bulucu** → aç.
   - "Kısıtlı ayar" uyarısı çıkarsa: Ayarlar → Uygulamalar → Ülke Bulucu → sağ üstteki ⋮ → **Kısıtlı ayarlara izin ver**, sonra tekrar deneyin.
4. Kırmızı kareye art arda 3 kez dokunun. Yerini beğendiyseniz uygulamada "Alanı kırmızı göster" işaretini kaldırıp Kaydet'e basın.
