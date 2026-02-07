"use client";

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import dynamic from "next/dynamic";

// react-globe.gl uses window internally — must be client-only
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

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
const INITIAL_POV = { lat: 32, lng: -98, altitude: 2.2 };

const DEFAULT_HOTSPOTS: HotspotData[] = [
  { id: "austin", city: "Austin, TX", lat: 30.27, lng: -97.74, severity: 3, status: "critical", threat: "Ice Storm", cascade: 73 },
  { id: "houston", city: "Houston, TX", lat: 29.76, lng: -95.37, severity: 4, status: "critical", threat: "Extreme Heat", cascade: 45 },
  { id: "dallas", city: "Dallas, TX", lat: 32.78, lng: -96.80, severity: 3, status: "stressed", threat: "Grid Stress", cascade: 30 },
  { id: "la", city: "Los Angeles, CA", lat: 34.05, lng: -118.24, severity: 3, status: "stressed", threat: "Heat Wave", cascade: 25 },
  { id: "ny", city: "New York, NY", lat: 40.71, lng: -74.01, severity: 2, status: "stressed", threat: "Cold Snap", cascade: 15 },
  { id: "chicago", city: "Chicago, IL", lat: 41.88, lng: -87.63, severity: 0, status: "nominal", threat: "None", cascade: 5 },
  { id: "miami", city: "Miami, FL", lat: 25.76, lng: -80.19, severity: 0, status: "nominal", threat: "None", cascade: 3 },
  { id: "seattle", city: "Seattle, WA", lat: 47.61, lng: -122.33, severity: 0, status: "nominal", threat: "None", cascade: 2 },
];

const DEFAULT_ARCS: ArcData[] = [
  { startLat: 30.27, startLng: -97.74, endLat: 29.76, endLng: -95.37, status: "critical" },
  { startLat: 30.27, startLng: -97.74, endLat: 32.78, endLng: -96.80, status: "stressed" },
  { startLat: 29.76, startLng: -95.37, endLat: 32.78, endLng: -96.80, status: "stressed" },
  { startLat: 40.71, startLng: -74.01, endLat: 41.88, endLng: -87.63, status: "nominal" },
  { startLat: 34.05, startLng: -118.24, endLat: 47.61, endLng: -122.33, status: "nominal" },
];

const STATUS_COLORS: Record<string, string> = {
  critical: "#ef4444",
  stressed: "#f59e0b",
  nominal: "#22c55e",
};

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
  const globeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isZoomed, setIsZoomed] = useState(false);
  const [hovered, setHovered] = useState<HotspotData | null>(null);
  const [mounted, setMounted] = useState(false);

  /* ---- Responsive sizing ---- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- Mount fade-in ---- */
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  /* ---- Initial pointOfView ---- */
  useEffect(() => {
    if (!globeRef.current) return;
    const t = setTimeout(() => {
      globeRef.current?.pointOfView(INITIAL_POV, 0);
    }, 300);
    return () => clearTimeout(t);
  }, []);

  /* ---- Prop-driven zoom ---- */
  useEffect(() => {
    if (!focusedLocation || !globeRef.current) return;
    globeRef.current.pointOfView(focusedLocation, 1500);
    setIsZoomed(true);
    pauseAutoRotate();
  }, [focusedLocation]);

  /* ---- Auto-rotate management ---- */
  const pauseAutoRotate = useCallback(() => {
    if (globeRef.current?.controls) {
      globeRef.current.controls().autoRotate = false;
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (globeRef.current?.controls && !isZoomed) {
        globeRef.current.controls().autoRotate = true;
      }
    }, 5000);
  }, [isZoomed]);

  /* ---- Globe ready ---- */
  const handleGlobeReady = useCallback(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
      controls.enableZoom = true;
      controls.minDistance = 120;
      controls.maxDistance = 500;
    }
  }, []);

  /* ---- City click ---- */
  const handlePointClick = useCallback(
    (point: any) => {
      const city = point as HotspotData;
      if (!globeRef.current) return;
      globeRef.current.pointOfView(
        { lat: city.lat, lng: city.lng, altitude: 0.6 },
        1500
      );
      setIsZoomed(true);
      pauseAutoRotate();
      onSelectCity?.(city);
    },
    [onSelectCity, pauseAutoRotate]
  );

  /* ---- Back to overview ---- */
  const handleBackToOverview = useCallback(() => {
    if (!globeRef.current) return;
    globeRef.current.pointOfView(INITIAL_POV, 1500);
    setIsZoomed(false);
    onDeselectCity?.();
    // Resume auto-rotate after animation
    setTimeout(() => {
      if (globeRef.current?.controls) {
        globeRef.current.controls().autoRotate = true;
      }
    }, 1600);
  }, [onDeselectCity]);

  /* ---- Ring data (only stressed/critical) ---- */
  const ringsData = useMemo(
    () =>
      hotspots
        .filter((h) => h.status !== "nominal")
        .map((h) => ({
          lat: h.lat,
          lng: h.lng,
          maxR: h.status === "critical" ? 3 : 2,
          propagationSpeed: 2,
          repeatPeriod: h.status === "critical" ? 800 : 1200,
          color: STATUS_COLORS[h.status],
        })),
    [hotspots]
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Globe */}
      <div
        className="transition-opacity duration-1000"
        style={{ opacity: mounted ? 1 : 0 }}
      >
        <Globe
          ref={globeRef}
          width={dimensions.width}
          height={dimensions.height}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          backgroundColor="rgba(0,0,0,0)"
          atmosphereColor="#00ff88"
          atmosphereAltitude={0.18}
          showAtmosphere={true}
          animateIn={true}
          onGlobeReady={handleGlobeReady}
          /* --- Points layer --- */
          pointsData={hotspots}
          pointLat="lat"
          pointLng="lng"
          pointRadius={(d: any) => {
            const h = d as HotspotData;
            if (h.status === "critical") return 0.7;
            if (h.status === "stressed") return 0.5;
            return 0.3;
          }}
          pointColor={(d: any) => STATUS_COLORS[(d as HotspotData).status]}
          pointAltitude={0.01}
          pointResolution={12}
          onPointClick={handlePointClick}
          onPointHover={(point: any) => setHovered(point as HotspotData | null)}
          /* --- Rings layer --- */
          ringsData={ringsData}
          ringLat="lat"
          ringLng="lng"
          ringMaxRadius="maxR"
          ringPropagationSpeed="propagationSpeed"
          ringRepeatPeriod="repeatPeriod"
          ringColor={(d: any) => {
            const c = d.color;
            return (t: number) => {
              const r = parseInt(c.slice(1, 3), 16);
              const g = parseInt(c.slice(3, 5), 16);
              const b = parseInt(c.slice(5, 7), 16);
              return `rgba(${r},${g},${b},${(1 - t) * 0.6})`;
            };
          }}
          /* --- Arcs layer --- */
          arcsData={arcs}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={(d: any) => {
            const a = d as ArcData;
            const c = STATUS_COLORS[a.status];
            if (a.status === "nominal") {
              return [c + "33", c + "33"];
            }
            return [c, c];
          }}
          arcStroke={(d: any) =>
            (d as ArcData).status === "nominal" ? 0.3 : 0.8
          }
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={2000}
        />
      </div>

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
