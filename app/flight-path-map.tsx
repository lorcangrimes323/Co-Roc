"use client";

import maplibregl, { type CustomLayerInterface, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatsFlightEvent, FlightPoint } from "../lib/flight-data";

type MapPoint = Pick<FlightPoint, "latitude" | "longitude" | "altitude" | "time">;

type Props = {
  measured?: MapPoint[];
  simulated?: MapPoint[];
  currentIndex?: number;
  events?: CatsFlightEvent[];
  launchSite: { latitude: number; longitude: number; altitude: number };
  onLaunchSiteChange?: (site: { latitude: number; longitude: number }) => void;
  theme?: "light" | "dark";
  compact?: boolean;
};

const styleUrl = "https://tiles.openfreemap.org/styles/liberty";

function geoLine(points: MapPoint[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points.map((point) => [point.longitude, point.latitude]) },
  };
}

function closestPoint(points: MapPoint[], time: number) {
  return points.reduce((closest, point) => Math.abs(point.time - time) < Math.abs(closest.time - time) ? point : closest, points[0]);
}

function geoPoints(measured: MapPoint[], simulated: MapPoint[], events: CatsFlightEvent[]) {
  const entries = [
    measured[0] && { point: measured[0], kind: "launch", label: "Launch" },
    measured.length && { point: measured.reduce((high, point) => point.altitude > high.altitude ? point : high, measured[0]), kind: "apogee", label: "Measured apogee" },
    measured.at(-1) && { point: measured.at(-1)!, kind: "landing", label: "Landing" },
    simulated.length && { point: simulated.reduce((high, point) => point.altitude > high.altitude ? point : high, simulated[0]), kind: "simulation", label: "Simulated apogee" },
    ...events.filter((event) => measured.length && event.time >= measured[0].time && event.time <= measured.at(-1)!.time)
      .map((event) => ({ point: closestPoint(measured, event.time), kind: "event", label: event.name })),
  ].filter(Boolean) as Array<{ point: MapPoint; kind: string; label: string }>;
  return {
    type: "FeatureCollection" as const,
    features: entries.map(({ point, kind, label }) => ({ type: "Feature" as const, properties: { kind, label, altitude: point.altitude }, geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

function addTrajectoryLayer(map: MapLibreMap, id: string, points: MapPoint[], colour: string): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let position = -1;
  let matrixLocation: WebGLUniformLocation | null = null;
  let colourLocation: WebGLUniformLocation | null = null;
  const coordinates = points.flatMap((point) => {
    const coordinate = maplibregl.MercatorCoordinate.fromLngLat([point.longitude, point.latitude], point.altitude);
    return [coordinate.x, coordinate.y, coordinate.z];
  });
  const rgb = colour.match(/[a-f\d]{2}/gi)?.map((value) => parseInt(value, 16) / 255) ?? [1, 0, 0];
  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      const vertex = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vertex, "attribute vec3 a_position; uniform mat4 u_matrix; void main(){gl_Position=u_matrix*vec4(a_position,1.0);}");
      gl.compileShader(vertex);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragment, "precision mediump float; uniform vec3 u_colour; void main(){gl_FragColor=vec4(u_colour,1.0);}");
      gl.compileShader(fragment);
      program = gl.createProgram()!;
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coordinates), gl.STATIC_DRAW);
      position = gl.getAttribLocation(program, "a_position");
      matrixLocation = gl.getUniformLocation(program, "u_matrix");
      colourLocation = gl.getUniformLocation(program, "u_colour");
    },
    render(gl, options) {
      if (!program || !buffer) return;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, options.defaultProjectionData.mainMatrix);
      gl.uniform3f(colourLocation, rgb[0], rgb[1], rgb[2]);
      gl.lineWidth(3);
      gl.drawArrays(gl.LINE_STRIP, 0, points.length);
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); },
  };
}

export function FlightPathMap({ measured = [], simulated = [], currentIndex, events = [], launchSite, onLaunchSiteChange, theme = "light", compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [terrain, setTerrain] = useState(true);
  const [ready, setReady] = useState(false);
  const activePoint = measured[Math.min(currentIndex ?? measured.length - 1, Math.max(0, measured.length - 1))];
  const boundsKey = useMemo(() => [...measured, ...simulated].map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join("|"), [measured, simulated]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    setReady(false);
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: [launchSite.longitude, launchSite.latitude],
      zoom: compact ? 11 : 13,
      pitch: compact ? 35 : 58,
      bearing: -18,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (!compact) map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => {
      if (!map.getSource("terrain-dem")) map.addSource("terrain-dem", { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", tileSize: 512, maxzoom: 13 });
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.35 });
      setReady(true);
    });
    map.on("styledata", () => {
      if (map.isStyleLoaded() && map.getSource("terrain-dem")) setReady(true);
    });
    map.on("click", (event) => onLaunchSiteChange?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded() || !map.getSource("terrain-dem")) return;
    for (const id of ["measured-3d", "simulated-3d", "measured-ground", "simulated-ground", "flight-markers", "active-flight-point"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ["measured", "simulated", "flight-markers", "active-flight-point"]) if (map.getSource(id)) map.removeSource(id);
    if (measured.length > 1) {
      map.addSource("measured", { type: "geojson", data: geoLine(measured) });
      map.addLayer({ id: "measured-ground", type: "line", source: "measured", paint: { "line-color": "#d4253b", "line-width": 3, "line-opacity": 0.7 } });
      map.addLayer(addTrajectoryLayer(map, "measured-3d", measured, "#d4253b"));
    }
    if (simulated.length > 1) {
      map.addSource("simulated", { type: "geojson", data: geoLine(simulated) });
      map.addLayer({ id: "simulated-ground", type: "line", source: "simulated", paint: { "line-color": "#157f54", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.76 } });
      map.addLayer(addTrajectoryLayer(map, "simulated-3d", simulated, "#157f54"));
    }
    map.addSource("flight-markers", { type: "geojson", data: geoPoints(measured.length ? measured : [{ ...launchSite, time: 0 }], simulated, events) });
    map.addLayer({ id: "flight-markers", type: "circle", source: "flight-markers", paint: { "circle-radius": ["match", ["get", "kind"], "event", 5, 6], "circle-color": ["match", ["get", "kind"], "launch", "#111111", "apogee", "#d4253b", "simulation", "#157f54", "event", "#b1721b", "#f4b942"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    map.on("mouseenter", "flight-markers", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "flight-markers", () => { map.getCanvas().style.cursor = onLaunchSiteChange ? "crosshair" : ""; });
    map.on("click", "flight-markers", (event) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coordinates = feature.geometry.coordinates as number[];
      new maplibregl.Popup().setLngLat([coordinates[0], coordinates[1]]).setHTML(`<strong>${feature.properties?.label ?? "Flight point"}</strong><br>${Math.round(Number(feature.properties?.altitude ?? 0)).toLocaleString()} m MSL`).addTo(map);
    });
    const all = [...measured, ...simulated];
    if (all.length) {
      const bounds = all.reduce((value, point) => value.extend([point.longitude, point.latitude]), new maplibregl.LngLatBounds([all[0].longitude, all[0].latitude], [all[0].longitude, all[0].latitude]));
      map.fitBounds(bounds, { padding: compact ? 38 : 72, maxZoom: 15, duration: 900 });
    } else map.flyTo({ center: [launchSite.longitude, launchSite.latitude], zoom: compact ? 10 : 13 });
  }, [ready, boundsKey, measured, simulated, events, launchSite.latitude, launchSite.longitude, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded() || !activePoint) return;
    const data = { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [activePoint.longitude, activePoint.latitude] } };
    const source = map.getSource("active-flight-point") as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource("active-flight-point", { type: "geojson", data });
      map.addLayer({ id: "active-flight-point", type: "circle", source: "active-flight-point", paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": "#d4253b", "circle-stroke-width": 4 } });
    }
  }, [activePoint, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    map.setTerrain(terrain ? { source: "terrain-dem", exaggeration: 1.35 } : null);
  }, [terrain, ready]);

  return <div className={`flight-map-shell ${compact ? "flight-map-compact" : ""} flight-map-${theme}`}>
    <div
      ref={container}
      className="flight-map"
      data-measured-points={measured.length}
      data-flight-events={events.length}
      aria-label={`3D terrain flight-path visualisation${measured.length ? ` with ${measured.length.toLocaleString()} measured points and ${events.length} CATS flight events` : ""}`}
    />
    <div className="flight-map-legend"><span><i className="flight-measured" />Measured</span>{simulated.length > 1 && <span><i className="flight-simulated" />Simulation</span>}</div>
    <button className="flight-terrain-toggle" type="button" aria-pressed={terrain} onClick={() => setTerrain((value) => !value)}>{terrain ? "3D terrain" : "Flat map"}</button>
    {onLaunchSiteChange && <div className="flight-map-pick-hint">Click the map to set the launch datum</div>}
  </div>;
}
