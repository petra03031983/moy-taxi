package kz.astanaguide.scanner;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int SCAN_PERMISSION_REQUEST = 4107;
    private static final String MAP_URL = "https://astana-map-roads.vercel.app/astana-map?nativeScanner=1";
    private static final String MAP_HOST = "astana-map-roads.vercel.app";
    private WebView webView;
    private boolean pendingStart = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(15, 23, 32));
        window.setNavigationBarColor(Color.rgb(15, 23, 32));
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(234, 240, 245));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setGeolocationEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new ScannerBridge(), "AstanaScanner");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && MAP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("https".equalsIgnoreCase(uri.getScheme()) && MAP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                openExternal(uri);
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean allowed = origin != null && origin.startsWith("https://" + MAP_HOST);
                callback.invoke(origin, allowed, false);
            }
        });
        setContentView(webView);
        webView.loadUrl(MAP_URL);
    }

    private void openExternal(Uri uri) {
        try {
            if (uri != null && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))) {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            }
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "Не найден браузер для этой ссылки", Toast.LENGTH_SHORT).show();
        }
    }

    private void requestScannerPermissionsAndStart() {
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) {
            pendingStart = true;
            requestPermissions(missing.toArray(new String[0]), SCAN_PERMISSION_REQUEST);
            return;
        }
        startScannerService();
    }

    private void startScannerService() {
        pendingStart = false;
        Intent intent = new Intent(this, RoadScanService.class);
        intent.setAction(RoadScanService.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
            else startService(intent);
            Toast.makeText(this, "Астана Гид: запускаем сканирование", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException error) {
            RoadScanService.setLastError(this, "Не удалось запустить фоновое сканирование: " + error.getMessage());
            Toast.makeText(this, "Не удалось запустить камеру. Проверь разрешения.", Toast.LENGTH_LONG).show();
        }
    }

    private void stopScannerService() {
        stopService(new Intent(this, RoadScanService.class));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != SCAN_PERMISSION_REQUEST || !pendingStart) return;
        boolean allowed = true;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) allowed = false;
        }
        if (allowed) {
            startScannerService();
        } else {
            pendingStart = false;
            RoadScanService.setLastError(this, "Нужны разрешения на камеру, GPS и уведомления сканера.");
            Toast.makeText(this, "Разреши камеру и местоположение, чтобы начать сканирование.", Toast.LENGTH_LONG).show();
        }
    }

    private void runOnUi(Runnable runnable) {
        runOnUiThread(runnable);
    }

    private final class ScannerBridge {
        @JavascriptInterface
        public void startScanning() {
            runOnUi(() -> requestScannerPermissionsAndStart());
        }

        @JavascriptInterface
        public void stopScanning() {
            runOnUi(() -> stopScannerService());
        }

        @JavascriptInterface
        public String getStatus() {
            return RoadScanService.getStatusJson(MainActivity.this);
        }

        @JavascriptInterface
        public String saveObservation(String kind) {
            if (!RoadScanService.isScanning(MainActivity.this)) {
                return "{\"ok\":false,\"error\":\"Сначала запусти сканирование.\"}";
            }
            Intent intent = new Intent(MainActivity.this, RoadScanService.class);
            intent.setAction(RoadScanService.ACTION_MARK);
            intent.putExtra(RoadScanService.EXTRA_KIND, kind == null ? "unknown" : kind);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
                else startService(intent);
                return "{\"ok\":true,\"queued\":true}";
            } catch (RuntimeException error) {
                JSONObject result = new JSONObject();
                try {
                    result.put("ok", false);
                    result.put("error", "Не удалось сохранить отметку.");
                } catch (Exception ignored) {}
                return result.toString();
            }
        }

        @JavascriptInterface
        public void openBatterySettings() {
            runOnUi(() -> {
                try {
                    Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (RuntimeException error) {
                    Toast.makeText(MainActivity.this, "Открой настройки приложения и разреши работу в фоне.", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public String exportFolderHint() {
            return RoadScanService.getExportFolderHint(MainActivity.this);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AstanaScanner");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
