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

function formatArrivalTime(seconds) {
  const date = new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000);
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function routeTurnCount(route) {
  return (route?.steps || []).filter(step => ["turn", "roundabout", "fork", "merge"].includes(step?.maneuver?.type)).length;
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
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function selectedPlaceTitle(item) {
  if (!item) return "Выбранное место";
  return item.name || item.display_name?.split(",")[0] || cleanName(item) || "Выбранное место";
}

function selectedPlaceAddress(item) {
  return item?.display_name || cleanName(item) || "Адрес не указан";
}

function placeCategory(item) {
  const key = `${item?.class || ""} ${item?.type || ""} ${item?.address?.amenity || ""}`.toLowerCase();
  if (/apartments|residential|house|building|tower/.test(key)) return "Жилой дом";
  if (/hospital|clinic|doctors|pharmacy/.test(key)) return "Медицина";
  if (/restaurant|cafe|fast_food|food/.test(key)) return "Ресторан";
  if (/shop|supermarket|convenience|mall/.test(key)) return "Магазин";
  if (/school|university|college|kindergarten/.test(key)) return "Образование";
  if (/hotel|hostel|guest_house/.test(key)) return "Гостиница";
  if (/park|garden|nature_reserve/.test(key)) return "Парк";
  if (/road|street|highway|residential_road/.test(key)) return "Адрес";
  return "Место на карте";
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

function nextTurnArrow(step) {
  const maneuver = step?.maneuver || {};
  const modifier = String(maneuver.modifier || "").toLowerCase();
  if (maneuver.type === "roundabout" || maneuver.type === "rotary") return "↻";
  if (modifier.includes("uturn") || maneuver.type === "uturn") return "↶";
  if (modifier.includes("left")) return "←";
  if (modifier.includes("right")) return "→";
  return "↑";
}

function nextRouteInstruction(route, points, progress) {
  if (!route?.steps?.length || points.length < 2) return { distance: "", arrow: "↑" };
  let next = null;
  let nextIndex = Infinity;
  for (const step of route.steps) {
    const loc = step?.maneuver?.location;
    if (!Array.isArray(loc) || !["turn", "roundabout", "rotary", "fork", "merge", "arrive"].includes(step.maneuver?.type)) continue;
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
  if (!next) return { distance: "", arrow: "↑" };
  return {
    distance: formatDistance(routeDistanceToIndex(points, progress, nextIndex)),
    arrow: nextTurnArrow(next),
  };
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
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [route, setRoute] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [routeOrigin, setRouteOrigin] = useState(null);
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
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const navigationMapTypeRef = useRef(null);
  const speedLimitCell = useMemo(() => origin ? `${Math.round(origin.lat * 100)},${Math.round(origin.lng * 100)}` : "", [origin?.lat, origin?.lng]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled || !window.L || !mapEl.current || mapRef.current) return;
      const L = window.L;
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true, rotate: true, touchRotate: true, dragRotate: true, rotateClockwise: true, shiftKeyRotate: false, preventPageGestures: true }).setView(ASTANA, 12);
      const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
      const dark = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
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
    const loadWithRotation = () => {
      if (cancelled || !window.L) return;
      if (typeof window.L.Map?.prototype?.setBearing === "function") {
        load();
        return;
      }
      let rotateScript = document.querySelector('script[data-moy-leaflet-rotate-js="1"]');
      if (!rotateScript) {
        rotateScript = document.createElement("script");
        rotateScript.src = "https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js";
        rotateScript.dataset.moyLeafletRotateJs = "1";
        rotateScript.addEventListener("load", () => { if (!cancelled) load(); }, { once: true });
        rotateScript.addEventListener("error", () => { if (!cancelled) load(); }, { once: true });
        document.head.appendChild(rotateScript);
        return;
      }
      if (typeof window.L.Map?.prototype?.setBearing === "function" || rotateScript.dataset.moyLeafletRotateLoaded === "true") {
        load();
        return;
      }
      rotateScript.addEventListener("load", () => {
        rotateScript.dataset.moyLeafletRotateLoaded = "true";
        if (!cancelled) load();
      }, { once: true });
      rotateScript.addEventListener("error", () => { if (!cancelled) load(); }, { once: true });
    };

    if (window.L) loadWithRotation();
    else {
      let script = document.querySelector('script[data-moy-leaflet-js="1"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.dataset.moyLeafletJs = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", loadWithRotation, { once: true });
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
      const title = selectedPlaceTitle(selectedPlace);
      const rating = Number.isFinite(Number(selectedPlace?.rating)) && selectedPlace?.rating !== null && selectedPlace?.rating !== undefined
        ? `<small>★ ${escapeHtml(Number(selectedPlace.rating).toFixed(1))}</small>`
        : "";
      const icon = L.divIcon({
        className: route ? "moy-destination-icon" : "moy-selected-place",
        html: route
          ? '<span>Б</span>'
          : `<span class="moy-selected-pin"></span><span class="moy-selected-label"><b>${escapeHtml(title)}</b>${rating}</span>`,
        iconSize: route ? [40, 46] : [290, 58],
        iconAnchor: route ? [20, 44] : [20, 38],
      });
      L.marker([destination.lat, destination.lng], { icon, zIndexOffset: 900 }).addTo(group);
    }

    if (route?.geometry?.length > 1) {
      const allOptions = routeOptions.length ? routeOptions : [route];
      const boundsPoints = [];
      allOptions.filter(option => option && option !== route && option.geometry?.length > 1).forEach(option => {
        const alternativeLine = option.geometry.map(p => [p[1], p[0]]);
        boundsPoints.push(...alternativeLine);
        L.polyline(alternativeLine, {
          color: "#3985f6",
          weight: 6,
          opacity: 0.82,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "9 7",
          interactive: false,
        }).addTo(group);
        const middle = alternativeLine[Math.floor(alternativeLine.length / 2)];
        if (middle) {
          const altIcon = L.divIcon({
            className: "moy-alt-route-label",
            html: '<span>' + escapeHtml(formatDuration(option.duration)) + '<small>' + escapeHtml(formatDistance(option.distance)) + '</small></span>',
            iconSize: [88, 44],
            iconAnchor: [44, 22],
          });
          L.marker(middle, { icon: altIcon, interactive: false, zIndexOffset: 600 }).addTo(group);
        }
      });
      const line = route.geometry.map(p => [p[1], p[0]]);
      boundsPoints.push(...line);
      routePointsRef.current = line;
      routeRef.current = L.polyline(line, { color: "#20c943", weight: 8, opacity: 0.98, lineCap: "round", lineJoin: "round" }).addTo(group);
      const bounds = L.latLngBounds(boundsPoints.length ? boundsPoints : line);
      mapRef.current.fitBounds(bounds, { paddingTopLeft: [18, navigating ? 115 : 80], paddingBottomRight: [18, navigating ? 280 : 300], maxZoom: 16 });
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
  }, [leafletReady, destination?.lat, destination?.lng, route, routeOptions, selectedPlace]); 

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
      const fromPoint = routeOrigin || origin;
      if (!fromPoint) throw new Error("Не удалось определить начальную точку маршрута.");
      if (!routeOrigin) setRouteOrigin(fromPoint);
      const router = nextMode === "walk" ? ROUTERS.walk : ROUTERS.car;
      const alternatives = nextMode === "car" ? "&alternatives=true" : "";
      const url = `${router}/${fromPoint.lng},${fromPoint.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&annotations=true${alternatives}`;
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
      const options = data.routes.slice(0, 3).map((r, index) => ({
        id: nextMode + "-" + index + "-" + Math.round(r.distance) + "-" + Math.round(r.duration),
        geometry: r.geometry.coordinates,
        distance: r.distance,
        duration: r.duration,
        steps: r.legs?.flatMap(l => l.steps || []) || [],
        mode: nextMode,
        optionIndex: index,
      }));
      setRouteOptions(options);
      setRoute(options[0]);
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
    setRouteOrigin(null);
    setRouteOptions([]);
    setSelectedPlace(item);
    setIsFavorite(false);
    setQuery(cleanName(item));
    setResults([]);
    setShowResultsPanel(false);
    setSearchActive(false);
    setRoute(null);
    setNavigating(false);
    setNextInstruction(null);
    setError("");
    mapRef.current?.setView([point.lat, point.lng], 15);
  }

  function swapMapType() {
    setMapType(v => v === "map" ? "satellite" : v === "satellite" ? "dark" : "map");
  }

  function startNavigation(nextRoute = route) {
    const activeRoute = nextRoute || route;
    if (!activeRoute?.geometry?.length) {
      setError("Сначала построй маршрут, затем нажми «В путь».");
      return;
    }
    setRoute(activeRoute);
    if (navigationMapTypeRef.current === null) navigationMapTypeRef.current = mapType;
    setShowSteps(false);
    setNavigationMenuOpen(false);
    routeProgressRef.current = -1;
    setNextInstruction(null);
    setNavigating(true);
    setMapType("dark");
    const current = routeOrigin || origin;
    if (current && mapRef.current) {
      mapRef.current.setView([current.lat, current.lng], 17, { animate: true });
    }
    window.setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
    }, 80);
  }

  function stopNavigation() {
    setNavigating(false);
    setNavigationMenuOpen(false);
    setNextInstruction(null);
    routeProgressRef.current = -1;
    setRouteOptions(items => items.slice());
    setMapType(navigationMapTypeRef.current || "map");
    navigationMapTypeRef.current = null;
  }

  function openSearchFromNavigation() {
    stopNavigation();
    setRoute(null);
    setRouteOptions([]);
    setRouteOrigin(null);
    setQuery("");
    setResults([]);
    setShowResultsPanel(false);
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  const selectedLabel = useMemo(
    () => selectedPlace ? selectedPlaceTitle(selectedPlace) : query || "Куда едем?",
    [selectedPlace, query]
  );
  const selectedAddress = useMemo(
    () => selectedPlace ? selectedPlaceAddress(selectedPlace) : query,
    [selectedPlace, query]
  );
  const selectedCategory = useMemo(() => placeCategory(selectedPlace), [selectedPlace]);
  const isHomeScreen = !searchActive && !query.trim() && !showResultsPanel && !destination && !route;
  const showMapUtilityControls = Boolean(route && navigating);
  const showPlaceMapControls = Boolean(destination && !route && selectedPlace);

  function openHomeSearch() {
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 30);
  }

  return (
    <main className="astana-map-page">
      <div ref={mapEl} className={`astana-map-canvas${navigating ? " astana-map-canvas-navigation" : ""}`} />



      {!route && <div className={`astana-search-wrap ${isHomeScreen ? "astana-search-wrap-home" : showPlaceMapControls ? "astana-search-wrap-selected" : "astana-search-wrap-active"}`}>
        {isHomeScreen && <div className="astana-home-handle"><span /></div>}
        <div className="astana-search-home-row">
          <div className="astana-search-box">
            <button className="astana-search-icon" onClick={() => searchAddress(query)} aria-label="Найти адрес" title="Найти адрес">⌕</button>
            <input
              ref={searchInputRef}
              value={query}
              onFocus={() => setSearchActive(true)}
              onChange={e => { setQuery(e.target.value); setResults([]); setShowResultsPanel(false); setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchAddress(query); } }}
              placeholder="Поиск"
              aria-label="Поиск адреса"
            />
            {query && <button className="astana-clear" onClick={() => { setQuery(""); setResults([]); setShowResultsPanel(false); setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setSearchActive(false); setError(""); }}>×</button>}
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
      </div>}

      {navigating && route && <div className="astana-nav-guidance" aria-label="Следующий манёвр">
        <div className="astana-nav-guidance-symbol">{nextInstruction?.arrow || "↑"}</div>
        <div className="astana-nav-guidance-copy">
          <b>{nextInstruction?.distance || "— м"}</b>
        </div>
      </div>}

      {showPlaceMapControls && <div className="astana-place-map-controls" aria-label="Управление картой">
        <button onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 16); }} aria-label="Моё местоположение" title="Моё местоположение">➤</button>
        <button onClick={() => mapRef.current?.zoomIn()} aria-label="Приблизить" title="Приблизить">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label="Отдалить" title="Отдалить">−</button>
        <button onClick={swapMapType} aria-label="Сменить карту" title="Сменить тип карты">◈</button>
      </div>}

      {destination && !route && <section className="astana-place-card">
        <div className="astana-place-handle"><span /></div>
        <div className="astana-place-heading">
          <div className="astana-place-heading-copy">
            <h2>{selectedLabel}</h2>
            <span className="astana-place-category">{selectedCategory}</span>
          </div>
          <button className="astana-place-close" onClick={() => {
            setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setQuery("");
            setResults([]); setShowResultsPanel(false); setSearchActive(false); setNavigating(false); setError("");
          }} aria-label="Закрыть карточку места">×</button>
        </div>

        {selectedPlace?.rating !== undefined && selectedPlace?.rating !== null && Number.isFinite(Number(selectedPlace.rating)) &&
          <div className="astana-place-rating"><span className="astana-stars">★★★★★</span><b>{Number(selectedPlace.rating).toFixed(1)}</b>{selectedPlace.review_count ? <span>{selectedPlace.review_count} оценок</span> : null}</div>
        }

        <p className="astana-place-address">{selectedAddress}</p>
        <div className="astana-place-meta">
          <span>{selectedPlace?.address?.city || selectedPlace?.address?.town || selectedPlace?.address?.village || selectedPlace?.address?.municipality || "Местоположение на карте"}</span>
          <span className="astana-place-coordinates">{destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</span>
        </div>

        <div className="astana-place-tabs"><span className="active">Информация</span><span>Рядом</span><span>На карте</span></div>

        <div className="astana-place-actions">
          <button className="astana-place-route-button" onClick={() => buildRoute(mode)} disabled={routing || locating}>
            {routing ? "Строим…" : <><span className="astana-place-route-arrow">➤</span> Маршрут</>}
          </button>
          <button className={`astana-place-icon-action ${isFavorite ? "saved" : ""}`} onClick={() => setIsFavorite(v => !v)} aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"} title="Избранное">{isFavorite ? "★" : "♧"}</button>
          <button className="astana-place-icon-action" onClick={async () => {
            const shareText = `${selectedLabel}\n${selectedAddress}`;
            try {
              if (navigator.share) await navigator.share({ title: selectedLabel, text: shareText, url: window.location.href });
              else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareText); setError("Адрес скопирован."); }
              else setError(shareText);
            } catch {}
          }} aria-label="Поделиться адресом" title="Поделиться">●</button>
          <button className="astana-place-taxi-action" onClick={() => setError("Вызов такси пока не подключён к карте.")}><span>🚕</span><b>На такси</b></button>
        </div>
      </section>}

      {showMapUtilityControls && <div className="astana-map-right-controls astana-navigation-controls">
        <div className="astana-nav-speed-limit"><b>{speedLimit || "—"}</b></div>
        <div className="astana-nav-speed-now"><b>{speed}</b></div>
        <button className="astana-nav-parking" title="Парковки" onClick={() => setError("Данные парковок пока не подключены.")}>P</button>
        <div className="astana-nav-zoom">
          <button onClick={() => mapRef.current?.zoomIn()} aria-label="Приблизить">+</button>
          <button onClick={() => mapRef.current?.zoomOut()} aria-label="Отдалить">−</button>
        </div>
        <button className="astana-nav-compass" onClick={() => mapRef.current?.setView([origin?.lat || ASTANA[0], origin?.lng || ASTANA[1]], mapRef.current?.getZoom() || 17)} aria-label="Ориентировать карту">◢</button>
        <button className="astana-nav-recenter" onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 17, { animate: true }); }} aria-label="Моё местоположение">➤</button>
      </div>}

      {route && !navigating && <div className="astana-route-quick-actions">
        <button className="astana-route-quick-icon" onClick={() => setShowSteps(v => !v)} aria-label="Параметры маршрута" title="Параметры маршрута">☷</button>
        <button className="astana-route-quick-icon" onClick={async () => {
          const shareText = "Маршрут до " + selectedLabel + "\n" + formatDistance(route.distance) + ", " + formatDuration(route.duration);
          try {
            if (navigator.share) await navigator.share({ title: "Маршрут", text: shareText, url: window.location.href });
            else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareText); setError("Маршрут скопирован."); }
            else setError(shareText);
          } catch {}
        }} aria-label="Поделиться маршрутом" title="Поделиться маршрутом">♧</button>
        <button onClick={() => setError("Добавление промежуточных остановок пока не подключено.")}>Заехать</button>
        <button onClick={() => {
          if (mapRef.current && routeOptions.length) {
            const points = routeOptions.flatMap(option => (option.geometry || []).map(p => [p[1], p[0]]));
            if (points.length) mapRef.current.fitBounds(window.L.latLngBounds(points), { padding: [30, 320] });
          }
        }}>К подъезду</button>
        <button onClick={() => setError("Данные парковок пока не подключены.")}>На парковку</button>
      </div>}

      {route && !navigating && <section className="astana-route-card astana-route-results">
        <div className="astana-route-handle"><span /></div>
        <div className="astana-route-endpoints">
          <div className="astana-route-endpoint-list">
            <div className="astana-route-endpoint"><span className="astana-endpoint-dot astana-origin-dot" /><span>Моё местоположение</span></div>
            <div className="astana-route-endpoint"><span className="astana-endpoint-dot astana-destination-dot" /><span>{selectedLabel}</span></div>
          </div>
          <div className="astana-route-endpoint-actions">
            <button aria-label="Поменять точки местами" title="Поменять точки местами" onClick={() => {
              const oldStart = routeOrigin || origin;
              if (!oldStart || !destination) return;
              setRouteOrigin(destination);
              setDestination(oldStart);
              setSelectedPlace({ name: "Моё местоположение", display_name: "Моё местоположение", address: { city: "Астана" }, lat: oldStart.lat, lon: oldStart.lng, type: "place" });
              setQuery("Моё местоположение");
              setRoute(null); setRouteOptions([]); setNavigating(false); setNextInstruction(null); setError("");
            }}>↕</button>
            <button aria-label="Закрыть маршрут" title="Закрыть маршрут" onClick={() => {
              setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setNextInstruction(null); setShowSteps(false); setError("");
              if (destination) mapRef.current?.setView([destination.lat, destination.lng], 15);
            }}>×</button>
          </div>
        </div>

        <div className="astana-route-option-track">
          {(routeOptions.length ? routeOptions : [route]).map((option, index) => <article key={option.id || index} className={`astana-route-option-card ${option === route ? "selected" : ""}`}>
            <div className="astana-route-option-top">
              <div><strong>{formatDuration(option.duration)}</strong><span className="astana-route-arrival">→ {formatArrivalTime(option.duration)}</span></div>
              {option === route && <button type="button" className="astana-route-start-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); startNavigation(option); }} aria-label="Начать навигацию по выбранному маршруту">В путь</button>}
            </div>
            <p>{formatDistance(option.distance)} · {index === 0 ? "Лучший маршрут" : "Альтернативный маршрут"}</p>
            <div className="astana-route-turns"><span>◉</span> Повороты · {routeTurnCount(option)}</div>
          </article>)}
        </div>

        {showSteps && <div className="astana-steps astana-route-step-list">
          {route.steps.slice(0, 12).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}
        </div>}

        <div className="astana-route-transport-strip">
          <button className={route.mode === "car" ? "active" : ""} onClick={() => buildRoute("car")}><span>🚘</span><b>{route.mode === "car" ? formatDuration(route.duration) : "Авто"}</b></button>
          <button onClick={() => buildRoute("bus")}><span>🚌</span><b>Автобус</b><small>—</small></button>
          <button className={route.mode === "walk" ? "active" : ""} onClick={() => buildRoute("walk")}><span>🚶</span><b>{route.mode === "walk" ? formatDuration(route.duration) : "Пешком"}</b></button>
          <button disabled title="Вызов такси пока не подключён"><span>🚕</span><b>Такси</b><small>—</small></button>
          <button disabled title="Данные для мотоцикла пока не подключены"><span>🏍</span><b>Мото</b><small>—</small></button>
          <button disabled title="Данные для велосипеда пока не подключены"><span>🚲</span><b>Вело</b><small>—</small></button>
        </div>
      </section>}

      {navigating && route && <div className="astana-nav-parking-filter">Все парковки⌄</div>}
      {navigating && route && navigationMenuOpen && <div className="astana-nav-menu">
        <div className="astana-nav-menu-title">Маршрут · {formatDistance(route.distance)}</div>
        <div className="astana-nav-menu-steps">
          {route.steps.slice(0, 10).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}
        </div>
        <button onClick={stopNavigation}>Завершить навигацию</button>
      </div>}
      {navigating && route && <div className="astana-nav-bottom-hud">
        <button className="astana-nav-hud-icon" onClick={openSearchFromNavigation} aria-label="Новый поиск">⌕</button>
        <div className="astana-nav-hud-metric"><b>{formatDuration(route.duration)}</b><span>мин</span></div>
        <div className="astana-nav-hud-metric"><b>{formatArrivalTime(route.duration)}</b><span>прибытие</span></div>
        <div className="astana-nav-hud-metric"><b>{Math.round(Number(route.distance || 0) / 1000)}</b><span>км</span></div>
        <button className="astana-nav-hud-icon" onClick={() => setNavigationMenuOpen(v => !v)} aria-label="Меню навигации">☰</button>
      </div>}

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
.astana-map-canvas{position:absolute;inset:0;z-index:0;touch-action:none}
.astana-map-canvas .leaflet-container{touch-action:none}
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
/* Selected place details — photo-led white panel matching the approved mockup. */
.astana-search-wrap-selected{position:fixed;top:10px;left:10px;right:10px;bottom:auto;width:auto;max-width:none;margin:0;padding:0;z-index:30;border-radius:18px;background:transparent}
.astana-search-wrap-selected .astana-search-home-row{display:block}
.astana-search-wrap-selected .astana-search-box{height:56px;width:100%;box-sizing:border-box;border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 4px 22px rgba(20,38,50,.16);border:1px solid rgba(0,0,0,.04)}
.astana-search-wrap-selected .astana-search-icon,.astana-search-wrap-selected .astana-clear,.astana-search-wrap-selected .astana-mic{color:#77828b}
.astana-search-wrap-selected .astana-search-box input{font-size:17px;color:#20262c}
.astana-search-wrap-selected .astana-search-box input::placeholder{color:#7b858d}
.astana-search-wrap-selected .astana-home-menu,.astana-search-wrap-selected .astana-home-handle{display:none}
.astana-search-wrap-selected .astana-results{background:#fff;color:#1f2529;box-shadow:0 8px 28px #12202c24}
.astana-search-wrap-selected .astana-result{color:#1f2529;border-bottom-color:#edf0f2}
.astana-search-wrap-selected .astana-result small{color:#78838c}
.astana-search-wrap-selected .astana-search-cancel{display:none}
.astana-place-map-controls{position:fixed;right:14px;top:27%;z-index:17;display:flex;flex-direction:column;align-items:center;gap:10px}
.astana-place-map-controls button{width:58px;height:58px;border:0;border-radius:50%;background:rgba(255,255,255,.98);color:#222a30;box-shadow:0 3px 14px rgba(16,30,43,.18);display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:500;cursor:pointer}
.astana-place-map-controls button:first-child{font-size:26px;color:#087cf5}
.astana-place-map-controls button:last-child{color:#64717b;font-size:24px}
.astana-place-card{position:fixed;left:0;right:0;bottom:0;z-index:21;height:auto;min-height:0;max-height:min(62dvh,460px);box-sizing:border-box;overflow-y:auto;padding:0 16px calc(8px + env(safe-area-inset-bottom,0px));border-radius:29px 29px 0 0;background:rgba(255,255,255,.99);color:#1e252a;box-shadow:0 -5px 28px rgba(25,45,58,.15);scrollbar-width:none}
.astana-place-card::-webkit-scrollbar{display:none}
.astana-place-handle{height:21px;display:flex;justify-content:center;align-items:center;margin-bottom:7px}
.astana-place-handle span{width:52px;height:5px;border-radius:99px;background:#d9dde0}
.astana-place-heading{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}
.astana-place-heading-copy{min-width:0;flex:1}
.astana-place-heading h2{margin:0;color:#1e2429;font-size:23px;line-height:1.18;font-weight:800;letter-spacing:-.5px;overflow-wrap:anywhere}
.astana-place-category{display:block;margin-top:5px;color:#7c858c;font-size:16px}
.astana-place-close{flex:none;width:52px;height:52px;border:0;border-radius:15px;background:#f0f2f3;color:#48515a;font-size:31px;line-height:1}
.astana-place-rating{display:flex;align-items:center;gap:8px;margin:12px 0 7px;font-size:15px}
.astana-stars{color:#f6b900;font-size:22px;letter-spacing:-2px}
.astana-place-rating b{color:#232a30;font-size:17px}
.astana-place-rating span:last-child{color:#899198}
.astana-place-address{margin:12px 0 8px;color:#222a30;font-size:17px;line-height:1.35;overflow-wrap:anywhere}
.astana-place-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#899198;font-size:13px;line-height:1.25}
.astana-place-coordinates{font-size:11px;color:#9aa2a8;white-space:nowrap}
.astana-place-tabs{display:flex;gap:24px;align-items:center;margin:15px -1px 12px;padding-top:13px;border-top:1px solid #e7ebee;color:#7f8991;font-weight:700;font-size:14px;white-space:nowrap;overflow:auto}
.astana-place-tabs .active{color:#252c31}
.astana-place-actions{display:grid;grid-template-columns:minmax(0,1.5fr) 56px 56px minmax(100px,1.4fr);gap:8px;align-items:center;margin-bottom:4px}
.astana-place-actions button{height:55px;border:0;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:700;min-width:0;white-space:nowrap}
.astana-place-route-button{background:#12bc55;color:white;box-shadow:0 2px 5px #0c9d4526}
.astana-place-route-button:disabled{opacity:.58}
.astana-place-route-arrow{font-size:22px}
.astana-place-icon-action{background:#f0f2f3;color:#171d21;font-size:24px!important}
.astana-place-icon-action.saved{color:#11a94f;background:#e1f7e9}
.astana-place-taxi-action{background:#f0f2f3;color:#262b2f;padding:0 10px}
.astana-place-taxi-action span{font-size:21px}
.moy-selected-place{display:flex;align-items:center;width:290px;height:58px;overflow:visible;background:none;border:0}
.moy-selected-place .moy-selected-pin{display:inline-block;width:34px;height:34px;border:4px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#087df2;box-shadow:0 3px 10px #0004;box-sizing:border-box;flex:none}
.moy-selected-place .moy-selected-label{display:flex;flex-direction:column;gap:2px;max-width:236px;margin-left:7px;margin-top:-2px;padding:9px 11px;border-radius:13px;background:rgba(255,255,255,.97);color:#20272d;box-shadow:0 3px 12px #0002;font-family:Arial,sans-serif;line-height:1.2}
.moy-selected-place .moy-selected-label b{font-size:13px;font-weight:700;white-space:normal}
.moy-selected-place .moy-selected-label small{color:#f3b500;font-size:12px;font-weight:800}
@media(max-width:520px){
 .astana-place-map-controls{right:10px;top:26%;gap:8px}
 .astana-place-map-controls button{width:51px;height:51px;font-size:27px}
 .astana-place-card{height:auto;min-height:0;max-height:min(62dvh,440px);padding-left:14px;padding-right:14px;padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))}
 .astana-place-heading h2{font-size:21px}
 .astana-place-category{font-size:14px}
 .astana-place-address{font-size:15px}
 .astana-place-tabs{gap:20px;font-size:13px;margin-top:12px;margin-bottom:10px}
 .astana-place-actions{grid-template-columns:minmax(0,1.4fr) 48px 48px minmax(94px,1.2fr);gap:6px}
 .astana-place-actions button{height:50px;font-size:13px}
}


/* Route preview: map stays visible above a light route-planning sheet. */
.astana-route-controls{z-index:18;top:14%;right:12px;gap:9px}
.astana-route-controls button,.astana-route-controls .astana-speed-now{width:55px;height:55px;min-height:55px;border-radius:50%;background:rgba(255,255,255,.97);color:#27313a;box-shadow:0 3px 12px rgba(30,46,60,.18);font-size:27px}
.astana-route-controls .astana-speed-limit{width:60px;height:60px;min-height:60px;border-radius:50%;background:#169e22;border:3px solid #fff;color:#fff}
.astana-route-controls .astana-speed-limit span,.astana-route-controls .astana-speed-now span{color:#6e7b84}
.astana-route-controls .astana-speed-now{border:0}
.astana-route-controls button:nth-last-child(2),.astana-route-controls button:nth-last-child(3){background:rgba(255,255,255,.97);color:#27313a}
.astana-route-quick-actions{position:fixed;left:12px;right:12px;bottom:calc(min(455px, max(39dvh, 375px)) - 45px);z-index:20;display:flex;gap:7px;overflow-x:auto;white-space:nowrap;scrollbar-width:none;padding:3px 2px 5px}
.astana-route-quick-actions::-webkit-scrollbar,.astana-route-option-track::-webkit-scrollbar,.astana-route-transport-strip::-webkit-scrollbar{display:none}
.astana-route-quick-actions button{height:48px;flex:none;border:0;border-radius:13px;padding:0 15px;background:#fff;color:#222a30;box-shadow:0 2px 10px rgba(22,37,49,.14);font-size:15px;font-weight:700}
.astana-route-quick-actions .astana-route-quick-icon{width:51px;padding:0;font-size:23px}
.astana-route-card.astana-route-results{position:fixed;left:0;right:0;bottom:0;height:min(39dvh,455px);min-height:min(375px,43dvh);max-height:455px;z-index:25;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;gap:0;padding:0 12px calc(7px + env(safe-area-inset-bottom,0px));border-radius:25px 25px 0 0;background:rgba(247,248,249,.985);color:#20282e;box-shadow:0 -4px 24px rgba(17,33,45,.15)}
.astana-route-handle{height:20px;flex:none;display:flex;align-items:center;justify-content:center}
.astana-route-handle span{display:block;width:52px;height:5px;border-radius:99px;background:#d5d9dc}
.astana-route-endpoints{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 3px 11px;border-bottom:1px solid #e7eaed;flex:none}
.astana-route-endpoint-list{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
.astana-route-endpoint{display:flex;align-items:center;gap:10px;min-width:0;color:#222a30;font-size:14px;font-weight:600}
.astana-route-endpoint span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.astana-endpoint-dot{display:block;flex:none;width:13px;height:13px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px currentColor}
.astana-origin-dot{background:#16b954;color:#16b954}
.astana-destination-dot{background:#2183f5;color:#2183f5}
.astana-route-endpoint-actions{display:flex;gap:7px;flex:none}
.astana-route-endpoint-actions button{width:43px;height:43px;border:0;border-radius:13px;background:#e9ecef;color:#4a5660;font-size:25px;display:flex;align-items:center;justify-content:center}
.astana-route-option-track{display:flex;align-items:flex-start;gap:10px;overflow-x:auto;overflow-y:hidden;flex:1;min-height:0;padding:11px 2px 10px;scrollbar-width:none;scroll-snap-type:x mandatory}
.astana-route-option-card{position:relative;display:flex;flex-direction:column;gap:8px;flex:0 0 min(78vw,360px);min-width:0;padding:15px;border:1px solid #e8ebed;border-radius:20px;background:#fff;color:#20272d;box-shadow:0 2px 10px rgba(16,38,51,.05);scroll-snap-align:start;box-sizing:border-box}
.astana-route-option-card.selected{border-color:#e0e6e8;box-shadow:0 2px 9px rgba(16,38,51,.06)}
.astana-route-option-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.astana-route-option-top>div{display:flex;align-items:baseline;gap:7px;min-width:0;flex-wrap:wrap}
.astana-route-option-top strong{font-size:25px;line-height:1.05;color:#1d252b;white-space:nowrap}
.astana-route-arrival{font-size:15px;color:#7e878e;white-space:nowrap}
.astana-route-start-button{position:relative;z-index:40;pointer-events:auto;touch-action:manipulation;height:46px;flex:none;padding:0 18px;border:0;border-radius:12px;background:#16b850;color:#fff;font-size:16px;font-weight:800;box-shadow:0 2px 6px rgba(15,163,72,.18)}
.astana-route-option-card p{margin:0;color:#828b92;font-size:14px}
.astana-route-turns{display:flex;align-items:center;gap:8px;color:#414b52;font-size:14px}
.astana-route-turns span{color:#efad00;font-size:19px}
.astana-route-step-list{flex:none;max-height:110px;overflow:auto;border-top:1px solid #e0e5e8;margin:0 3px 6px;color:#20272d}
.astana-route-step-list .astana-step{border-bottom-color:#e6eaed;padding:6px 2px}
.astana-route-step-list .astana-step>span{background:#2183f5}
.astana-route-step-list .astana-step small{color:#78828a}
.astana-route-transport-strip{flex:none;display:flex;align-items:stretch;gap:6px;overflow-x:auto;overflow-y:hidden;padding:2px 1px 1px;scrollbar-width:none;border-top:1px solid #e3e7ea}
.astana-route-transport-strip button{display:flex;flex:1 0 61px;min-width:61px;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:7px 4px;border:1px solid transparent;border-radius:14px;background:transparent;color:#838c93}
.astana-route-transport-strip button.active{background:#fff;border:2px solid #19b653;color:#263037}
.astana-route-transport-strip button span{font-size:21px;line-height:1.1;filter:grayscale(.65)}
.astana-route-transport-strip button.active span{filter:none}
.astana-route-transport-strip button b{font-size:11px;font-weight:700;white-space:nowrap}
.astana-route-transport-strip button small{font-size:10px}
.astana-route-transport-strip button:disabled{opacity:.8}
.moy-alt-route-label{background:transparent;border:0}
.moy-alt-route-label span{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:72px;padding:5px 8px;border-radius:11px;background:rgba(44,49,54,.92);color:#fff;box-shadow:0 2px 7px rgba(0,0,0,.2);font-size:13px;font-weight:800;line-height:1.15;white-space:nowrap}
.moy-alt-route-label small{font-size:10px;color:#e0e4e7;margin-top:2px}
@media(max-width:520px){
 .astana-route-controls{top:12%;right:8px;gap:7px}
 .astana-route-controls button,.astana-route-controls .astana-speed-now{width:47px;height:47px;min-height:47px;font-size:23px}
 .astana-route-controls .astana-speed-limit{width:52px;height:52px;min-height:52px}
 .astana-route-quick-actions{left:8px;right:8px;gap:6px;bottom:calc(min(455px, max(39dvh, 375px)) - 45px)}
 .astana-route-quick-actions button{height:43px;padding:0 12px;font-size:13px}
 .astana-route-quick-actions .astana-route-quick-icon{width:43px;font-size:21px}
 .astana-route-card.astana-route-results{height:min(39dvh,455px);min-height:min(375px,43dvh);max-height:455px;padding-left:9px;padding-right:9px}
 .astana-route-endpoint{font-size:13px}
 .astana-route-endpoint-actions button{width:38px;height:38px}
 .astana-route-option-card{flex-basis:min(82vw,340px);padding:12px}
 .astana-route-option-top strong{font-size:23px}
 .astana-route-start-button{height:42px;padding:0 13px;font-size:15px}
 .astana-route-transport-strip button{flex-basis:55px;min-width:55px}
}


/* Active navigation screen — dark map, turn instructions, speed widgets and compact HUD. */
.astana-map-canvas-navigation{background:#11171c}
.astana-map-canvas-navigation .leaflet-tile-pane{filter:brightness(.38) saturate(.82) contrast(1.12)}
.astana-map-canvas-navigation .leaflet-control-attribution{background:rgba(8,11,14,.72);color:#b9c2c9}
.astana-map-canvas-navigation .leaflet-control-attribution a{color:#dce6ee}
.astana-nav-guidance{position:fixed;left:12px;top:12px;z-index:28;width:auto;min-width:124px;max-width:calc(100vw - 104px);min-height:0;box-sizing:border-box;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:9px;padding:11px 14px;border-radius:15px;background:rgba(9,12,15,.96);color:#fff;box-shadow:0 4px 15px #0007;overflow:hidden}
.astana-nav-guidance-symbol{flex:none;color:#1680ff;font-size:38px;font-weight:900;line-height:1;width:38px;text-align:center}
.astana-nav-guidance-copy{display:flex;flex-direction:column;gap:0;min-width:0;flex:0 1 auto;overflow:hidden}
.astana-nav-guidance-copy b{font-size:23px;line-height:1.05;white-space:nowrap;overflow-wrap:normal}
.astana-nav-guidance-copy span{display:none}
.astana-navigation-controls{position:fixed;top:14px;right:10px;z-index:28;display:flex;flex-direction:column;align-items:center;gap:8px}
.astana-navigation-controls button{border:0;display:flex;align-items:center;justify-content:center;cursor:pointer}
.astana-nav-speed-limit{width:61px;height:61px;border-radius:50%;border:5px solid #df2638;background:#090b0d;color:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;box-shadow:0 2px 8px #0008}
.astana-nav-speed-limit b{font-size:25px;font-weight:900}
.astana-nav-speed-now{width:80px;height:80px;border-radius:50%;background:#090b0d;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px #0008}
.astana-nav-speed-now b{font-size:31px;font-weight:700}
.astana-nav-parking{width:54px;height:62px;border-radius:13px;background:#06090c;color:#1481ff;font-size:34px;font-weight:900;box-shadow:0 3px 10px #0008}
.astana-nav-zoom{display:flex;flex-direction:column;width:66px;overflow:hidden;border-radius:15px;background:#090b0d;box-shadow:0 3px 12px #0008}
.astana-nav-zoom button{height:60px;background:transparent;color:#fff;font-size:39px;font-weight:300}
.astana-nav-zoom button+button{border-top:1px solid #24292e}
.astana-nav-compass,.astana-nav-recenter{width:62px;height:62px;border-radius:50%;background:#090b0d;color:#fff;font-size:34px;box-shadow:0 3px 12px #0008}
.astana-nav-compass{color:#eaf1f6;text-shadow:3px 0 #dc2337}
.astana-nav-recenter{font-size:33px;color:#fff;border-radius:15px}
.astana-nav-parking-filter{position:fixed;left:16px;bottom:101px;z-index:28;border-radius:12px;background:rgba(8,10,12,.96);color:#fff;font-size:15px;padding:10px 14px;box-shadow:0 3px 12px #0007}
.astana-nav-bottom-hud{position:fixed;left:12px;right:12px;bottom:11px;z-index:32;height:77px;box-sizing:border-box;display:grid;grid-template-columns:50px minmax(42px,1fr) minmax(74px,1.3fr) minmax(36px,.8fr) 50px;gap:4px;align-items:center;padding:7px 9px;border-radius:21px;background:rgba(9,11,13,.97);color:#fff;box-shadow:0 4px 18px #0008}
.astana-nav-hud-icon{width:47px;height:50px;border:0;border-radius:13px;background:#1d2024;color:#fff;font-size:31px;display:flex;align-items:center;justify-content:center}
.astana-nav-hud-metric{min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px}
.astana-nav-hud-metric b{font-size:25px;font-weight:800;line-height:1;white-space:nowrap}
.astana-nav-hud-metric span{color:#b5bbc0;font-size:13px;line-height:1.1}
.astana-nav-menu{position:fixed;left:12px;right:12px;bottom:98px;z-index:31;max-height:48dvh;display:flex;flex-direction:column;gap:8px;padding:15px;border-radius:19px;background:rgba(13,16,19,.98);color:#fff;box-shadow:0 4px 18px #0008;box-sizing:border-box}
.astana-nav-menu-title{font-size:18px;font-weight:800;flex:none}
.astana-nav-menu-steps{overflow-y:auto;min-height:0}
.astana-nav-menu .astana-step{border-bottom-color:#30363c}
.astana-nav-menu .astana-step small{color:#aeb6bd}
.astana-nav-menu>button{height:45px;flex:none;border:0;border-radius:13px;background:#272c31;color:#fff;font-weight:800}
@media(max-width:520px){
 .astana-nav-guidance{top:10px;left:9px;width:auto;min-width:112px;max-width:calc(100vw - 92px);min-height:0;padding:8px 10px;gap:7px;border-radius:13px}
 .astana-nav-guidance-symbol{font-size:34px;width:34px}
 .astana-nav-guidance-copy b{font-size:21px;line-height:1.05}
 .astana-nav-guidance-copy span{display:none}
 .astana-navigation-controls{top:10px;right:7px;gap:7px}
 .astana-nav-speed-limit{width:53px;height:53px;border-width:4px}
 .astana-nav-speed-limit b{font-size:22px}
 .astana-nav-speed-now{width:67px;height:67px}
 .astana-nav-speed-now b{font-size:28px}
 .astana-nav-parking{width:47px;height:51px;font-size:30px}
 .astana-nav-zoom{width:58px;border-radius:13px}
 .astana-nav-zoom button{height:51px;font-size:35px}
 .astana-nav-compass,.astana-nav-recenter{width:53px;height:53px;font-size:30px}
 .astana-nav-bottom-hud{left:9px;right:9px;bottom:8px;height:70px;grid-template-columns:43px minmax(38px,.9fr) minmax(68px,1.3fr) minmax(32px,.7fr) 43px;padding:6px;gap:2px;border-radius:18px}
 .astana-nav-hud-icon{width:41px;height:45px;font-size:28px}
 .astana-nav-hud-metric b{font-size:22px}
 .astana-nav-hud-metric span{font-size:11px}
 .astana-nav-parking-filter{left:10px;bottom:87px;font-size:13px}
 .astana-nav-menu{left:9px;right:9px;bottom:87px;max-height:49dvh}
}

`;



if (typeof document !== "undefined" && !document.getElementById("astana-map-styles")) {
  const style = document.createElement("style");
  style.id = "astana-map-styles";
  style.textContent = styles;
  document.head.appendChild(style);
}
