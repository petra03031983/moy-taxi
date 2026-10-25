package kz.astanaguide.scanner;

import android.graphics.Bitmap;
import android.graphics.Color;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Conservative, on-device detector for common map-navigation UI symbols.
 *
 * This is deliberately a heuristic detector, not a claim that every provider icon is supported.
 * It never saves or uploads the screen bitmap; only normalized icon positions leave this class.
 */
public final class ScreenIconDetector {
    private static final int MAX_WIDTH = 480;
    private static final int MAX_RED_BADGE_SIZE = 15;
    private static final int MAX_LIGHT_COMPONENT_SIZE = 10;

    private ScreenIconDetector() {}

    public static final class Detection {
        public final String kind;
        public final float x;
        public final float y;
        public final double confidence;
        public final String pattern;

        Detection(String kind, float x, float y, double confidence, String pattern) {
            this.kind = kind;
            this.x = x;
            this.y = y;
            this.confidence = confidence;
            this.pattern = pattern;
        }
    }

    public static final class ScanResult {
        public final List<Detection> detections;
        public final boolean vehicleAnchorFound;
        public final boolean vehicleAnchorEstimated;
        public final float vehicleX;
        public final float vehicleY;

        ScanResult(List<Detection> detections, boolean vehicleAnchorFound, boolean vehicleAnchorEstimated,
                   float vehicleX, float vehicleY) {
            this.detections = detections;
            this.vehicleAnchorFound = vehicleAnchorFound;
            this.vehicleAnchorEstimated = vehicleAnchorEstimated;
            this.vehicleX = vehicleX;
            this.vehicleY = vehicleY;
        }
    }

    private static final class Component {
        int minX, minY, maxX, maxY, area;
        double sumX, sumY;
        final int colorClass;

        Component(int x, int y, int colorClass) {
            minX = maxX = x;
            minY = maxY = y;
            area = 1;
            sumX = x;
            sumY = y;
            this.colorClass = colorClass;
        }

        void add(int x, int y) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            area++;
            sumX += x;
            sumY += y;
        }

        int width() { return maxX - minX + 1; }
        int height() { return maxY - minY + 1; }
        float cx() { return (float) (sumX / area); }
        float cy() { return (float) (sumY / area); }
        double fillRatio() { return area / (double) Math.max(1, width() * height()); }
    }

    public static ScanResult detect(Bitmap source) {
        if (source == null || source.isRecycled() || source.getWidth() < 80 || source.getHeight() < 120) {
            return new ScanResult(new ArrayList<>(), false, false, 0.5f, 0.68f);
        }

        float scale = Math.min(1f, MAX_WIDTH / (float) source.getWidth());
        int width = Math.max(80, Math.round(source.getWidth() * scale));
        int height = Math.max(120, Math.round(source.getHeight() * scale));
        Bitmap scaled = (width == source.getWidth() && height == source.getHeight())
            ? source : Bitmap.createScaledBitmap(source, width, height, true);
        int[] pixels = new int[width * height];
        scaled.getPixels(pixels, 0, width, 0, 0, width, height);
        if (scaled != source && !scaled.isRecycled()) scaled.recycle();

        List<Component> red = components(pixels, width, height, 1);
        List<Component> yellow = components(pixels, width, height, 2);
        List<Component> green = components(pixels, width, height, 3);
        List<Component> blue = components(pixels, width, height, 4);

        List<Detection> detections = new ArrayList<>();
        detectCameraBadges(red, pixels, width, height, detections);
        detectCompositeCameraSigns(red, pixels, width, height, detections);
        detectTrafficLights(red, yellow, green, pixels, width, height, detections);
        detectTrafficLightSequencesFromPixels(red, yellow, pixels, width, height, detections);

        Component vehicle = findVehicleMarker(blue, width, height);
        boolean anchorFound = vehicle != null;
        // Navigation layouts commonly keep the vehicle arrow near the lower middle of a portrait map.
        // Use that as a weak fallback only when a road-icon candidate exists; observations remain provisional.
        boolean anchorEstimated = !anchorFound && !detections.isEmpty();
        float vehicleX = anchorFound ? vehicle.cx() / width : 0.5f;
        float vehicleY = anchorFound ? vehicle.cy() / height : 0.68f;

        List<Detection> unique = new ArrayList<>();
        for (Detection detection : detections) {
            if (detection.y < 0.04f || detection.y > 0.84f ||
                detection.x < 0.04f || detection.x > 0.96f) continue;
            boolean duplicate = false;
            for (Detection prior : unique) {
                if (prior.kind.equals(detection.kind) &&
                    Math.abs(prior.x - detection.x) < 0.025f &&
                    Math.abs(prior.y - detection.y) < 0.025f) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) unique.add(detection);
        }
        boolean useEstimatedAnchor = anchorEstimated && !unique.isEmpty();
        return new ScanResult(unique, anchorFound || useEstimatedAnchor, useEstimatedAnchor,
            vehicleX, vehicleY);
    }

    private static List<Component> components(int[] pixels, int width, int height, int colorClass) {
        int count = width * height;
        byte[] visited = new byte[count];
        int[] queue = new int[count];
        List<Component> found = new ArrayList<>();
        for (int start = 0; start < count; start++) {
            if (visited[start] != 0 || !matches(pixels[start], colorClass)) continue;
            int head = 0;
            int tail = 0;
            queue[tail++] = start;
            visited[start] = 1;
            Component component = new Component(start % width, start / width, colorClass);
            while (head < tail) {
                int index = queue[head++];
                int x = index % width;
                int y = index / width;
                if (!(x == component.minX && y == component.minY && component.area == 1)) {
                    component.add(x, y);
                }
                for (int dy = -1; dy <= 1; dy++) {
                    int ny = y + dy;
                    if (ny < 0 || ny >= height) continue;
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        int next = ny * width + nx;
                        if (visited[next] == 0 && matches(pixels[next], colorClass)) {
                            visited[next] = 1;
                            queue[tail++] = next;
                        }
                    }
                }
            }
            if (component.area >= 2) found.add(component);
        }
        return found;
    }

    private static boolean matches(int color, int colorClass) {
        int r = Color.red(color), g = Color.green(color), b = Color.blue(color);
        switch (colorClass) {
            case 1: return r >= 150 && r > g * 1.38 && r > b * 1.24;
            case 2: return r >= 155 && g >= 120 && b < 145 && r > b * 1.25 && g > b * 1.12;
            case 3: return g >= 112 && g > r * 1.20 && g > b * 1.08;
            case 4: return b >= 120 && b > r * 1.22 && b > g * 1.12;
            default: return false;
        }
    }

    private static void detectCameraBadges(List<Component> red, int[] pixels, int width, int height,
                                           List<Detection> out) {
        List<Component> small = new ArrayList<>();
        List<Component> rings = new ArrayList<>();
        for (Component c : red) {
            if (c.width() >= 4 && c.height() >= 4 &&
                c.width() <= MAX_RED_BADGE_SIZE && c.height() <= MAX_RED_BADGE_SIZE &&
                c.area >= 7 && c.area <= 130 &&
                c.width() / (float) c.height() >= 0.50f &&
                c.width() / (float) c.height() <= 2.0f &&
                hasLightAndDarkDetail(c, pixels, width, height)) {
                small.add(c);
            }
            if (c.width() >= 14 && c.height() >= 14 &&
                c.width() <= 48 && c.height() <= 48 && c.area >= 25 &&
                c.width() / (float) c.height() >= 0.62f &&
                c.width() / (float) c.height() <= 1.48f &&
                c.fillRatio() >= 0.08 && c.fillRatio() <= 0.78) {
                rings.add(c);
            }
        }

        for (Component badge : small) {
            Component matchingRing = null;
            double bestDistance = Double.MAX_VALUE;
            for (Component ring : rings) {
                float dx = badge.cx() - ring.cx();
                float dy = badge.cy() - ring.cy();
                if (dx < ring.width() * 0.18f || dx > ring.width() * 0.95f) continue;
                if (dy > -ring.height() * 0.08f || dy < -ring.height() * 0.95f) continue;
                double distance = Math.abs(dx / ring.width() - 0.48) + Math.abs(dy / ring.height() + 0.42);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    matchingRing = ring;
                }
            }
            if (matchingRing != null) {
                // Use the speed-sign center as the marker position, not the tiny camera badge.
                out.add(new Detection("speed-camera", matchingRing.cx() / width,
                    matchingRing.cy() / height, 0.62, "camera-badge-on-speed-sign"));
            } else {
                // A small red icon is only a weak candidate until it passes close to the vehicle marker.
                out.add(new Detection("speed-camera", badge.cx() / width,
                    badge.cy() / height, 0.32, "unmatched-red-camera-like-badge"));
            }
        }
    }

    /**
     * Some navigation providers join the little camera badge to the red speed-limit ring into
     * a single connected red shape. The old "small badge plus separate ring" detector misses it.
     * Detect that compound shape conservatively by looking for a distinct upper-right red protrusion.
     */
    private static void detectCompositeCameraSigns(List<Component> red, int[] pixels, int width, int height,
                                                   List<Detection> out) {
        for (Component c : red) {
            if (c.width() < 22 || c.width() > 58 || c.height() < 22 || c.height() > 58 ||
                c.area < 100 || c.area > 950 ||
                c.width() / (float) c.height() < 0.60f ||
                c.width() / (float) c.height() > 1.55f ||
                c.fillRatio() < 0.10 || c.fillRatio() > 0.38 ||
                !hasLightAndDarkDetail(c, pixels, width, height)) continue;

            int upperLeft = 0, upperRight = 0, lowerLeft = 0, lowerRight = 0;
            float midX = (c.minX + c.maxX) / 2f;
            float midY = (c.minY + c.maxY) / 2f;
            for (int y = c.minY; y <= c.maxY; y++) {
                for (int x = c.minX; x <= c.maxX; x++) {
                    if (!matches(pixels[y * width + x], 1)) continue;
                    if (x < midX && y < midY) upperLeft++;
                    else if (x >= midX && y < midY) upperRight++;
                    else if (x < midX) lowerLeft++;
                    else lowerRight++;
                }
            }
            boolean badgeProtrudesUpperRight = upperRight >= 30 &&
                upperRight > upperLeft * 1.35 &&
                upperRight > lowerRight * 1.35;
            if (!badgeProtrudesUpperRight) continue;

            // Center on the red sign rather than the small protruding badge.
            float x = (c.minX + c.maxX) / (2f * width);
            float y = (c.minY + c.maxY) / (2f * height);
            out.add(new Detection("speed-camera", x, y, 0.48,
                "compound-speed-sign-with-upper-right-camera-badge"));
        }
    }

    private static boolean hasLightAndDarkDetail(Component c, int[] pixels, int width, int height) {
        int light = 0, dark = 0;
        for (int y = Math.max(0, c.minY); y <= Math.min(height - 1, c.maxY); y++) {
            for (int x = Math.max(0, c.minX); x <= Math.min(width - 1, c.maxX); x++) {
                int p = pixels[y * width + x];
                int r = Color.red(p), g = Color.green(p), b = Color.blue(p);
                int lum = (r * 30 + g * 59 + b * 11) / 100;
                if (lum > 180 && Math.abs(r - g) < 65 && Math.abs(g - b) < 65) light++;
                if (lum < 95) dark++;
            }
        }
        return light >= 2 && dark >= 1;
    }

    private static void detectTrafficLights(List<Component> red, List<Component> yellow, List<Component> green,
                                            int[] pixels, int width, int height, List<Detection> out) {
        List<Component> reds = tinyBulbs(red);
        List<Component> yellows = tinyBulbs(yellow);
        List<Component> greens = tinyBulbs(green);

        for (Component r : reds) {
            for (Component y : yellows) {
                if (!closeBulbs(r, y)) continue;
                for (Component g : greens) {
                    if (!closeBulbs(r, g) || !closeBulbs(y, g)) continue;
                    int left = Math.min(r.minX, Math.min(y.minX, g.minX));
                    int right = Math.max(r.maxX, Math.max(y.maxX, g.maxX));
                    int top = Math.min(r.minY, Math.min(y.minY, g.minY));
                    int bottom = Math.max(r.maxY, Math.max(y.maxY, g.maxY));
                    if (bottom - top > 18 || right - left > 9) continue;
                    if (!hasDarkHousing(left, top, right, bottom, pixels, width, height)) continue;
                    float x = (r.cx() + y.cx() + g.cx()) / (3f * width);
                    float yy = (r.cy() + y.cy() + g.cy()) / (3f * height);
                    out.add(new Detection("traffic-light", x, yy, 0.48, "three-colour-traffic-light-icon"));
                }
            }
        }
    }

    /**
     * The green bulb in a navigation-map traffic-light glyph can touch the bright route line and
     * therefore merge into a large green component. This fallback checks the pixels directly below
     * a compact red-yellow pair instead of requiring three separate connected components.
     */
    private static void detectTrafficLightSequencesFromPixels(List<Component> red, List<Component> yellow,
                                                              int[] pixels, int width, int height,
                                                              List<Detection> out) {
        List<Component> reds = tinyBulbs(red);
        List<Component> yellows = tinyBulbs(yellow);
        for (Component r : reds) {
            if (r.width() > 8 || r.height() > 8) continue;
            for (Component y : yellows) {
                if (y.width() > 8 || y.height() > 8) continue;
                float dx = Math.abs(r.cx() - y.cx());
                float dy = y.cy() - r.cy();
                if (dx > 4.0f || dy < 2.0f || dy > 9.0f) continue;

                int centerX = Math.round((r.cx() + y.cx()) / 2f);
                int startY = Math.max(y.maxY, r.maxY);
                int greenCount = 0;
                double sumGreenX = 0.0, sumGreenY = 0.0;
                for (int py = Math.max(0, startY); py <= Math.min(height - 1, startY + 8); py++) {
                    for (int px = Math.max(0, centerX - 3); px <= Math.min(width - 1, centerX + 3); px++) {
                        if (matches(pixels[py * width + px], 3)) {
                            greenCount++;
                            sumGreenX += px;
                            sumGreenY += py;
                        }
                    }
                }
                if (greenCount < 3) continue;

                int left = Math.min(r.minX, y.minX);
                int right = Math.max(r.maxX, y.maxX);
                int top = Math.min(r.minY, y.minY);
                int bottom = Math.max(r.maxY, y.maxY);
                if (bottom - top > 12 || right - left > 8) continue;
                if (!hasDarkHousing(left, top, right, Math.min(height - 1, bottom + 6), pixels, width, height)) continue;

                float x = (float) ((r.cx() + y.cx() + sumGreenX / greenCount) / (3.0 * width));
                float yy = (float) ((r.cy() + y.cy() + sumGreenY / greenCount) / (3.0 * height));
                out.add(new Detection("traffic-light", x, yy, 0.42,
                    "pixel-sampled-three-colour-traffic-light-on-route"));
            }
        }
    }

    private static List<Component> tinyBulbs(List<Component> components) {
        List<Component> result = new ArrayList<>();
        for (Component c : components) {
            if (c.width() <= MAX_LIGHT_COMPONENT_SIZE && c.height() <= MAX_LIGHT_COMPONENT_SIZE &&
                c.area >= 2 && c.area <= 55 && c.fillRatio() >= 0.10) result.add(c);
        }
        return result;
    }

    private static boolean closeBulbs(Component a, Component b) {
        return Math.abs(a.cx() - b.cx()) <= 5.0f &&
            Math.abs(a.cy() - b.cy()) >= 1.5f && Math.abs(a.cy() - b.cy()) <= 15.0f;
    }

    private static boolean hasDarkHousing(int left, int top, int right, int bottom,
                                          int[] pixels, int width, int height) {
        int x0 = Math.max(0, left - 2), x1 = Math.min(width - 1, right + 2);
        int y0 = Math.max(0, top - 2), y1 = Math.min(height - 1, bottom + 2);
        int dark = 0, total = 0;
        for (int y = y0; y <= y1; y++) {
            for (int x = x0; x <= x1; x++) {
                int p = pixels[y * width + x];
                int r = Color.red(p), g = Color.green(p), b = Color.blue(p);
                int lum = (r * 30 + g * 59 + b * 11) / 100;
                if (lum < 90 && Math.abs(r - g) < 55 && Math.abs(g - b) < 55) dark++;
                total++;
            }
        }
        return total > 0 && dark / (double) total >= 0.08;
    }

    private static Component findVehicleMarker(List<Component> blue, int width, int height) {
        List<Component> candidates = new ArrayList<>();
        for (Component c : blue) {
            float x = c.cx() / width, y = c.cy() / height;
            if (c.width() < 7 || c.height() < 8 || c.width() > 42 || c.height() > 58) continue;
            if (c.area < 24 || c.area > 900 || c.fillRatio() < 0.12) continue;
            // Reject horizontal blue parking labels/buttons; the moving vehicle arrow is usually taller.
            if (c.height() < c.width() * 0.78f) continue;
            if (x < 0.38f || x > 0.62f || y < 0.42f || y > 0.82f) continue;
            candidates.add(c);
        }
        if (candidates.isEmpty()) return null;
        candidates.sort(Comparator.comparingDouble(c ->
            Math.abs(c.cx() / width - 0.5) * 1.1 +
            Math.abs(c.cy() / height - 0.66) -
            Math.min(0.16, c.fillRatio() * 0.16)));
        return candidates.get(0);
    }
}
