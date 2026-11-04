package com.ruslan.smarttv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Ayar ekranı: anahtar, oyun uygulaması, otomatik mod, dokunma alanı, yazı görünürlüğü. */
public class MainActivity extends Activity {

    static final String PREFS = "ayarlar";

    static final String[] KONUMLAR = {
            "orta", "sag-ust", "sol-ust", "orta-ust", "sag-orta", "sol-orta", "sag-alt", "sol-alt"
    };
    static final String[] KONUM_ADLARI = {
            "Tam orta", "Sağ üst", "Sol üst", "Orta üst", "Sağ orta", "Sol orta", "Sağ alt", "Sol alt"
    };

    private String secilenPaket;
    private Button oyunBtn;

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView baslik(String metin) {
        TextView t = new TextView(this);
        t.setText(metin);
        t.setTextSize(16);
        t.setPadding(0, dp(18), 0, dp(6));
        return t;
    }

    /** Yüklü uygulamalar (ad, paket), ada göre sıralı */
    private List<String[]> uygulamalar() {
        PackageManager pm = getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        List<String[]> liste = new ArrayList<>();
        for (ResolveInfo r : pm.queryIntentActivities(i, 0)) {
            String paket = r.activityInfo.packageName;
            if (paket.equals(getPackageName())) continue;
            liste.add(new String[]{String.valueOf(r.loadLabel(pm)), paket});
        }
        Collections.sort(liste, (a, b) -> a[0].compareToIgnoreCase(b[0]));
        return liste;
    }

    private String uygulamaAdi(String paket) {
        if (paket == null || paket.isEmpty()) return "otomatik (GeoGuessr)";
        for (String[] u : uygulamalar()) if (u[1].equals(paket)) return u[0];
        return paket;
    }

    /** Şifre düz metin saklanmaz, özeti (SHA-256) saklanır */
    static String ozet(String s) {
        try {
            byte[] b = MessageDigest.getInstance("SHA-256").digest(("smarttv:" + s).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) {
            return s;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!p.getString("sifre", "").isEmpty()) sifreEkrani(p);
        else ayarlarEkrani(p);
    }

    private void sifreEkrani(final SharedPreferences p) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(32), dp(80), dp(32), dp(32));
        TextView t = new TextView(this);
        t.setText("Smart TV");
        t.setTextSize(24);
        l.addView(t);
        TextView a = new TextView(this);
        a.setText("Devam etmek için şifreyi girin");
        a.setPadding(0, dp(12), 0, dp(8));
        l.addView(a);
        final EditText giris = new EditText(this);
        giris.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        giris.setHint("Şifre");
        l.addView(giris);
        Button ac = new Button(this);
        ac.setText("Aç");
        ac.setOnClickListener(v -> {
            if (ozet(giris.getText().toString()).equals(p.getString("sifre", ""))) ayarlarEkrani(p);
            else {
                giris.setText("");
                Toast.makeText(this, "Şifre yanlış", Toast.LENGTH_SHORT).show();
            }
        });
        l.addView(ac);
        setContentView(l);
    }

    private void ayarlarEkrani(final SharedPreferences p) {

        // İlk açılışta GeoGuessr yüklüyse onu seç
        secilenPaket = p.getString("oyunPaket", "");
        if (secilenPaket.isEmpty()) {
            for (String[] u : uygulamalar()) {
                if (u[1].toLowerCase().contains("geoguessr") || u[0].toLowerCase().contains("geoguessr")) { secilenPaket = u[1]; break; }
            }
        }

        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(20), dp(20), dp(20), dp(40));

        TextView ad = new TextView(this);
        ad.setText("Smart TV");
        ad.setTextSize(24);
        l.addView(ad);

        l.addView(baslik("1) Gemini API anahtarı"));
        final EditText anahtar = new EditText(this);
        anahtar.setHint("AQ.... (AI Studio'dan Copy key ile yapıştırın)");
        anahtar.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        anahtar.setText(p.getString("anahtar", ""));
        l.addView(anahtar);

        l.addView(baslik("2) Oyun uygulaması"));
        oyunBtn = new Button(this);
        oyunBtn.setText("Seçili: " + uygulamaAdi(secilenPaket));
        oyunBtn.setOnClickListener(v -> {
            final List<String[]> liste = uygulamalar();
            String[] adlar = new String[liste.size() + 1];
            adlar[0] = "Otomatik (adında GeoGuessr geçen)";
            for (int k = 0; k < liste.size(); k++) adlar[k + 1] = liste.get(k)[0];
            new AlertDialog.Builder(this)
                    .setTitle("Oyun uygulamasını seçin")
                    .setItems(adlar, (d, n) -> {
                        secilenPaket = n == 0 ? "" : liste.get(n - 1)[1];
                        oyunBtn.setText("Seçili: " + uygulamaAdi(secilenPaket));
                    })
                    .show();
        });
        l.addView(oyunBtn);

        final CheckBox otomatik = new CheckBox(this);
        otomatik.setText("Otomatik: oyunda her yeni fotoğrafta kendiliğinden çalış");
        otomatik.setChecked(p.getBoolean("otomatik", true));
        l.addView(otomatik);

        l.addView(baslik("3) Elle çalıştırma alanı (3 kez dokunma)"));
        final RadioGroup konumlar = new RadioGroup(this);
        String secili = p.getString("konum", "orta");
        for (int i = 0; i < KONUMLAR.length; i++) {
            RadioButton r = new RadioButton(this);
            r.setText(KONUM_ADLARI[i]);
            r.setId(1000 + i);
            konumlar.addView(r);
            if (KONUMLAR[i].equals(secili)) r.setChecked(true);
        }
        l.addView(konumlar);

        final CheckBox goster = new CheckBox(this);
        goster.setText("Alanı kırmızı göster (yerini görmek için; sonra kapatın)");
        goster.setChecked(p.getBoolean("goster", true));
        l.addView(goster);

        l.addView(baslik("4) Alttaki yazının görünürlüğü"));
        final TextView saydamYazi = new TextView(this);
        final SeekBar saydam = new SeekBar(this);
        saydam.setMax(80);
        saydam.setProgress(p.getInt("saydamlik", 60) - 20);
        saydamYazi.setText("Görünürlük: %" + p.getInt("saydamlik", 60));
        saydam.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int v, boolean user) {
                saydamYazi.setText("Görünürlük: %" + (v + 20));
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
            }
        });
        l.addView(saydamYazi);
        l.addView(saydam);

        l.addView(baslik("5) Uygulama şifresi"));
        final EditText sifre = new EditText(this);
        sifre.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        sifre.setHint(p.getString("sifre", "").isEmpty() ? "Şifre yok – yeni şifre yazın (sadece rakam)" : "Şifre var – değiştirmek için yenisini yazın");
        l.addView(sifre);
        final CheckBox sifreKaldir = new CheckBox(this);
        sifreKaldir.setText("Şifreyi kaldır");
        if (!p.getString("sifre", "").isEmpty()) l.addView(sifreKaldir);

        Button kaydet = new Button(this);
        kaydet.setText("Kaydet");
        kaydet.setOnClickListener(v -> {
            int id = konumlar.getCheckedRadioButtonId();
            String konum = (id >= 1000 && id < 1000 + KONUMLAR.length) ? KONUMLAR[id - 1000] : "orta";
            p.edit()
                    .putString("anahtar", anahtar.getText().toString().trim())
                    .putString("oyunPaket", secilenPaket)
                    .putBoolean("otomatik", otomatik.isChecked())
                    .putString("konum", konum)
                    .putBoolean("goster", goster.isChecked())
                    .putInt("saydamlik", saydam.getProgress() + 20)
                    .apply();
            String yeni = sifre.getText().toString().trim();
            if (sifreKaldir.isChecked()) p.edit().putString("sifre", "").apply();
            else if (!yeni.isEmpty()) {
                if (yeni.length() < 4) {
                    Toast.makeText(this, "Şifre en az 4 rakam olmalı", Toast.LENGTH_SHORT).show();
                    return;
                }
                p.edit().putString("sifre", ozet(yeni)).apply();
                sifre.setText("");
            }
            Toast.makeText(this, "Kaydedildi", Toast.LENGTH_SHORT).show();
        });
        l.addView(kaydet);

        Button erisim = new Button(this);
        erisim.setText("Erişilebilirlik ayarlarını aç");
        erisim.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        l.addView(erisim);

        TextView bilgi = new TextView(this);
        bilgi.setPadding(0, dp(16), 0, 0);
        bilgi.setText("Nasıl çalışır:\n"
                + "• Seçili oyun açılınca altta 1 saniyelik \"+\" görünür.\n"
                + "• Yeni bir fotoğraf (tur) gelince ekran görüntüsü kendiliğinden alınır, altta kısa bir \"0\" görünür.\n"
                + "• Birkaç saniye sonra altta ülke adının ilk iki harfi çıkar (Tayland → TA). Yazıya 2 kez dokununca kapanır.\n"
                + "• İsterseniz seçtiğiniz alana 3 kez dokunarak elle de çalıştırabilirsiniz.");
        l.addView(bilgi);

        ScrollView sv = new ScrollView(this);
        sv.addView(l, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(sv);
    }
}
