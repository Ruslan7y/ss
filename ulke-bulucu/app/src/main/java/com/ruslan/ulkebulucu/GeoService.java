package com.ruslan.ulkebulucu;

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
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ekranda görünmez küçük bir alan açar. O alana art arda 3 kez dokunulunca
 * ekran görüntüsünü alır, Gemini'ye gönderir ve cevabı ekranın altında soluk yazıyla gösterir.
 */
public class GeoService extends AccessibilityService {

    private static final String[] MODELLER = {
            "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest",
            "gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"
    };

    private static final String TALIMAT =
            "Bu bir ekran görüntüsü; büyük ihtimalle bir sokak görünümü (Street View / GeoGuessr). "
            + "Görünen yerin hangi ülkede olduğunu bul. Şu ipuçlarını kullan: tabelalardaki yazı ve dil, "
            + "telefon numarası biçimi, plakalar, trafiğin hangi şeritten aktığı, yol çizgileri, "
            + "trafik işaretleri, elektrik direkleri, araç modelleri, bitki örtüsü ve mimari. "
            + "Cevabı Türkçe ve tam olarak şu biçimde, çok kısa ver:\n"
            + "Ülke: ...\n"
            + "Bölge/şehir (tahmin): ...\n"
            + "İpuçları: en fazla 2 kısa madde";

    private static final int GOSTERME_SURESI_MS = 15000;

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

    /** Gemini'den gelen hata kodu (404, 429 vb.) */
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
        yaziGoster("Ülke Bulucu hazır");
    }

    // ---------------- Dokunma alanı ----------------

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
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);

        String k = prefs.getString("konum", "sag-orta");
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
            ekranGoruntusuAl();
        }
    }

    // ---------------- Ekran görüntüsü ----------------

    private void ekranGoruntusuAl() {
        if (mesgul) return;
        mesgul = true;
        if (yazi != null) {  // Eski cevap yazısı yeni görüntüye girmesin
            try {
                wm.removeView(yazi);
            } catch (Exception ignored) {
            }
            yazi = null;
        }
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
                if (kopya == null) {
                    mesgul = false;
                    yaziGoster("Ekran görüntüsü alınamadı");
                    return;
                }
                final Bitmap resim = kopya;
                ag.execute(() -> gonder(resim));
            }

            @Override
            public void onFailure(int hataKodu) {
                mesgul = false;
                yaziGoster("Ekran görüntüsü alınamadı (" + hataKodu + ")");
            }
        });
    }

    // ---------------- Gemini ----------------

    private void gonder(Bitmap resim) {
        String cevap;
        try {
            String anahtar = prefs.getString("anahtar", "").trim();
            if (anahtar.isEmpty()) {
                yaziGoster("Önce uygulamada API anahtarını girin");
                return;
            }

            int w = resim.getWidth(), h = resim.getHeight();
            float olcek = Math.min(1f, 1280f / Math.max(w, h));
            Bitmap kucuk = Bitmap.createScaledBitmap(resim,
                    Math.max(1, Math.round(w * olcek)), Math.max(1, Math.round(h * olcek)), true);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            kucuk.compress(Bitmap.CompressFormat.JPEG, 80, bos);
            String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);

            StringBuilder hatalar = new StringBuilder();
            cevap = null;
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
                    else if (e.kod == 429) atlanacak.put(model, System.currentTimeMillis() + 600_000L);
                    hatalar.append(model).append(": ").append(e.kod).append('\n');
                } catch (Exception e) {
                    hatalar.append(model).append(": ").append(e.getClass().getSimpleName()).append('\n');
                }
            }
            if (cevap == null || cevap.trim().isEmpty()) {
                cevap = "Hata:\n" + hatalar.toString().trim();
            }
        } catch (Exception e) {
            cevap = "Hata: " + e.getMessage();
        } finally {
            mesgul = false;
        }
        yaziGoster(cevap.trim());
    }

    private String istek(String model, String anahtar, String b64, boolean hizli) throws Exception {
        URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/"
                + model + ":generateContent");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("x-goog-api-key", anahtar);

        JSONArray parcalar = new JSONArray();
        parcalar.put(new JSONObject().put("inline_data",
                new JSONObject().put("mime_type", "image/jpeg").put("data", b64)));
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

    // ---------------- Soluk yazı ----------------

    private void yaziGoster(String metin) {
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
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(56);

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
            }, GOSTERME_SURESI_MS);
        });
    }

    // ---------------- Zorunlu metotlar ----------------

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
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
