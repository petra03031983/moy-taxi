"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const ASTANA = [51.1694, 71.4491];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";
const ROUTERS = {
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
};
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
function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/([A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])(?=\d)/g, "$1 ")
    .replace(/\bул\.?\s+/i, "улица ")
    .replace(/\bпр\.?\s+/i, "проспект ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function photonToAddress(feature) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const street = properties.street || properties.name || "";
  const city = properties.city || properties.locality || properties.district || properties.county || "";
  const address = {
    road: properties.street || "",
    pedestrian: properties.street || "",
    house_number: properties.housenumber || "",
    city: properties.city || "",
    town: properties.locality || "",
    village: properties.locality || "",
    municipality: properties.district || "",
    country: properties.country || "",
  };
  const display_name = [
    properties.name,
    properties.street && properties.name !== properties.street ? properties.street : "",
    properties.housenumber,
    city,
    properties.state,
    properties.country,
  ].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(", ");
  return {
    place_id: `photon-${properties.osm_type || "place"}-${properties.osm_id || `${lat},${lon}`}`,
    lat: String(lat),
    lon: String(lon),
    display_name: display_name || street || "Место на карте",
    address,
    type: properties.osm_value || properties.type || "place",
    class: properties.osm_key || "place",
    source: "photon",
  };
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
  const labels = {
    left: "налево",
    right: "направо",
    straight: "прямо",
    "slight left": "плавно налево",
    "slight right": "плавно направо",
    "sharp left": "резко налево",
    "sharp right": "резко направо",
    uturn: "развернитесь",
  };
  const modifier = labels[m.modifier] || "по направлению движения";
  if (m.type === "arrive") return "Вы прибыли";
  if (m.type === "depart") return `Начните движение по ${road}`;
  if (m.type === "roundabout") return m.exit ? `На круговом движении съезд №${m.exit}` : `На круговом движении: ${road}`;
  if (m.type === "merge") return `Перестройтесь на ${road}`;
  if (m.type === "fork") return `На развилке держитесь: ${modifier}`;
  if (m.type === "new name") return `Продолжайте по ${road}`;
  if (m.type === "turn") return `Поверните ${modifier}${road && road !== "дорога" ? ` на ${road}` : ""}`;
  return `Продолжайте по ${road}`;
}

function turnSymbol(step) {
  const m = step?.maneuver || {};
  if (m.type === "roundabout") return "↻";
  if (String(m.modifier || "").includes("uturn")) return "↶";
  if (String(m.modifier || "").includes("left")) return "↰";
  if (String(m.modifier || "").includes("right")) return "↱";
  if (m.modifier === "straight" || m.type === "depart") return "↑";
  return "➜";
}

function distanceBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function snapToRoute(position, points) {
  const cosLat = Math.max(0.2, Math.cos(position.lat * Math.PI / 180));
  let best = { distance: Infinity, progress: 0, point: points[0], heading: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const ax = (a[1] - position.lng) * 111320 * cosLat;
    const ay = (a[0] - position.lat) * 111320;
    const bx = (b[1] - position.lng) * 111320 * cosLat;
    const by = (b[0] - position.lat) * 111320;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    const distance = Math.hypot(x, y);
    if (distance < best.distance) {
      const lat = a[0] + (b[0] - a[0]) * t;
      const lng = a[1] + (b[1] - a[1]) * t;
      best = {
        distance,
        progress: i + t,
        point: [lat, lng],
        heading: Math.atan2((b[1] - a[1]) * Math.cos(lat * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI,
      };
    }
  }
  return best;
}

function routeDistanceToIndex(points, startProgress, endIndex) {
  if (!points.length || endIndex <= startProgress) return 0;
  const clamped = Math.max(0, Math.min(points.length - 1, startProgress));
  const segment = Math.min(points.length - 2, Math.floor(clamped));
  const fraction = clamped - segment;
  const start = [
    points[segment][0] + (points[segment + 1][0] - points[segment][0]) * fraction,
    points[segment][1] + (points[segment + 1][1] - points[segment][1]) * fraction,
  ];
  let total = distanceBetween(start, points[segment + 1]);
  for (let i = segment + 1; i < Math.min(endIndex, points.length - 1); i += 1) {
    total += distanceBetween(points[i], points[i + 1]);
  }
  return Math.max(0, total);
}

function nextRouteInstruction(route, points, progress) {
  if (!route?.steps?.length || points.length < 2) return null;
  let next = null;
  let nextIndex = Infinity;
  for (const step of route.steps) {
    const loc = step?.maneuver?.location;
    if (!Array.isArray(loc) || !["turn", "roundabout", "fork", "merge", "arrive"].includes(step.maneuver?.type)) continue;
    let nearest = { index: 0, distance: Infinity };
    for (let i = 0; i < points.length; i += 1) {
      const d = (points[i][0] - loc[1]) ** 2 + (points[i][1] - loc[0]) ** 2;
      if (d < nearest.distance) nearest = { index: i, distance: d };
    }
    if (nearest.index > progress + 1 && nearest.index < nextIndex) {
      next = step;
      nextIndex = nearest.index;
    }
  }
  if (!next) return { text: "Продолжайте движение по маршруту", distance: "" };
  return { text: stepText(next), distance: formatDistance(routeDistanceToIndex(points, progress, nextIndex)) };
}

export default function AstanaMapPage() {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const locationLayerRef = useRef(null);
  const routeRef = useRef(null);
  const arrowRef = useRef(null);
  const routePointsRef = useRef([]);
  const routeProgressRef = useRef(-1);
  const positionRef = useRef(null);
  const watchRef = useRef(null);
  const searchAbortRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const searchRequestRef = useRef(0);
  const lastSearchAtRef = useRef(0);
  const [leafletReady, setLeafletReady] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResultsPanel, setShowResultsPanel] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [listening, setListening] = useState(false);
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
  const [navigating, setNavigating] = useState(false);
  const [nextInstruction, setNextInstruction] = useState(null);
  const speedLimitCell = useMemo(() => origin ? `${Math.round(origin.lat * 100)},${Math.round(origin.lng * 100)}` : "", [origin?.lat, origin?.lng]);

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
      locationLayerRef.current = L.layerGroup().addTo(map);
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
      layersRef.current = null;
      locationLayerRef.current = null;
      routeRef.current = null;
      arrowRef.current = null;
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

  async function searchAddress(value = query) {
    const text = normalizeSearchText(value);
    if (text.length < 2) {
      setResults([]);
      setShowResultsPanel(false);
      setSearching(false);
      setError("Введите хотя бы два символа адреса.");
      return;
    }

    setQuery(text);
    setShowResultsPanel(true);
    setError("");
    const cacheKey = text.toLocaleLowerCase("ru-RU");
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++searchRequestRef.current;
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setSearching(false);
      setResults(cached);
      return;
    }

    setSearching(true);
    setResults([]);
    const timeout = window.setTimeout(() => controller.abort(), 18000);

    try {
      // Photon tolerates minor typos and supports location-biased geocoding.
      try {
        const photonUrl = new URL(PHOTON);
        photonUrl.searchParams.set("q", text);
        photonUrl.searchParams.set("limit", "8");
        photonUrl.searchParams.set("lang", "ru");
        photonUrl.searchParams.set("countrycode", "KZ");
        const focus = positionRef.current || origin;
        if (focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng)) {
          photonUrl.searchParams.set("lat", String(focus.lat));
          photonUrl.searchParams.set("lon", String(focus.lng));
          photonUrl.searchParams.set("zoom", "13");
        }
        const response = await fetch(photonUrl.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Photon HTTP " + response.status);
        const data = await response.json();
        const found = (Array.isArray(data.features) ? data.features : [])
          .map(photonToAddress)
          .filter(Boolean);
        if (found.length && requestId === searchRequestRef.current && !controller.signal.aborted) {
          searchCacheRef.current.set(cacheKey, found);
          if (searchCacheRef.current.size > 60) searchCacheRef.current.delete(searchCacheRef.current.keys().next().value);
          setResults(found);
          return;
        }
      } catch (e) {
        if (e?.name === "AbortError") throw e;
      }

      // Nominatim is the fallback. The viewbox is a preference, not a hard boundary,
      // so the search can still return settlements and villages outside Astana.
      const nominatimUrl = new URL(NOMINATIM);
      nominatimUrl.searchParams.set("format", "jsonv2");
      nominatimUrl.searchParams.set("addressdetails", "1");
      nominatimUrl.searchParams.set("limit", "8");
      nominatimUrl.searchParams.set("accept-language", "ru");
      nominatimUrl.searchParams.set("countrycodes", "kz");
      nominatimUrl.searchParams.set("q", text);
      const focus = positionRef.current || origin;
      if (focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng)) {
        const span = 0.45;
        nominatimUrl.searchParams.set("viewbox", [
          focus.lng - span, focus.lat + span, focus.lng + span, focus.lat - span
        ].join(","));
        nominatimUrl.searchParams.set("bounded", "0");
      }
      const waitMs = Math.max(0, 1100 - (Date.now() - lastSearchAtRef.current));
      if (waitMs) await new Promise(resolve => window.setTimeout(resolve, waitMs));
      if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
      lastSearchAtRef.current = Date.now();
      const response = await fetch(nominatimUrl.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Nominatim HTTP " + response.status);
      const data = await response.json();
      const found = Array.isArray(data) ? data : [];
      if (requestId === searchRequestRef.current && !controller.signal.aborted) {
        if (found.length) {
          searchCacheRef.current.set(cacheKey, found);
          if (searchCacheRef.current.size > 60) searchCacheRef.current.delete(searchCacheRef.current.keys().next().value);
        }
        setResults(found);
        if (!found.length) setError("Адрес не найден. Попробуйте добавить номер дома или название города/посёлка.");
      }
    } catch (e) {
      if (e?.name !== "AbortError" && requestId === searchRequestRef.current) {
        setResults([]);
        setError("Поиск временно недоступен. Проверьте интернет и попробуйте снова.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestId === searchRequestRef.current) {
        setSearching(false);
        if (controller.signal.aborted) {
          setError("Поиск занимает слишком много времени. Попробуйте ещё раз.");
        }
      }
    }
  }

  function startVoiceSearch() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Голосовой поиск не поддерживается этим браузером. Введите адрес вручную.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "ru-RU";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => { setListening(true); setError(""); };
      recognition.onresult = event => {
        const spoken = event.results?.[0]?.[0]?.transcript?.trim();
        if (spoken) {
          setQuery(spoken);
          setResults([]);
          setShowResultsPanel(false);
          setError("Нажмите поиск, чтобы найти произнесённый адрес.");
        }
      };
      recognition.onerror = () => setError("Не удалось распознать речь. Можно ввести адрес вручную.");
      recognition.onend = () => setListening(false);
      recognition.start();
    } catch {
      setListening(false);
      setError("Не удалось запустить голосовой поиск. Введите адрес вручную.");
    }
  }

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
    routePointsRef.current = [];
    routeProgressRef.current = -1;

    if (destination) {
      const icon = L.divIcon({ className: "moy-destination-icon", html: '<span>Б</span>', iconSize: [40, 46], iconAnchor: [20, 44] });
      L.marker([destination.lat, destination.lng], { icon, zIndexOffset: 900 }).addTo(group);
    }

    if (route?.geometry?.length > 1) {
      const line = route.geometry.map(p => [p[1], p[0]]);
      routePointsRef.current = line;
      routeRef.current = L.polyline(line, { color: "#22d300", weight: 8, opacity: 0.98, lineCap: "round", lineJoin: "round" }).addTo(group);
      const bounds = L.latLngBounds(line);
      mapRef.current.fitBounds(bounds, { paddingTopLeft: [24, navigating ? 150 : 100], paddingBottomRight: [24, 230], maxZoom: 16 });
      if (route.steps?.length) {
        route.steps.filter(s => ["turn", "roundabout", "fork"].includes(s.maneuver?.type)).forEach(step => {
          const c = step.maneuver?.location;
          if (!Array.isArray(c)) return;
          const icon = L.divIcon({ className: "moy-turn-icon", html: `<span>${turnSymbol(step)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
          L.marker([c[1], c[0]], { icon, interactive: false }).addTo(group);
        });
      }
    } else if (destination) {
      mapRef.current.setView([destination.lat, destination.lng], 15);
    }
  }, [leafletReady, destination?.lat, destination?.lng, route, navigating]); 

  useEffect(() => {
    if (!leafletReady || !locationLayerRef.current) return;
    const L = window.L;
    const group = locationLayerRef.current;
    group.clearLayers();
    arrowRef.current = null;
    if (!origin) return;

    let point = [origin.lat, origin.lng];
    let heading = 0;
    const points = routePointsRef.current;
    if (navigating && route?.geometry?.length > 1 && points.length > 1) {
      const snapped = snapToRoute(origin, points);
      if (snapped.distance <= 85) {
        if (routeProgressRef.current < 0 || snapped.progress > routeProgressRef.current) {
          routeProgressRef.current = snapped.progress;
        }
        const progress = Math.max(0, Math.min(points.length - 1, routeProgressRef.current));
        const segment = Math.min(points.length - 2, Math.floor(progress));
        const fraction = progress >= points.length - 1 ? 1 : progress - segment;
        point = [
          points[segment][0] + (points[segment + 1][0] - points[segment][0]) * fraction,
          points[segment][1] + (points[segment + 1][1] - points[segment][1]) * fraction,
        ];
        heading = snapToRoute({ lat: point[0], lng: point[1] }, points).heading;
        const remaining = progress >= points.length - 1 ? [points[points.length - 1]] : [point, ...points.slice(segment + 1)];
        routeRef.current?.setLatLngs(remaining);
        setNextInstruction(nextRouteInstruction(route, points, progress));
        mapRef.current?.panTo(point, { animate: true, duration: 0.35 });
        const icon = L.divIcon({
          className: "moy-nav-arrow",
          html: `<span class="moy-nav-arrow-shape" style="--heading:${heading}deg">▲</span>`,
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
        arrowRef.current = L.marker(point, { icon, interactive: false, zIndexOffset: 2000 }).addTo(group);
      } else {
        setNextInstruction({ text: "Вы отклонились от маршрута", distance: "" });
        const icon = L.divIcon({ className: "moy-user-icon", html: '<span class="moy-user-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
        L.marker(point, { icon, zIndexOffset: 2000 }).addTo(group);
      }
    } else {
      setNextInstruction(null);
      const icon = L.divIcon({ className: "moy-user-icon", html: '<span class="moy-user-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker(point, { icon, zIndexOffset: 1000 }).addTo(group);
    }
  }, [leafletReady, origin?.lat, origin?.lng, navigating, route]);

  useEffect(() => {
    if (!speedLimitCell) {
      setSpeedLimit(null);
      return;
    }
    const [latCell, lngCell] = speedLimitCell.split(",").map(Number);
    const queryLat = latCell / 100;
    const queryLng = lngCell / 100;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const point = positionRef.current || { lat: queryLat, lng: queryLng };
        const q = `[out:json][timeout:7];way[highway][maxspeed](around:220,${point.lat},${point.lng});out tags center;`;
        const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Speed-limit lookup failed");
        const data = await res.json();
        const ways = (data.elements || []).filter(x => x.center && x.tags?.maxspeed);
        const distance = x => distanceBetween([point.lat, point.lng], [x.center.lat, x.center.lon]);
        ways.sort((a, b) => distance(a) - distance(b));
        const value = String(ways[0]?.tags?.maxspeed || "").match(/\d+/)?.[0];
        setSpeedLimit(value && Number(value) > 0 && Number(value) < 200 ? Number(value) : null);
      } catch {
        if (!controller.signal.aborted) setSpeedLimit(null);
      }
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [speedLimitCell]);

  async function buildRoute(nextMode = mode) {
    if (!origin || !destination) {
      setError("Сначала выберите адрес назначения.");
      return;
    }
    if (nextMode === "bus") {
      setError("Маршрут на автобусе пока не подтверждён для Астаны в подключённых данных. Я не буду подменять его автомобильным маршрутом.");
      return;
    }
    setRouting(true);
    setNavigating(false);
    setNextInstruction(null);
    setError("");
    try {
      const router = nextMode === "walk" ? ROUTERS.walk : ROUTERS.car;
      const url = `${router}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&annotations=true`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 22000);
      let res;
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (e) {
        if (e?.name === "AbortError") throw new Error("Маршрутизатор долго не отвечает. Проверьте интернет и попробуйте ещё раз.");
        throw e;
      } finally {
        window.clearTimeout(timeout);
      }
      if (!res.ok) throw new Error("Маршрутизатор временно недоступен");
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("По этим точкам маршрут не найден");
      const r = data.routes[0];
      setRoute({
        geometry: r.geometry.coordinates,
        distance: r.distance,
        duration: r.duration,
        steps: r.legs?.flatMap(l => l.steps || []) || [],
        mode: nextMode,
      });
      setMode(nextMode);
      setShowSteps(false);
      setNavigating(false);
      routeProgressRef.current = -1;
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
    setShowResultsPanel(false);
    setRoute(null);
    setNavigating(false);
    setNextInstruction(null);
    setError("");
    mapRef.current?.setView([point.lat, point.lng], 15);
  }

  function swapMapType() {
    setMapType(v => v === "map" ? "satellite" : v === "satellite" ? "dark" : "map");
  }

  const selectedLabel = useMemo(() => query || "Куда едем?", [query]);
  const isHomeScreen = !searchActive && !query.trim() && !showResultsPanel && !destination && !route;
  const showMapUtilityControls = Boolean(route && navigating);

  function openHomeSearch() {
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 30);
  }

  return (
    <main className="astana-map-page">
      <div ref={mapEl} className="astana-map-canvas" />



      <div className={`astana-search-wrap ${isHomeScreen ? "astana-search-wrap-home" : "astana-search-wrap-active"}`}>
        {isHomeScreen && <div className="astana-home-handle"><span /></div>}
        <div className="astana-search-home-row">
          <div className="astana-search-box">
            <button className="astana-search-icon" onClick={() => searchAddress(query)} aria-label="Найти адрес" title="Найти адрес">⌕</button>
            <input
              ref={searchInputRef}
              value={query}
              onFocus={() => setSearchActive(true)}
              onChange={e => { setQuery(e.target.value); setResults([]); setShowResultsPanel(false); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchAddress(query); } }}
              placeholder="Поиск"
              aria-label="Поиск адреса"
            />
            {query && <button className="astana-clear" onClick={() => { setQuery(""); setResults([]); setShowResultsPanel(false); setDestination(null); setRoute(null); setNavigating(false); setError(""); }}>×</button>}
            <button className={`astana-mic${listening ? " listening" : ""}`} onClick={startVoiceSearch} aria-label="Голосовой поиск" title="Голосовой поиск">🎙</button>
          </div>
          {isHomeScreen && <button className="astana-home-menu" onClick={openHomeSearch} aria-label="Открыть поиск">☰</button>}
        </div>
        {searchActive && <button className="astana-search-cancel" onClick={() => { setSearchActive(false); setShowResultsPanel(false); setResults([]); setQuery(""); setError(""); searchInputRef.current?.blur(); }}>Отмена</button>}
        {showResultsPanel && <div className="astana-results">
          {searching && <div className="astana-result-loading">Ищем адрес…</div>}
          {!searching && results.map((item, i) => <button key={`${item.place_id}-${i}`} className="astana-result" onClick={() => { chooseResult(item); setSearchActive(false); }}>
            <span className="astana-result-pin">⌖</span>
            <span><b>{cleanName(item)}</b><small>{item.display_name}</small></span>
          </button>)}
          {!searching && !results.length && <div className="astana-result-loading">{error || "Ничего не найдено. Проверьте адрес и нажмите поиск."}</div>}
        </div>}

        {isHomeScreen && <>
          <div className="astana-home-shortcuts">
            <button className="astana-shortcut astana-shortcut-icon" onClick={openHomeSearch} aria-label="Сохранённые места">♧</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">◉</span> Найти работу</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">⌂</span> Домой</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">▰</span> На работу</button>
          </div>

          <div className="astana-home-promo-strip" aria-label="Подборки">
            <div className="astana-promo-card astana-promo-child">
              <div className="astana-promo-art">📚👧🏻</div>
              <span>Детский профиль<br />или обычный?</span>
            </div>
            <div className="astana-promo-card astana-promo-business">
              <div className="astana-promo-art">🏙️💚</div>
              <span>Где лучше открыть<br />бизнес?</span>
            </div>
            <div className="astana-promo-card astana-promo-autumn">
              <div className="astana-promo-art">🍁✨</div>
              <span>Гуляйте и собирайте<br />искры</span>
            </div>
            <div className="astana-promo-card astana-promo-smile">
              <div className="astana-promo-art">😁</div>
              <span>Зубы, которые<br />мы потеряли</span>
            </div>
          </div>

          <section className="astana-home-interesting">
            <h2>Интересное для вас</h2>
            <div className="astana-interesting-cards">
              <article className="astana-interesting-card astana-friends-card">
                <div className="astana-interesting-copy"><b>Где ваши друзья?</b><span>Смотрите прямо<br />на карте города</span></div>
                <div className="astana-friends-art"><span>👨🏻</span><b>📍</b><span>👩🏻</span><i>🚘</i></div>
              </article>
              <article className="astana-interesting-card astana-sauna-card">
                <div className="astana-interesting-copy"><b>Избушка, сауна</b><span>Бани и сауны<br />рядом с вами</span></div>
                <div className="astana-sauna-art">🏡</div>
              </article>
            </div>
          </section>
        </>}
      </div>

      {navigating && route && <div className="astana-nav-guidance"><b>{nextInstruction?.distance || "Маршрут"}</b><span>{nextInstruction?.text || "Ведём по выбранному маршруту"}</span></div>}

      {showMapUtilityControls && <div className="astana-map-right-controls">
        <button onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], navigating ? 17 : 16); }} title="Моё местоположение">◎</button>
        <div className="astana-speed-limit"><b>{speedLimit || "—"}</b><span>км/ч</span></div>
        <div className="astana-speed-now"><b>{speed}</b><span>км/ч</span></div>
        <button onClick={() => mapRef.current?.zoomIn()} title="Приблизить">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} title="Отдалить">−</button>
        <button onClick={swapMapType} title="Карта / спутник">▱</button>
      </div>}

      {destination && !route && <section className="astana-bottom-card">
        <div className="astana-destination-title"><span className="green-dot" /> <div><b>{selectedLabel}</b><small>Адрес выбран</small></div></div>
        <button className="astana-route-button" onClick={() => buildRoute(mode)} disabled={routing || locating}>{routing ? "Строим маршрут…" : "➤ Маршрут"}</button>
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
          <button className={route.mode === "car" ? "active" : ""} onClick={() => buildRoute("car")}>🚗 {route.mode === "car" ? formatDuration(route.duration) : "Авто"}</button>
          <button className={route.mode === "bus" ? "active" : ""} onClick={() => buildRoute("bus")}>🚌 Автобус</button>
          <button className={route.mode === "walk" ? "active" : ""} onClick={() => buildRoute("walk")}>🚶 {route.mode === "walk" ? formatDuration(route.duration) : "Пешком"}</button>
        </div>
        {showSteps && <div className="astana-steps">{route.steps.slice(0, 12).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}</div>}
        <button className="astana-go-button" onClick={() => { setShowSteps(false); setNavigating(true); if (origin) mapRef.current?.setView([origin.lat, origin.lng], 17); }}>➤ В путь</button>
        {navigating && <button className="astana-stop-button" onClick={() => { setNavigating(false); setNextInstruction(null); routeProgressRef.current = -1; setRoute(value => value ? { ...value } : value); }}>Завершить навигацию</button>}
      </section>}

      {locating && <div className="astana-toast">Определяем местоположение…</div>}
      {error && <div className="astana-error">{error}</div>}


      {isHomeScreen && <button className="astana-home-locate" onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 16); }} aria-label="Моё местоположение">➤</button>}
      {isHomeScreen && <div className="astana-home-weather" aria-label="Погода"><span>☁️</span><b>Погода</b></div>}
      {isHomeScreen && <nav className="astana-home-bottom-nav" aria-label="Главное меню">
        <button className="active" onClick={openHomeSearch}><span>▦</span><b>Поиск</b></button>
        <button onClick={() => { if (route) setShowSteps(true); else openHomeSearch(); }}><span>⌁</span><b>Проезд</b></button>
        <button onClick={() => { if (route) setNavigating(true); else openHomeSearch(); }}><span>➤</span><b>Навигатор</b></button>
        <div><span>♧</span><b>Друзья</b></div>
        <div><span>◈</span><b>Места</b></div>
      </nav>}
    </main>
  );
}

const styles = `
.astana-map-page{position:fixed;inset:0;overflow:hidden;background:#10171d;color:#fff;font-family:Arial,sans-serif;z-index:1}
.astana-map-canvas{position:absolute;inset:0;z-index:0}
.astana-search-wrap{position:absolute;top:18px;left:18px;right:18px;z-index:20;max-width:760px;margin:auto}
.astana-search-box{height:58px;border-radius:18px;background:rgba(28,31,34,.96);display:flex;align-items:center;gap:10px;padding:0 15px;box-shadow:0 5px 22px rgba(0,0,0,.35)}
.astana-search-icon{font-size:31px;color:#aaa;line-height:1;background:none;border:0;padding:0;cursor:pointer;flex:none}.astana-search-box input{flex:1;background:none;border:0;outline:0;color:#fff;font-size:20px;min-width:0}.astana-search-box input::placeholder{color:#aaa}.astana-clear,.astana-mic{background:none;border:0;color:#ddd;font-size:25px;padding:6px;cursor:pointer;flex:none}.astana-mic.listening{color:#ff6262;animation:astana-pulse 1s infinite alternate}@keyframes astana-pulse{from{opacity:.65}to{opacity:1;transform:scale(1.08)}}.astana-results{margin-top:7px;border-radius:18px;overflow:hidden;background:rgba(28,31,34,.98);box-shadow:0 10px 28px rgba(0,0,0,.4);max-height:55vh;overflow-y:auto}.astana-result,.astana-result-loading{width:100%;border:0;border-bottom:1px solid #34383b;background:none;color:#fff;text-align:left;padding:15px;display:flex;gap:13px;align-items:flex-start}.astana-result:hover{background:#32363a}.astana-result-pin{font-size:23px;color:#36d56f}.astana-result b{display:block;font-size:16px}.astana-result small{display:block;color:#aeb4b8;font-size:13px;margin-top:5px;line-height:1.25}.astana-result-loading{color:#aaa}
.astana-map-right-controls{position:absolute;right:14px;top:105px;z-index:15;display:flex;flex-direction:column;align-items:center;gap:9px}.astana-map-right-controls button,.astana-speed-limit,.astana-speed-now{width:58px;min-height:58px;border:0;border-radius:18px;background:rgba(20,23,26,.94);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:30px}.astana-speed-limit{border:4px solid #e42b35;background:#17191b;border-radius:50%;width:64px;height:64px;min-height:64px;flex-direction:column}.astana-speed-limit b{font-size:22px}.astana-speed-limit span,.astana-speed-now span{font-size:10px;color:#bbb}.astana-speed-now{border-radius:50%;width:64px;height:64px;min-height:64px;flex-direction:column}.astana-speed-now b{font-size:24px}.astana-map-right-controls button:last-child{font-size:22px}.astana-map-right-controls button:nth-last-child(2),.astana-map-right-controls button:nth-last-child(3){font-size:34px;background:rgba(16,20,23,.96)}
.astana-bottom-card,.astana-route-card{position:absolute;left:12px;right:12px;bottom:18px;z-index:18;border-radius:24px;background:rgba(24,27,30,.97);padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.4);max-height:min(58vh,540px);overflow-y:auto}.astana-nav-guidance{position:absolute;left:12px;top:82px;z-index:19;display:flex;flex-direction:column;gap:3px;width:min(72vw,360px);padding:13px 15px;border-radius:17px;background:rgba(12,14,17,.96);box-shadow:0 5px 18px #0007}.astana-nav-guidance b{font-size:27px;line-height:1.05}.astana-nav-guidance span{font-size:15px;line-height:1.25}.astana-stop-button{width:100%;height:44px;margin-top:8px;border:1px solid #4a4f54;border-radius:14px;background:#2b3034;color:#eee;font-size:15px;font-weight:700}.astana-destination-title{display:flex;gap:10px;align-items:center;margin-bottom:12px}.green-dot{width:14px;height:14px;border-radius:50%;background:#20d35f;display:block;box-shadow:0 0 0 4px rgba(32,211,95,.16)}.astana-destination-title b{font-size:18px;display:block}.astana-destination-title small{color:#aeb4b8;display:block;margin-top:3px}.astana-route-button,.astana-go-button{width:100%;height:54px;border:0;border-radius:16px;background:#16c65b;color:#fff;font-weight:800;font-size:19px}.astana-mode-row,.astana-route-modes{display:flex;gap:8px;margin-top:10px;overflow:auto}.astana-mode-row button,.astana-route-modes button{border:0;border-radius:14px;background:#303438;color:#eee;padding:12px 15px;white-space:nowrap;font-size:15px}.astana-mode-row button.active,.astana-route-modes button.active{background:#19bd59;color:#fff}.astana-route-summary{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:10px}.astana-route-summary strong{display:block;font-size:25px}.astana-route-summary small{color:#aaa}.astana-route-summary button{border:0;background:#303438;color:#fff;border-radius:12px;padding:11px 12px}.astana-route-modes{margin-bottom:8px}.astana-steps{max-height:30vh;overflow:auto;border-top:1px solid #3b3f42;margin:8px 0}.astana-step{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid #303438}.astana-step>span{width:25px;height:25px;border-radius:50%;background:#1d7cf0;display:flex;align-items:center;justify-content:center;font-size:12px}.astana-step b{font-size:14px;display:block}.astana-step small{color:#aaa}.astana-toast,.astana-error{position:absolute;left:20px;right:20px;bottom:190px;z-index:25;background:rgba(30,33,36,.96);border-radius:14px;padding:12px 15px;text-align:center}.astana-error{bottom:110px;background:#6d2428;color:#fff}.astana-map-switch{position:absolute;left:50%;transform:translateX(-50%);bottom:8px;z-index:30;background:rgba(24,27,30,.95);border-radius:18px;padding:4px;display:flex;gap:3px}.astana-map-switch button{border:0;background:none;color:#aaa;padding:9px 18px;border-radius:14px;font-weight:700}.astana-map-switch button.active{background:#fff;color:#222}.moy-user-dot{display:block;width:18px;height:18px;border-radius:50%;background:#1385ff;border:4px solid #fff;box-shadow:0 0 0 2px #1385ff}.moy-destination-icon{background:#19a95b;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 9px #0008}.moy-destination-icon span{transform:rotate(45deg);font-weight:900;color:#fff}.moy-nav-arrow{background:none;border:0}.moy-nav-arrow-shape{display:block;color:#087cf5;text-shadow:0 2px 5px #000;font-size:48px;line-height:48px;transform:rotate(var(--heading,0deg)) translateY(-4px);transform-origin:50% 50%}.moy-turn-icon{background:none;border:0}.moy-turn-icon span{display:flex;width:27px;height:27px;border-radius:9px;background:#087cf5;color:#fff;align-items:center;justify-content:center;font-size:20px;font-weight:900;box-shadow:0 2px 5px #0008}
@media(max-width:520px){.astana-search-wrap{top:10px;left:10px;right:10px}.astana-search-box{height:54px;border-radius:17px}.astana-search-box input{font-size:17px}.astana-map-right-controls{right:9px;top:78px;gap:6px}.astana-map-right-controls button,.astana-speed-now{width:52px;min-height:52px}.astana-speed-limit{width:58px;height:58px;min-height:58px}.astana-bottom-card,.astana-route-card{bottom:12px;border-radius:22px}.astana-route-summary strong{font-size:22px}}

/* Main home screen styled after the approved mockup. Navigation/search logic above is unchanged. */
.astana-search-wrap-home{position:fixed;top:auto;left:0;right:0;bottom:0;width:100%;max-width:none;height:57dvh;max-height:760px;min-height:450px;margin:0;padding:0 14px 92px;box-sizing:border-box;overflow-x:hidden;overflow-y:auto;border-radius:29px 29px 0 0;background:rgba(255,255,255,.985);color:#17191b;box-shadow:0 -8px 34px rgba(14,30,42,.18);z-index:22;scrollbar-width:none}
.astana-search-wrap-home::-webkit-scrollbar{display:none}
.astana-home-handle{height:20px;display:flex;align-items:center;justify-content:center;margin:0 0 7px}
.astana-home-handle span{display:block;width:52px;height:5px;border-radius:99px;background:#d8dadd}
.astana-search-home-row{display:flex;align-items:center;gap:10px;min-width:0}
.astana-search-wrap-home .astana-search-box{flex:1;min-width:0;height:58px;border-radius:16px;background:#f0f1f2;box-shadow:none;padding:0 13px}
.astana-search-wrap-home .astana-search-icon{color:#767d82;font-size:31px}
.astana-search-wrap-home .astana-search-box input{color:#1d2226;font-size:19px}
.astana-search-wrap-home .astana-search-box input::placeholder{color:#858b90}
.astana-search-wrap-home .astana-clear,.astana-search-wrap-home .astana-mic{color:#687077}
.astana-home-menu{width:52px;height:58px;flex:none;border:0;border-radius:15px;background:#f0f1f2;color:#14181b;font-size:28px;display:flex;align-items:center;justify-content:center}
.astana-search-cancel{display:block;margin:9px 0 0 auto;border:0;background:transparent;color:#159b53;font-size:16px;font-weight:700}
.astana-search-wrap-active{position:fixed;top:10px;left:10px;right:10px;bottom:auto;width:auto;max-width:none;margin:0;padding:0;z-index:30;border-radius:18px;background:transparent}
.astana-search-wrap-active .astana-search-home-row{display:block}
.astana-search-wrap-active .astana-search-box{height:56px;width:100%;box-sizing:border-box;border-radius:18px}
.astana-search-wrap-active .astana-search-box input{font-size:17px}
.astana-search-wrap-active .astana-home-menu,.astana-search-wrap-active .astana-home-handle{display:none}
.astana-search-wrap-active .astana-results{max-height:calc(100dvh - 135px);background:rgba(28,31,34,.985)}
.astana-search-wrap-active .astana-result b{font-size:16px;line-height:1.3}
.astana-search-wrap-active .astana-result small{font-size:13px}
.astana-search-wrap-active .astana-search-cancel{position:absolute;right:5px;top:56px;color:#1ba85d}
.astana-home-shortcuts{display:flex;gap:9px;overflow-x:auto;margin:16px 0 15px;padding:0 0 2px;scrollbar-width:none}
.astana-home-shortcuts::-webkit-scrollbar,.astana-home-promo-strip::-webkit-scrollbar{display:none}
.astana-shortcut{flex:none;min-height:57px;padding:0 15px;border:0;border-radius:14px;background:#f0f1f2;color:#202428;font-size:15px;font-weight:600;white-space:nowrap;display:flex;align-items:center;gap:9px}
.astana-shortcut-icon{width:62px;justify-content:center;font-size:28px;padding:0}
.shortcut-symbol{font-size:26px;line-height:1;font-weight:500}
.astana-home-promo-strip{display:flex;gap:10px;overflow-x:auto;padding:0 0 4px;margin:0 -1px 20px;scrollbar-width:none}
.astana-promo-card{position:relative;display:flex;flex-direction:column;justify-content:space-between;flex:none;width:157px;height:166px;overflow:hidden;border:2px solid #22bf5d;border-radius:21px;padding:10px 10px 11px;box-sizing:border-box;box-shadow:inset 0 0 0 2px rgba(255,255,255,.72)}
.astana-promo-card:before{content:"";position:absolute;inset:0;opacity:.75;background:linear-gradient(140deg,transparent 30%,rgba(255,255,255,.35) 31%,transparent 48%)}
.astana-promo-card span{position:relative;z-index:1;font-size:14px;line-height:1.12;letter-spacing:-.2px;font-weight:800;color:#151819;text-shadow:0 1px 0 rgba(255,255,255,.45)}
.astana-promo-art{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;min-height:88px;font-size:51px;letter-spacing:-18px;filter:drop-shadow(0 5px 3px rgba(0,0,0,.2))}
.astana-promo-child{background:linear-gradient(145deg,#fff6c8 0%,#ffdf42 58%,#b7ee48 100%)}
.astana-promo-business{background:linear-gradient(150deg,#6cce21,#075c32 72%,#003d28)}
.astana-promo-business span{color:white;text-shadow:0 1px 3px #00361f}
.astana-promo-autumn{background:linear-gradient(150deg,#ffd43c,#ff8a16 48%,#ffe9a8)}
.astana-promo-smile{background:linear-gradient(140deg,#ff6c43,#ffb29a 55%,#f04f39)}
.astana-promo-smile .astana-promo-art{font-size:71px}
.astana-home-interesting{margin:0 0 4px}
.astana-home-interesting h2{margin:0 0 15px;font-size:23px;line-height:1.2;font-weight:800;letter-spacing:-.5px;color:#17191b}
.astana-interesting-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.astana-interesting-card{position:relative;height:205px;overflow:hidden;border-radius:20px;background:#f2f3f3;color:#181c1f;padding:15px 13px;box-sizing:border-box}
.astana-interesting-copy{position:relative;z-index:2;display:flex;flex-direction:column;gap:6px}
.astana-interesting-copy b{font-size:16px;line-height:1.15;font-weight:800}
.astana-interesting-copy span{font-size:13px;line-height:1.3;color:#7b8288}
.astana-friends-card{background:linear-gradient(180deg,#fff 5%,#f2f5f4 62%,#e7f4ed)}
.astana-friends-art{position:absolute;bottom:0;left:5px;right:5px;height:95px;display:flex;align-items:center;justify-content:center;gap:0}
.astana-friends-art span{display:flex;align-items:center;justify-content:center;width:53px;height:53px;border:5px solid #fff;border-radius:50%;background:#e6f1e7;font-size:30px;box-shadow:0 2px 8px #0002;z-index:2}
.astana-friends-art b{display:flex;align-items:center;justify-content:center;width:55px;height:55px;border-radius:50%;background:#17ba5b;color:white;font-size:31px;margin:0 -6px;z-index:3}
.astana-friends-art i{position:absolute;right:1px;top:0;font-style:normal;font-size:38px;filter:drop-shadow(0 2px 2px #0003)}
.astana-sauna-card{background:linear-gradient(180deg,#f7fbff,#d9e9f8 58%,#9cb0a0)}
.astana-sauna-art{position:absolute;bottom:-13px;left:-8px;right:-4px;height:110px;display:flex;align-items:center;justify-content:center;font-size:91px;text-shadow:0 5px 9px #0002}
.astana-home-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:35;height:78px;padding:7px 7px calc(7px + env(safe-area-inset-bottom,0px));box-sizing:border-box;background:rgba(255,255,255,.985);border-top:1px solid #e7e8e9;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;color:#92989d}
.astana-home-bottom-nav button,.astana-home-bottom-nav div{border:0;background:none;color:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:2px 0}
.astana-home-bottom-nav span{font-size:29px;line-height:1.05;font-weight:800}
.astana-home-bottom-nav b{font-size:12px;line-height:1.15;font-weight:600}
.astana-home-bottom-nav .active{color:#16ad56}
.astana-map-switch-home{display:none}
.astana-home-locate{position:fixed;right:19px;bottom:calc(57dvh + 18px);z-index:16;width:56px;height:56px;border:0;border-radius:50%;background:#fff;color:#101820;box-shadow:0 3px 13px #0002;font-size:30px;display:flex;align-items:center;justify-content:center}
.astana-home-locate::first-letter{color:#137cf4}
.astana-home-weather{position:fixed;left:16px;bottom:calc(57dvh + 18px);z-index:16;display:flex;align-items:center;gap:6px;border-radius:14px;background:#fff;padding:9px 12px;box-shadow:0 3px 13px #0002;color:#535e66}
.astana-home-weather span{font-size:24px}.astana-home-weather b{font-size:12px;font-weight:700}
.astana-home-map-side{display:none!important;position:fixed;left:15px;top:24px;z-index:14;flex-direction:column;gap:13px;align-items:center}
.astana-home-avatar{position:relative;width:66px;height:66px;border:4px solid #fff;border-radius:50%;background:linear-gradient(140deg,#e7c6ab,#8b9da3 50%,#263741);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#fff;box-shadow:0 3px 12px #0003}
.astana-home-avatar span{position:absolute;right:-4px;top:-2px;width:23px;height:23px;border-radius:50%;background:#f33d4b;color:#fff;text-align:center;line-height:23px;font-size:13px}
.astana-home-city-mark{width:55px;height:55px;border-radius:50%;background:#20272d;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 3px 12px #0003}
.astana-home-briefcase{display:none!important;position:fixed;top:24px;right:16px;z-index:14;width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,.95);align-items:center;justify-content:center;font-size:29px;box-shadow:0 3px 13px #0002}
.astana-search-wrap-home .astana-home-shortcuts,.astana-search-wrap-home .astana-home-promo-strip,.astana-search-wrap-home .astana-home-interesting{max-width:100%}
/* Photo-led cards like the approved home-screen reference. Colors remain as fallbacks if an image is unavailable. */
.astana-promo-art{display:none}
.astana-promo-card span{position:absolute;left:0;right:0;bottom:0;padding:12px 10px 11px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.94) 36%);color:#141719}
.astana-promo-child{background-color:#f9df53;background-image:linear-gradient(0deg,rgba(255,225,74,.98) 0%,rgba(255,225,74,.88) 28%,rgba(255,225,74,0) 78%),url("https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=420&q=80");background-size:cover;background-position:center 30%}
.astana-promo-business{background-color:#176d3a;background-image:linear-gradient(0deg,rgba(0,72,40,.98) 0%,rgba(0,72,40,.8) 32%,rgba(0,72,40,0) 82%),url("https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=420&q=80");background-size:cover;background-position:center}
.astana-promo-business span{color:#fff;background:linear-gradient(180deg,transparent,rgba(0,61,34,.95) 35%);text-shadow:0 1px 2px #00361f}
.astana-promo-autumn{background-color:#ffad22;background-image:linear-gradient(0deg,rgba(255,183,35,.98) 0%,rgba(255,183,35,.78) 32%,rgba(255,183,35,0) 82%),url("https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=420&q=80");background-size:cover;background-position:center}
.astana-promo-smile{background-color:#ff7a61;background-image:linear-gradient(0deg,rgba(255,113,86,.98) 0%,rgba(255,113,86,.82) 34%,rgba(255,113,86,0) 82%),url("https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=420&q=80");background-size:cover;background-position:center}
.astana-promo-smile span{color:#fff;background:linear-gradient(180deg,transparent,rgba(220,66,51,.96) 38%)}
.astana-interesting-card{background-size:cover;background-position:center}
.astana-friends-card{background-color:#e9f4ed;background-image:linear-gradient(180deg,rgba(255,255,255,.96) 0%,rgba(255,255,255,.88) 44%,rgba(228,244,235,.2) 100%),url("https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=700&q=82")}
.astana-sauna-card{background-color:#dbe6ed;background-image:linear-gradient(180deg,rgba(247,251,255,.98) 0%,rgba(247,251,255,.87) 40%,rgba(226,237,246,.12) 100%),url("https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=700&q=82")}
.astana-friends-art,.astana-sauna-art{display:none}
@media(max-width:520px){
  .astana-search-wrap-home{height:57dvh;min-height:400px;padding-left:12px;padding-right:12px;padding-bottom:85px}
  .astana-search-wrap-home .astana-search-box{height:52px}
  .astana-home-shortcuts{gap:7px;margin-top:13px}
  .astana-shortcut{min-height:50px;font-size:14px;padding:0 12px}
  .astana-shortcut-icon{width:54px;padding:0}
  .astana-promo-card{width:139px;height:151px;padding:8px}
  .astana-promo-art{font-size:44px;min-height:80px}
  .astana-promo-card span{font-size:12px}
  .astana-home-interesting h2{font-size:21px;margin-bottom:12px}
  .astana-interesting-card{height:180px;padding:12px 10px}
  .astana-interesting-copy b{font-size:14px}
  .astana-interesting-copy span{font-size:12px}
  .astana-friends-art{height:78px}
  .astana-friends-art span{width:42px;height:42px;font-size:24px}
  .astana-friends-art b{width:43px;height:43px;font-size:25px}
  .astana-friends-art i{font-size:30px}
  .astana-sauna-art{font-size:72px}
  .astana-home-bottom-nav{height:72px}
  .astana-home-bottom-nav span{font-size:26px}
  .astana-home-bottom-nav b{font-size:11px}
  .astana-home-locate{bottom:calc(57dvh + 16px);width:51px;height:51px;right:13px}
  .astana-home-weather{bottom:calc(57dvh + 16px);left:12px}
  .astana-home-map-side{left:10px;top:16px;gap:10px}
  .astana-home-avatar{width:54px;height:54px}
  .astana-home-city-mark{width:48px;height:48px}
  .astana-home-briefcase{top:17px;right:12px;width:52px;height:52px;font-size:25px}
}
`;

if (typeof document !== "undefined" && !document.getElementById("astana-map-styles")) {
  const style = document.createElement("style");
  style.id = "astana-map-styles";
  style.textContent = styles;
  document.head.appendChild(style);
}
