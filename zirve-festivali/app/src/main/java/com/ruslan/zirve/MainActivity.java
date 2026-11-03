package com.ruslan.zirve;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Oyunu (assets/oyun/index.html) tam ekran, yatay bir WebView içinde çalıştırır. */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // rekorlar için
        s.setMediaPlaybackRequiresUserGesture(false); // motor sesi için
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF0D1714);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        setContentView(web);
        tamEkran();
        web.loadUrl("file:///android_asset/oyun/index.html");
    }

    @SuppressWarnings("deprecation")
    private void tamEkran() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) tamEkran();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.oyunDuraklat && window.oyunDuraklat()", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        tamEkran();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Oyun içindeyse geri tuşu duraklatır; garajdaysa uygulamadan çıkar.
        web.evaluateJavascript("window.geriTusu ? window.geriTusu() : 'cik'", deger -> {
            if (deger != null && deger.contains("cik")) finish();
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
