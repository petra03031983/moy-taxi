package kz.astanaguide.scanner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.text.Normalizer;
import java.time.Instant;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ScreenCaptureService extends Service {
    public static final String ACTION_START = "kz.astanaguide.scanner.SCREEN_START";
    public static final String ACTION_STOP = "kz.astanaguide.scanner.SCREEN_STOP";
    public static final String EXTRA_RESULT_CODE = "screen_result_code";
    public static final String EXTRA_RESULT_DATA = "screen_result_data";

    private static final String PREFS = "astana_screen_scan";
    private static final String ROAD_PREFS = "road_scan_status";
    private static final String CHANNEL_ID = "astana_guide_screen_scan";
    private static final int NOTIFICATION_ID = 7402;
    private static final long OCR_INTERVAL_MS = 4500L;
    private static final long MAX_GPS_AGE_MS = 25000L;
    private static final float MAX_GPS_ACCURACY_M = 60.0f;
    private static final int MAX_LOCAL_EVIDENCE = 80;
    private static final String CLOUD_ENDPOINT = "https://qyejqovxwniqlcsspmbc.supabase.co/rest/v1/road_screen_evidence?on_conflict=source_id";
    private static final String SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YjssgR_0Of2b5dhqsSfG_Q_EnYTkrOn";
    private static final Object EVIDENCE_LOCK = new Object();
    private static final Pattern DISTANCE_PATTERN = Pattern.compile(
        "(?:через\\s*)?(\\d{1,4}(?:[.,]\\d+)?)\\s*(км|м)\\b",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private HandlerThread captureThread;
    private Handler captureHandler;
    private ImageReader imageReader;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private LocationManager locationManager;
    private LocationListener locationListener;
    private volatile Location lastLocation;
    private volatile boolean active = false;
    private volatile boolean ocrInFlight = false;
    private long lastOcrAt = 0L;
    private int displayWidth;
    private int displayHeight;
    private int densityDpi;
    private NotificationManager notificationManager;
    private RussianScreenOcr screenOcr;
    private final java.util.concurrent.ExecutorService cloudExecutor =
        java.util.concurrent.Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannel();
        captureThread = new HandlerThread("AstanaGuideScreenOCR");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        screenOcr = new RussianScreenOcr(this);
        screenOcr.initialize((ready, message) -> {
            if (ready) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString("status", "Русский OCR готов · экран анализируется")
                    .apply();
                updateNotification("Русский OCR готов · ищем подсказки");
            } else {
                setError("Модель русского OCR не загрузилась: " + (message == null ? "ошибка" : message));
            }
            return kotlin.Unit.INSTANCE;
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (active) return START_NOT_STICKY;
        if (intent == null || !intent.hasExtra(EXTRA_RESULT_CODE)) {
            setError("Android не передал разрешение на захват экрана. Нажми кнопку и подтверди системный запрос.");
            stopSelf();
            return START_NOT_STICKY;
        }

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            //noinspection deprecation
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultCode != android.app.Activity.RESULT_OK || resultData == null) {
            setError("Захват экрана не разрешён.");
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            startForegroundCompat();
            MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = manager.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) throw new IllegalStateException("Android не выдал разрешение MediaProjection.");

            active = true;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean("active", true)
                .putString("lastError", "")
                .putString("status", "Захват экрана разрешён · ищем подсказки о дорожных объектах")
                .apply();

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() {
                    stopSelf();
                }
            }, captureHandler);

            startLocationUpdates();
            startDisplayCapture();
            cloudExecutor.execute(this::flushPendingCloudEvidence);
            updateNotification("Экран анализируется · изображения не сохраняются");
        } catch (Exception error) {
            setError("Не удалось начать анализ экрана: " + safeMessage(error));
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startForegroundCompat() {
        Notification notification = buildNotification("Ожидаем захват экрана");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION |
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startDisplayCapture() {
        WindowManager windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        if (Build.VERSION.SDK_INT >= 30) {
            Rect bounds = windowManager.getCurrentWindowMetrics().getBounds();
            displayWidth = bounds.width();
            displayHeight = bounds.height();
            densityDpi = getResources().getDisplayMetrics().densityDpi;
        } else {
            //noinspection deprecation
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            displayWidth = metrics.widthPixels;
            displayHeight = metrics.heightPixels;
            densityDpi = metrics.densityDpi;
        }
        if (displayWidth <= 0 || displayHeight <= 0) {
            throw new IllegalStateException("Не удалось определить размер экрана.");
        }

        // OCR only: do not persist screenshots or unrelated text from other apps.
        imageReader = ImageReader.newInstance(displayWidth, displayHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(this::onImageAvailable, captureHandler);
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "AstanaGuideScreenReader",
            displayWidth,
            displayHeight,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    private void onImageAvailable(ImageReader reader) {
        Image image = null;
        Bitmap bitmap = null;
        try {
            long now = android.os.SystemClock.elapsedRealtime();
            if (!active || ocrInFlight || now - lastOcrAt < OCR_INTERVAL_MS) {
                image = reader.acquireLatestImage();
                if (image != null) image.close();
                return;
            }
            image = reader.acquireLatestImage();
            if (image == null) return;
            lastOcrAt = now;
            ocrInFlight = true;
            bitmap = imageToBitmap(image);
        } catch (Exception error) {
            ocrInFlight = false;
            setError("Не удалось прочитать кадр экрана: " + safeMessage(error));
        } finally {
            if (image != null) image.close();
        }

        if (bitmap == null) {
            ocrInFlight = false;
            return;
        }
        try {
            final Bitmap frame = bitmap;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putInt("framesCount", getSharedPreferences(PREFS, MODE_PRIVATE).getInt("framesCount", 0) + 1)
                .putLong("lastFrameAt", System.currentTimeMillis())
                .apply();
            screenOcr.recognize(frame, (recognizedText, errorMessage) -> {
                if (errorMessage != null) {
                    setError("Русский OCR не смог прочитать экран: " + errorMessage);
                } else if (recognizedText != null) {
                    processRecognizedText(recognizedText);
                }
                if (!frame.isRecycled()) frame.recycle();
                ocrInFlight = false;
                return kotlin.Unit.INSTANCE;
            });
        } catch (Exception error) {
            if (!bitmap.isRecycled()) bitmap.recycle();
            ocrInFlight = false;
            setError("Не удалось запустить распознавание: " + safeMessage(error));
        }
    }

    private Bitmap imageToBitmap(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes == null || planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        buffer.rewind();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = Math.max(0, rowStride - pixelStride * image.getWidth());
        int paddedWidth = image.getWidth() + rowPadding / Math.max(1, pixelStride);
        Bitmap padded = Bitmap.createBitmap(paddedWidth, image.getHeight(), Bitmap.Config.ARGB_8888);
        padded.copyPixelsFromBuffer(buffer);
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
        if (cropped != padded) padded.recycle();
        return cropped;
    }

    private void processRecognizedText(String rawText) {
        if (!active || rawText == null || rawText.trim().isEmpty()) return;
        String[] lines = rawText.split("[\\r\\n]+");
        Set<String> thisFrameDedup = new HashSet<>();
        for (String rawLine : lines) {
            String line = normalizeLine(rawLine);
            if (line.length() < 3 || line.length() > 160) continue;
            String kind = classifyRoadHint(line);
            if (kind == null || !thisFrameDedup.add(kind + ":" + line.toLowerCase(Locale.ROOT))) continue;
            saveScreenEvidence(kind, line);
        }
    }

    private static String normalizeLine(String value) {
        String s = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
            .replaceAll("[\\t\\u00A0]+", " ")
            .replaceAll("\\s{2,}", " ")
            .trim();
        if (s.length() > 160) s = s.substring(0, 160);
        return s;
    }

    private static String classifyRoadHint(String line) {
        String s = line.toLowerCase(Locale.ROOT).replace('ё', 'е');
        if (s.contains("камера") || s.contains("контроля скорости") ||
            s.contains("speed camera") || s.contains("speedcam")) return "speed-camera";
        if (s.contains("светофор") || s.contains("traffic light")) return "traffic-light";
        if ((s.contains("ограничение скорости") || s.contains("скорость")) &&
            Pattern.compile("\\d{2,3}").matcher(s).find()) return "speed-limit";
        if (s.contains("дорожные работы") || s.contains("ремонт дороги") ||
            s.contains("перекрытие") || s.contains("road works")) return "roadwork";
        if (s.contains("дтп") || s.contains("авария") || s.contains("опасность") ||
            s.contains("происшествие") || s.contains("accident") || s.contains("hazard")) return "road-hazard";
        return null;
    }

    private void saveScreenEvidence(String kind, String sourceText) {
        Location point = getFreshLocation();
        long now = System.currentTimeMillis();
        JSONObject item = new JSONObject();
        String sourceId = "screen_" + UUID.randomUUID();
        Double estimateLat = null;
        Double estimateLng = null;
        Double distanceAhead = parseDistanceAhead(sourceText);
        if (point != null && distanceAhead != null && point.hasBearing()) {
            double bearingRadians = Math.toRadians(point.getBearing());
            double earth = 6371000.0;
            double latRad = Math.toRadians(point.getLatitude());
            estimateLat = point.getLatitude() + Math.toDegrees(distanceAhead / earth * Math.cos(bearingRadians));
            double cosLat = Math.max(0.1, Math.abs(Math.cos(latRad)));
            estimateLng = point.getLongitude() + Math.toDegrees(distanceAhead / earth * Math.sin(bearingRadians) / cosLat);
            // Approximate points are for review only; do not imply the GPS is the object location.
        }

        try {
            item.put("id", sourceId);
            item.put("source_id", sourceId);
            item.put("kind", kind);
            item.put("sourceText", sourceText);
            item.put("observedLat", point == null ? JSONObject.NULL : point.getLatitude());
            item.put("observedLng", point == null ? JSONObject.NULL : point.getLongitude());
            item.put("accuracy", point == null ? JSONObject.NULL : point.getAccuracy());
            item.put("gpsAt", point == null ? 0 : point.getTime());
            item.put("distanceAheadM", distanceAhead == null ? JSONObject.NULL : distanceAhead);
            item.put("estimatedLat", estimateLat == null ? JSONObject.NULL : estimateLat);
            item.put("estimatedLng", estimateLng == null ? JSONObject.NULL : estimateLng);
            item.put("capturedAt", Instant.ofEpochMilli(now).toString());
            item.put("source", "screen-evidence");
            item.put("reviewStatus", "needs-review");
            item.put("confidence", estimateLat == null ? 0.0 : 0.30);
            item.put("syncStatus", "local-only");
        } catch (Exception ignored) {}

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        synchronized (EVIDENCE_LOCK) {
            JSONArray evidence;
            try { evidence = new JSONArray(prefs.getString("evidence", "[]")); }
            catch (Exception error) { evidence = new JSONArray(); }
            // Avoid recording the same visible warning every OCR cycle.
            long cutoff = now - 90_000L;
            for (int i = evidence.length() - 1; i >= 0; i--) {
                JSONObject prior = evidence.optJSONObject(i);
                if (prior == null) continue;
                long priorAt = parseTime(prior.optString("capturedAt"));
                if (priorAt < cutoff) continue;
                if (kind.equals(prior.optString("kind")) &&
                    sourceText.equalsIgnoreCase(prior.optString("sourceText"))) return;
            }
            evidence.put(item);
            while (evidence.length() > MAX_LOCAL_EVIDENCE) evidence.remove(0);
            prefs.edit()
                .putString("evidence", evidence.toString())
                .putInt("matchesCount", prefs.getInt("matchesCount", 0) + 1)
                .putString("lastMatch", kind + " · " + sourceText)
                .putLong("lastMatchAt", now)
                .putString("status", point == null
                    ? "Экран читается, но GPS нет или он устарел; подсказка сохранена без координат."
                    : estimateLat == null
                        ? "Найдена дорожная подсказка. Точной точки объекта на экране определить не удалось."
                        : "Найдена подсказка с расстоянием; приблизительная точка отмечена как требующая проверки.")
                .apply();
        }

        if (point != null) {
            cloudExecutor.execute(() -> queueAndSync(item));
        }
        updateNotification("Экран анализируется · подсказок " +
            prefs.getInt("matchesCount", 0) + " · изображения не сохраняются");
    }

    private Location getFreshLocation() {
        long now = System.currentTimeMillis();
        Location chosen = lastLocation == null ? null : new Location(lastLocation);
        if (chosen != null && now - chosen.getTime() >= 0L &&
            now - chosen.getTime() <= MAX_GPS_AGE_MS && chosen.hasAccuracy() &&
            chosen.getAccuracy() <= MAX_GPS_ACCURACY_M) return chosen;

        android.content.SharedPreferences roadPrefs = getSharedPreferences(ROAD_PREFS, MODE_PRIVATE);
        long gpsAt = roadPrefs.getLong("gpsAt", 0L);
        if (now - gpsAt < 0L || now - gpsAt > MAX_GPS_AGE_MS) return null;
        String lat = roadPrefs.getString("lat", "");
        String lng = roadPrefs.getString("lng", "");
        if (lat.isEmpty() || lng.isEmpty()) return null;
        try {
            Location fromRoadScanner = new Location("road-scanner-gps");
            fromRoadScanner.setLatitude(Double.parseDouble(lat));
            fromRoadScanner.setLongitude(Double.parseDouble(lng));
            fromRoadScanner.setTime(gpsAt);
            fromRoadScanner.setAccuracy(roadPrefs.getFloat("accuracy", 999f));
            float bearing = roadPrefs.getFloat("heading", -1f);
            if (bearing >= 0f) fromRoadScanner.setBearing(bearing);
            float speed = roadPrefs.getFloat("speedMps", -1f);
            if (speed >= 0f) fromRoadScanner.setSpeed(speed);
            if (fromRoadScanner.hasAccuracy() && fromRoadScanner.getAccuracy() <= MAX_GPS_ACCURACY_M) return fromRoadScanner;
        } catch (Exception ignored) {}
        return null;
    }

    private static Double parseDistanceAhead(String text) {
        Matcher matcher = DISTANCE_PATTERN.matcher(text == null ? "" : text.toLowerCase(Locale.ROOT));
        if (!matcher.find()) return null;
        try {
            double value = Double.parseDouble(matcher.group(1).replace(',', '.'));
            double meters = "км".equalsIgnoreCase(matcher.group(2)) ? value * 1000.0 : value;
            if (meters < 15.0 || meters > 2000.0) return null;
            return meters;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locationManager == null || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("lastError", "Нет разрешения точной геолокации; экран будет читать подсказки без координат.")
                .apply();
            return;
        }
        locationListener = location -> {
            if (location == null) return;
            lastLocation = new Location(location);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putLong("gpsAt", System.currentTimeMillis())
                .putString("lat", Double.toString(location.getLatitude()))
                .putString("lng", Double.toString(location.getLongitude()))
                .putFloat("accuracy", location.hasAccuracy() ? location.getAccuracy() : 999f)
                .putFloat("heading", location.hasBearing() ? location.getBearing() : -1f)
                .putFloat("speedMps", location.hasSpeed() ? location.getSpeed() : -1f)
                .apply();
        };
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000L, 0f, locationListener, Looper.getMainLooper());
            Location old = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (old == null) old = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (old != null) lastLocation = new Location(old);
        } catch (SecurityException error) {
            setError("Нет доступа к GPS: " + safeMessage(error));
        } catch (RuntimeException error) {
            setError("GPS недоступен: " + safeMessage(error));
        }
    }

    private void queueAndSync(JSONObject evidenceItem) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String sourceId = evidenceItem.optString("id");
        synchronized (EVIDENCE_LOCK) {
            JSONArray pending;
            try { pending = new JSONArray(prefs.getString("pendingCloud", "[]")); }
            catch (Exception ignored) { pending = new JSONArray(); }
            boolean exists = false;
            for (int i = 0; i < pending.length(); i++) {
                JSONObject row = pending.optJSONObject(i);
                if (row != null && sourceId.equals(row.optString("source_id"))) { exists = true; break; }
            }
            if (!exists) pending.put(evidenceItem);
            while (pending.length() > 200) pending.remove(0);
            prefs.edit().putString("pendingCloud", pending.toString()).apply();
        }
        flushPendingCloudEvidence();
    }

    private void flushPendingCloudEvidence() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        while (active) {
            JSONArray pending;
            synchronized (EVIDENCE_LOCK) {
                try { pending = new JSONArray(prefs.getString("pendingCloud", "[]")); }
                catch (Exception ignored) { pending = new JSONArray(); }
            }
            if (pending.length() == 0) {
                prefs.edit().putString("cloudStatus", "Все найденные подсказки синхронизированы")
                    .putLong("cloudLastSyncAt", System.currentTimeMillis()).apply();
                return;
            }
            JSONObject item = pending.optJSONObject(0);
            if (item == null) {
                pending.remove(0);
                prefs.edit().putString("pendingCloud", pending.toString()).apply();
                continue;
            }
            HttpURLConnection connection = null;
            try {
                JSONObject body = new JSONObject();
                body.put("source_id", item.optString("source_id", item.optString("id")));
                body.put("kind", item.optString("kind"));
                body.put("source_text", item.optString("sourceText"));
                body.put("observed_lat", item.opt("observedLat"));
                body.put("observed_lng", item.opt("observedLng"));
                body.put("accuracy_m", item.opt("accuracy"));
                body.put("gps_captured_at", item.opt("gpsAt"));
                body.put("distance_ahead_m", item.opt("distanceAheadM"));
                body.put("estimated_lat", item.opt("estimatedLat"));
                body.put("estimated_lng", item.opt("estimatedLng"));
                body.put("captured_at", item.optString("capturedAt"));
                body.put("confidence", item.optDouble("confidence", 0.0));
                connection = (HttpURLConnection) new URL(CLOUD_ENDPOINT).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("apikey", SUPABASE_PUBLISHABLE_KEY);
                connection.setRequestProperty("Authorization", "Bearer " + SUPABASE_PUBLISHABLE_KEY);
                connection.setRequestProperty("Prefer", "resolution=ignore-duplicates,return=minimal");
                byte[] bytes = body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int responseCode = connection.getResponseCode();
                InputStream response = responseCode >= 200 && responseCode < 300
                    ? connection.getInputStream() : connection.getErrorStream();
                if (response != null) try (InputStream stream = response) {
                    byte[] discard = new byte[512];
                    while (stream.read(discard) != -1) { }
                }
                if (responseCode < 200 || responseCode >= 300) {
                    prefs.edit().putString("cloudStatus", "Нет подтверждения сервера (HTTP " + responseCode + "); отметки ждут отправки").apply();
                    return;
                }
                synchronized (EVIDENCE_LOCK) {
                    JSONArray current;
                    try { current = new JSONArray(prefs.getString("pendingCloud", "[]")); }
                    catch (Exception ignored) { current = new JSONArray(); }
                    JSONArray remaining = new JSONArray();
                    for (int i = 0; i < current.length(); i++) {
                        JSONObject row = current.optJSONObject(i);
                        if (row != null && !item.optString("id").equals(row.optString("id"))) remaining.put(row);
                    }
                    prefs.edit().putString("pendingCloud", remaining.toString())
                        .putString("cloudStatus", remaining.length() == 0
                            ? "Подсказки отправлены в базу предварительных наблюдений"
                            : "Отправляем оставшиеся подсказки")
                        .putLong("cloudLastSyncAt", System.currentTimeMillis()).apply();
                }
            } catch (Exception error) {
                prefs.edit().putString("cloudStatus", "Нет интернета; подсказки сохранены на телефоне").apply();
                return;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }

    private static long parseTime(String value) {
        try { return Instant.parse(value).toEpochMilli(); } catch (Exception ignored) { return 0L; }
    }

    public static boolean isActive(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("active", false);
    }

    public static void recordExternalError(Context context, String message) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("lastError", message == null ? "" : message)
            .putString("status", message == null ? "" : message)
            .apply();
    }

    private void setError(String message) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("lastError", message == null ? "" : message)
            .putString("status", message == null ? "" : message)
            .apply();
    }

    private static String safeMessage(Throwable error) {
        String s = error == null || error.getMessage() == null ? "неизвестная ошибка" : error.getMessage();
        return s.length() > 180 ? s.substring(0, 180) : s;
    }

    public static String getStatusJson(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONObject result = new JSONObject();
        try {
            result.put("screenScanActive", prefs.getBoolean("active", false));
            result.put("screenScanFrameCount", prefs.getInt("framesCount", 0));
            result.put("screenScanMatchCount", prefs.getInt("matchesCount", 0));
            result.put("screenScanLastMatch", prefs.getString("lastMatch", ""));
            result.put("screenScanLastAt", prefs.getLong("lastMatchAt", 0));
            result.put("screenScanLastError", prefs.getString("lastError", ""));
            result.put("screenScanStatus", prefs.getString("status", "Экран ещё не сканировался"));
            result.put("screenScanCloudStatus", prefs.getString("cloudStatus", "Облачная синхронизация экрана ещё не запускалась"));
            result.put("screenScanPendingCount", new JSONArray(prefs.getString("pendingCloud", "[]")).length());
            result.put("screenScanEvidence", new JSONArray(prefs.getString("evidence", "[]")));
        } catch (Exception ignored) {}
        return result.toString();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                "Астана Гид — анализ экрана", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Показывает, что вы разрешили анализ экрана для поиска дорожных подсказок.");
            channel.setShowBadge(false);
            notificationManager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String message) {
        Intent stop = new Intent(this, ScreenCaptureService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 7402, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Астана Гид · анализ экрана")
            .setContentText(message)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(0, "Остановить", stopPending).build())
            .build();
    }

    private void updateNotification(String message) {
        if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification(message));
    }

    @Override
    public void onDestroy() {
        active = false;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("active", false)
            .putString("status", "Сканирование экрана остановлено")
            .apply();
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (SecurityException ignored) {}
        }
        locationListener = null;
        locationManager = null;
        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.setOnImageAvailableListener(null, null);
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        if (screenOcr != null) {
            try { screenOcr.release(); } catch (Exception ignored) {}
            screenOcr = null;
        }
        cloudExecutor.shutdown();
        if (captureThread != null) {
            captureThread.quitSafely();
            try { captureThread.join(800); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        if (notificationManager != null) notificationManager.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
