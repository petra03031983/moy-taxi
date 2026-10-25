package kz.astanaguide.scanner;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.media.projection.MediaProjectionManager;
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
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int SCAN_PERMISSION_REQUEST = 4107;
    private static final int SCREEN_SCAN_PERMISSION_REQUEST = 4108;
    private static final int MEDIA_PROJECTION_REQUEST = 4109;
    private static final String MAP_URL = "https://astana-map-roads.vercel.app/astana-map?nativeScanner=1";
    private static final String MAP_HOST = "astana-map-roads.vercel.app";
    private WebView webView;
    private Button screenCaptureButton;
    private FrameLayout rootLayout;
    private boolean pendingStart = false;
    private boolean pendingScreenCapture = false;

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
        rootLayout = new FrameLayout(this);
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // This native control remains available even when the hosted map UI is waiting for deployment.
        screenCaptureButton = new Button(this);
        screenCaptureButton.setAllCaps(false);
        screenCaptureButton.setTextSize(12);
        screenCaptureButton.setTextColor(Color.WHITE);
        screenCaptureButton.setElevation(dp(8));
        screenCaptureButton.setPadding(dp(8), 0, dp(8), 0);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.rgb(30, 64, 87));
        buttonBackground.setCornerRadius(dp(14));
        buttonBackground.setStroke(dp(1), Color.rgb(132, 196, 225));
        screenCaptureButton.setBackground(buttonBackground);
        FrameLayout.LayoutParams captureButtonParams = new FrameLayout.LayoutParams(dp(116), dp(44),
            Gravity.TOP | Gravity.END);
        captureButtonParams.topMargin = dp(14);
        captureButtonParams.rightMargin = dp(10);
        rootLayout.addView(screenCaptureButton, captureButtonParams);
        screenCaptureButton.setOnClickListener(view -> {
            if (ScreenCaptureService.isActive(MainActivity.this)) {
                stopScreenCaptureService();
                Toast.makeText(MainActivity.this, "Анализ экрана остановлен", Toast.LENGTH_SHORT).show();
                syncScreenCaptureButton();
            } else {
                requestScreenCapturePermission();
                screenCaptureButton.postDelayed(this::syncScreenCaptureButton, 1000L);
            }
        });
        screenCaptureButton.setOnLongClickListener(view -> {
            try {
                JSONObject status = new JSONObject(ScreenCaptureService.getStatusJson(MainActivity.this));
                String lastMatch = status.optString("screenScanLastMatch", "");
                String state = status.optString("screenScanStatus", "Экран не сканируется");
                String iconStatus = status.optString("screenScanIconStatus", "");
                String combined = state
                    + (iconStatus.isEmpty() ? "" : "\nЗначки: " + iconStatus)
                    + (lastMatch.isEmpty() ? "" : "\nПоследняя подсказка: " + lastMatch);
                Toast.makeText(MainActivity.this, combined, Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {}
            return true;
        });
        syncScreenCaptureButton();

        setContentView(rootLayout);
        webView.loadUrl(MAP_URL);
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void syncScreenCaptureButton() {
        if (screenCaptureButton == null) return;
        boolean active = ScreenCaptureService.isActive(this);
        screenCaptureButton.setText(active ? "■ ЭКРАН: ВКЛ" : "▣ СКАН ЭКРАНА");
        GradientDrawable background = new GradientDrawable();
        background.setColor(active ? Color.rgb(22, 112, 67) : Color.rgb(30, 64, 87));
        background.setCornerRadius(dp(14));
        background.setStroke(dp(1), active ? Color.rgb(154, 242, 187) : Color.rgb(132, 196, 225));
        screenCaptureButton.setBackground(background);
        screenCaptureButton.setContentDescription(active
            ? "Остановить анализ экрана"
            : "Запустить анализ экрана");
    }

    @Override
    protected void onResume() {
        super.onResume();
        syncScreenCaptureButton();
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

    private void requestScreenCapturePermission() {
        List<String> missing = new ArrayList<>();
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
            pendingScreenCapture = true;
            requestPermissions(missing.toArray(new String[0]), SCREEN_SCAN_PERMISSION_REQUEST);
            return;
        }
        launchScreenCapturePrompt();
    }

    private void launchScreenCapturePrompt() {
        try {
            MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent captureIntent = manager.createScreenCaptureIntent();
            startActivityForResult(captureIntent, MEDIA_PROJECTION_REQUEST);
        } catch (RuntimeException error) {
            pendingScreenCapture = false;
            Toast.makeText(this, "Android не смог открыть разрешение на захват экрана.", Toast.LENGTH_LONG).show();
        }
    }

    private void startScreenCaptureService(int resultCode, Intent data) {
        pendingScreenCapture = false;
        Intent service = new Intent(this, ScreenCaptureService.class);
        service.setAction(ScreenCaptureService.ACTION_START);
        service.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode);
        service.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service);
            else startService(service);
            Toast.makeText(this,
                "Астана Гид: экран разрешён. Переключись на Яндекс Навигатор или 2ГИС.",
                Toast.LENGTH_LONG).show();
            screenCaptureButton.postDelayed(this::syncScreenCaptureButton, 1200L);
        } catch (RuntimeException error) {
            ScreenCaptureService.recordExternalError(this,
                "Не удалось запустить анализ экрана: " + (error.getMessage() == null ? "" : error.getMessage()));
            Toast.makeText(this, "Не удалось запустить анализ экрана.", Toast.LENGTH_LONG).show();
        }
    }

    private void stopScreenCaptureService() {
        Intent stop = new Intent(this, ScreenCaptureService.class);
        stop.setAction(ScreenCaptureService.ACTION_STOP);
        try {
            startService(stop);
        } catch (RuntimeException ignored) {
            stopService(new Intent(this, ScreenCaptureService.class));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != MEDIA_PROJECTION_REQUEST) return;
        if (resultCode == RESULT_OK && data != null) {
            startScreenCaptureService(resultCode, data);
        } else {
            pendingScreenCapture = false;
            ScreenCaptureService.recordExternalError(this,
                "Захват экрана отменён. Для чтения подсказок нужно подтвердить системный запрос.");
            Toast.makeText(this, "Захват экрана отменён.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SCREEN_SCAN_PERMISSION_REQUEST && pendingScreenCapture) {
            boolean allowed = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) allowed = false;
            }
            if (allowed) {
                launchScreenCapturePrompt();
            } else {
                pendingScreenCapture = false;
                ScreenCaptureService.recordExternalError(this,
                    "Для анализа экрана нужны разрешения на GPS и уведомления.");
                Toast.makeText(this, "Разреши GPS и уведомления, чтобы включить анализ экрана.", Toast.LENGTH_LONG).show();
            }
            return;
        }
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
        public void startScreenScan() {
            runOnUi(() -> requestScreenCapturePermission());
        }

        @JavascriptInterface
        public void stopScreenScan() {
            runOnUi(() -> stopScreenCaptureService());
        }

        @JavascriptInterface
        public String getStatus() {
            try {
                JSONObject result = new JSONObject(RoadScanService.getStatusJson(MainActivity.this));
                JSONObject screen = new JSONObject(ScreenCaptureService.getStatusJson(MainActivity.this));
                java.util.Iterator<String> keys = screen.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    result.put(key, screen.opt(key));
                }
                return result.toString();
            } catch (Exception error) {
                return RoadScanService.getStatusJson(MainActivity.this);
            }
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
