"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
export interface HotspotData {
  id: string;
  city: string;
  lat: number;
  lng: number;
  severity: number;
  status: "critical" | "stressed" | "nominal";
  threat: string;
  cascade: number;
}

export interface ArcData {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  status: "critical" | "stressed" | "nominal";
}

interface FocusedLocation {
  lat: number;
  lng: number;
  altitude: number;
}

interface OperatorGlobeProps {
  hotspots?: HotspotData[];
  arcs?: ArcData[];
  focusedLocation?: FocusedLocation | null;
  onSelectCity?: (city: HotspotData) => void;
  onDeselectCity?: () => void;
}

/* ================================================================== */
/*  DEFAULTS                                                           */
/* ================================================================== */
const INITIAL_CENTER: [number, number] = [-98, 32]; // [lng, lat]
const INITIAL_ZOOM = 2.8;

const DEFAULT_HOTSPOTS: HotspotData[] = [
  { id: "austin", city: "Austin, TX", lat: 30.27, lng: -97.74, severity: 3, status: "critical", threat: "Ice Storm", cascade: 73 },
  { id: "houston", city: "Houston, TX", lat: 29.76, lng: -95.37, severity: 4, status: "critical", threat: "Extreme Heat", cascade: 45 },
  { id: "dallas", city: "Dallas, TX", lat: 32.78, lng: -96.80, severity: 3, status: "stressed", threat: "Grid Stress", cascade: 30 },
  { id: "la", city: "Los Angeles, CA", lat: 34.05, lng: -118.24, severity: 3, status: "stressed", threat: "Heat Wave", cascade: 25 },
  { id: "ny", city: "New York, NY", lat: 40.71, lng: -74.01, severity: 2, status: "stressed", threat: "Cold Snap", cascade: 15 },
  { id: "chicago", city: "Chicago, IL", lat: 41.88, lng: -87.63, severity: 0, status: "nominal", threat: "None", cascade: 5 },
  { id: "miami", city: "Miami, FL", lat: 25.76, lng: -80.19, severity: 0, status: "nominal", threat: "None", cascade: 3 },
  { id: "seattle", city: "Seattle, WA", lat: 47.61, lng: -122.33, severity: 0, status: "nominal", threat: "None", cascade: 2 },
  /* --- Travis150 Electric & Gas Infrastructure (Travis County, TX) --- */
  { id: "sand-hill", city: "Sand Hill Power Plant", lat: 30.2098, lng: -97.6129, severity: 4, status: "critical", threat: "Gas Supply Freeze", cascade: 82 },
  { id: "decker-creek", city: "Decker Creek Power Plant", lat: 30.3033, lng: -97.6128, severity: 4, status: "critical", threat: "Gas Supply Freeze", cascade: 78 },
  { id: "lost-pines", city: "Lost Pines 1 Power Project", lat: 30.14, lng: -97.2714, severity: 4, status: "critical", threat: "Unit Trip — Ice", cascade: 85 },
  { id: "sam-gideon", city: "Sam Gideon Power Plant", lat: 30.16, lng: -97.2708, severity: 4, status: "critical", threat: "Unit Trip — Ice", cascade: 80 },
  { id: "marshall-ford", city: "Marshall Ford Power Plant", lat: 30.3899, lng: -97.9073, severity: 2, status: "stressed", threat: "Hydro Curtailment", cascade: 35 },
  { id: "bastrop-energy", city: "Bastrop Energy Center", lat: 30.1458, lng: -97.55, severity: 3, status: "critical", threat: "Gas Pressure Drop", cascade: 68 },
  { id: "mueller-energy", city: "Mueller Energy Center", lat: 30.305, lng: -97.7077, severity: 2, status: "stressed", threat: "Demand Surge", cascade: 40 },
  { id: "webberville-solar", city: "Webberville Solar Project", lat: 30.2385, lng: -97.5088, severity: 3, status: "critical", threat: "Ice on Panels", cascade: 62 },
  { id: "austin-power", city: "Austin Power Plant", lat: 30.2934, lng: -97.7844, severity: 3, status: "stressed", threat: "Load Shed Risk", cascade: 52 },
  { id: "central-utility", city: "Central Utility Plant", lat: 30.3974, lng: -97.8426, severity: 2, status: "stressed", threat: "Demand Surge", cascade: 38 },
];

const DEFAULT_ARCS: ArcData[] = [
  { startLat: 30.27, startLng: -97.74, endLat: 29.76, endLng: -95.37, status: "critical" },
  { startLat: 30.27, startLng: -97.74, endLat: 32.78, endLng: -96.80, status: "stressed" },
  { startLat: 29.76, startLng: -95.37, endLat: 32.78, endLng: -96.80, status: "stressed" },
  { startLat: 40.71, startLng: -74.01, endLat: 41.88, endLng: -87.63, status: "nominal" },
  { startLat: 34.05, startLng: -118.24, endLat: 47.61, endLng: -122.33, status: "nominal" },
  /* --- Travis150 infrastructure arcs --- */
  { startLat: 30.2098, startLng: -97.6129, endLat: 30.3033, endLng: -97.6128, status: "critical" },   // Sand Hill ↔ Decker Creek
  { startLat: 30.14, startLng: -97.2714, endLat: 30.16, endLng: -97.2708, status: "critical" },       // Lost Pines ↔ Sam Gideon
  { startLat: 30.27, startLng: -97.74, endLat: 30.2098, endLng: -97.6129, status: "critical" },       // Austin ↔ Sand Hill
  { startLat: 30.27, startLng: -97.74, endLat: 30.1458, endLng: -97.55, status: "critical" },         // Austin ↔ Bastrop Energy
  { startLat: 30.3033, startLng: -97.6128, endLat: 30.305, endLng: -97.7077, status: "stressed" },    // Decker Creek ↔ Mueller
  { startLat: 30.3899, startLng: -97.9073, endLat: 30.3974, endLng: -97.8426, status: "stressed" },   // Marshall Ford ↔ Central Utility
  { startLat: 30.2385, startLng: -97.5088, endLat: 30.1458, endLng: -97.55, status: "critical" },     // Webberville Solar ↔ Bastrop
  { startLat: 30.2934, startLng: -97.7844, endLat: 30.305, endLng: -97.7077, status: "stressed" },    // Austin Power ↔ Mueller
];

const STATUS_COLORS: Record<string, string> = {
  critical: "#ef4444",
  stressed: "#f59e0b",
  nominal: "#22c55e",
};

const AUSTIN_IDS = new Set([
  "austin", "sand-hill", "decker-creek", "lost-pines", "sam-gideon",
  "marshall-ford", "bastrop-energy", "mueller-energy", "webberville-solar",
  "austin-power", "central-utility",
]);

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

/** Convert altitude (react-globe.gl scale) to mapbox zoom level */
function altitudeToZoom(altitude: number): number {
  // react-globe.gl altitude ~2.2 = overview, ~0.6 = city zoom
  // mapbox zoom ~2.8 = overview, ~8 = city zoom
  const clampedAlt = Math.max(0.3, Math.min(altitude, 3));
  return 2.8 + (2.2 - clampedAlt) * (5.2 / 1.6);
}

/** Spherical linear interpolation for great-circle arcs */
function greatCirclePoints(
  startLng: number, startLat: number,
  endLng: number, endLat: number,
  numPoints: number = 64
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = startLat * toRad;
  const lng1 = startLng * toRad;
  const lat2 = endLat * toRad;
  const lng2 = endLng * toRad;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lng2 - lng1) / 2), 2)
    )
  );

  if (d < 1e-10) return [[startLng, startLat], [endLng, endLat]];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg;
    const lng = Math.atan2(y, x) * toDeg;
    points.push([lng, lat]);
  }
  return points;
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function OperatorGlobe({
  hotspots = DEFAULT_HOTSPOTS,
  arcs = DEFAULT_ARCS,
  focusedLocation,
  onSelectCity,
  onDeselectCity,
}: OperatorGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animFrameRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotatingRef = useRef(true);
  const interactingRef = useRef(false);

  const [isZoomed, setIsZoomed] = useState(false);
  const [hovered, setHovered] = useState<HotspotData | null>(null);
  const [mounted, setMounted] = useState(false);

  // Keep a ref to hotspots for event handlers
  const hotspotsRef = useRef(hotspots);
  hotspotsRef.current = hotspots;

  /* ---- Build GeoJSON sources from props ---- */
  const hotspotsGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: hotspots.map((h) => ({
      type: "Feature",
      properties: {
        id: h.id,
        city: h.city,
        severity: h.severity,
        status: h.status,
        threat: h.threat,
        cascade: h.cascade,
        color: STATUS_COLORS[h.status],
        radius: h.status === "critical" ? 8 : h.status === "stressed" ? 6 : 4,
        isAustin: AUSTIN_IDS.has(h.id),
      },
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
    })),
  }), [hotspots]);

  const ringsGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: hotspots
      .filter((h) => h.status !== "nominal")
      .map((h) => ({
        type: "Feature",
        properties: {
          color: STATUS_COLORS[h.status],
          status: h.status,
        },
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      })),
  }), [hotspots]);

  const arcsGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: arcs.map((a, i) => ({
      type: "Feature",
      properties: {
        status: a.status,
        color: STATUS_COLORS[a.status],
        opacity: a.status === "nominal" ? 0.2 : 0.8,
        width: a.status === "nominal" ? 1 : 2,
      },
      geometry: {
        type: "LineString",
        coordinates: greatCirclePoints(a.startLng, a.startLat, a.endLng, a.endLat),
      },
    })),
  }), [arcs]);

  /* ---- Auto-rotate helpers ---- */
  const pauseAutoRotate = useCallback(() => {
    rotatingRef.current = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (!isZoomed) {
        rotatingRef.current = true;
      }
    }, 5000);
  }, [isZoomed]);

  /* ---- Initialize map ---- */
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const mb = (await import("mapbox-gl")).default;
      if (cancelled) return;

      mb.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

      const map = new mb.Map({
        container: containerRef.current!,
        style: "mapbox://styles/mapbox/dark-v11",
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        projection: "globe",
        antialias: true,
        fadeDuration: 0,
      });

      mapRef.current = map;

      /* Dark atmosphere / fog */
      map.on("style.load", () => {
        map.setFog({
          color: "rgb(10, 10, 10)",
          "high-color": "rgb(20, 20, 30)",
          "horizon-blend": 0.08,
          "space-color": "rgb(10, 10, 10)",
          "star-intensity": 0.4,
        });
      });

      map.on("load", () => {
        if (cancelled) return;

        /* --- Hotspot points source & layer --- */
        map.addSource("hotspots", { type: "geojson", data: hotspotsGeoJSON });
        map.addLayer({
          id: "hotspot-dots",
          type: "circle",
          source: "hotspots",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["get", "radius"],
            "circle-opacity": 0.9,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.4,
          },
        });

        /* --- Austin labels (red) --- */
        map.addLayer({
          id: "austin-labels",
          type: "symbol",
          source: "hotspots",
          filter: ["==", ["get", "isAustin"], true],
          layout: {
            "text-field": ["get", "city"],
            "text-size": 11,
            "text-offset": [0, 1.4],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          },
          paint: {
            "text-color": "#ef4444",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1.5,
          },
        });

        /* --- Pulsing ring layers --- */
        map.addSource("rings", { type: "geojson", data: ringsGeoJSON });
        map.addLayer({
          id: "ring-pulse-1",
          type: "circle",
          source: "rings",
          paint: {
            "circle-color": "transparent",
            "circle-radius": 10,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.6,
          },
        });
        map.addLayer({
          id: "ring-pulse-2",
          type: "circle",
          source: "rings",
          paint: {
            "circle-color": "transparent",
            "circle-radius": 10,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.4,
          },
        });

        /* --- Arc lines --- */
        map.addSource("arcs", { type: "geojson", data: arcsGeoJSON });
        map.addLayer({
          id: "arc-lines",
          type: "line",
          source: "arcs",
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["get", "width"],
            "line-opacity": ["get", "opacity"],
            "line-dasharray": [2, 2],
          },
        });

        /* --- Hover cursor & tooltip logic --- */
        map.on("mouseenter", "hotspot-dots", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "hotspot-dots", () => {
          map.getCanvas().style.cursor = "";
          setHovered(null);
        });
        map.on("mousemove", "hotspot-dots", (e) => {
          if (e.features && e.features.length > 0) {
            const props = e.features[0].properties!;
            const h = hotspotsRef.current.find((hs) => hs.id === props.id);
            if (h) setHovered(h);
          }
        });

        /* --- Click to zoom --- */
        map.on("click", "hotspot-dots", (e) => {
          if (e.features && e.features.length > 0) {
            const props = e.features[0].properties!;
            const city = hotspotsRef.current.find((hs) => hs.id === props.id);
            if (!city) return;
            map.flyTo({
              center: [city.lng, city.lat],
              zoom: 8,
              duration: 1500,
            });
            setIsZoomed(true);
            rotatingRef.current = false;
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            onSelectCity?.(city);
          }
        });

        /* --- Pulse animation loop --- */
        let startTime = performance.now();
        function animateRings() {
          if (cancelled) return;
          const elapsed = performance.now() - startTime;

          // Ring 1: 1.6s period
          const t1 = (elapsed % 1600) / 1600;
          const radius1 = 10 + t1 * 25;
          const opacity1 = (1 - t1) * 0.6;
          map.setPaintProperty("ring-pulse-1", "circle-stroke-opacity", opacity1);
          map.setPaintProperty("ring-pulse-1", "circle-radius", radius1);

          // Ring 2: 1.6s period, offset by 0.8s
          const t2 = ((elapsed + 800) % 1600) / 1600;
          const radius2 = 10 + t2 * 25;
          const opacity2 = (1 - t2) * 0.4;
          map.setPaintProperty("ring-pulse-2", "circle-stroke-opacity", opacity2);
          map.setPaintProperty("ring-pulse-2", "circle-radius", radius2);

          animFrameRef.current = requestAnimationFrame(animateRings);
        }
        animFrameRef.current = requestAnimationFrame(animateRings);

        /* --- Auto-rotate loop --- */
        function autoRotate() {
          if (cancelled) return;
          if (rotatingRef.current && !interactingRef.current && mapRef.current) {
            const center = mapRef.current.getCenter();
            center.lng += 0.02;
            mapRef.current.setCenter(center);
          }
          requestAnimationFrame(autoRotate);
        }
        requestAnimationFrame(autoRotate);

        /* --- Pause rotation on interaction --- */
        map.on("mousedown", () => { interactingRef.current = true; });
        map.on("touchstart", () => { interactingRef.current = true; });
        map.on("mouseup", () => {
          interactingRef.current = false;
          pauseAutoRotate();
        });
        map.on("touchend", () => {
          interactingRef.current = false;
          pauseAutoRotate();
        });
        map.on("wheel", () => { pauseAutoRotate(); });

        // Fade in
        setTimeout(() => setMounted(true), 100);
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrameRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Update sources when props change ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("hotspots") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(hotspotsGeoJSON);
  }, [hotspotsGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("rings") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(ringsGeoJSON);
  }, [ringsGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("arcs") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(arcsGeoJSON);
  }, [arcsGeoJSON]);

  /* ---- Prop-driven zoom (from sidebar clicks) ---- */
  useEffect(() => {
    if (!focusedLocation || !mapRef.current) return;
    const zoom = altitudeToZoom(focusedLocation.altitude);
    mapRef.current.flyTo({
      center: [focusedLocation.lng, focusedLocation.lat],
      zoom,
      duration: 1500,
    });
    setIsZoomed(true);
    rotatingRef.current = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  }, [focusedLocation]);

  /* ---- Back to overview ---- */
  const handleBackToOverview = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      duration: 1500,
    });
    setIsZoomed(false);
    onDeselectCity?.();
    setTimeout(() => {
      rotatingRef.current = true;
    }, 1600);
  }, [onDeselectCity]);

  return (
    <div className="w-full h-full relative">
      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full h-full transition-opacity duration-1000"
        style={{ opacity: mounted ? 1 : 0 }}
      />

      {/* Tooltip */}
      {hovered && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-[#111111] border border-[#1a1a1a] rounded-lg p-4 shadow-xl min-w-[220px]">
            <p className="text-base font-bold text-white">{hovered.city}</p>
            <p className="text-sm text-[#a1a1aa] mt-1">
              {hovered.threat} — SEV {hovered.severity}
            </p>
            <p
              className="text-xl font-mono font-bold mt-2"
              style={{ color: STATUS_COLORS[hovered.status] }}
            >
              {hovered.cascade}%
              <span className="text-xs text-[#71717a] font-normal ml-1.5">
                cascade risk
              </span>
            </p>
            <p className="text-xs text-[#52525b] mt-2">Click to zoom in</p>
          </div>
        </div>
      )}

      {/* Back to overview button */}
      {isZoomed && (
        <button
          onClick={handleBackToOverview}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 h-11 px-5 rounded-lg bg-[#111111] border border-[#3f3f46] text-sm text-white font-medium hover:border-[#22c55e]/50 hover:bg-[#1a1a1a] transition-colors cursor-pointer shadow-lg"
        >
          ← Back to Overview
        </button>
      )}
    </div>
  );
}
