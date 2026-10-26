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
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.TotalCaptureResult;
import android.media.Image;
import android.media.ImageReader;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;
import org.tensorflow.lite.support.image.TensorImage;
import org.tensorflow.lite.task.core.BaseOptions;
import org.tensorflow.lite.support.label.Category;
import org.tensorflow.lite.task.vision.detector.Detection;
import org.tensorflow.lite.task.vision.detector.ObjectDetector;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.List;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RoadScanService extends Service {
    public static final String ACTION_START = "kz.astanaguide.scanner.START";
    public static final String ACTION_STOP = "kz.astanaguide.scanner.STOP";
    public static final String ACTION_MARK = "kz.astanaguide.scanner.MARK";
    public static final String EXTRA_KIND = "kind";
    private static final String CHANNEL_ID = "astana_guide_scan";
    private static final int NOTIFICATION_ID = 7401;
    private static final String PREFS = "road_scan_status";
    private static final long CAPTURE_INTERVAL_MS = 8000L;
    private static final int MAX_SAVED_FRAMES = 4200;
    private static final long MAX_STORAGE_BYTES = 280L * 1024L * 1024L;
    private static final Object STATE_LOCK = new Object();

    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private LocationManager locationManager;
    private volatile Location lastLocation;
    private LocationListener locationListener;
    private volatile boolean scanning = false;
    private boolean captureInFlight = false;
    private boolean cameraReady = false;
    private String pendingObservationKind = null;
    private Location pendingCaptureLocation = null;
    private long lastCapturedAt = 0L;
    private File scanDirectory;
    private File frameDirectory;
    private File metadataFile;
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;
    private static final String ROAD_DETECTOR_MODEL = "lite-model_efficientdet_lite0_detection_metadata_1.tflite";
    private static final long MAX_AUTO_GPS_AGE_MS = 25000L;
    private static final float MAX_AUTO_GPS_ACCURACY_METERS = 35.0f;
    private static final float AUTO_DETECTION_MIN_CONFIDENCE = 0.50f;
    private volatile ObjectDetector roadObjectDetector;
    private boolean detectorInitializationAttempted = false;
    private final Object detectorLock = new Object();
    private static final String ROAD_SYNC_ENDPOINT = "https://astana-map-roads.vercel.app/api/road-observations";
    private static final Object CLOUD_QUEUE_LOCK = new Object();
    private final ExecutorService cloudSyncExecutor = Executors.newSingleThreadExecutor();
    private final Runnable captureLoop = new Runnable() {
        @Override public void run() {
            if (!scanning) return;
            captureFrame(null);
            if (cameraHandler != null) cameraHandler.postDelayed(this, CAPTURE_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannel();
        cameraThread = new HandlerThread("AstanaGuideCamera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        File root = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (root == null) root = getFilesDir();
        scanDirectory = new File(root, "astana-guide-road-scan");
        frameDirectory = new File(scanDirectory, "frames");
        if (!frameDirectory.exists() && !frameDirectory.mkdirs()) {
            setLastError(this, "Не удалось создать папку для дорожных кадров.");
        }
        metadataFile = new File(scanDirectory, "observations.jsonl");
        synchronized (STATE_LOCK) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action)) {
            startForegroundCompat();
            if (!scanning) startScanningInternal();
        } else if (ACTION_MARK.equals(action)) {
            if (scanning) {
                String kind = intent.getStringExtra(EXTRA_KIND);
                requestMarkedCapture(kind == null ? "unknown" : kind);
            } else {
                setLastError(this, "Сканирование остановлено. Запусти его снова.");
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        return START_STICKY;
    }

    private void startForegroundCompat() {
        Notification notification = buildNotification("Подключаем камеру и GPS…");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA |
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startScanningInternal() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            setLastError(this, "Разреши приложению доступ к камере и точному местоположению.");
            stopSelf();
            return;
        }
        scanning = true;
        // Keep the CPU awake so timed camera captures and GPS updates continue
        // while Android dims or locks the screen. Battery use will be higher.
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null && (wakeLock == null || !wakeLock.isHeld())) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AstanaGuide:RoadScan");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("active", true).putString("lastError", "").apply();
        updateNotification("Сканирование запущено · ожидание GPS");
        cloudSyncExecutor.execute(this::flushPendingCloudObservations);
        startLocationUpdates();
        if (cameraHandler != null) cameraHandler.post(this::openBackCamera);
    }

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locationManager == null) {
            setLastError(this, "Служба GPS недоступна на телефоне.");
            return;
        }
        locationListener = new LocationListener() {
            @Override public void onLocationChanged(Location location) {
                if (location == null) return;
                lastLocation = new Location(location);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString("lat", Double.toString(location.getLatitude()))
                    .putString("lng", Double.toString(location.getLongitude()))
                    .putFloat("accuracy", location.getAccuracy())
                    .putFloat("heading", location.hasBearing() ? location.getBearing() : -1f)
                    .putFloat("speedMps", location.hasSpeed() ? location.getSpeed() : -1f)
                    .putLong("gpsAt", System.currentTimeMillis())
                    .apply();
                updateNotification("Сканирование работает · GPS подключён · кадров " +
                    getSharedPreferences(PREFS, MODE_PRIVATE).getInt("framesCount", 0));
            }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {
                setLastError(RoadScanService.this, "GPS выключен. Включи местоположение телефона.");
            }
        };
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2500L, 0f, locationListener, Looper.getMainLooper());
            if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000L, 0f, locationListener, Looper.getMainLooper());
            }
            Location old = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (old == null) old = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (old != null) lastLocation = new Location(old);
        } catch (SecurityException error) {
            setLastError(this, "Нет разрешения GPS: " + error.getMessage());
        } catch (RuntimeException error) {
            setLastError(this, "Не удалось запустить GPS: " + error.getMessage());
        }
    }

    private void openBackCamera() {
        if (!scanning || cameraDevice != null) return;
        try {
            CameraManager manager = (CameraManager) getSystemService(CAMERA_SERVICE);
            if (manager == null) throw new IllegalStateException("Служба камеры недоступна");
            String selectedId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    selectedId = id;
                    break;
                }
            }
            if (selectedId == null) throw new IllegalStateException("Задняя камера не найдена");

            CameraCharacteristics characteristics = manager.getCameraCharacteristics(selectedId);
            android.util.Size chosen = chooseJpegSize(characteristics);
            imageReader = ImageReader.newInstance(chosen.getWidth(), chosen.getHeight(), ImageFormat.JPEG, 2);
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = null;
                try {
                    image = reader.acquireNextImage();
                    if (image == null) return;
                    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    saveCapturedFrame(bytes);
                } catch (Exception error) {
                    setLastError(this, "Не удалось сохранить кадр: " + error.getMessage());
                } finally {
                    if (image != null) image.close();
                    synchronized (STATE_LOCK) { captureInFlight = false; }
                }
            }, cameraHandler);

            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                throw new SecurityException("Нет разрешения на камеру");
            }
            manager.openCamera(selectedId, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice camera) {
                    if (!scanning) {
                        camera.close();
                        return;
                    }
                    cameraDevice = camera;
                    try {
                        camera.createCaptureSession(Arrays.asList(imageReader.getSurface()), new CameraCaptureSession.StateCallback() {
                            @Override public void onConfigured(CameraCaptureSession session) {
                                if (!scanning) {
                                    session.close();
                                    return;
                                }
                                captureSession = session;
                                cameraReady = true;
                                setLastError(RoadScanService.this, "");
                                updateNotification("Сканирование работает · камера подключена");
                                if (cameraHandler != null) {
                                    cameraHandler.removeCallbacks(captureLoop);
                                    cameraHandler.post(captureLoop);
                                }
                            }
                            @Override public void onConfigureFailed(CameraCaptureSession session) {
                                setLastError(RoadScanService.this, "Телефон не смог настроить камеру. Попробуй перезапустить сканирование.");
                            }
                        }, cameraHandler);
                    } catch (CameraAccessException error) {
                        setLastError(RoadScanService.this, "Ошибка настройки камеры: " + error.getMessage());
                    }
                }

                @Override public void onDisconnected(CameraDevice camera) {
                    camera.close();
                    if (cameraDevice == camera) cameraDevice = null;
                    cameraReady = false;
                    setLastError(RoadScanService.this, "Камера отключилась. Проверь, не использует ли её другое приложение.");
                }

                @Override public void onError(CameraDevice camera, int error) {
                    camera.close();
                    if (cameraDevice == camera) cameraDevice = null;
                    cameraReady = false;
                    setLastError(RoadScanService.this, "Ошибка камеры (" + error + "). Возможно, она занята другим приложением.");
                }
            }, cameraHandler);
        } catch (SecurityException error) {
            setLastError(this, "Разреши доступ к камере: " + error.getMessage());
        } catch (CameraAccessException | RuntimeException error) {
            setLastError(this, "Не удалось открыть камеру: " + error.getMessage());
        }
    }

    private android.util.Size chooseJpegSize(CameraCharacteristics characteristics) {
        android.util.Size[] sizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            .getOutputSizes(ImageFormat.JPEG);
        android.util.Size chosen = new android.util.Size(640, 480);
        long bestArea = 0;
        if (sizes != null) {
            for (android.util.Size size : sizes) {
                if (size.getWidth() <= 1280 && size.getHeight() <= 720) {
                    long area = (long) size.getWidth() * size.getHeight();
                    if (area > bestArea) {
                        chosen = size;
                        bestArea = area;
                    }
                }
            }
        }
        return chosen;
    }

    private void captureFrame(String markedKind) {
        if (!scanning || !cameraReady || captureSession == null || cameraDevice == null) return;
        Location point = lastLocation == null ? null : new Location(lastLocation);
        if (markedKind != null && point == null) {
            setLastError(this, "Ждём GPS, чтобы привязать отметку к карте.");
            return;
        }
        if (point != null && System.currentTimeMillis() - point.getTime() > 45000L && markedKind != null) {
            setLastError(this, "GPS устарел. Подожди точные координаты.");
            return;
        }
        synchronized (STATE_LOCK) {
            if (captureInFlight) {
                if (markedKind != null) setLastError(this, "Предыдущий кадр ещё сохраняется. Подожди секунду.");
                return;
            }
            captureInFlight = true;
            pendingObservationKind = markedKind;
            pendingCaptureLocation = point;
        }
        try {
            CaptureRequest.Builder builder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            builder.addTarget(imageReader.getSurface());
            builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
            builder.set(CaptureRequest.JPEG_QUALITY, (byte) 55);
            captureSession.capture(builder.build(), new CameraCaptureSession.CaptureCallback() {
                @Override public void onCaptureCompleted(CameraCaptureSession session, CaptureRequest request, TotalCaptureResult result) {
                    lastCapturedAt = System.currentTimeMillis();
                }
                @Override public void onCaptureFailed(CameraCaptureSession session, CaptureRequest request, android.hardware.camera2.CaptureFailure failure) {
                    synchronized (STATE_LOCK) { captureInFlight = false; }
                    setLastError(RoadScanService.this, "Камера не смогла снять кадр.");
                }
            }, cameraHandler);
        } catch (CameraAccessException | IllegalStateException error) {
            synchronized (STATE_LOCK) { captureInFlight = false; }
            setLastError(this, "Не удалось сделать кадр: " + error.getMessage());
        }
    }

    private void saveCapturedFrame(byte[] bytes) throws IOException {
        String kind;
        Location point;
        synchronized (STATE_LOCK) {
            kind = pendingObservationKind;
            pendingObservationKind = null;
            point = pendingCaptureLocation == null ? null : new Location(pendingCaptureLocation);
            pendingCaptureLocation = null;
        }
        if (!scanning) return;
        if (point == null) point = lastLocation == null ? null : new Location(lastLocation);
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(new Date());
        File file = new File(frameDirectory, "road_" + stamp + ".jpg");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            output.flush();
        }

        JSONObject metadata = new JSONObject();
        String id = file.getName().replace(".jpg", "");
        try {
            metadata.put("id", id);
            metadata.put("capturedAt", Instant.now().toString());
            metadata.put("lat", point == null ? JSONObject.NULL : point.getLatitude());
            metadata.put("lng", point == null ? JSONObject.NULL : point.getLongitude());
            metadata.put("accuracy", point == null ? JSONObject.NULL : point.getAccuracy());
            metadata.put("heading", point != null && point.hasBearing() ? point.getBearing() : JSONObject.NULL);
            metadata.put("speedMps", point != null && point.hasSpeed() ? point.getSpeed() : JSONObject.NULL);
            metadata.put("framePath", file.getAbsolutePath());
            metadata.put("kind", kind == null ? JSONObject.NULL : kind);
            metadata.put("source", "android-foreground-camera");
        } catch (Exception ignored) {}

        synchronized (STATE_LOCK) {
            try (FileWriter writer = new FileWriter(metadataFile, true)) {
                writer.write(metadata.toString());
                writer.write(System.lineSeparator());
            }
        }

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        int count = prefs.getInt("framesCount", 0) + 1;
        android.content.SharedPreferences.Editor editor = prefs.edit()
            .putInt("framesCount", count)
            .putLong("lastCaptureAt", System.currentTimeMillis())
            .putString("lastError", "");
        if (point != null) {
            editor.putString("lat", Double.toString(point.getLatitude()))
                .putString("lng", Double.toString(point.getLongitude()));
        }
        if (kind != null) {
            JSONArray list;
            try { list = new JSONArray(prefs.getString("observations", "[]")); }
            catch (Exception error) { list = new JSONArray(); }
            JSONObject observation = new JSONObject();
            try {
                observation.put("id", id);
                observation.put("capturedAt", metadata.optString("capturedAt"));
                observation.put("lat", point == null ? JSONObject.NULL : point.getLatitude());
                observation.put("lng", point == null ? JSONObject.NULL : point.getLongitude());
                observation.put("accuracy", point == null ? JSONObject.NULL : point.getAccuracy());
                observation.put("heading", metadata.opt("heading"));
                observation.put("speedMps", metadata.opt("speedMps"));
                observation.put("kind", kind);
                observation.put("framePath", file.getAbsolutePath());
                observation.put("reviewStatus", "needs-review");
                observation.put("source", "android-foreground-camera");
            } catch (Exception ignored) {}
            list.put(observation);
            while (list.length() > 500) list.remove(0);
            editor.putInt("observationsCount", Math.max(prefs.getInt("observationsCount", 0) + 1, list.length()))
                .putString("observations", list.toString());
        }
        editor.apply();
        // Local inference is deliberately limited to classes the bundled COCO model knows:
        // traffic lights and STOP signs. Speed-limit signs require a separate trained model.
        detectAndSaveRoadObjects(bytes, id, point, file);
        pruneOldFrames();
        updateNotification("Сканирование работает · кадров " + count);
    }

    private ObjectDetector getRoadObjectDetector() throws Exception {
        if (roadObjectDetector != null) return roadObjectDetector;
        synchronized (detectorLock) {
            if (roadObjectDetector != null) return roadObjectDetector;
            if (detectorInitializationAttempted) {
                throw new IllegalStateException("Модель ИИ не смогла загрузиться.");
            }
            detectorInitializationAttempted = true;
            ObjectDetector.ObjectDetectorOptions options = ObjectDetector.ObjectDetectorOptions.builder()
                .setBaseOptions(BaseOptions.builder().setNumThreads(2).build())
                .setScoreThreshold(AUTO_DETECTION_MIN_CONFIDENCE)
                .setMaxResults(10)
                .setLabelAllowList(Arrays.asList("traffic light", "stop sign"))
                .build();
            roadObjectDetector = ObjectDetector.createFromFileAndOptions(this, ROAD_DETECTOR_MODEL, options);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean("detectorReady", true)
                .putString("detectorStatus", "ИИ готов: светофоры и знаки STOP")
                .apply();
            return roadObjectDetector;
        }
    }

    private void detectAndSaveRoadObjects(byte[] jpegBytes, String frameId, Location point, File frameFile) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (point == null || !point.hasAccuracy() ||
            System.currentTimeMillis() - point.getTime() < 0L ||
            System.currentTimeMillis() - point.getTime() > MAX_AUTO_GPS_AGE_MS ||
            point.getAccuracy() > MAX_AUTO_GPS_ACCURACY_METERS) {
            prefs.edit().putString("detectorStatus", "ИИ ждёт свежий GPS с точностью до 35 м.").apply();
            return;
        }

        Bitmap bitmap = null;
        try {
            bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.length);
            if (bitmap == null) {
                prefs.edit().putString("detectorStatus", "ИИ пропустил кадр: не удалось прочитать изображение.").apply();
                return;
            }
            ObjectDetector detector = getRoadObjectDetector();
            List<Detection> detections = detector.detect(TensorImage.fromBitmap(bitmap));
            int saved = 0;
            int seen = 0;
            String lastLabel = "";
            float bestConfidence = 0f;
            for (Detection detection : detections) {
                for (Category category : detection.getCategories()) {
                    String label = category.getLabel() == null ? "" : category.getLabel().trim().toLowerCase(Locale.US);
                    float confidence = category.getScore();
                    if (confidence < AUTO_DETECTION_MIN_CONFIDENCE) continue;
                    String kind;
                    if ("traffic light".equals(label)) {
                        kind = "traffic-light";
                    } else if ("stop sign".equals(label)) {
                        kind = "traffic-sign";
                    } else {
                        continue;
                    }
                    seen++;
                    if (confidence > bestConfidence) {
                        bestConfidence = confidence;
                        lastLabel = label;
                    }
                    if (appendAutoObservation(kind, label, confidence, frameId, frameFile, point)) saved++;
                    break;
                }
            }
            prefs.edit()
                .putBoolean("detectorReady", true)
                .putLong("detectorLastRunAt", System.currentTimeMillis())
                .putString("detectorStatus", saved > 0
                    ? "ИИ добавил " + saved + " отмет. на карту: " + lastLabel
                    : seen > 0
                        ? "ИИ обнаружил объект рядом с уже сохранённой отметкой."
                        : "ИИ работает: светофор или знак STOP в кадре не найден.")
                .apply();
        } catch (Exception error) {
            String message = error.getMessage() == null ? "неизвестная ошибка" : error.getMessage();
            if (message.length() > 150) message = message.substring(0, 150);
            prefs.edit()
                .putBoolean("detectorReady", roadObjectDetector != null)
                .putString("detectorStatus", "ИИ не смог обработать кадр: " + message)
                .apply();
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private boolean appendAutoObservation(String kind, String label, float confidence,
                                         String frameId, File frameFile, Location point) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONArray list;
        try {
            list = new JSONArray(prefs.getString("observations", "[]"));
        } catch (Exception error) {
            list = new JSONArray();
        }
        long now = System.currentTimeMillis();
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject prior = list.optJSONObject(i);
            if (prior == null || !kind.equals(prior.optString("kind"))) continue;
            double priorLat = prior.optDouble("lat", Double.NaN);
            double priorLng = prior.optDouble("lng", Double.NaN);
            if (!Double.isFinite(priorLat) || !Double.isFinite(priorLng)) continue;
            long priorAt = 0L;
            try { priorAt = Instant.parse(prior.optString("capturedAt")).toEpochMilli(); }
            catch (Exception ignored) {}
            if (priorAt > 0L && now - priorAt >= 0L && now - priorAt < 10L * 60L * 1000L &&
                distanceMeters(point.getLatitude(), point.getLongitude(), priorLat, priorLng) < 20.0) {
                return false;
            }
        }

        JSONObject observation = new JSONObject();
        try {
            observation.put("id", "ai_" + UUID.randomUUID());
            observation.put("capturedAt", Instant.now().toString());
            observation.put("lat", point.getLatitude());
            observation.put("lng", point.getLongitude());
            observation.put("accuracy", point.getAccuracy());
            observation.put("heading", point.hasBearing() ? point.getBearing() : JSONObject.NULL);
            observation.put("speedMps", point.hasSpeed() ? point.getSpeed() : JSONObject.NULL);
            observation.put("kind", kind);
            observation.put("detectedLabel", label);
            observation.put("confidence", confidence);
            observation.put("model", "EfficientDet-Lite0-COCO");
            observation.put("frameId", frameId);
            observation.put("framePath", frameFile.getAbsolutePath());
            observation.put("reviewStatus", "needs-review");
            observation.put("source", "android-ai-detection");
            observation.put("syncStatus", "local-only");
        } catch (Exception ignored) {}
        list.put(observation);
        while (list.length() > 500) list.remove(0);
        prefs.edit()
            .putString("observations", list.toString())
            .putInt("observationsCount", prefs.getInt("observationsCount", 0) + 1)
            .putInt("autoDetectionsCount", prefs.getInt("autoDetectionsCount", 0) + 1)
            .putString("detectorLastLabel", label)
            .putLong("detectorLastObservationAt", now)
            .apply();
        queueCloudObservation(observation);
        return true;
    }


    private void queueCloudObservation(JSONObject observation) {
        try {
            JSONObject pendingItem = new JSONObject(observation.toString());
            pendingItem.put("sourceId", observation.optString("id"));
            pendingItem.put("syncStatus", "pending");
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            synchronized (CLOUD_QUEUE_LOCK) {
                JSONArray pending;
                try { pending = new JSONArray(prefs.getString("pendingCloudObservations", "[]")); }
                catch (Exception ignored) { pending = new JSONArray(); }
                String sourceId = pendingItem.optString("sourceId");
                boolean exists = false;
                for (int i = 0; i < pending.length(); i++) {
                    JSONObject item = pending.optJSONObject(i);
                    if (item != null && sourceId.equals(item.optString("sourceId"))) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) pending.put(pendingItem);
                while (pending.length() > 1500) pending.remove(0);
                prefs.edit().putString("pendingCloudObservations", pending.toString())
                    .putString("cloudSyncStatus", "Есть новые наблюдения для отправки")
                    .commit();
            }
            cloudSyncExecutor.execute(this::flushPendingCloudObservations);
        } catch (Exception error) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("cloudSyncStatus", "Не удалось поставить отметку в очередь отправки")
                .apply();
        }
    }

    private void flushPendingCloudObservations() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        while (true) {
            String accessKey = prefs.getString("accessKey", "");
            if (accessKey == null || accessKey.trim().length() < 32) {
                prefs.edit().putString("cloudSyncStatus",
                    "Координаты сохранены на телефоне; открой «Астана Гид» и введи личный ключ базы.")
                    .apply();
                return;
            }
            JSONArray pending;
            synchronized (CLOUD_QUEUE_LOCK) {
                try { pending = new JSONArray(prefs.getString("pendingCloudObservations", "[]")); }
                catch (Exception ignored) { pending = new JSONArray(); }
            }
            if (pending.length() == 0) {
                prefs.edit().putString("cloudSyncStatus", "Все доступные отметки отправлены")
                    .putLong("cloudLastSyncAt", System.currentTimeMillis()).apply();
                return;
            }

            JSONArray batch = new JSONArray();
            Set<String> sendingIds = new HashSet<>();
            for (int i = 0; i < pending.length() && i < 40; i++) {
                JSONObject item = pending.optJSONObject(i);
                if (item == null) continue;
                try {
                    JSONObject row = new JSONObject();
                    String sourceId = item.optString("sourceId", item.optString("id"));
                    row.put("source_id", sourceId);
                    row.put("kind", item.optString("kind"));
                    row.put("lat", item.getDouble("lat"));
                    row.put("lng", item.getDouble("lng"));
                    row.put("accuracy_m", item.getDouble("accuracy"));
                    row.put("confidence", item.getDouble("confidence"));
                    row.put("detected_label", item.optString("detectedLabel"));
                    row.put("model", item.optString("model", "EfficientDet-Lite0-COCO"));
                    row.put("captured_at", item.optString("capturedAt"));
                    batch.put(row);
                    sendingIds.add(sourceId);
                } catch (Exception ignored) {}
            }
            if (batch.length() == 0) {
                prefs.edit().putString("cloudSyncStatus", "Очередь содержит некорректные отметки").apply();
                return;
            }

            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(ROAD_SYNC_ENDPOINT).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("X-Astana-Guide-Key", accessKey);
                JSONObject payload = new JSONObject();
                payload.put("observations", batch);
                byte[] body = payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                    output.flush();
                }
                int code = connection.getResponseCode();
                InputStream response = code >= 200 && code < 400
                    ? connection.getInputStream() : connection.getErrorStream();
                if (response != null) {
                    try (InputStream stream = response) {
                        byte[] discard = new byte[512];
                        while (stream.read(discard) != -1) { }
                    }
                }
                if (code < 200 || code >= 300) {
                    prefs.edit().putString("cloudSyncStatus", "Отправка не удалась (HTTP " + code + "). Повторим позже.")
                        .apply();
                    return;
                }

                synchronized (CLOUD_QUEUE_LOCK) {
                    JSONArray current;
                    try { current = new JSONArray(prefs.getString("pendingCloudObservations", "[]")); }
                    catch (Exception ignored) { current = new JSONArray(); }
                    JSONArray remaining = new JSONArray();
                    for (int i = 0; i < current.length(); i++) {
                        JSONObject item = current.optJSONObject(i);
                        if (item != null && !sendingIds.contains(item.optString("sourceId"))) remaining.put(item);
                    }
                    prefs.edit().putString("pendingCloudObservations", remaining.toString())
                        .putString("cloudSyncStatus", remaining.length() == 0
                            ? "Отметки отправлены на общую карту как предварительные"
                            : "Отправлена часть отметок, продолжаем синхронизацию")
                        .putLong("cloudLastSyncAt", System.currentTimeMillis()).commit();
                    updateLocalSyncStatuses(sendingIds, "synced");
                }
            } catch (Exception error) {
                prefs.edit().putString("cloudSyncStatus", "Нет связи с сервером. Отметки сохранены на телефоне.")
                    .apply();
                return;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }

    private void updateLocalSyncStatuses(Set<String> ids, String status) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONArray observations;
        try { observations = new JSONArray(prefs.getString("observations", "[]")); }
        catch (Exception ignored) { return; }
        boolean changed = false;
        for (int i = 0; i < observations.length(); i++) {
            JSONObject item = observations.optJSONObject(i);
            if (item == null || !ids.contains(item.optString("id"))) continue;
            try { item.put("syncStatus", status); changed = true; } catch (Exception ignored) {}
        }
        if (changed) prefs.edit().putString("observations", observations.toString()).apply();
    }

    private static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double earth = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2.0) * Math.sin(dLng / 2.0);
        return earth * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0.0, 1.0 - a)));
    }

    private void requestMarkedCapture(String kind) {
        if (kind == null || kind.trim().isEmpty()) kind = "unknown";
        captureFrame(kind);
    }

    private void pruneOldFrames() {
        File[] files = frameDirectory.listFiles((dir, name) -> name.endsWith(".jpg"));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long bytes = 0;
        for (File f : files) bytes += f.length();
        int excess = files.length - MAX_SAVED_FRAMES;
        for (File file : files) {
            if (excess <= 0 && bytes <= MAX_STORAGE_BYTES) break;
            long size = file.length();
            if (file.delete()) {
                excess--;
                bytes -= size;
            }
        }
    }

    private void stopScanningInternal() {
        scanning = false;
        cameraReady = false;
        if (cameraHandler != null) cameraHandler.removeCallbacks(captureLoop);
        try {
            if (locationManager != null && locationListener != null) locationManager.removeUpdates(locationListener);
        } catch (SecurityException ignored) {}
        locationListener = null;
        locationManager = null;
        if (captureSession != null) {
            try { captureSession.stopRepeating(); } catch (Exception ignored) {}
            captureSession.close();
            captureSession = null;
        }
        if (cameraDevice != null) {
            cameraDevice.close();
            cameraDevice = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        synchronized (STATE_LOCK) {
            captureInFlight = false;
            pendingObservationKind = null;
            pendingCaptureLocation = null;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("active", false).apply();
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (RuntimeException ignored) {}
        }
        wakeLock = null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep the user-started foreground scanner alive when the map is swiped away.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopScanningInternal();
        updateNotification("Сканирование остановлено");
        if (notificationManager != null) notificationManager.cancel(NOTIFICATION_ID);
        if (roadObjectDetector != null) {
            try { roadObjectDetector.close(); } catch (Exception ignored) {}
            roadObjectDetector = null;
        }
        cloudSyncExecutor.shutdown();
        if (cameraThread != null) {
            cameraThread.quitSafely();
            try { cameraThread.join(1000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Астана Гид — сканирование", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Показывает, что фоновая камера и GPS собирают дорожные кадры.");
            channel.setShowBadge(false);
            notificationManager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String message) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, RoadScanService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 2, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Астана Гид · сканер")
            .setContentText(message)
            .setContentIntent(openPending)
            .setOngoing(scanning)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Остановить", stopPending).build());
        return builder.build();
    }

    private void startForegroundCompatSafely() {
        startForegroundCompat();
    }

    private void updateNotification(String message) {
        if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification(message));
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    public static void setLastError(Context context, String error) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("lastError", error == null ? "" : error).apply();
    }

    public static boolean isScanning(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("active", false);
    }

    public static String getExportFolderHint(Context context) {
        File root = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (root == null) root = context.getFilesDir();
        return new File(new File(root, "astana-guide-road-scan"), "frames").getAbsolutePath();
    }

    public static String getStatusJson(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONObject result = new JSONObject();
        try {
            result.put("active", prefs.getBoolean("active", false));
            result.put("framesCount", prefs.getInt("framesCount", 0));
            result.put("observationsCount", prefs.getInt("observationsCount", 0));
            result.put("autoDetectionsCount", prefs.getInt("autoDetectionsCount", 0));
            result.put("detectorReady", prefs.getBoolean("detectorReady", false));
            result.put("detectorStatus", prefs.getString("detectorStatus", "ИИ ещё не запускался"));
            result.put("detectorLastLabel", prefs.getString("detectorLastLabel", ""));
            result.put("detectorLastRunAt", prefs.getLong("detectorLastRunAt", 0));
            result.put("cloudSyncStatus", prefs.getString("cloudSyncStatus", "Синхронизация ещё не запускалась"));
            result.put("cloudPendingCount", new JSONArray(prefs.getString("pendingCloudObservations", "[]")).length());
            result.put("cloudLastSyncAt", prefs.getLong("cloudLastSyncAt", 0));
            String latValue = prefs.getString("lat", "");
            String lngValue = prefs.getString("lng", "");
            result.put("lat", latValue.isEmpty() ? JSONObject.NULL : Double.parseDouble(latValue));
            result.put("lng", lngValue.isEmpty() ? JSONObject.NULL : Double.parseDouble(lngValue));
            result.put("accuracy", prefs.contains("accuracy") ? prefs.getFloat("accuracy", 0f) : JSONObject.NULL);
            result.put("gpsAt", prefs.getLong("gpsAt", 0));
            result.put("lastCaptureAt", prefs.getLong("lastCaptureAt", 0));
            result.put("lastError", prefs.getString("lastError", ""));
            result.put("folder", getExportFolderHint(context));
            result.put("observations", new JSONArray(prefs.getString("observations", "[]")));
        } catch (Exception ignored) {}
        return result.toString();
    }

}
