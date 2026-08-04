"use client";

import maplibregl, { type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatsFlightEvent, FlightPoint } from "../lib/flight-data";

type MapPoint = Pick<FlightPoint, "latitude" | "longitude" | "altitude" | "time">;

type Props = {
  measured?: MapPoint[];
  simulated?: MapPoint[];
  currentIndex?: number;
  activePoint?: MapPoint;
  events?: CatsFlightEvent[];
  launchSite: { latitude: number; longitude: number; altitude: number };
  onLaunchSiteChange?: (site: { latitude: number; longitude: number }) => void;
  theme?: "light" | "dark";
  accent?: string;
  compact?: boolean;
};

const styleUrl = "https://tiles.openfreemap.org/styles/liberty";

function altitudeAwareMaxZoom(map: MapLibreMap, points: MapPoint[]) {
  if (!points.length) return 13.5;
  const lowest = Math.min(...points.map((point) => point.altitude));
  const verticalRange = Math.max(1, Math.max(...points.map((point) => point.altitude)) - lowest);
  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const usableHeight = Math.max(120, map.getCanvas().clientHeight * 0.58);
  const requiredMetresPerPixel = verticalRange / usableHeight;
  const zoom = Math.log2(156_543.03392 * Math.max(0.1, Math.cos(latitude * Math.PI / 180)) / requiredMetresPerPixel);
  return Math.max(8, Math.min(15, zoom));
}

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

function trajectoryRibbon(points: MapPoint[], widthMetres = 7, thicknessMetres = 3) {
  const features = points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    const latitude = (start.latitude + end.latitude) / 2;
    const metresPerLatitude = 111_320;
    const metresPerLongitude = Math.max(1, metresPerLatitude * Math.cos(latitude * Math.PI / 180));
    const east = (end.longitude - start.longitude) * metresPerLongitude;
    const north = (end.latitude - start.latitude) * metresPerLatitude;
    const length = Math.hypot(east, north);
    if (!Number.isFinite(length) || length < 0.02) return [];
    const halfWidth = widthMetres / 2;
    const offsetLongitude = (-north / length * halfWidth) / metresPerLongitude;
    const offsetLatitude = (east / length * halfWidth) / metresPerLatitude;
    const altitude = Math.max(0, (start.altitude + end.altitude) / 2);
    const base = Math.max(0, altitude - thicknessMetres / 2);
    return [{
      type: "Feature" as const,
      properties: { base, height: Math.max(base + 0.5, altitude + thicknessMetres / 2), sequence: index },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [start.longitude + offsetLongitude, start.latitude + offsetLatitude],
          [end.longitude + offsetLongitude, end.latitude + offsetLatitude],
          [end.longitude - offsetLongitude, end.latitude - offsetLatitude],
          [start.longitude - offsetLongitude, start.latitude - offsetLatitude],
          [start.longitude + offsetLongitude, start.latitude + offsetLatitude],
        ]],
      },
    }];
  });
  return { type: "FeatureCollection" as const, features };
}

function colourChannels(colour: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!match) return [0.79, 0.14, 0.21];
  return [Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255];
}

function addPointRibbonLayer(id: string, points: MapPoint[], colour: string): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let position = -1;
  let matrixLocation: WebGLUniformLocation | null = null;
  let colourLocation: WebGLUniformLocation | null = null;
  let sizeLocation: WebGLUniformLocation | null = null;
  const positions: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const startCoordinate = maplibregl.MercatorCoordinate.fromLngLat([start.longitude, start.latitude], start.altitude);
    const endCoordinate = maplibregl.MercatorCoordinate.fromLngLat([end.longitude, end.latitude], end.altitude);
    const horizontalMetres = Math.hypot((end.latitude - start.latitude) * 111_320, (end.longitude - start.longitude) * 111_320 * Math.cos(start.latitude * Math.PI / 180));
    const distance = Math.hypot(horizontalMetres, end.altitude - start.altitude);
    const steps = Math.max(1, Math.min(48, Math.ceil(distance / 6)));
    for (let step = 0; step < steps; step += 1) {
      const amount = step / steps;
      positions.push(
        startCoordinate.x + (endCoordinate.x - startCoordinate.x) * amount,
        startCoordinate.y + (endCoordinate.y - startCoordinate.y) * amount,
        startCoordinate.z + (endCoordinate.z - startCoordinate.z) * amount,
      );
    }
  }
  const final = points.at(-1);
  if (final) {
    const coordinate = maplibregl.MercatorCoordinate.fromLngLat([final.longitude, final.latitude], final.altitude);
    positions.push(coordinate.x, coordinate.y, coordinate.z);
  }
  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      const vertex = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vertex, "attribute vec3 a_position; uniform mat4 u_matrix; uniform float u_size; void main(){gl_Position=u_matrix*vec4(a_position,1.0); gl_PointSize=u_size;}");
      gl.compileShader(vertex);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragment, "precision mediump float; uniform vec4 u_colour; void main(){float distance=length(gl_PointCoord-vec2(.5)); if(distance>.5) discard; float edge=1.0-smoothstep(.38,.5,distance); gl_FragColor=vec4(u_colour.rgb,u_colour.a*edge);}");
      gl.compileShader(fragment);
      program = gl.createProgram()!;
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
      position = gl.getAttribLocation(program, "a_position");
      matrixLocation = gl.getUniformLocation(program, "u_matrix");
      colourLocation = gl.getUniformLocation(program, "u_colour");
      sizeLocation = gl.getUniformLocation(program, "u_size");
    },
    render(gl, options) {
      if (!program || !buffer || !positions.length) return;
      const [red, green, blue] = colourChannels(colour);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, options.defaultProjectionData.mainMatrix);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(colourLocation, red, green, blue, 0.2); gl.uniform1f(sizeLocation, 15);
      gl.drawArrays(gl.POINTS, 0, positions.length / 3);
      gl.uniform4f(colourLocation, red, green, blue, 0.98); gl.uniform1f(sizeLocation, 7);
      gl.drawArrays(gl.POINTS, 0, positions.length / 3);
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); },
  };
}

function addActiveFlightMarker(map: MapLibreMap, id: string, pointRef: { current: MapPoint | undefined }, colour: string): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let position = -1;
  let matrixLocation: WebGLUniformLocation | null = null;
  let colourLocation: WebGLUniformLocation | null = null;
  let sizeLocation: WebGLUniformLocation | null = null;
  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      const vertex = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vertex, "attribute vec3 a_position; uniform mat4 u_matrix; uniform float u_size; void main(){gl_Position=u_matrix*vec4(a_position,1.0); gl_PointSize=u_size;}");
      gl.compileShader(vertex);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragment, "precision mediump float; uniform vec3 u_colour; void main(){if(length(gl_PointCoord-vec2(.5))>.5) discard; gl_FragColor=vec4(u_colour,1.0);}");
      gl.compileShader(fragment);
      program = gl.createProgram()!;
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      buffer = gl.createBuffer();
      position = gl.getAttribLocation(program, "a_position");
      matrixLocation = gl.getUniformLocation(program, "u_matrix");
      colourLocation = gl.getUniformLocation(program, "u_colour");
      sizeLocation = gl.getUniformLocation(program, "u_size");
    },
    render(gl, options) {
      const point = pointRef.current;
      if (!program || !buffer || !point) return;
      const coordinate = maplibregl.MercatorCoordinate.fromLngLat([point.longitude, point.latitude], point.altitude);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([coordinate.x, coordinate.y, coordinate.z]), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, options.defaultProjectionData.mainMatrix);
      const [red, green, blue] = colourChannels(colour);
      gl.uniform3f(colourLocation, red, green, blue);
      gl.uniform1f(sizeLocation, 19);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.uniform3f(colourLocation, 1, 1, 1);
      gl.uniform1f(sizeLocation, 10);
      gl.drawArrays(gl.POINTS, 0, 1);
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); },
  };
}

export function FlightPathMap({ measured = [], simulated = [], currentIndex, activePoint: suppliedActivePoint, events = [], launchSite, onLaunchSiteChange, theme = "light", accent = "#c92335", compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [terrain, setTerrain] = useState(true);
  const [ready, setReady] = useState(false);
  const activePoint = suppliedActivePoint ?? measured[Math.min(currentIndex ?? measured.length - 1, Math.max(0, measured.length - 1))];
  const activePointRef = useRef<MapPoint | undefined>(activePoint);
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
      maxPitch: 85,
      bearing: -18,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
    });
    mapRef.current = map;
    map.dragPan.enable();
    map.dragRotate.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.keyboard.enable();
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
    for (const id of ["measured-3d", "simulated-3d", "measured-ribbon", "simulated-ribbon", "measured-glow", "simulated-glow", "measured-ground", "simulated-ground", "flight-markers", "active-flight-point", "active-flight-marker-3d"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ["measured", "simulated", "measured-3d", "simulated-3d", "flight-markers", "active-flight-point"]) if (map.getSource(id)) map.removeSource(id);
    if (measured.length > 1) {
      map.addSource("measured", { type: "geojson", data: geoLine(measured) });
      map.addLayer({ id: "measured-glow", type: "line", source: "measured", paint: { "line-color": accent, "line-width": 4, "line-blur": 3, "line-opacity": 0.12 } });
      map.addLayer({ id: "measured-ground", type: "line", source: "measured", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": accent, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.45 } });
      map.addSource("measured-3d", { type: "geojson", data: trajectoryRibbon(measured) });
      map.addLayer({ id: "measured-3d", type: "fill-extrusion", source: "measured-3d", paint: { "fill-extrusion-color": accent, "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-opacity": 0.94 } });
      map.addLayer(addPointRibbonLayer("measured-ribbon", measured, accent));
    }
    if (simulated.length > 1) {
      map.addSource("simulated", { type: "geojson", data: geoLine(simulated) });
      map.addLayer({ id: "simulated-glow", type: "line", source: "simulated", paint: { "line-color": "#157f54", "line-width": 9, "line-blur": 4, "line-opacity": 0.22 } });
      map.addLayer({ id: "simulated-ground", type: "line", source: "simulated", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#157f54", "line-width": 4, "line-dasharray": [2, 1.5], "line-opacity": 0.88 } });
      map.addSource("simulated-3d", { type: "geojson", data: trajectoryRibbon(simulated, 5, 2) });
      map.addLayer({ id: "simulated-3d", type: "fill-extrusion", source: "simulated-3d", paint: { "fill-extrusion-color": "#157f54", "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-opacity": 0.72 } });
      map.addLayer(addPointRibbonLayer("simulated-ribbon", simulated, "#157f54"));
    }
    map.addSource("flight-markers", { type: "geojson", data: geoPoints(measured.length ? measured : [{ ...launchSite, time: 0 }], simulated, events) });
    map.addLayer({ id: "flight-markers", type: "circle", source: "flight-markers", paint: { "circle-radius": ["match", ["get", "kind"], "event", 5, 6], "circle-color": ["match", ["get", "kind"], "launch", "#111111", "apogee", "#d4253b", "simulation", "#157f54", "event", "#b1721b", "#f4b942"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    if (activePointRef.current) map.addLayer(addActiveFlightMarker(map, "active-flight-marker-3d", activePointRef, accent));
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
      map.fitBounds(bounds, { padding: compact ? 38 : 72, maxZoom: altitudeAwareMaxZoom(map, all), duration: 900 });
    } else map.flyTo({ center: [launchSite.longitude, launchSite.latitude], zoom: compact ? 10 : 13 });
  }, [ready, boundsKey, measured, simulated, events, launchSite.latitude, launchSite.longitude, compact, accent]);

  useEffect(() => {
    const map = mapRef.current;
    activePointRef.current = activePoint;
    if (!map || !ready || !map.isStyleLoaded()) return;
    if (activePoint && !map.getLayer("active-flight-marker-3d")) map.addLayer(addActiveFlightMarker(map, "active-flight-marker-3d", activePointRef, accent));
    map.triggerRepaint();
  }, [activePoint, ready, accent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    map.setTerrain(terrain ? { source: "terrain-dem", exaggeration: 1.35 } : null);
  }, [terrain, ready]);

  function fitFlight() {
    const map = mapRef.current;
    const all = [...measured, ...simulated];
    if (!map || !all.length) return;
    const bounds = all.reduce((value, point) => value.extend([point.longitude, point.latitude]), new maplibregl.LngLatBounds([all[0].longitude, all[0].latitude], [all[0].longitude, all[0].latitude]));
    map.fitBounds(bounds, { padding: compact ? 38 : 72, maxZoom: altitudeAwareMaxZoom(map, all), pitch: terrain ? 58 : 0, bearing: terrain ? -18 : 0, duration: 700 });
  }

  return <div className={`flight-map-shell ${compact ? "flight-map-compact" : ""} flight-map-${theme}`}>
    <div
      ref={container}
      className="flight-map"
      data-measured-points={measured.length}
      data-flight-events={events.length}
      aria-label={`3D terrain flight-path visualisation${measured.length ? ` with ${measured.length.toLocaleString()} measured points and ${events.length} CATS flight events` : ""}`}
    />
    <div className="flight-map-legend"><span><i className="flight-measured" />Measured{measured.length > 1 ? ` · ${measured.length.toLocaleString()} fixes` : ""}</span>{simulated.length > 1 && <span><i className="flight-simulated" />Simulation</span>}</div>
    <button className="flight-terrain-toggle" type="button" aria-pressed={terrain} onClick={() => setTerrain((value) => !value)}>{terrain ? "3D terrain" : "Flat map"}</button>
    <button className="flight-fit-toggle" type="button" onClick={fitFlight}>Fit flight</button>
    {!compact && <div className="flight-map-controls-hint">Drag to pan · right-drag or Ctrl/⌘-drag to orbit · scroll to zoom</div>}
    {onLaunchSiteChange && <div className="flight-map-pick-hint">Click the map to set the launch datum</div>}
  </div>;
}
