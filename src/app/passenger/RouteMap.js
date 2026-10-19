"use client";
import { useEffect, useRef, useState } from "react";

export default function RouteMap({ pickupPoint, destinationPoint, routeGeometry, pickupInfo = null, destinationInfo = null }) {
  const element = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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
        map.current = L.map(element.current, { zoomControl: true, scrollWheelZoom: false }).setView(
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
    if (Array.isArray(routeGeometry) && routeGeometry.length > 1) {
      const line = routeGeometry
        .filter(pair => Array.isArray(pair) && Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1])))
        .map(pair => [Number(pair[1]), Number(pair[0])]);
      if (line.length > 1) {
        L.polyline(line, { color: "#146b4b", weight: 5, opacity: 0.88 }).addTo(group);
        line.forEach(point => bounds.push(point));
      }
    }
    if (bounds.length > 1) {
      map.current.fitBounds(L.latLngBounds(bounds), { padding: (pickupInfo||destinationInfo) ? [24, 96] : [24, 24], maxZoom: 15 });
    } else if (bounds.length === 1) {
      map.current.setView(bounds[0], 14);
    }
  }, [ready, pickupPoint?.lat, pickupPoint?.lng, destinationPoint?.lat, destinationPoint?.lng, routeGeometry, pickupInfo?.timeText, pickupInfo?.distanceText, destinationInfo?.timeText, destinationInfo?.distanceText]);

  return (
    <section className="route-map-panel" aria-label="Карта маршрута">
      <div className="route-map-heading">
        <div><b>Ваш маршрут</b><span>Точка A — подача · точка B — назначение</span></div>
        <span className="route-map-badge">{routeGeometry?.length > 1 ? "Маршрут" : "Карта"}</span>
      </div>
      <div ref={element} className="route-map" />
      {failed && <p className="muted small">Карта не загрузилась. Адреса и расчёт стоимости можно использовать без неё.</p>}
      {!ready && !failed && <div className="route-map-loading">Загружаем карту…</div>}{failed && <div className="route-map-loading">Карта временно недоступна</div>}
    </section>
  );
}
