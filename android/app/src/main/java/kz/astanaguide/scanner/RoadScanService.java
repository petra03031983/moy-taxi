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
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;

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
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("active", true).putString("lastError", "").apply();
        updateNotification("Сканирование запущено · ожидание GPS");
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
        pruneOldFrames();
        updateNotification("Сканирование работает · кадров " + count);
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
