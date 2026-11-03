package com.ruslan.ulkebulucu;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
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

/** Ayar ekranı: API anahtarı, dokunma alanının yeri, yazının görünümü. */
public class MainActivity extends Activity {

    static final String PREFS = "ayarlar";

    static final String[] KONUMLAR = {
            "sag-ust", "sol-ust", "orta-ust", "sag-orta", "sol-orta", "sag-alt", "sol-alt"
    };
    static final String[] KONUM_ADLARI = {
            "Sağ üst", "Sol üst", "Orta üst", "Sağ orta", "Sol orta", "Sağ alt", "Sol alt"
    };

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);

        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(20), dp(20), dp(20), dp(40));

        TextView ad = new TextView(this);
        ad.setText("Ülke Bulucu");
        ad.setTextSize(24);
        l.addView(ad);

        // --- API anahtarı ---
        l.addView(baslik("1) Gemini API anahtarı"));
        final EditText anahtar = new EditText(this);
        anahtar.setHint("AQ.... (AI Studio'dan Copy key ile yapıştırın)");
        anahtar.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        anahtar.setText(p.getString("anahtar", ""));
        l.addView(anahtar);

        // --- Dokunma alanı ---
        l.addView(baslik("2) 3 kez dokunulacak alan nerede olsun?"));
        final RadioGroup konumlar = new RadioGroup(this);
        String secili = p.getString("konum", "sag-orta");
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

        // --- Yazı ---
        l.addView(baslik("3) Cevap yazısının görünürlüğü"));
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

        // --- Butonlar ---
        Button kaydet = new Button(this);
        kaydet.setText("Kaydet");
        kaydet.setOnClickListener(v -> {
            int id = konumlar.getCheckedRadioButtonId();
            String konum = (id >= 1000 && id < 1000 + KONUMLAR.length) ? KONUMLAR[id - 1000] : "sag-orta";
            p.edit()
                    .putString("anahtar", anahtar.getText().toString().trim())
                    .putString("konum", konum)
                    .putBoolean("goster", goster.isChecked())
                    .putInt("saydamlik", saydam.getProgress() + 20)
                    .apply();
            Toast.makeText(this, "Kaydedildi", Toast.LENGTH_SHORT).show();
        });
        l.addView(kaydet);

        Button erisim = new Button(this);
        erisim.setText("Erişilebilirlik ayarlarını aç");
        erisim.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        l.addView(erisim);

        TextView bilgi = new TextView(this);
        bilgi.setPadding(0, dp(16), 0, 0);
        bilgi.setText("Kullanım:\n"
                + "• Anahtarı yapıştırıp Kaydet'e basın.\n"
                + "• 'Erişilebilirlik ayarlarını aç' → Yüklü uygulamalar → Ülke Bulucu → Aç.\n"
                + "• Seçtiğiniz alana art arda 3 kez dokunun; cevap ekranın altında soluk yazıyla çıkar.\n"
                + "• Ayarı değiştirince Kaydet'e basmanız yeterli, servis kendini günceller.");
        l.addView(bilgi);

        ScrollView sv = new ScrollView(this);
        sv.addView(l, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(sv);
    }
}
