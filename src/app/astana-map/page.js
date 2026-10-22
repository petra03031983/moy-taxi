"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const ASTANA = [51.1694, 71.4491];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1";
const OVERPASS = "https://overpass-api.de/api/interpreter";

function formatDistance(meters) {
  const n = Number(meters || 0);
  return n >= 1000 ? `${(n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км` : `${Math.round(n)} м`;
}
function formatDuration(seconds) {
  const min = Math.max(1, Math.round(Number(seconds || 0) / 60));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ч ${m} мин`;
}
function cleanName(item) {
  const a = item?.address || {};
  const parts = [
    a.road || a.pedestrian || a.highway,
    a.house_number ? `д. ${a.house_number}` : "",
    a.city || a.town || a.village || a.municipality,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : item?.display_name || "Место";
}
function stepText(step) {
  const m = step?.maneuver || {};
  const road = step?.name || "дорога";
  const modifier = String(m.modifier || "").replace("sharp", "резко").replace("slight", "плавно");
  if (m.type === "arrive") return "Вы прибыли";
  if (m.type === "depart") return `Начните движение по ${road}`;
  if (m.type === "roundabout") return `На круговом движении: ${road}`;
  if (m.type === "merge") return `Перестройтесь на ${road}`;
  if (m.type === "fork") return `Развилка: ${modifier || "продолжайте"} на ${road}`;
  if (m.type === "new name") return `Продолжайте по ${road}`;
  if (m.type === "turn") return `Поверните ${modifier || "по направлению"} на ${road}`;
  return `Продолжайте по ${road}`;
}

export default function AstanaMapPage() {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const routeRef = useRef(null);
  const arrowRef = useRef(null);
  const positionRef = useRef(null);
  const watchRef = useRef(null);
  const searchAbortRef = useRef(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [mode, setMode] = useState("car");
  const [mapType, setMapType] = useState("map");
  const [speed, setSpeed] = useState(0);
  const [speedLimit, setSpeedLimit] = useState(null);
  const [locating, setLocating] = useState(true);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled || !window.L || !mapEl.current || mapRef.current) return;
      const L = window.L;
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView(ASTANA, 12);
      const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
      const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, attribution: "© OpenStreetMap © CARTO" });
      const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "© Esri" });
      base.addTo(map);
      map._moyTiles = { base, dark, satellite };
      layersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setLeafletReady(true);
      requestAnimationFrame(() => map.invalidateSize());
    };
    if (!document.querySelector('link[data-moy-leaflet="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.moyLeaflet = "1";
      document.head.appendChild(link);
    }
    if (window.L) load();
    else {
      let script = document.querySelector('script[data-moy-leaflet-js="1"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.dataset.moyLeafletJs = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", load);
    }
    return () => {
      cancelled = true;
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leafletReady || !navigator.geolocation) {
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        positionRef.current = p;
        setOrigin(p);
        setSpeed(Math.max(0, Math.round((pos.coords.speed || 0) * 3.6)));
        setLocating(false);
        mapRef.current?.setView([p.lat, p.lng], 15);
      },
      () => { setOrigin({ lat: ASTANA[0], lng: ASTANA[1] }); setLocating(false); },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
    );
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        positionRef.current = p;
        setOrigin(p);
        setSpeed(Math.max(0, Math.round((pos.coords.speed || 0) * 3.6)));
        if (routeRef.current && arrowRef.current) arrowRef.current.setLatLng([p.lat, p.lng]);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );
    return () => {
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [leafletReady]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const text = query.trim();
      if (text.length < 2) { setResults([]); setSearching(false); return; }
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearching(true);
      setError("");
      try {
        const url = new URL(NOMINATIM);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "8");
        url.searchParams.set("accept-language", "ru");
        url.searchParams.set("countrycodes", "kz");
        url.searchParams.set("q", text);
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("Поиск адреса временно недоступен");
        const data = await res.json();
        if (!controller.signal.aborted) setResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e?.name !== "AbortError") setError(e?.message || "Не удалось выполнить поиск");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    const L = window.L;
    const tiles = mapRef.current._moyTiles;
    if (!tiles) return;
    Object.values(tiles).forEach(layer => { if (mapRef.current.hasLayer(layer)) mapRef.current.removeLayer(layer); });
    tiles[mapType === "satellite" ? "satellite" : mapType === "dark" ? "dark" : "base"].addTo(mapRef.current);
  }, [mapType, leafletReady]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || !layersRef.current) return;
    const L = window.L;
    const group = layersRef.current;
    group.clearLayers();
    routeRef.current = null;
    arrowRef.current = null;
    if (origin) {
      const icon = L.divIcon({ className: "moy-user-icon", html: '<span class="moy-user-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker([origin.lat, origin.lng], { icon, zIndexOffset: 1000 }).addTo(group);
    }
    if (destination) {
      const icon = L.divIcon({ className: "moy-destination-icon", html: '<span>Б</span>', iconSize: [40, 46], iconAnchor: [20, 44] });
      L.marker([destination.lat, destination.lng], { icon, zIndexOffset: 900 }).addTo(group);
    }
    if (route?.geometry?.length > 1) {
      const line = route.geometry.map(p => [p[1], p[0]]);
      routeRef.current = L.polyline(line, { color: "#22d300", weight: 8, opacity: 0.98, lineCap: "round", lineJoin: "round" }).addTo(group);
      const bounds = L.latLngBounds(line);
      mapRef.current.fitBounds(bounds, { paddingTopLeft: [24, 100], paddingBottomRight: [24, 230], maxZoom: 16 });
      if (route.steps?.length) {
        route.steps.filter(s => ["turn", "roundabout", "fork"].includes(s.maneuver?.type)).forEach(step => {
          const c = step.maneuver?.location;
          if (!Array.isArray(c)) return;
          const icon = L.divIcon({ className: "moy-turn-icon", html: '<span>➜</span>', iconSize: [28, 28], iconAnchor: [14, 14] });
          L.marker([c[1], c[0]], { icon, interactive: false }).addTo(group);
        });
      }
      const p = positionRef.current || origin;
      if (p) {
        const icon = L.divIcon({ className: "moy-nav-arrow", html: '<span class="moy-nav-arrow-shape">▲</span>', iconSize: [52, 52], iconAnchor: [26, 26] });
        arrowRef.current = L.marker([p.lat, p.lng], { icon, interactive: false, zIndexOffset: 2000 }).addTo(group);
      }
    }
  }, [leafletReady, origin?.lat, origin?.lng, destination?.lat, destination?.lng, route]);

  useEffect(() => {
    if (!origin?.lat || !origin?.lng) return;
    const timer = window.setTimeout(async () => {
      try {
        const q = `[out:json][timeout:5];way[highway][maxspeed](around:250,${origin.lat},${origin.lng});out tags center 1;`;
        const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`);
        const data = await res.json();
        const values = (data.elements || []).map(x => String(x.tags?.maxspeed || "").match(/\d+/)?.[0]).filter(Boolean).map(Number).filter(n => n > 0 && n < 200);
        if (values.length) setSpeedLimit(Math.min(...values));
      } catch {}
    }, 500);
    return () => window.clearTimeout(timer);
  }, [origin?.lat, origin?.lng]);

  async function buildRoute(nextMode = mode) {
    if (!origin || !destination) return;
    setRouting(true);
    setError("");
    try {
      const profile = nextMode === "walk" ? "foot" : "driving";
      const url = `${OSRM}/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&annotations=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Маршрутизатор не ответил");
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("Маршрут не найден");
      const r = data.routes[0];
      setRoute({ geometry: r.geometry.coordinates, distance: r.distance, duration: r.duration, steps: r.legs?.flatMap(l => l.steps || []) || [] });
      setShowSteps(false);
    } catch (e) {
      setError(e?.message || "Не удалось построить маршрут");
    } finally {
      setRouting(false);
    }
  }

  function chooseResult(item) {
    const point = { lat: Number(item.lat), lng: Number(item.lon) };
    setDestination(point);
    setQuery(cleanName(item));
    setResults([]);
    setError("");
    mapRef.current?.setView([point.lat, point.lng], 15);
  }

  function swapMapType() {
    setMapType(v => v === "map" ? "satellite" : v === "satellite" ? "dark" : "map");
  }

  const selectedLabel = useMemo(() => query || "Куда едем?", [query]);

  return (
    <main className="astana-map-page">
      <div ref={mapEl} className="astana-map-canvas" />

      <div className="astana-search-wrap">
        <div className="astana-search-box">
          <span className="astana-search-icon">⌕</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск адреса или места" aria-label="Поиск адреса" />
          {query && <button className="astana-clear" onClick={() => { setQuery(""); setResults([]); setDestination(null); }}>×</button>}
          <button className="astana-mic" aria-label="Голосовой поиск">🎙</button>
        </div>
        {(searching || results.length > 0) && <div className="astana-results">
          {searching && <div className="astana-result-loading">Ищем адрес…</div>}
          {results.map((item, i) => <button key={`${item.place_id}-${i}`} className="astana-result" onClick={() => chooseResult(item)}>
            <span className="astana-result-pin">⌖</span>
            <span><b>{cleanName(item)}</b><small>{item.display_name}</small></span>
          </button>)}
          {!searching && !results.length && <div className="astana-result-loading">Ничего не найдено</div>}
        </div>}
      </div>

      <div className="astana-map-right-controls">
        <button onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 16); }} title="Моё местоположение">◎</button>
        <div className="astana-speed-limit"><b>{speedLimit || "—"}</b><span>км/ч</span></div>
        <div className="astana-speed-now"><b>{speed}</b><span>км/ч</span></div>
        <button onClick={() => mapRef.current?.zoomIn()} title="Приблизить">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} title="Отдалить">−</button>
        <button onClick={swapMapType} title="Карта / спутник">▱</button>
      </div>

      {destination && !route && <section className="astana-bottom-card">
        <div className="astana-destination-title"><span className="green-dot" /> <div><b>{selectedLabel}</b><small>Адрес выбран</small></div></div>
        <button className="astana-route-button" onClick={() => buildRoute("car")} disabled={routing || locating}>{routing ? "Строим маршрут…" : "➤ Маршрут"}</button>
        <div className="astana-mode-row">
          <button className={mode === "car" ? "active" : ""} onClick={() => setMode("car")}>🚗 Авто</button>
          <button className={mode === "walk" ? "active" : ""} onClick={() => setMode("walk")}>🚶 Пешком</button>
          <button className={mode === "bus" ? "active" : ""} onClick={() => setMode("bus")}>🚌 Автобус</button>
        </div>
      </section>}

      {route && <section className="astana-route-card">
        <div className="astana-route-summary">
          <div><strong>{formatDuration(route.duration)}</strong><small>в пути</small></div>
          <div><strong>{formatDistance(route.distance)}</strong><small>расстояние</small></div>
          <button onClick={() => setShowSteps(v => !v)}>{showSteps ? "Скрыть" : "Команды"}</button>
        </div>
        <div className="astana-route-modes">
          <button className={mode === "car" ? "active" : ""} onClick={() => { setMode("car"); buildRoute("car"); }}>🚗 {mode === "car" ? formatDuration(route.duration) : "Авто"}</button>
          <button className={mode === "bus" ? "active" : ""} onClick={() => { setMode("bus"); buildRoute("car"); }}>🚌 Автобус</button>
          <button className={mode === "walk" ? "active" : ""} onClick={() => { setMode("walk"); buildRoute("walk"); }}>🚶 Пешком</button>
        </div>
        {showSteps && <div className="astana-steps">{route.steps.slice(0, 12).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}</div>}
        <button className="astana-go-button" onClick={() => { setShowSteps(false); if (origin) mapRef.current?.setView([origin.lat, origin.lng], 17); }}>➤ В путь</button>
      </section>}

      {locating && <div className="astana-toast">Определяем местоположение…</div>}
      {error && <div className="astana-error">{error}</div>}

      <div className="astana-map-switch"><button className={mapType === "map" ? "active" : ""} onClick={() => setMapType("map")}>Карта</button><button className={mapType === "satellite" ? "active" : ""} onClick={() => setMapType("satellite")}>Спутник</button></div>
    </main>
  );
}

const styles = `
.astana-map-page{position:fixed;inset:0;overflow:hidden;background:#10171d;color:#fff;font-family:Arial,sans-serif;z-index:1}
.astana-map-canvas{position:absolute;inset:0;z-index:0}
.astana-search-wrap{position:absolute;top:18px;left:18px;right:18px;z-index:20;max-width:760px;margin:auto}
.astana-search-box{height:58px;border-radius:18px;background:rgba(28,31,34,.96);display:flex;align-items:center;gap:10px;padding:0 15px;box-shadow:0 5px 22px rgba(0,0,0,.35)}
.astana-search-icon{font-size:31px;color:#aaa;line-height:1}.astana-search-box input{flex:1;background:none;border:0;outline:0;color:#fff;font-size:20px;min-width:0}.astana-search-box input::placeholder{color:#aaa}.astana-clear,.astana-mic{background:none;border:0;color:#ddd;font-size:25px;padding:6px}.astana-results{margin-top:7px;border-radius:18px;overflow:hidden;background:rgba(28,31,34,.98);box-shadow:0 10px 28px rgba(0,0,0,.4);max-height:55vh;overflow-y:auto}.astana-result,.astana-result-loading{width:100%;border:0;border-bottom:1px solid #34383b;background:none;color:#fff;text-align:left;padding:15px;display:flex;gap:13px;align-items:flex-start}.astana-result:hover{background:#32363a}.astana-result-pin{font-size:23px;color:#36d56f}.astana-result b{display:block;font-size:16px}.astana-result small{display:block;color:#aeb4b8;font-size:13px;margin-top:5px;line-height:1.25}.astana-result-loading{color:#aaa}
.astana-map-right-controls{position:absolute;right:14px;top:105px;z-index:15;display:flex;flex-direction:column;align-items:center;gap:9px}.astana-map-right-controls button,.astana-speed-limit,.astana-speed-now{width:58px;min-height:58px;border:0;border-radius:18px;background:rgba(20,23,26,.94);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:30px}.astana-speed-limit{border:4px solid #e42b35;background:#17191b;border-radius:50%;width:64px;height:64px;min-height:64px;flex-direction:column}.astana-speed-limit b{font-size:22px}.astana-speed-limit span,.astana-speed-now span{font-size:10px;color:#bbb}.astana-speed-now{border-radius:50%;width:64px;height:64px;min-height:64px;flex-direction:column}.astana-speed-now b{font-size:24px}.astana-map-right-controls button:last-child{font-size:22px}.astana-map-right-controls button:nth-last-child(2),.astana-map-right-controls button:nth-last-child(3){font-size:34px;background:rgba(16,20,23,.96)}
.astana-bottom-card,.astana-route-card{position:absolute;left:12px;right:12px;bottom:18px;z-index:18;border-radius:24px;background:rgba(24,27,30,.97);padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)}.astana-destination-title{display:flex;gap:10px;align-items:center;margin-bottom:12px}.green-dot{width:14px;height:14px;border-radius:50%;background:#20d35f;display:block;box-shadow:0 0 0 4px rgba(32,211,95,.16)}.astana-destination-title b{font-size:18px;display:block}.astana-destination-title small{color:#aeb4b8;display:block;margin-top:3px}.astana-route-button,.astana-go-button{width:100%;height:54px;border:0;border-radius:16px;background:#16c65b;color:#fff;font-weight:800;font-size:19px}.astana-mode-row,.astana-route-modes{display:flex;gap:8px;margin-top:10px;overflow:auto}.astana-mode-row button,.astana-route-modes button{border:0;border-radius:14px;background:#303438;color:#eee;padding:12px 15px;white-space:nowrap;font-size:15px}.astana-mode-row button.active,.astana-route-modes button.active{background:#19bd59;color:#fff}.astana-route-summary{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:10px}.astana-route-summary strong{display:block;font-size:25px}.astana-route-summary small{color:#aaa}.astana-route-summary button{border:0;background:#303438;color:#fff;border-radius:12px;padding:11px 12px}.astana-route-modes{margin-bottom:8px}.astana-steps{max-height:30vh;overflow:auto;border-top:1px solid #3b3f42;margin:8px 0}.astana-step{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid #303438}.astana-step>span{width:25px;height:25px;border-radius:50%;background:#1d7cf0;display:flex;align-items:center;justify-content:center;font-size:12px}.astana-step b{font-size:14px;display:block}.astana-step small{color:#aaa}.astana-toast,.astana-error{position:absolute;left:20px;right:20px;bottom:190px;z-index:25;background:rgba(30,33,36,.96);border-radius:14px;padding:12px 15px;text-align:center}.astana-error{bottom:110px;background:#6d2428;color:#fff}.astana-map-switch{position:absolute;left:50%;transform:translateX(-50%);bottom:8px;z-index:30;background:rgba(24,27,30,.95);border-radius:18px;padding:4px;display:flex;gap:3px}.astana-map-switch button{border:0;background:none;color:#aaa;padding:9px 18px;border-radius:14px;font-weight:700}.astana-map-switch button.active{background:#fff;color:#222}.moy-user-dot{display:block;width:18px;height:18px;border-radius:50%;background:#1385ff;border:4px solid #fff;box-shadow:0 0 0 2px #1385ff}.moy-destination-icon{background:#19a95b;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 9px #0008}.moy-destination-icon span{transform:rotate(45deg);font-weight:900;color:#fff}.moy-nav-arrow{background:none;border:0}.moy-nav-arrow-shape{display:block;color:#087cf5;text-shadow:0 2px 5px #000;font-size:48px;line-height:48px;transform:translateY(-4px)}.moy-turn-icon{background:none;border:0}.moy-turn-icon span{display:flex;width:27px;height:27px;border-radius:9px;background:#087cf5;color:#fff;align-items:center;justify-content:center;font-size:18px;font-weight:900;box-shadow:0 2px 5px #0008}
@media(max-width:520px){.astana-search-wrap{top:10px;left:10px;right:10px}.astana-search-box{height:54px;border-radius:17px}.astana-search-box input{font-size:17px}.astana-map-right-controls{right:9px;top:78px;gap:6px}.astana-map-right-controls button,.astana-speed-now{width:52px;min-height:52px}.astana-speed-limit{width:58px;height:58px;min-height:58px}.astana-bottom-card,.astana-route-card{bottom:12px;border-radius:22px}.astana-route-summary strong{font-size:22px}}
`;

if (typeof document !== "undefined" && !document.getElementById("astana-map-styles")) {
  const style = document.createElement("style");
  style.id = "astana-map-styles";
  style.textContent = styles;
  document.head.appendChild(style);
}
