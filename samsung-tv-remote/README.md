# TV Remote Samsung

Samsung Smart TV (Tizen, 2016+) için Android kumanda uygulaması. Capacitor ile yazıldı.

## Özellikler
- Rakam tuşları / yön tuşları, CH, VOL, sessiz, renkli tuşlar, menü, kaynak, HDMI ve diğerleri
- Basılı tutunca tekrar (ses, kanal, yön), titreşim geri bildirimi
- **Wi‑Fi taraması:** SSDP + yerel ağ taraması, TV `http://IP:8001/api/v2/` ile doğrulanır
- **Bluetooth taraması:** yakındaki TV'leri listeler (komutlar Wi‑Fi üzerinden gönderilir)
- İlk açılışta bağlantı kılavuzu ve **Bir daha gösterme** düğmesi
- Açıkça etiketlenmiş **Demo modu** (TV olmadan arayüzü denemek için)
- IP ile elle bağlanma, ilk bağlantıdan sonra TV izni (token) kaydedilir

## APK indir
[Releases](https://github.com/Ruslan7y/ss/releases) sayfasından en son `TV-Remote-Samsung.apk` dosyasını indirip telefona kurun.
Her `main` push'unda GitHub Actions APK'yı otomatik derler.

## Yerelde derleme
```bash
npm ci
npm run sync
cd android && ./gradlew assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## Yapı
- `www/` – arayüz (HTML/CSS/JS)
- `android/app/src/main/java/com/ruslan/tvremote/SamsungTvPlugin.java` – Wi‑Fi tarama ve TV WebSocket bağlantısı
