"use client";
import { useEffect, useRef } from "react";
export default function MapPicker({ lat, lng, onPick }) {
  const el = useRef(null), map = useRef(null), marker = useRef(null), pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled || !el.current || !window.L || map.current) return;
      const L = window.L;
      const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
      const instance = L.map(el.current, { zoomControl: true }).setView(
        hasPoint ? [lat, lng] : [51.1694, 71.4491], hasPoint ? 16 : 12
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(instance);
      if (hasPoint) marker.current = L.marker([lat, lng]).addTo(instance);
      instance.on("click", (event) => {
        if (!marker.current) marker.current = L.marker(event.latlng).addTo(instance);
        else marker.current.setLatLng(event.latlng);
        if (pick.current) pick.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      map.current = instance;
    };
    if (!document.querySelector('link[data-leaflet-css="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.leafletCss = "1"; document.head.appendChild(link);
    }
    if (window.L) load();
    else {
      let script = document.querySelector('script[data-leaflet-js="1"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.dataset.leafletJs = "1"; document.head.appendChild(script);
      }
      script.addEventListener("load", load);
    }
    return () => { cancelled = true; if (map.current) { map.current.remove(); map.current = null; marker.current = null; } };
  }, []);
  return <div ref={el} className="map-picker" aria-label="Карта для выбора точки подачи" />;
}