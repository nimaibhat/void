"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RerouteArc } from "@/lib/api";

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

export interface GridNode {
  id: string;
  lat: number;
  lon: number;
  base_load_mw: number;
  capacity_mw: number;
  voltage_kv: number;
  weather_zone: string;
  source?: "activsg" | "travis";
}

interface FocusedLocation {
  lat: number;
  lng: number;
  altitude: number;
}

export interface GridEdge {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  source: "activsg" | "travis";
  capacity_mva: number;
}

export interface CrewMarker {
  id: string;
  lat: number;
  lng: number;
  status: "deployed" | "en_route" | "standby";
  label: string;
  specialty: string;
}

export interface CascadeState {
  failedNodeIds: Set<string>;
  rerouteArcs: RerouteArc[];
}

interface OperatorGlobeProps {
  hotspots?: HotspotData[];
  arcs?: ArcData[];
  gridNodes?: GridNode[];
  gridEdges?: GridEdge[];
  crews?: CrewMarker[];
  focusedLocation?: FocusedLocation | null;
  cascadeState?: CascadeState | null;
  onSelectCity?: (city: HotspotData) => void;
  onDeselectCity?: () => void;
}

/* ================================================================== */
/*  DEFAULTS                                                           */
/* ================================================================== */
const INITIAL_CENTER: [number, number] = [-99.5, 31.5]; // [lng, lat] — centered on Texas
const INITIAL_ZOOM = 5.2;

const STATUS_COLORS: Record<string, string> = {
  critical: "#ef4444",
  stressed: "#f59e0b",
  nominal: "#22c55e",
};

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
const CREW_STATUS_COLORS: Record<string, string> = {
  deployed: "#22c55e",
  en_route: "#f59e0b",
  standby: "#3b82f6",
};

export default function OperatorGlobe({
  hotspots = [],
  arcs = [],
  gridNodes = [],
  gridEdges = [],
  crews = [],
  focusedLocation,
  cascadeState,
  onSelectCity,
  onDeselectCity,
}: OperatorGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animFrameRef = useRef<number>(0);

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

  const gridNodesGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: gridNodes.map((n) => {
      // Travis 150 nodes → red; ACTIVSg nodes → color by voltage
      const isTravis = n.source === "travis";
      const color = isTravis
        ? "#ef4444"
        : n.voltage_kv >= 300 ? "#3b82f6" : n.voltage_kv >= 100 ? "#6366f1" : "#4b5563";
      const radius = isTravis ? 3.5 : n.voltage_kv >= 300 ? 3 : n.voltage_kv >= 100 ? 2 : 1.5;
      return {
        type: "Feature",
        properties: {
          id: n.id,
          color,
          radius,
          voltage_kv: n.voltage_kv,
          load_mw: n.base_load_mw,
          capacity_mw: n.capacity_mw,
          zone: n.weather_zone,
          source: n.source ?? "activsg",
        },
        geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      };
    }),
  }), [gridNodes]);

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

  const gridEdgesGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: gridEdges.map((e, i) => {
      const isTravis = e.source === "travis";
      return {
        type: "Feature",
        properties: {
          color: isTravis ? "#ef4444" : "#3b82f6",
          opacity: isTravis ? 0.5 : 0.15,
          width: isTravis ? 1.5 : 0.5,
          source: e.source,
        },
        geometry: {
          type: "LineString",
          coordinates: greatCirclePoints(e.fromLon, e.fromLat, e.toLon, e.toLat, 32),
        },
      };
    }),
  }), [gridEdges]);

  /* ---- Crew markers GeoJSON ---- */
  const crewsGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: crews.map((c) => ({
      type: "Feature",
      properties: {
        id: c.id,
        label: c.label,
        specialty: c.specialty,
        status: c.status,
        color: CREW_STATUS_COLORS[c.status] ?? "#3b82f6",
      },
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
    })),
  }), [crews]);

  /* ---- Cascade overlay GeoJSON ---- */
  // Extract stable references from cascadeState to avoid recomputing every render
  const failedNodeIds = cascadeState?.failedNodeIds ?? null;
  const rerouteArcs = cascadeState?.rerouteArcs ?? null;

  const cascadeFailedGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!failedNodeIds || failedNodeIds.size === 0) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: gridNodes
        .filter((n) => failedNodeIds.has(n.id))
        .map((n) => ({
          type: "Feature" as const,
          properties: { id: n.id },
          geometry: { type: "Point" as const, coordinates: [n.lon, n.lat] },
        })),
    };
  }, [failedNodeIds, gridNodes]);

  const cascadeRerouteGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!rerouteArcs || rerouteArcs.length === 0) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: rerouteArcs.map((r) => ({
        type: "Feature" as const,
        properties: { load_mw: r.load_mw },
        geometry: {
          type: "LineString" as const,
          coordinates: greatCirclePoints(r.from_lon, r.from_lat, r.to_lon, r.to_lat, 32),
        },
      })),
    };
  }, [rerouteArcs]);

  // Track which nodes are "new" this step for shockwave
  const prevFailedRef = useRef<Set<string>>(new Set());
  const shockwaveGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!failedNodeIds || failedNodeIds.size === 0) {
      prevFailedRef.current = new Set();
      return { type: "FeatureCollection", features: [] };
    }
    const newIds: string[] = [];
    failedNodeIds.forEach((id) => {
      if (!prevFailedRef.current.has(id)) newIds.push(id);
    });
    prevFailedRef.current = new Set(failedNodeIds);

    return {
      type: "FeatureCollection",
      features: gridNodes
        .filter((n) => newIds.includes(n.id))
        .map((n) => ({
          type: "Feature" as const,
          properties: { id: n.id },
          geometry: { type: "Point" as const, coordinates: [n.lon, n.lat] },
        })),
    };
  }, [failedNodeIds, gridNodes]);

  // Shockwave animation state
  const shockwaveStartRef = useRef<number>(0);
  const shockwaveAnimRef = useRef<number>(0);

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

      /* Atmosphere / fog — natural look with dark space */
      map.on("style.load", () => {
        map.setFog({
          color: "rgb(186, 210, 235)",
          "high-color": "rgb(36, 92, 223)",
          "horizon-blend": 0.02,
          "space-color": "rgb(11, 11, 25)",
          "star-intensity": 0.6,
        });
      });

      map.on("load", () => {
        if (cancelled) return;

        /* --- Grid edges (transmission lines, lowest layer) --- */
        map.addSource("grid-edges", { type: "geojson", data: gridEdgesGeoJSON });
        map.addLayer({
          id: "grid-edge-lines",
          type: "line",
          source: "grid-edges",
          paint: {
            "line-color": ["get", "color"],
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              2, ["get", "width"],
              6, ["*", ["get", "width"], 2],
              10, ["*", ["get", "width"], 3],
            ],
            "line-opacity": [
              "interpolate", ["linear"], ["zoom"],
              2, ["get", "opacity"],
              6, ["*", ["get", "opacity"], 1.5],
              10, ["min", ["*", ["get", "opacity"], 2], 1],
            ],
          },
        });

        /* --- Grid infrastructure nodes (background layer) --- */
        map.addSource("grid-nodes", { type: "geojson", data: gridNodesGeoJSON });
        map.addLayer({
          id: "grid-node-dots",
          type: "circle",
          source: "grid-nodes",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              2, ["get", "radius"],
              6, ["*", ["get", "radius"], 2],
              10, ["*", ["get", "radius"], 3],
            ],
            "circle-opacity": [
              "interpolate", ["linear"], ["zoom"],
              2, 0.4,
              6, 0.7,
              10, 0.9,
            ],
          },
        });

        /* --- Cascade layers (between grid-nodes and hotspots) --- */
        map.addSource("cascade-failed", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        // Red glow behind failed nodes
        map.addLayer({
          id: "cascade-failed-glow",
          type: "circle",
          source: "cascade-failed",
          paint: {
            "circle-color": "#ef4444",
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              2, 10, 6, 18, 10, 28,
            ],
            "circle-opacity": 0.25,
            "circle-blur": 1,
          },
        });
        // Solid failed node dot
        map.addLayer({
          id: "cascade-failed-nodes",
          type: "circle",
          source: "cascade-failed",
          paint: {
            "circle-color": "#ef4444",
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              2, 4, 6, 7, 10, 12,
            ],
            "circle-opacity": 0.95,
            "circle-stroke-color": "#fca5a5",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.7,
          },
        });

        map.addSource("cascade-reroutes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "cascade-reroute-arcs",
          type: "line",
          source: "cascade-reroutes",
          paint: {
            "line-color": "#f59e0b",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              2, 1.5, 6, 2.5, 10, 4,
            ],
            "line-opacity": 0.8,
            "line-dasharray": [4, 3],
          },
        });

        map.addSource("cascade-shockwave", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "cascade-shockwave-ring",
          type: "circle",
          source: "cascade-shockwave",
          paint: {
            "circle-color": "transparent",
            "circle-radius": 8,
            "circle-stroke-color": "#ef4444",
            "circle-stroke-width": 2.5,
            "circle-stroke-opacity": 0.8,
          },
        });

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

        /* --- Crew markers --- */
        map.addSource("crews", { type: "geojson", data: crewsGeoJSON });
        // Outer glow ring
        map.addLayer({
          id: "crew-glow",
          type: "circle",
          source: "crews",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              2, 6, 6, 12, 10, 18,
            ],
            "circle-opacity": 0.15,
          },
        });
        // Inner dot
        map.addLayer({
          id: "crew-dots",
          type: "circle",
          source: "crews",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              2, 3.5, 6, 6, 10, 9,
            ],
            "circle-opacity": 0.95,
            "circle-stroke-color": "#0a0a0a",
            "circle-stroke-width": 1.5,
          },
        });
        // Label (visible at zoom >= 6)
        map.addLayer({
          id: "crew-labels",
          type: "symbol",
          source: "crews",
          minzoom: 6,
          layout: {
            "text-field": ["get", "label"],
            "text-size": 10,
            "text-offset": [0, 1.4],
            "text-anchor": "top",
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          },
          paint: {
            "text-color": ["get", "color"],
            "text-halo-color": "#0a0a0a",
            "text-halo-width": 1,
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

        // Fade in
        setTimeout(() => setMounted(true), 100);
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrameRef.current);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("grid-nodes") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(gridNodesGeoJSON);
  }, [gridNodesGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("grid-edges") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(gridEdgesGeoJSON);
  }, [gridEdgesGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("crews") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(crewsGeoJSON);
  }, [crewsGeoJSON]);

  /* ---- Update cascade layers ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const src = map.getSource("cascade-failed") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(cascadeFailedGeoJSON);
    } catch { /* source not ready yet */ }
  }, [cascadeFailedGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const src = map.getSource("cascade-reroutes") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(cascadeRerouteGeoJSON);
    } catch { /* source not ready yet */ }
  }, [cascadeRerouteGeoJSON]);

  // Shockwave: update source + run expanding ring animation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const src = map.getSource("cascade-shockwave") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(shockwaveGeoJSON);
    } catch { /* source not ready yet */ }

    // Only animate if there are new shockwave points
    if (shockwaveGeoJSON.features.length === 0) return;

    cancelAnimationFrame(shockwaveAnimRef.current);
    shockwaveStartRef.current = performance.now();
    const DURATION = 1500; // ms

    function animateShockwave() {
      if (!map) return;
      try {
        if (!map.getLayer("cascade-shockwave-ring")) return;
        const elapsed = performance.now() - shockwaveStartRef.current;
        const t = Math.min(elapsed / DURATION, 1);
        const radius = 8 + t * 40;
        const opacity = (1 - t) * 0.8;
        map.setPaintProperty("cascade-shockwave-ring", "circle-radius", radius);
        map.setPaintProperty("cascade-shockwave-ring", "circle-stroke-opacity", opacity);
        if (t < 1) {
          shockwaveAnimRef.current = requestAnimationFrame(animateShockwave);
        }
      } catch { /* layer not ready */ }
    }
    shockwaveAnimRef.current = requestAnimationFrame(animateShockwave);

    return () => cancelAnimationFrame(shockwaveAnimRef.current);
  }, [shockwaveGeoJSON]);

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

      {/* Zoom controls */}
      <div className="absolute bottom-6 right-6 z-30 flex flex-col gap-1.5">
        <button
          onClick={() => {
            const map = mapRef.current;
            if (map) map.zoomIn({ duration: 300 });
          }}
          className="w-10 h-10 rounded-lg bg-[#111111] border border-[#1a1a1a] text-white/70 hover:text-white hover:border-[#22c55e]/50 transition-colors cursor-pointer flex items-center justify-center text-lg font-mono shadow-lg"
        >
          +
        </button>
        <button
          onClick={() => {
            const map = mapRef.current;
            if (map) map.zoomOut({ duration: 300 });
          }}
          className="w-10 h-10 rounded-lg bg-[#111111] border border-[#1a1a1a] text-white/70 hover:text-white hover:border-[#22c55e]/50 transition-colors cursor-pointer flex items-center justify-center text-lg font-mono shadow-lg"
        >
          −
        </button>
      </div>
    </div>
  );
}
