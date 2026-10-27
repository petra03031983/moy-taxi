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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
    private static final long OCR_INTERVAL_MS = 3000L;
    private static final long MAX_GPS_AGE_MS = 25000L;
    private static final float MAX_GPS_ACCURACY_M = 60.0f;
    // Icon-only pass-by evidence may be recorded at lower confidence up to this GPS radius.
    private static final float MAX_ICON_GPS_ACCURACY_M = 150.0f;
    private static final int MAX_LOCAL_EVIDENCE = 3000;
    private static final int MAX_PENDING_CLOUD_EVIDENCE = 3000;
    private static final String CLOUD_ENDPOINT = "https://astana-map-roads.vercel.app/api/road-screen-evidence";
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
            if (!active || ocrInFlight || now - lastOcrAt < OCR_INTERVAL_MS ||
                getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("scannerAppForeground", false)) {
                image = reader.acquireLatestImage();
                if (image != null) image.close();
                if (active && getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("scannerAppForeground", false)) {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString("screenIconStatus", "Ожидаю перехода в 2ГИС/Яндекс; собственный экран «Астана Гид» пропускается.")
                        .apply();
                }
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
            // Detect graphic navigation symbols locally as well as reading visible text.
            // The frame is never persisted or uploaded.
            try {
                processScreenIcons(ScreenIconDetector.detect(frame));
            } catch (Exception iconError) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString("screenIconStatus", "Не удалось распознать значки: " + safeMessage(iconError))
                    .apply();
            }
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

    private static boolean isTrustedIconPattern(ScreenIconDetector.Detection detection) {
        if (detection == null || detection.pattern == null) return false;
        if ("speed-camera".equals(detection.kind)) {
            return "compound-speed-sign-with-upper-right-camera-badge".equals(detection.pattern)
                || "camera-badge-on-speed-sign".equals(detection.pattern);
        }
        if ("traffic-light".equals(detection.kind)) {
            return "three-colour-traffic-light-icon".equals(detection.pattern)
                || "pixel-sampled-three-colour-traffic-light-on-route".equals(detection.pattern);
        }
        return false;
    }

    private void processScreenIcons(ScreenIconDetector.ScanResult result) {
        if (!active || result == null) return;
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        long now = System.currentTimeMillis();
        List<ScreenIconDetector.Detection> trustedDetections = new ArrayList<>();
        if (result.detections != null) {
            for (ScreenIconDetector.Detection detection : result.detections) {
                if (isTrustedIconPattern(detection)) trustedDetections.add(detection);
            }
        }
        int count = trustedDetections.size();
        android.content.SharedPreferences.Editor counter = prefs.edit()
            .putLong("screenIconLastScanAt", now)
            .putInt("screenIconLastFrameCount", count);
        if (count > 0) {
            counter.putInt("screenIconCandidateFrames", prefs.getInt("screenIconCandidateFrames", 0) + 1)
                .putInt("screenIconCandidatesTotal", prefs.getInt("screenIconCandidatesTotal", 0) + count);
        }
        counter.apply();
        pruneExpiredScreenIconTracks(now);

        if (count == 0) {
            prefs.edit().putString("screenIconStatus", "Последний кадр: графические значки камеры/светофора не найдены.")
                .apply();
            return;
        }
        if (result.vehicleAnchorEstimated) {
            prefs.edit().putString("screenIconStatus",
                "Графический кандидат замечен, но маркер автомобиля не распознан уверенно; GPS-точка не отправляется.")
                .apply();
            return;
        }

        Location point = getIconLocation();
        if (point == null) {
            prefs.edit().putString("screenIconStatus",
                "Найдено графических кандидатов: " + count + ", но нет свежего GPS с точностью до 60 м.")
                .apply();
            return;
        }
        if (!point.hasAccuracy() || point.getAccuracy() > MAX_GPS_ACCURACY_M) {
            prefs.edit().putString("screenIconStatus",
                "Значки найдены, но точность GPS хуже 60 м; точку пока не отправляем.")
                .apply();
            return;
        }

        boolean savedAny = false;
        boolean closeButWaiting = false;
        int tracked = 0;
        for (ScreenIconDetector.Detection detection : trustedDetections) {
            JSONObject track = updateScreenIconTrack(detection, result, point, now);
            if (track == null) continue;
            int hits = track.optInt("hits", 1);
            int approaches = track.optInt("approaches", 0);
            float dx = Math.abs(detection.x - result.vehicleX);
            float dy = Math.abs(detection.y - result.vehicleY);
            boolean closeToVehicle = dx <= 0.16f && dy <= 0.145f;
            if (!closeToVehicle) continue;
            closeButWaiting = true;

            double movedMeters = Double.NaN;
            if (track.has("firstLat") && track.has("firstLng")) {
                movedMeters = distanceMeters(
                    point.getLatitude(), point.getLongitude(),
                    track.optDouble("firstLat", point.getLatitude()),
                    track.optDouble("firstLng", point.getLongitude()));
            }
            boolean gpsMoved = Double.isFinite(movedMeters) && movedMeters >= 20.0
                && point.hasAccuracy() && point.getAccuracy() <= 60.0f;
            boolean moving = point.hasSpeed() && point.getSpeed() >= 1.4f;
            // Do not save a static screen marker from a single frame. It must be seen repeatedly
            // and approach the vehicle anchor, or have reliable GPS movement while passing.
            boolean passEvidence = hits >= 2 && (approaches >= 1 || gpsMoved || (hits >= 4 && moving));
            if (!passEvidence) {
                tracked++;
                continue;
            }

            boolean saved = saveScreenIconEvidence(detection, result, point, result.vehicleAnchorEstimated, track);
            savedAny = savedAny || saved;
        }

        if (savedAny) {
            prefs.edit().putString("screenIconStatus",
                "Распознаны значки, отслежены на нескольких кадрах и сохранены как приблизительные GPS-точки.")
                .apply();
        } else if (closeButWaiting) {
            prefs.edit().putString("screenIconStatus",
                "Графические значки найдены возле маркера; сверяем повторные кадры и движение перед сохранением.")
                .apply();
        } else {
            prefs.edit().putString("screenIconStatus",
                "Графических кандидатов в последнем кадре: " + count + ". Отслеживаем их движение по карте.")
                .apply();
        }
    }

    private void pruneExpiredScreenIconTracks(long now) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        synchronized (EVIDENCE_LOCK) {
            try {
                JSONArray existing = new JSONArray(prefs.getString("screenIconTracks", "[]"));
                JSONArray kept = new JSONArray();
                for (int i = 0; i < existing.length(); i++) {
                    JSONObject candidate = existing.optJSONObject(i);
                    if (candidate == null) continue;
                    long lastAt = candidate.optLong("lastAt", 0L);
                    if (lastAt > 0L && now - lastAt >= 0L && now - lastAt <= 45_000L) kept.put(candidate);
                }
                if (kept.length() != existing.length()) {
                    prefs.edit().putString("screenIconTracks", kept.toString()).apply();
                }
            } catch (Exception error) {
                prefs.edit().putString("screenIconStatus", "Не удалось обновить список отслеживаемых значков: " + safeMessage(error)).apply();
            }
        }
    }

    private JSONObject updateScreenIconTrack(ScreenIconDetector.Detection detection,
                                             ScreenIconDetector.ScanResult result,
                                             Location point, long now) {
        if (detection == null || result == null) return null;
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        synchronized (EVIDENCE_LOCK) {
            try {
                JSONArray tracks;
                try { tracks = new JSONArray(prefs.getString("screenIconTracks", "[]")); }
                catch (Exception ignored) { tracks = new JSONArray(); }

            JSONArray kept = new JSONArray();
            JSONObject best = null;
            int bestIndex = -1;
            double bestDistance = Double.MAX_VALUE;
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject candidate = tracks.optJSONObject(i);
                if (candidate == null) continue;
                long lastAt = candidate.optLong("lastAt", 0L);
                if (lastAt <= 0L || now - lastAt < 0L || now - lastAt > 45_000L) continue;
                int keptIndex = kept.length();
                kept.put(candidate);
                if (!detection.kind.equals(candidate.optString("kind"))) continue;
                double ddx = detection.x - candidate.optDouble("x", -10.0);
                double ddy = detection.y - candidate.optDouble("y", -10.0);
                double distance = Math.sqrt(ddx * ddx * 1.35 + ddy * ddy);
                if (Math.abs(ddx) <= 0.22 && Math.abs(ddy) <= 0.26 && distance < bestDistance) {
                    bestDistance = distance;
                    best = candidate;
                    bestIndex = keptIndex;
                }
            }

            double currentDistanceToAnchor = screenDistance(detection.x, detection.y,
                result.vehicleX, result.vehicleY);
            JSONObject track;
            if (best != null) {
                track = new JSONObject(best.toString());
                float oldX = (float) track.optDouble("x", detection.x);
                float oldY = (float) track.optDouble("y", detection.y);
                double previousDistance = screenDistance(oldX, oldY, result.vehicleX, result.vehicleY);
                int approaches = track.optInt("approaches", 0);
                if (previousDistance - currentDistanceToAnchor >= 0.008) approaches++;
                track.put("approaches", approaches);
                track.put("hits", track.optInt("hits", 1) + 1);
                track.put("bestDistance", Math.min(track.optDouble("bestDistance", currentDistanceToAnchor),
                    currentDistanceToAnchor));
                track.put("x", detection.x);
                track.put("y", detection.y);
                track.put("lastAt", now);
                track.put("lastPattern", detection.pattern == null ? "graphic" : detection.pattern);
                if (bestIndex >= 0) kept.put(bestIndex, track);
            } else {
                track = new JSONObject();
                track.put("id", UUID.randomUUID().toString());
                track.put("kind", detection.kind);
                track.put("x", detection.x);
                track.put("y", detection.y);
                track.put("firstX", detection.x);
                track.put("firstY", detection.y);
                track.put("hits", 1);
                track.put("approaches", 0);
                track.put("bestDistance", currentDistanceToAnchor);
                track.put("firstAt", now);
                track.put("lastAt", now);
                track.put("lastPattern", detection.pattern == null ? "graphic" : detection.pattern);
                track.put("anchorEstimated", result.vehicleAnchorEstimated);
                if (point.hasAccuracy() && point.getAccuracy() <= 150.0f) {
                    track.put("firstLat", point.getLatitude());
                    track.put("firstLng", point.getLongitude());
                    track.put("firstAccuracy", point.getAccuracy());
                }
                kept.put(track);
            }

            while (kept.length() > 40) kept.remove(0);
                prefs.edit().putString("screenIconTracks", kept.toString()).apply();
                return track;
            } catch (Exception error) {
                prefs.edit().putString("screenIconStatus", "Не удалось обновить отслеживание значка: " + safeMessage(error)).apply();
                return null;
            }
        }
    }

    private static double screenDistance(float x, float y, float anchorX, float anchorY) {
        double dx = (x - anchorX) * 1.15;
        double dy = y - anchorY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private boolean saveScreenIconEvidence(ScreenIconDetector.Detection detection, ScreenIconDetector.ScanResult scanResult, Location point, boolean estimatedAnchor, JSONObject track) {
        if (detection == null || point == null) return false;
        long now = System.currentTimeMillis();
        String kind = detection.kind;
        String label = "speed-camera".equals(kind) ? "speed camera icon" : "traffic light icon";
        StringBuilder text = new StringBuilder(label)
            .append(" near vehicle marker, screen x=")
            .append(Math.round(detection.x * 100f))
            .append("% y=")
            .append(Math.round(detection.y * 100f))
            .append("%");
        if (point.hasBearing() && point.hasSpeed() && point.getSpeed() >= 1.4f) {
            text.append(", heading=").append(Math.round(point.getBearing())).append("deg");
        }
        text.append(", hits=").append(track == null ? 1 : track.optInt("hits", 1));
        text.append(", approaching=").append(track != null && track.optInt("approaches", 0) > 0 ? "yes" : "no");
        text.append(", pattern=").append(detection.pattern == null ? "graphic" : detection.pattern);
        String sourceText = text.toString();
        if (sourceText.length() > 150) sourceText = sourceText.substring(0, 150);

        String sourceId = "screen_icon_" + UUID.randomUUID();
        JSONObject item = new JSONObject();
        try {
            item.put("id", sourceId);
            item.put("source_id", sourceId);
            item.put("kind", kind);
            item.put("sourceText", sourceText);
            item.put("observedLat", point.getLatitude());
            item.put("observedLng", point.getLongitude());
            item.put("accuracy", point.getAccuracy());
            item.put("gpsAt", point.getTime());
            item.put("travelHeadingDegrees",
                point.hasBearing() && point.hasSpeed() && point.getSpeed() >= 1.4f
                    ? Math.round(point.getBearing()) % 360 : JSONObject.NULL);
            item.put("detectionMethod", "icon-heuristic");
            // GPS describes the vehicle, not the physical road object. Keep the raw
            // observation separate until map-scale/trajectory matching estimates its location.
            item.put("coordinateMethod", "vehicle-gps-only");
            item.put("iconPattern", detection.pattern == null ? "legacy-icon-pass-by-gps" : detection.pattern);
            item.put("frameHits", Math.max(1, Math.min(100, track == null ? 1 : track.optInt("hits", 1))));
            item.put("trackId", track == null ? "" : track.optString("id", ""));
            item.put("screenXRatio", detection.x);
            item.put("screenYRatio", detection.y);
            item.put("vehicleAnchorXRatio", scanResult == null ? JSONObject.NULL : scanResult.vehicleX);
            item.put("vehicleAnchorYRatio", scanResult == null ? JSONObject.NULL : scanResult.vehicleY);
            item.put("trackStartLat", track != null && track.has("firstLat") ? track.opt("firstLat") : JSONObject.NULL);
            item.put("trackStartLng", track != null && track.has("firstLng") ? track.opt("firstLng") : JSONObject.NULL);
            long trackStartAtMs = track == null ? 0L : track.optLong("firstAt", 0L);
            item.put("trackStartAt", trackStartAtMs > 0L ? trackStartAtMs : JSONObject.NULL);
            item.put("gpsSpeedMps", point.hasSpeed() ? point.getSpeed() : JSONObject.NULL);
            item.put("gpsBearingDegrees", point.hasBearing() ? Math.round(point.getBearing()) % 360 : JSONObject.NULL);
            item.put("distanceAheadM", JSONObject.NULL);
            item.put("estimatedLat", JSONObject.NULL);
            item.put("estimatedLng", JSONObject.NULL);
            item.put("capturedAt", Instant.ofEpochMilli(now).toString());
            item.put("source", "screen-icon-near-vehicle");
            item.put("reviewStatus", "needs-review");
            double baseConfidence = Math.min(0.28, Math.max(0.10, detection.confidence * 0.40));
            if (point.hasAccuracy() && point.getAccuracy() > MAX_GPS_ACCURACY_M) {
                baseConfidence = Math.min(baseConfidence, 0.10);
            }
            if (estimatedAnchor) baseConfidence = Math.min(baseConfidence, 0.06);
            item.put("confidence", baseConfidence);
            item.put("syncStatus", "local-only");
        } catch (Exception ignored) { return false; }

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        synchronized (EVIDENCE_LOCK) {
            JSONArray evidence;
            try { evidence = new JSONArray(prefs.getString("evidence", "[]")); }
            catch (Exception error) { evidence = new JSONArray(); }

            // Deduplicate only repeated detections from the same visual track.
            // Do not drop a different camera/light merely because its vehicle GPS is nearby:
            // adjacent road objects may be physically distinct and need manual review.
            String trackId = item.optString("trackId", "");
            if (!trackId.isEmpty()) {
                for (int i = evidence.length() - 1; i >= 0; i--) {
                    JSONObject prior = evidence.optJSONObject(i);
                    if (prior == null || !kind.equals(prior.optString("kind"))) continue;
                    if (trackId.equals(prior.optString("trackId", ""))) {
                        prefs.edit().putString("lastMatch", kind + " · " + sourceText)
                            .putLong("lastMatchAt", now)
                            .putString("screenIconStatus", "Повторный кадр того же значка учтён; соседние объекты не объединяются.")
                            .apply();
                        return true;
                    }
                }
            }

            evidence.put(item);
            while (evidence.length() > MAX_LOCAL_EVIDENCE) evidence.remove(0);
            prefs.edit()
                .putString("evidence", evidence.toString())
                .putInt("matchesCount", prefs.getInt("matchesCount", 0) + 1)
                .putInt("screenIconSavedCount", prefs.getInt("screenIconSavedCount", 0) + 1)
                .putString("lastMatch", kind + " · " + sourceText)
                .putLong("lastMatchAt", now)
                .putString("status", "Найден графический значок; приблизительная точка сохранена как требующая проверки.")
                .apply();
        }

        cloudExecutor.execute(() -> queueAndSync(item));
        updateNotification("Анализ экрана · графических наблюдений " +
            prefs.getInt("screenIconSavedCount", 0) + " · точки требуют проверки");
        return true;
    }

    private static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371000.0 * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0.0, 1.0 - a)));
    }

    private static String normalizeLine(String value) {
        String s = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
            .replaceAll("[\\t\\u00A0]+", " ")
            .replaceAll("\\s{2,}", " ")
            .trim();
        if (s.length() > 160) s = s.substring(0, 160);
        return s;
    }

    private static boolean isScannerInterfaceText(String s) {
        String[] blocked = {
            "астана гид", "сканер", "координат", "направление", "на карте",
            "графических наблюдений", "кадров экрана", "кадров сохранено",
            "отметок на карте", "требующей проверки", "подсказка", "облако",
            "светофор/знак", "камера/светофор", "сохранить объект", "объект с gps",
            "фоновая камера", "камера активна", "экран анализируется",
            "whatsapp", "wa business", "значки найдены", "значки камеры",
            "распознаны", "gps подключен", "gps подключён", "маркер автомобиля",
            "speed camera icon", "traffic light icon"
        };
        for (String phrase : blocked) {
            if (s.contains(phrase)) return true;
        }
        return false;
    }

    private static String classifyRoadHint(String line) {
        String s = line.toLowerCase(Locale.ROOT).replace('ё', 'е')
            .replaceAll("\\s+", " ").trim();
        if (s.length() < 3 || isScannerInterfaceText(s)) return null;

        if (Pattern.compile("(?:камера\\s+(?:контроля скорости|скорости|фиксации скорости)|контроль скорости|фиксация скорости|speed\\s*camera|speedcam|camera ahead)")
            .matcher(s).find()) return "speed-camera";
        if (Pattern.compile("(?:светофор впереди|следующий светофор|traffic light ahead)")
            .matcher(s).find()) return "traffic-light";
        if (Pattern.compile("(?:ограничение скорости|speed limit)\\D{0,12}[0-9]{2,3}")
            .matcher(s).find()) return "speed-limit";
        if (Pattern.compile("(?:дорожные работы|ремонт дороги|перекрытие дороги|road works)")
            .matcher(s).find()) return "roadwork";
        if (Pattern.compile("(?:дтп впереди|авария впереди|опасность впереди|происшествие впереди|accident ahead|hazard ahead)")
            .matcher(s).find()) return "road-hazard";
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
            item.put("travelHeadingDegrees",
                point != null && point.hasBearing() && point.hasSpeed() && point.getSpeed() >= 1.4f
                    ? Math.round(point.getBearing()) % 360 : JSONObject.NULL);
            item.put("detectionMethod", "text-ocr");
            item.put("coordinateMethod", estimateLat == null ? "unknown" : "distance-and-heading");
            item.put("iconPattern", JSONObject.NULL);
            item.put("frameHits", 1);
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

        if (point != null && estimateLat != null && estimateLng != null) {
            cloudExecutor.execute(() -> queueAndSync(item));
        }
        updateNotification("Экран анализируется · подсказок " +
            prefs.getInt("matchesCount", 0) + " · изображения не сохраняются");
    }

    private Location getFreshLocation() {
        return getRecentLocation(MAX_GPS_ACCURACY_M);
    }

    private Location getIconLocation() {
        return getRecentLocation(MAX_ICON_GPS_ACCURACY_M);
    }

    private Location getRecentLocation(float maximumAccuracyMeters) {
        long now = System.currentTimeMillis();
        Location chosen = lastLocation == null ? null : new Location(lastLocation);
        if (chosen != null && now - chosen.getTime() >= 0L &&
            now - chosen.getTime() <= MAX_GPS_AGE_MS && chosen.hasAccuracy() &&
            chosen.getAccuracy() <= maximumAccuracyMeters) return chosen;

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
            if (fromRoadScanner.hasAccuracy() && fromRoadScanner.getAccuracy() <= maximumAccuracyMeters) return fromRoadScanner;
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
            while (pending.length() > MAX_PENDING_CLOUD_EVIDENCE) pending.remove(0);
            prefs.edit().putString("pendingCloud", pending.toString()).apply();
        }
        flushPendingCloudEvidence();
    }

    private void flushPendingCloudEvidence() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        while (active) {
            String accessKey = prefs.getString("accessKey", "");
            if (accessKey == null || accessKey.trim().length() < 32) {
                prefs.edit().putString("cloudStatus",
                    "Координаты сохранены на телефоне; открой «Астана Гид» и введи личный ключ базы.")
                    .apply();
                return;
            }
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
                long gpsTimeMs = item.optLong("gpsAt", 0L);
                body.put("gps_captured_at", gpsTimeMs > 0L
                    ? Instant.ofEpochMilli(gpsTimeMs).toString()
                    : JSONObject.NULL);
                body.put("distance_ahead_m", item.opt("distanceAheadM"));
                body.put("estimated_lat", item.opt("estimatedLat"));
                body.put("estimated_lng", item.opt("estimatedLng"));
                body.put("captured_at", item.optString("capturedAt"));
                body.put("confidence", item.optDouble("confidence", 0.0));
                body.put("detection_method", item.optString("detectionMethod", "text-ocr"));
                body.put("travel_heading_degrees", item.isNull("travelHeadingDegrees")
                    ? JSONObject.NULL : item.opt("travelHeadingDegrees"));
                body.put("icon_pattern", item.isNull("iconPattern")
                    ? JSONObject.NULL : item.opt("iconPattern"));
                body.put("frame_hits", item.optInt("frameHits", 1));
                body.put("coordinate_method", item.optString("coordinateMethod", "unknown"));
                body.put("track_id", item.optString("trackId", ""));
                body.put("screen_x_ratio", item.opt("screenXRatio"));
                body.put("screen_y_ratio", item.opt("screenYRatio"));
                body.put("vehicle_anchor_x_ratio", item.opt("vehicleAnchorXRatio"));
                body.put("vehicle_anchor_y_ratio", item.opt("vehicleAnchorYRatio"));
                body.put("track_start_lat", item.opt("trackStartLat"));
                body.put("track_start_lng", item.opt("trackStartLng"));
                long trackStartMs = item.optLong("trackStartAt", 0L);
                body.put("track_start_at", trackStartMs > 0L
                    ? Instant.ofEpochMilli(trackStartMs).toString()
                    : JSONObject.NULL);
                body.put("vehicle_speed_mps", item.opt("gpsSpeedMps"));
                body.put("vehicle_bearing_degrees", item.opt("gpsBearingDegrees"));
                connection = (HttpURLConnection) new URL(CLOUD_ENDPOINT).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("X-Astana-Guide-Key", accessKey);
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
            result.put("screenScanIconStatus", prefs.getString("screenIconStatus", "Графические значки ещё не анализировались."));
            result.put("screenScanIconSavedCount", prefs.getInt("screenIconSavedCount", 0));
            result.put("screenScanIconCandidateFrames", prefs.getInt("screenIconCandidateFrames", 0));
            result.put("screenScanIconCandidatesTotal", prefs.getInt("screenIconCandidatesTotal", 0));
            result.put("screenScanIconCandidatesLastFrame", prefs.getInt("screenIconLastFrameCount", 0));
            result.put("screenScanTrackCount", new JSONArray(prefs.getString("screenIconTracks", "[]")).length());
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
