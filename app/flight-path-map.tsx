"use client";

import maplibregl, { type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  followActive?: boolean;
};

const styleUrl = "https://tiles.openfreemap.org/styles/liberty";

function trajectoryFitMaxZoom(points: MapPoint[], following = false) {
  if (points.length <= 1) return 13.5;
  const altitudes = points.map((point) => point.altitude).filter(Number.isFinite);
  const altitudeSpan = altitudes.length ? Math.max(...altitudes) - Math.min(...altitudes) : 0;
  const altitudeAwareZoom = altitudeSpan > 20
    ? Math.max(10.75, Math.min(15, 15.4 - Math.log2(Math.max(1, altitudeSpan / 250))))
    : 15;
  return following ? Math.min(12, altitudeAwareZoom) : altitudeAwareZoom;
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

function geometryFingerprint(points: MapPoint[]) {
  let hash = 2_166_136_261;
  for (const point of points) {
    for (const value of [point.latitude * 1e6, point.longitude * 1e6, point.altitude * 10, point.time * 100]) {
      hash ^= Math.round(value);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return `${points.length}:${hash >>> 0}`;
}

function geoPoints(measured: MapPoint[], simulated: MapPoint[]) {
  const entries = [
    measured[0] && { point: measured[0], kind: "launch", label: "Launch" },
    measured.length && { point: measured.reduce((high, point) => point.altitude > high.altitude ? point : high, measured[0]), kind: "apogee", label: "Measured apogee" },
    measured.at(-1) && { point: measured.at(-1)!, kind: "landing", label: "Landing" },
    simulated.length && { point: simulated.reduce((high, point) => point.altitude > high.altitude ? point : high, simulated[0]), kind: "simulation", label: "Simulated apogee" },
  ].filter(Boolean) as Array<{ point: MapPoint; kind: string; label: string }>;
  return {
    type: "FeatureCollection" as const,
    features: entries.map(({ point, kind, label }) => ({ type: "Feature" as const, properties: { kind, label, altitude: point.altitude }, geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

function eventPoints(measured: MapPoint[], events: CatsFlightEvent[]) {
  if (!measured.length) return [];
  const firstTime = measured[0].time;
  const lastTime = measured.at(-1)!.time;
  return events
    .filter((event) => event.time >= firstTime && event.time <= lastTime)
    .map((event) => ({ ...closestPoint(measured, event.time), event }));
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

function pointPrisms(points: MapPoint[], radiusMetres = 7, heightMetres = 14) {
  const features = points.map((point, index) => {
    const metresPerLatitude = 111_320;
    const metresPerLongitude = Math.max(1, metresPerLatitude * Math.cos(point.latitude * Math.PI / 180));
    const latitudeRadius = radiusMetres / metresPerLatitude;
    const longitudeRadius = radiusMetres / metresPerLongitude;
    const base = Math.max(0, point.altitude - heightMetres / 2);
    return {
      type: "Feature" as const,
      properties: { base, height: Math.max(base + 1, point.altitude + heightMetres / 2), sequence: index },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [point.longitude - longitudeRadius, point.latitude - latitudeRadius],
          [point.longitude + longitudeRadius, point.latitude - latitudeRadius],
          [point.longitude + longitudeRadius, point.latitude + latitudeRadius],
          [point.longitude - longitudeRadius, point.latitude + latitudeRadius],
          [point.longitude - longitudeRadius, point.latitude - latitudeRadius],
        ]],
      },
    };
  });
  return { type: "FeatureCollection" as const, features };
}

function colourChannels(colour: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!match) return [0.79, 0.14, 0.21];
  return [Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255];
}

function withStableOverlayState(gl: WebGLRenderingContext | WebGL2RenderingContext, draw: () => void) {
  const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);
  const blendEnabled = gl.isEnabled(gl.BLEND);
  const depthWrite = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
  const blendSourceRgb = gl.getParameter(gl.BLEND_SRC_RGB) as number;
  const blendDestinationRgb = gl.getParameter(gl.BLEND_DST_RGB) as number;
  const blendSourceAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
  const blendDestinationAlpha = gl.getParameter(gl.BLEND_DST_ALPHA) as number;
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  try {
    draw();
  } finally {
    gl.depthMask(depthWrite);
    depthEnabled ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    blendEnabled ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND);
    gl.blendFuncSeparate(blendSourceRgb, blendDestinationRgb, blendSourceAlpha, blendDestinationAlpha);
  }
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
    const steps = Math.max(1, Math.min(512, Math.ceil(distance / 1.5)));
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
      withStableOverlayState(gl, () => {
        gl.uniform4f(colourLocation, red, green, blue, 0.2); gl.uniform1f(sizeLocation, 30);
        gl.drawArrays(gl.POINTS, 0, positions.length / 3);
        gl.uniform4f(colourLocation, red, green, blue, 1); gl.uniform1f(sizeLocation, 14);
        gl.drawArrays(gl.POINTS, 0, positions.length / 3);
      });
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
      withStableOverlayState(gl, () => {
        gl.uniform3f(colourLocation, 1, 1, 1);
        gl.uniform1f(sizeLocation, 19);
        gl.drawArrays(gl.POINTS, 0, 1);
        const [red, green, blue] = colourChannels(colour);
        gl.uniform3f(colourLocation, red, green, blue);
        gl.uniform1f(sizeLocation, 13);
        gl.drawArrays(gl.POINTS, 0, 1);
      });
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); },
  };
}

function addFlightEventMarkersLayer(id: string, points: ReturnType<typeof eventPoints>, colour: string): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let position = -1;
  let matrixLocation: WebGLUniformLocation | null = null;
  let colourLocation: WebGLUniformLocation | null = null;
  let sizeLocation: WebGLUniformLocation | null = null;
  const positions = points.flatMap((point) => {
    const coordinate = maplibregl.MercatorCoordinate.fromLngLat([point.longitude, point.latitude], point.altitude);
    return [coordinate.x, coordinate.y, coordinate.z];
  });
  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      const vertex = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vertex, "attribute vec3 a_position; uniform mat4 u_matrix; uniform float u_size; void main(){gl_Position=u_matrix*vec4(a_position,1.0); gl_PointSize=u_size;}");
      gl.compileShader(vertex);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragment, "precision mediump float; uniform vec3 u_colour; void main(){float d=length(gl_PointCoord-vec2(.5)); if(d>.5) discard; gl_FragColor=vec4(u_colour,1.0);}");
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
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, options.defaultProjectionData.mainMatrix);
      withStableOverlayState(gl, () => {
        gl.uniform3f(colourLocation, 1, 1, 1); gl.uniform1f(sizeLocation, 14);
        gl.drawArrays(gl.POINTS, 0, positions.length / 3);
        const [red, green, blue] = colourChannels(colour);
        gl.uniform3f(colourLocation, red, green, blue); gl.uniform1f(sizeLocation, 9);
        gl.drawArrays(gl.POINTS, 0, positions.length / 3);
      });
    },
    onRemove(_map, gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); },
  };
}

export function FlightPathMap({ measured = [], simulated = [], currentIndex, activePoint: suppliedActivePoint, events = [], launchSite, onLaunchSiteChange, theme = "light", accent = "#c92335", compact = false, followActive = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [terrain, setTerrain] = useState(true);
  const [ready, setReady] = useState(false);
  const activePoint = suppliedActivePoint ?? measured[Math.min(currentIndex ?? measured.length - 1, Math.max(0, measured.length - 1))];
  const activePointRef = useRef<MapPoint | undefined>(activePoint);
  const lastFittedBoundsKey = useRef("");
  const lastFollowAt = useRef(0);
  const followSuspended = useRef(false);
  const followActiveRef = useRef(followActive);
  followActiveRef.current = followActive;
  const measuredEventPoints = useMemo(() => eventPoints(measured, events), [measured, events]);
  const measuredGeometryKey = useMemo(() => geometryFingerprint(measured), [measured]);
  const simulatedGeometryKey = useMemo(() => geometryFingerprint(simulated), [simulated]);
  const boundsKey = `${measuredGeometryKey}|${simulatedGeometryKey}`;
  const eventKey = useMemo(() => events.map((event) => `${event.time}:${event.name}`).join("|"), [events]);

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
    const suspendFollow = () => {
      if (!followActiveRef.current) return;
      followSuspended.current = true;
      if (container.current) container.current.dataset.cameraFollow = "paused-by-user";
    };
    map.getCanvas().addEventListener("pointerdown", suspendFollow);
    map.getCanvas().addEventListener("wheel", suspendFollow, { passive: true });
    map.on("load", () => {
      if (!map.getSource("terrain-dem")) map.addSource("terrain-dem", { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", tileSize: 512, maxzoom: 13 });
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.35 });
      setReady(true);
    });
    map.on("styledata", () => {
      if (map.isStyleLoaded() && map.getSource("terrain-dem")) setReady(true);
    });
    map.on("click", (event) => onLaunchSiteChange?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    return () => {
      map.getCanvas().removeEventListener("pointerdown", suspendFollow);
      map.getCanvas().removeEventListener("wheel", suspendFollow);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    followSuspended.current = false;
    lastFollowAt.current = 0;
    if (container.current) container.current.dataset.cameraFollow = followActive ? "active" : "off";
  }, [followActive, boundsKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (container.current) container.current.dataset.trailState = "building";
    for (const id of ["measured-3d", "simulated-3d", "measured-ribbon", "simulated-ribbon", "measured-glow", "simulated-glow", "measured-ground", "simulated-ground", "flight-markers", "flight-event-markers-3d", "flight-event-markers", "active-flight-point", "active-flight-marker-3d", "active-flight-marker"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ["measured", "simulated", "measured-3d", "simulated-3d", "flight-markers", "flight-event-markers-3d", "active-flight-point"]) if (map.getSource(id)) map.removeSource(id);
    if (measured.length > 1) {
      map.addSource("measured", { type: "geojson", data: geoLine(measured) });
      // A regular MapLibre line is necessarily a ground projection. Keep that
      // reference deliberately subtle; the custom 3D ribbon below is the
      // authoritative measured flight path and uses every point's altitude.
      map.addLayer({ id: "measured-ground", type: "line", source: "measured", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": accent, "line-width": 1.25, "line-dasharray": [2, 3], "line-opacity": 0.24 } });
      map.addLayer(addPointRibbonLayer("measured-ribbon", measured, accent));
      if (container.current) container.current.dataset.trailState = "measured-ready";
    }
    if (simulated.length > 1) {
      map.addSource("simulated", { type: "geojson", data: geoLine(simulated) });
      map.addLayer({ id: "simulated-ground", type: "line", source: "simulated", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#157f54", "line-width": 1, "line-dasharray": [2, 3], "line-opacity": 0.2 } });
      map.addLayer(addPointRibbonLayer("simulated-ribbon", simulated, "#157f54"));
    }
    map.addSource("flight-markers", { type: "geojson", data: geoPoints(measured.length ? measured : [{ ...launchSite, time: 0 }], simulated) });
    map.addLayer({ id: "flight-markers", type: "circle", source: "flight-markers", paint: { "circle-radius": 6, "circle-color": ["match", ["get", "kind"], "launch", "#111111", "simulation", "#157f54", accent], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    if (measuredEventPoints.length) {
      map.addLayer(addFlightEventMarkersLayer("flight-event-markers", measuredEventPoints, accent));
    }
    if (activePointRef.current) {
      map.addLayer(addActiveFlightMarker(map, "active-flight-marker", activePointRef, accent));
    }
    map.on("mouseenter", "flight-markers", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "flight-markers", () => { map.getCanvas().style.cursor = onLaunchSiteChange ? "crosshair" : ""; });
    map.on("click", "flight-markers", (event) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coordinates = feature.geometry.coordinates as number[];
      new maplibregl.Popup().setLngLat([coordinates[0], coordinates[1]]).setHTML(`<strong>${feature.properties?.label ?? "Flight point"}</strong><br>${Math.round(Number(feature.properties?.altitude ?? 0)).toLocaleString()} m MSL`).addTo(map);
    });
    const all = [...measured, ...simulated];
    if (all.length && lastFittedBoundsKey.current !== boundsKey) {
      const bounds = all.reduce((value, point) => value.extend([point.longitude, point.latitude]), new maplibregl.LngLatBounds([all[0].longitude, all[0].latitude], [all[0].longitude, all[0].latitude]));
      map.fitBounds(bounds, { padding: compact ? 38 : 72, maxZoom: trajectoryFitMaxZoom(all, followActive), duration: 900 });
      lastFittedBoundsKey.current = boundsKey;
    } else if (!all.length && !lastFittedBoundsKey.current) {
      map.flyTo({ center: [launchSite.longitude, launchSite.latitude], zoom: compact ? 10 : 13 });
      lastFittedBoundsKey.current = "launch-site";
    }
    if (container.current) container.current.dataset.trailState = measured.length > 1 ? "ready" : "empty";
  }, [ready, boundsKey, eventKey, compact, accent, followActive]);

  useEffect(() => {
    const map = mapRef.current;
    activePointRef.current = activePoint;
    if (!map || !ready) return;
    if (activePoint && !map.getLayer("active-flight-marker")) {
      map.addLayer(addActiveFlightMarker(map, "active-flight-marker", activePointRef, accent));
    }
    if (activePoint && followActive && !followSuspended.current && performance.now() - lastFollowAt.current > 280) {
      map.easeTo({
        center: [activePoint.longitude, activePoint.latitude],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        duration: 260,
        essential: true,
      });
      lastFollowAt.current = performance.now();
      if (container.current) container.current.dataset.cameraFollow = "active";
    }
    map.triggerRepaint();
  }, [activePoint, ready, accent, followActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("terrain-dem")) return;
    map.setTerrain(terrain ? { source: "terrain-dem", exaggeration: 1.35 } : null);
  }, [terrain, ready]);

  function fitFlight() {
    const map = mapRef.current;
    const all = [...measured, ...simulated];
    if (!map || !all.length) return;
    const bounds = all.reduce((value, point) => value.extend([point.longitude, point.latitude]), new maplibregl.LngLatBounds([all[0].longitude, all[0].latitude], [all[0].longitude, all[0].latitude]));
    followSuspended.current = false;
    if (container.current) container.current.dataset.cameraFollow = followActive ? "active" : "off";
    map.fitBounds(bounds, { padding: compact ? 38 : 72, maxZoom: trajectoryFitMaxZoom(all, followActive), pitch: terrain ? 58 : 0, bearing: terrain ? -18 : 0, duration: 700 });
  }

  return <div className={`flight-map-shell ${compact ? "flight-map-compact" : ""} flight-map-${theme}`} style={{ "--flight-accent": accent } as CSSProperties}>
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
