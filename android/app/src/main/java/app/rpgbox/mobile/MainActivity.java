package app.rpgbox.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public MainActivity() {
        registerPlugin(RpgStoragePlugin.class);
    }
}
