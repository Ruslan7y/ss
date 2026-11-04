package com.ruslan.tvremote;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SamsungTvPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
