package com.ruslan.smarttv;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.HardwareBuffer;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Smart TV servisi.
 * - Seçili oyun uygulaması öne gelince altta 1 sn "+" gösterir.
 * - Oyundayken ekranı düzenli olarak (sadece telefonda, hiçbir yere göndermeden) kontrol eder;
 *   yeni bir fotoğraf/tur gelince ekran görüntüsünü Gemini'ye gönderir ve altta kısa "0" gösterir.
 * - Cevabı ülke adının ilk iki harfi olarak altta soluk yazıyla gösterir.
 * - Seçilen alana 3 kez dokunarak elle de çalıştırılabilir.
 */
public class TvServisi extends AccessibilityService {

    private static final String[] MODELLER = {
            "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest",
            "gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"
    };

    private static final String TALIMAT =
            "Bu bir telefon ekran görüntüsü. Ekranda bir sokak görünümü / dış mekân fotoğrafı varsa "
            + "görünen yerin hangi ülkede olduğunu bul. Tabelalardaki yazı ve dil, telefon numarası biçimi, plakalar, "
            + "trafiğin hangi şeritten aktığı, yol çizgileri, trafik işaretleri, elektrik direkleri, araç modelleri, "
            + "bitki örtüsü ve mimari gibi ipuçlarını kullan. "
            + "Cevap olarak SADECE ülkenin Türkçe adını yaz (örneğin: Tayland). "
            + "Ekranda böyle bir fotoğraf yoksa (menü, harita, skor ekranı gibi) sadece YOK yaz. Başka hiçbir şey yazma.";

    private static final int CEVAP_SURESI_MS = 15000;
    private static final long KONTROL_ARALIGI_MS = 1500;     // oyundayken ekran kontrol sıklığı
    private static final long OTOMATIK_BEKLEME_MS = 20000;   // aynı turda tekrar göndermeden önce bekleme
    private static final Pattern TUR_DESENI =
            Pattern.compile("(ROUND|TUR|RAUND|RUNDE)\\D{0,4}(\\d+)\\s*/\\s*(\\d+)", Pattern.CASE_INSENSITIVE);

    private final Handler ana = new Handler(Looper.getMainLooper());
    private final ExecutorService ag = Executors.newSingleThreadExecutor();
    private final Map<String, Long> atlanacak = new HashMap<>();

    private WindowManager wm;
    private SharedPreferences prefs;
    private SharedPreferences.OnSharedPreferenceChangeListener dinleyici;
    private View dokunmaAlani;
    private TextView yazi;

    private long sonDokunma = 0;
    private int dokunmaSayisi = 0;
    private volatile boolean mesgul = false;

    // Otomatik mod durumu
    private boolean oyunda = false;
    private int[] oncekiImza, gonderilenImza;
    private int sabitSayac = 0;
    private long sonGonderim = 0, sonMetinKontrol = 0;
    private String sonTurMetni = null;
    private boolean metinModu = false, turDegisti = false;
    private volatile boolean kareAliniyor = false;

    private final Runnable kontrolDongusu = new Runnable() {
        @Override
        public void run() {
            if (!oyunda) return;
            if (prefs.getBoolean("otomatik", true) && !mesgul && !kareAliniyor) kareKontrol();
            ana.postDelayed(this, KONTROL_ARALIGI_MS);
        }
    };

    private static class ApiHata extends Exception {
        final int kod;

        ApiHata(int kod, String mesaj) {
            super(mesaj);
            this.kod = kod;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        dinleyici = (sp, anahtar) -> ana.post(this::alaniYerlestir);
        prefs.registerOnSharedPreferenceChangeListener(dinleyici);
        alaniYerlestir();
    }

    // ---------------- Oyun algılama ----------------

    private boolean oyunMu(String paket) {
        String sec = prefs.getString("oyunPaket", "");
        if (sec.isEmpty()) return paket.toLowerCase(Locale.ROOT).contains("geoguessr");
        return paket.equals(sec);
    }

    private boolean gozArdi(String paket) {
        return paket.equals(getPackageName()) || paket.equals("com.android.systemui") || paket.equals("android")
                || paket.contains("inputmethod") || paket.contains("keyboard") || paket.contains("honeyboard");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || prefs == null || e.getPackageName() == null) return;
        String paket = e.getPackageName().toString();
        int tip = e.getEventType();
        if (tip == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            if (oyunMu(paket)) {
                if (!oyunda) oyunaGirildi();
            } else if (!gozArdi(paket)) {
                if (oyunda) oyundanCikildi();
            }
        }
        if (oyunda && oyunMu(paket)) turMetniKontrol();
    }

    private void oyunaGirildi() {
        oyunda = true;
        oncekiImza = null; gonderilenImza = null; sabitSayac = 0;
        sonTurMetni = null; metinModu = false; turDegisti = false; sonGonderim = 0;
        yaziGoster("+", 1000);
        ana.removeCallbacks(kontrolDongusu);
        ana.postDelayed(kontrolDongusu, 1200);
    }

    private void oyundanCikildi() {
        oyunda = false;
        ana.removeCallbacks(kontrolDongusu);
    }

    /** Ekrandaki "ROUND 2/5" gibi yazıyı bulmaya çalışır; değişince yeni tur demektir. */
    @SuppressWarnings("deprecation")
    private void turMetniKontrol() {
        long simdi = SystemClock.uptimeMillis();
        if (simdi - sonMetinKontrol < 800) return;
        sonMetinKontrol = simdi;
        AccessibilityNodeInfo kok;
        try {
            kok = getRootInActiveWindow();
        } catch (Exception ex) {
            return;
        }
        if (kok == null) return;
        String bulunan = null;
        ArrayDeque<AccessibilityNodeInfo> kuyruk = new ArrayDeque<>();
        kuyruk.add(kok);
        int sayac = 0;
        while (!kuyruk.isEmpty() && sayac < 600 && bulunan == null) {
            AccessibilityNodeInfo n = kuyruk.poll();
            sayac++;
            if (n == null) continue;
            CharSequence t = n.getText();
            if (t == null) t = n.getContentDescription();
            if (t != null) {
                Matcher m = TUR_DESENI.matcher(t);
                if (m.find()) bulunan = m.group(2) + "/" + m.group(3);
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo c = n.getChild(i);
                if (c != null) kuyruk.add(c);
            }
        }
        if (bulunan != null) {
            metinModu = true;
            if (!bulunan.equals(sonTurMetni)) {
                sonTurMetni = bulunan;
                turDegisti = true;
                sabitSayac = 0;
            }
        }
    }

    // ---------------- Otomatik kontrol ----------------

    /** Ekranın 16x12 gri tonlu özeti: sahnenin değişip değişmediğini anlamak için */
    private static int[] imza(Bitmap b) {
        Bitmap k = Bitmap.createScaledBitmap(b, 16, 12, true);
        int[] p = new int[16 * 12];
        k.getPixels(p, 0, 16, 0, 0, 16, 12);
        for (int i = 0; i < p.length; i++) {
            int c = p[i];
            p[i] = (((c >> 16) & 255) * 3 + ((c >> 8) & 255) * 6 + (c & 255)) / 10;
        }
        k.recycle();
        return p;
    }

    private static int fark(int[] a, int[] b) {
        if (a == null || b == null) return 255;
        long s = 0;
        for (int i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return (int) (s / a.length);
    }

    private void kareKontrol() {
        kareAliniyor = true;
        ekranAl(bmp -> {
            kareAliniyor = false;
            if (bmp == null || !oyunda) return;
            int[] im = imza(bmp);
            boolean sabit = fark(im, oncekiImza) < 7;
            oncekiImza = im;
            sabitSayac = sabit ? sabitSayac + 1 : 0;
            long simdi = SystemClock.uptimeMillis();
            boolean yeniSahne = fark(im, gonderilenImza) > 35;
            boolean gonder;
            if (metinModu) gonder = turDegisti && sabitSayac >= 1;
            else gonder = yeniSahne && sabitSayac >= 1 && simdi - sonGonderim > OTOMATIK_BEKLEME_MS;
            if (gonder && !mesgul) {
                turDegisti = false;
                gonderilenImza = im;
                sonGonderim = simdi;
                gonderBaslat(bmp);
            } else {
                bmp.recycle();
            }
        });
    }

    // ---------------- Elle çalıştırma alanı ----------------

    private void alaniYerlestir() {
        if (wm == null) return;
        if (dokunmaAlani != null) {
            try {
                wm.removeView(dokunmaAlani);
            } catch (Exception ignored) {
            }
            dokunmaAlani = null;
        }
        View v = new View(this);
        v.setBackgroundColor(prefs.getBoolean("goster", true) ? 0x66FF0000 : 0x00000000);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                dp(64), dp(64),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        String k = prefs.getString("konum", "orta");
        int g;
        if (k.startsWith("sol")) g = Gravity.LEFT;
        else if (k.startsWith("sag")) g = Gravity.RIGHT;
        else g = Gravity.CENTER_HORIZONTAL;
        if (k.endsWith("ust")) {
            g |= Gravity.TOP;
            lp.y = dp(80);
        } else if (k.endsWith("alt")) {
            g |= Gravity.BOTTOM;
            lp.y = dp(140);
        } else {
            g |= Gravity.CENTER_VERTICAL;
        }
        lp.gravity = g;
        v.setOnTouchListener((view, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) dokunuldu();
            return true;
        });
        try {
            wm.addView(v, lp);
            dokunmaAlani = v;
        } catch (Exception ignored) {
        }
    }

    private void dokunuldu() {
        long simdi = SystemClock.uptimeMillis();
        if (simdi - sonDokunma > 500) dokunmaSayisi = 0;
        sonDokunma = simdi;
        dokunmaSayisi++;
        if (dokunmaSayisi >= 3) {
            dokunmaSayisi = 0;
            if (mesgul) return;
            ekranAl(bmp -> {
                if (bmp == null) {
                    yaziGoster("!", 1500);
                    return;
                }
                gonderilenImza = imza(bmp);
                sonGonderim = SystemClock.uptimeMillis();
                gonderBaslat(bmp);
            });
        }
    }

    // ---------------- Ekran görüntüsü ----------------

    private interface KareGeri {
        void al(Bitmap b);
    }

    private void ekranAl(KareGeri geri) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult sonuc) {
                    Bitmap kopya = null;
                    try (HardwareBuffer hb = sonuc.getHardwareBuffer()) {
                        Bitmap hw = Bitmap.wrapHardwareBuffer(hb, sonuc.getColorSpace());
                        if (hw != null) {
                            kopya = hw.copy(Bitmap.Config.ARGB_8888, false);
                            hw.recycle();
                        }
                    } catch (Exception ignored) {
                    }
                    geri.al(kopya);
                }

                @Override
                public void onFailure(int hataKodu) {
                    geri.al(null);
                }
            });
        } catch (Exception e) {
            geri.al(null);
        }
    }

    private void gonderBaslat(Bitmap bmp) {
        mesgul = true;
        yaziGoster("0", 1200);   // görüntü alındıktan sonra gösterilir, resme girmez
        ag.execute(() -> gonder(bmp));
    }

    // ---------------- Gemini ----------------

    private void gonder(Bitmap resim) {
        String gosterilecek = null;
        try {
            String anahtar = prefs.getString("anahtar", "").trim();
            if (anahtar.isEmpty()) {
                gosterilecek = "!A";   // anahtar yok
                return;
            }
            int w = resim.getWidth(), h = resim.getHeight();
            float olcek = Math.min(1f, 1280f / Math.max(w, h));
            Bitmap kucuk = Bitmap.createScaledBitmap(resim,
                    Math.max(1, Math.round(w * olcek)), Math.max(1, Math.round(h * olcek)), true);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            kucuk.compress(Bitmap.CompressFormat.JPEG, 80, bos);
            String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);

            String cevap = null;
            boolean kota = false;
            for (String model : MODELLER) {
                Long sinir = atlanacak.get(model);
                if (sinir != null && sinir > System.currentTimeMillis()) continue;
                try {
                    try {
                        cevap = istek(model, anahtar, b64, true);
                    } catch (ApiHata e) {
                        if (e.kod == 400) cevap = istek(model, anahtar, b64, false);
                        else throw e;
                    }
                    if (cevap != null && !cevap.trim().isEmpty()) break;
                } catch (ApiHata e) {
                    if (e.kod == 404) atlanacak.put(model, Long.MAX_VALUE);
                    else if (e.kod == 429) { atlanacak.put(model, System.currentTimeMillis() + 600_000L); kota = true; }
                } catch (Exception ignored) {
                }
            }
            if (cevap == null || cevap.trim().isEmpty()) {
                gosterilecek = kota ? "!Q" : "!";   // Q: kota doldu
            } else if (cevap.trim().toUpperCase(new Locale("tr", "TR")).startsWith("YOK")) {
                gosterilecek = null;               // fotoğraf yok: hiçbir şey gösterme
            } else {
                gosterilecek = ilkIkiHarf(cevap);
            }
        } catch (Exception e) {
            gosterilecek = "!";
        } finally {
            mesgul = false;
            resim.recycle();
            if (gosterilecek != null) yaziGoster(gosterilecek, CEVAP_SURESI_MS);
        }
    }

    /** "Tayland" -> "TA". Sadece harfler sayılır. */
    private static String ilkIkiHarf(String metin) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < metin.length() && sb.length() < 2; i++) {
            char c = metin.charAt(i);
            if (Character.isLetter(c)) sb.append(c);
        }
        if (sb.length() == 0) return "?";
        return sb.toString().toUpperCase(new Locale("tr", "TR"));
    }

    private String istek(String model, String anahtar, String b64, boolean hizli) throws Exception {
        URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("x-goog-api-key", anahtar);

        JSONArray parcalar = new JSONArray();
        parcalar.put(new JSONObject().put("inline_data", new JSONObject().put("mime_type", "image/jpeg").put("data", b64)));
        parcalar.put(new JSONObject().put("text", TALIMAT));
        JSONObject govde = new JSONObject();
        govde.put("contents", new JSONArray().put(new JSONObject().put("parts", parcalar)));
        if (hizli) {
            JSONObject dusunme = new JSONObject();
            if (model.startsWith("gemini-2.5")) dusunme.put("thinkingBudget", 0);
            else dusunme.put("thinkingLevel", "low");
            govde.put("generationConfig", new JSONObject().put("thinkingConfig", dusunme));
        }
        try (OutputStream os = c.getOutputStream()) {
            os.write(govde.toString().getBytes(StandardCharsets.UTF_8));
        }
        int kod = c.getResponseCode();
        InputStream is = kod >= 400 ? c.getErrorStream() : c.getInputStream();
        String yanit = oku(is);
        c.disconnect();
        if (kod >= 400) throw new ApiHata(kod, yanit);

        JSONObject j = new JSONObject(yanit);
        JSONArray adaylar = j.optJSONArray("candidates");
        if (adaylar == null || adaylar.length() == 0) return null;
        JSONObject icerik = adaylar.getJSONObject(0).optJSONObject("content");
        if (icerik == null) return null;
        JSONArray p = icerik.optJSONArray("parts");
        if (p == null) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < p.length(); i++) {
            JSONObject parca = p.getJSONObject(i);
            if (parca.optBoolean("thought", false)) continue;
            sb.append(parca.optString("text", ""));
        }
        return sb.toString();
    }

    private static String oku(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] tampon = new byte[8192];
        int n;
        while ((n = is.read(tampon)) > 0) bos.write(tampon, 0, n);
        is.close();
        return bos.toString("UTF-8");
    }

    // ---------------- Alttaki soluk yazı ----------------

    private void yaziGoster(String metin, int sureMs) {
        ana.post(() -> {
            if (wm == null) return;
            if (yazi != null) {
                try {
                    wm.removeView(yazi);
                } catch (Exception ignored) {
                }
                yazi = null;
            }
            final TextView t = new TextView(this);
            t.setText(metin);
            t.setTextSize(12);
            t.setTextColor(0xFFE6E6E6);
            t.setBackgroundColor(0x55000000);
            t.setPadding(dp(8), dp(4), dp(8), dp(4));
            t.setMaxWidth(dp(320));
            t.setAlpha(prefs.getInt("saydamlik", 60) / 100f);

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(56);

            // Yazıya art arda 2 kez dokununca kapanır
            final long[] son = {0};
            t.setOnTouchListener((view, e) -> {
                if (e.getAction() == MotionEvent.ACTION_DOWN) {
                    long simdi = SystemClock.uptimeMillis();
                    if (simdi - son[0] < 400) {
                        try {
                            wm.removeView(t);
                        } catch (Exception ignored) {
                        }
                        if (yazi == t) yazi = null;
                        son[0] = 0;
                    } else {
                        son[0] = simdi;
                    }
                }
                return true;
            });

            try {
                wm.addView(t, lp);
                yazi = t;
            } catch (Exception ignored) {
                return;
            }
            ana.postDelayed(() -> {
                if (yazi == t) {
                    try {
                        wm.removeView(t);
                    } catch (Exception ignored) {
                    }
                    yazi = null;
                }
            }, sureMs);
        });
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        ana.removeCallbacks(kontrolDongusu);
        if (prefs != null && dinleyici != null) prefs.unregisterOnSharedPreferenceChangeListener(dinleyici);
        if (wm != null) {
            try {
                if (dokunmaAlani != null) wm.removeView(dokunmaAlani);
            } catch (Exception ignored) {
            }
            try {
                if (yazi != null) wm.removeView(yazi);
            } catch (Exception ignored) {
            }
        }
        ag.shutdownNow();
        super.onDestroy();
    }
}
