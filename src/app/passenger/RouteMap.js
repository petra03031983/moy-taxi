"use client";
import { useEffect, useRef, useState } from "react";

export default function RouteMap({ pickupPoint, destinationPoint, routeGeometry, pickupInfo = null, destinationInfo = null, showZoomButtons = false }) {
  const element = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const routeLineRef = useRef(null);
  const movingArrowRef = useRef(null);
  const routePointsRef = useRef([]);
  const routeProgressRef = useRef(-1);
  const positionRef = useRef(null);
  const watchId = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [positionVersion, redraw] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loadTimer = null;
    let script = null;
    let loadHandler = null;
    let errorHandler = null;
    const fail = () => {
      if (cancelled) return;
      setFailed(true);
      setReady(false);
    };
    const init = () => {
      if (cancelled || !element.current || !window.L || map.current) return;
      try {
        const L = window.L;
        map.current = L.map(element.current, { zoomControl: !showZoomButtons, scrollWheelZoom: false }).setView(
          pickupPoint ? [pickupPoint.lat, pickupPoint.lng] : [51.1694, 71.4491],
          pickupPoint ? 13 : 11
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map.current);
        layers.current = L.layerGroup().addTo(map.current);
        setFailed(false);
        setReady(true);
        requestAnimationFrame(() => map.current?.invalidateSize());
      } catch {
        fail();
      }
    };
    if (!document.querySelector('link[data-leaflet-css="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.leafletCss = "1";
      document.head.appendChild(link);
    }
    if (window.L) {
      init();
    } else {
      script = document.querySelector('script[data-leaflet-js="1"]');
      if (script?.dataset.loaded === "1") {
        fail();
      } else {
        if (!script) {
          script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.dataset.leafletJs = "1";
        }
        loadHandler = () => {
          if (script) script.dataset.loaded = "1";
          if (window.L) init();
          else fail();
        };
        errorHandler = fail;
        script.addEventListener("load", loadHandler);
        script.addEventListener("error", errorHandler);
        if (!script.isConnected) document.head.appendChild(script);
        loadTimer = window.setTimeout(fail, 10000);
      }
    }
    return () => {
      cancelled = true;
      if (loadTimer) window.clearTimeout(loadTimer);
      if (script && loadHandler) script.removeEventListener("load", loadHandler);
      if (script && errorHandler) script.removeEventListener("error", errorHandler);
      if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      if (map.current) {
        map.current.remove();
        map.current = null;
        layers.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || !window.L || !map.current || !layers.current) return;
    const L = window.L;
    const group = layers.current;
    group.clearLayers();
    routeLineRef.current = null;
    movingArrowRef.current = null;
    routePointsRef.current = [];
    routeProgressRef.current = -1;
    const bounds = [];
    const escapeHtml = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    const marker = (point, letter, title, color, info) => {
      if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return;
      const latLng = [Number(point.lat), Number(point.lng)];
      bounds.push(latLng);
      const hasInfo = Boolean(info && (info.timeText || info.distanceText));
      const labelHtml = hasInfo
        ? '<div class="moy-route-pin"><div class="moy-route-eta-label moy-route-eta-label-' + letter.toLowerCase() + '"><b>' + escapeHtml(info.timeText || "В пути") + '</b><span>' + escapeHtml(info.distanceText || "") + '</span></div><span class="moy-route-marker-dot" style="background:' + color + '">' + letter + '</span></div>'
        : '<span style="background:' + color + '">' + letter + '</span>';
      const icon = L.divIcon({
        className: "moy-route-marker" + (hasInfo ? " moy-route-marker-labeled" : ""),
        html: labelHtml,
        iconSize: hasInfo ? [118, 94] : [30, 30],
        iconAnchor: hasInfo ? [59, 92] : [15, 15]
      });
      L.marker(latLng, { icon }).bindPopup(title).addTo(group);
    };
    marker(pickupPoint, "A", "Откуда забрать", "#367cf5", pickupInfo);
    marker(destinationPoint, "B", "Куда ехать", "#299958", destinationInfo);

    const line = Array.isArray(routeGeometry)
      ? routeGeometry
          .filter(pair => Array.isArray(pair) && Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1])))
          .map(pair => [Number(pair[1]), Number(pair[0])])
      : [];
    routePointsRef.current = line;

    if (line.length > 1) {
      routeLineRef.current = L.polyline(line, {
        color: "#146b4b",
        weight: 7,
        opacity: 0.94,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(group);
      line.forEach(point => bounds.push(point));
    }

    if (bounds.length > 1) {
      map.current.fitBounds(L.latLngBounds(bounds), { padding: (pickupInfo || destinationInfo) ? [24, 96] : [24, 24], maxZoom: 15 });
    } else if (bounds.length === 1) {
      map.current.setView(bounds[0], 14);
    }
  }, [ready, pickupPoint?.lat, pickupPoint?.lng, destinationPoint?.lat, destinationPoint?.lng, routeGeometry, pickupInfo?.timeText, pickupInfo?.distanceText, destinationInfo?.timeText, destinationInfo?.distanceText]);

  useEffect(() => {
    const L = window.L;
    const points = routePointsRef.current;
    if (!ready || !L || !map.current || !routeLineRef.current || points.length < 2) return;

    const position = positionRef.current;
    if (!position) {
      routeLineRef.current.setLatLngs(points);
      return;
    }

    // Snap the live GPS fix to the nearest route segment, so the arrow sits on the green line.
    const cosLat = Math.max(0.2, Math.cos(position.lat * Math.PI / 180));
    let best = { distance: Infinity, progress: 0 };
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const ax = (a[1] - position.lng) * 111320 * cosLat;
      const ay = (a[0] - position.lat) * 111320;
      const bx = (b[1] - position.lng) * 111320 * cosLat;
      const by = (b[0] - position.lat) * 111320;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
      const x = ax + t * dx;
      const y = ay + t * dy;
      const distance = Math.hypot(x, y);
      if (distance < best.distance) best = { distance, progress: i + t };
    }

    // Keep progress monotonic to prevent GPS drift from bringing the travelled trail back.
    if (routeProgressRef.current < 0 || best.progress > routeProgressRef.current) {
      routeProgressRef.current = best.progress;
    }
    const progress = Math.min(points.length - 1, Math.max(0, routeProgressRef.current));
    const segment = Math.min(points.length - 2, Math.floor(progress));
    const fraction = progress >= points.length - 1 ? 1 : progress - segment;
    const a = points[segment];
    const b = points[segment + 1];
    const lat = a[0] + (b[0] - a[0]) * fraction;
    const lng = a[1] + (b[1] - a[1]) * fraction;

    const remaining = progress >= points.length - 1
      ? [points[points.length - 1]]
      : [[lat, lng], ...points.slice(segment + 1)];
    routeLineRef.current.setLatLngs(remaining);

    const heading = Math.atan2((b[1] - a[1]) * Math.cos(lat * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
    const arrowIcon = L.divIcon({
      className: "moy-route-moving-arrow-wrap",
      html: '<span class="moy-route-moving-arrow" aria-label="Ваше положение" style="--heading:' + heading + 'deg"></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    if (!movingArrowRef.current) {
      movingArrowRef.current = L.marker([lat, lng], {
        icon: arrowIcon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(layers.current);
    } else {
      movingArrowRef.current.setLatLng([lat, lng]);
      const element = movingArrowRef.current.getElement();
      const arrow = element?.querySelector(".moy-route-moving-arrow");
      if (arrow) arrow.style.setProperty("--heading", heading + "deg");
    }
  }, [ready, positionVersion, routeGeometry]); 

  useEffect(() => {
    if (!ready || !routeGeometry?.length || !navigator.geolocation || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      position => {
        positionRef.current = { lat: position.coords.latitude, lng: position.coords.longitude };
        redraw(value => value + 1);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );
    return () => {
      if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [ready, routeGeometry?.length]);

  return (
    <section className="route-map-panel" aria-label="Карта маршрута">
      <div className="route-map-heading">
        <div><b>Ваш маршрут</b><span>Точка A — подача · точка B — назначение</span></div>
        <span className="route-map-badge">{routeGeometry?.length > 1 ? "Маршрут" : "Карта"}</span>
      </div>
      <div ref={element} className="route-map" />
      {showZoomButtons && <div className="moy-passenger-map-zoom" aria-label="Масштаб карты">
        <button type="button" aria-label="Приблизить карту" title="Приблизить" disabled={!ready} onClick={event => { event.preventDefault(); event.stopPropagation(); map.current?.zoomIn(); }}>+</button>
        <button type="button" aria-label="Уменьшить карту" title="Уменьшить" disabled={!ready} onClick={event => { event.preventDefault(); event.stopPropagation(); map.current?.zoomOut(); }}>−</button>
      </div>}
      {failed && <p className="muted small">Карта не загрузилась. Адреса и расчёт стоимости можно использовать без неё.</p>}
      {!ready && !failed && <div className="route-map-loading">Загружаем карту…</div>}{failed && <div className="route-map-loading">Карта временно недоступна</div>}
    </section>
  );
}
