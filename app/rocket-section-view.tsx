"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { OpenRocketComponent, OpenRocketModel } from "../lib/openrocket";

export type RocketSectionHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

type HitRegion = { id: string; x: number; y: number; width: number; height: number };
const SHELL_KINDS = new Set(["nosecone", "bodytube", "transition", "innertube", "tubecoupler", "launchlug"]);

function hasWall(component: OpenRocketComponent) {
  return SHELL_KINDS.has(component.kind) && component.thickness > 0;
}

function haackRadius(x: number, length: number, radius: number, parameter: number) {
  if (length <= 0) return radius;
  const theta = Math.acos(1 - 2 * Math.max(0, Math.min(1, x / length)));
  return radius * Math.sqrt(Math.max(0, theta - Math.sin(2 * theta) / 2 + parameter * Math.sin(theta) ** 3) / Math.PI);
}

function profileRadius(component: OpenRocketComponent, distance: number) {
  const length = component.length || 1;
  const u = Math.max(0, Math.min(1, distance / length));
  const radius = component.flipped ? component.foreRadius : component.aftRadius;
  if (component.shape === "conical") return radius * u;
  if (component.shape === "ellipsoid") return radius * Math.sqrt(Math.max(0, 1 - (u - 1) ** 2));
  if (component.shape === "power") return radius * u ** Math.max(0.01, component.shapeParameter || 0.5);
  if (component.shape === "parabolic") return radius * (2 * u - u * u);
  if (component.shape === "ogive") {
    const rho = (radius * radius + length * length) / (2 * Math.max(radius, 0.000001));
    return Math.sqrt(Math.max(0, rho * rho - (length - distance) ** 2)) + radius - rho;
  }
  return haackRadius(distance, length, radius, component.shapeParameter);
}

function componentPath(
  context: CanvasRenderingContext2D,
  component: OpenRocketComponent,
  sx: (value: number) => number,
  sy: (value: number) => number,
) {
  context.beginPath();
  if (component.kind === "nosecone") {
    const segments = 72;
    for (let index = 0; index <= segments; index += 1) {
      const distance = component.length * index / segments;
      const radius = component.flipped
        ? profileRadius(component, component.length - distance)
        : profileRadius(component, distance);
      if (index === 0) context.moveTo(sx(component.x + distance), sy(component.y - radius));
      else context.lineTo(sx(component.x + distance), sy(component.y - radius));
    }
    for (let index = segments; index >= 0; index -= 1) {
      const distance = component.length * index / segments;
      const radius = component.flipped
        ? profileRadius(component, component.length - distance)
        : profileRadius(component, distance);
      context.lineTo(sx(component.x + distance), sy(component.y + radius));
    }
  } else {
    context.moveTo(sx(component.x), sy(component.y - component.foreRadius));
    context.lineTo(sx(component.x + component.length), sy(component.y - component.aftRadius));
    context.lineTo(sx(component.x + component.length), sy(component.y + component.aftRadius));
    context.lineTo(sx(component.x), sy(component.y + component.foreRadius));
  }
  context.closePath();

  if (!hasWall(component)) return;
  if (component.kind === "nosecone") {
    const segments = 72;
    for (let index = 0; index <= segments; index += 1) {
      const distance = component.length * index / segments;
      const outerRadius = component.flipped
        ? profileRadius(component, component.length - distance)
        : profileRadius(component, distance);
      const radius = Math.max(0, outerRadius - component.thickness);
      if (index === 0) context.moveTo(sx(component.x + distance), sy(component.y - radius));
      else context.lineTo(sx(component.x + distance), sy(component.y - radius));
    }
    for (let index = segments; index >= 0; index -= 1) {
      const distance = component.length * index / segments;
      const outerRadius = component.flipped
        ? profileRadius(component, component.length - distance)
        : profileRadius(component, distance);
      const radius = Math.max(0, outerRadius - component.thickness);
      context.lineTo(sx(component.x + distance), sy(component.y + radius));
    }
  } else {
    const innerFore = Math.max(0, component.foreRadius - component.thickness);
    const innerAft = Math.max(0, component.aftRadius - component.thickness);
    context.moveTo(sx(component.x), sy(component.y - innerFore));
    context.lineTo(sx(component.x + component.length), sy(component.y - innerAft));
    context.lineTo(sx(component.x + component.length), sy(component.y + innerAft));
    context.lineTo(sx(component.x), sy(component.y + innerFore));
  }
  context.closePath();
}

function colours(component: OpenRocketComponent) {
  if (component.kind === "motor") return { stroke: "#555154", fill: "rgba(60,58,60,.20)" };
  if (["masscomponent", "parachute", "streamer", "shockcord"].includes(component.kind)) return { stroke: "#777275", fill: "rgba(90,86,89,.10)" };
  if (["bulkhead", "centeringring", "engineblock"].includes(component.kind)) return { stroke: "#343234", fill: "rgba(54,51,53,.18)" };
  if (["innertube", "tubecoupler"].includes(component.kind)) return { stroke: "#6f6b6e", fill: "rgba(85,82,84,.08)" };
  return { stroke: "#3c393b", fill: "rgba(53,50,52,.06)" };
}

function railButtonCentres(component: OpenRocketComponent) {
  const rail = component.railButton;
  if (!rail) return [];
  const firstCentre = component.x + component.length / 2;
  return Array.from({ length: rail.instanceCount }, (_value, index) => firstCentre + index * rail.instanceSeparation);
}

function railButtonPath(
  context: CanvasRenderingContext2D,
  component: OpenRocketComponent,
  centreX: number,
  rollRadians: number,
  sx: (value: number) => number,
  sy: (value: number) => number,
) {
  const rail = component.railButton!;
  const direction = -Math.cos(rail.angle + rollRadians);
  const outerHalf = rail.outerDiameter / 2;
  const innerHalf = Math.min(outerHalf, rail.innerDiameter / 2);
  const baseTop = rail.baseHeight;
  const flangeStart = Math.max(baseTop, rail.height - rail.flangeHeight);
  const radial = (distance: number) => component.y + direction * (rail.mountingRadius + distance);

  context.beginPath();
  context.moveTo(sx(centreX - outerHalf), sy(radial(0)));
  context.lineTo(sx(centreX + outerHalf), sy(radial(0)));
  context.lineTo(sx(centreX + outerHalf), sy(radial(baseTop)));
  context.lineTo(sx(centreX + innerHalf), sy(radial(baseTop)));
  context.lineTo(sx(centreX + innerHalf), sy(radial(flangeStart)));
  context.lineTo(sx(centreX + outerHalf), sy(radial(flangeStart)));
  context.lineTo(sx(centreX + outerHalf), sy(radial(rail.height)));
  context.lineTo(sx(centreX - outerHalf), sy(radial(rail.height)));
  context.lineTo(sx(centreX - outerHalf), sy(radial(flangeStart)));
  context.lineTo(sx(centreX - innerHalf), sy(radial(flangeStart)));
  context.lineTo(sx(centreX - innerHalf), sy(radial(baseTop)));
  context.lineTo(sx(centreX - outerHalf), sy(radial(baseTop)));
  context.closePath();
}

export const RocketSectionView = forwardRef<RocketSectionHandle, {
  model: OpenRocketModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  rollDegrees: number;
  onRoll: (deltaDegrees: number) => void;
  accent: string;
  themeKey: string;
}>(function RocketSectionView({ model, selectedId, onSelect, rollDegrees, onRoll, accent, themeKey }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const drawRef = useRef<() => void>(() => undefined);
  const hitsRef = useRef<HitRegion[]>([]);

  function changeZoom(factor: number, anchor?: { x: number; y: number }) {
    const previousZoom = zoomRef.current;
    const nextZoom = Math.max(0.65, Math.min(4.5, previousZoom * factor));
    if (anchor && nextZoom !== previousZoom) {
      const canvas = canvasRef.current;
      const host = canvas?.parentElement;
      if (host) {
        const rect = host.getBoundingClientRect();
        const scaleChange = nextZoom / previousZoom;
        const baseOriginX = 54;
        const baseOriginY = rect.height * 0.53;
        panRef.current = {
          x: anchor.x - baseOriginX - (anchor.x - baseOriginX - panRef.current.x) * scaleChange,
          y: anchor.y - baseOriginY - (anchor.y - baseOriginY - panRef.current.y) * scaleChange,
        };
      }
    }
    zoomRef.current = nextZoom;
    drawRef.current();
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => changeZoom(1.2),
    zoomOut: () => changeZoom(1 / 1.2),
    reset: () => {
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      drawRef.current();
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const host = canvas?.parentElement as HTMLElement;
    if (!canvas || !host || !model) return;
    const activeModel = model;
    let drag = { active: false, moved: false, x: 0, y: 0 };

    function draw() {
      const rect = host.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      const darkTheme = document.documentElement.dataset.theme === "dark";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const margin = 54;
      const baseScale = (rect.width - margin * 2) / activeModel.length;
      const scale = baseScale * zoomRef.current;
      const originX = margin + panRef.current.x;
      const originY = rect.height * 0.53 + panRef.current.y;
      const sx = (value: number) => originX + value * scale;
      const sy = (value: number) => originY + value * scale;
      const rollRadians = rollDegrees * Math.PI / 180;
      const projectedY = (component: OpenRocketComponent) => component.y * Math.cos(rollRadians) + component.z * Math.sin(rollRadians);
      const hits: HitRegion[] = [];

      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "top";
      const stationStep = activeModel.length > 4 ? 0.5 : 0.25;
      for (let station = 0; station <= activeModel.length + 0.001; station += stationStep) {
        const x = sx(station);
        context.strokeStyle = darkTheme ? "rgba(255,255,255,.07)" : "rgba(20,18,19,.07)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, 38);
        context.lineTo(x, rect.height - 36);
        context.stroke();
        context.fillStyle = "#746f70";
        context.fillText(`${Math.round(station * 1000)}`, x + 4, 42);
      }
      context.strokeStyle = "rgba(255,102,114,.22)";
      context.setLineDash([6, 5]);
      context.beginPath();
      context.moveTo(24, originY);
      context.lineTo(rect.width - 24, originY);
      context.stroke();
      context.setLineDash([]);

      const regular = activeModel.components.filter((component) => !component.fin);
      const ordered = [...regular.filter((component) => component.external), ...regular.filter((component) => !component.external)];
      for (const component of ordered) {
        const projection = { ...component, y: projectedY(component) };
        const radius = Math.max(component.foreRadius, component.aftRadius, 0.006);
        const width = Math.max(3, component.length * scale);
        const selected = component.id === selectedId;
        if (component.railButton) {
          const rail = component.railButton;
          const direction = -Math.cos(rail.angle + rollRadians);
          const baseY = projection.y + direction * rail.mountingRadius;
          const outerY = projection.y + direction * (rail.mountingRadius + rail.height + rail.screwHeight);
          const top = Math.min(sy(baseY), sy(outerY)) - 5;
          const height = Math.max(10, Math.abs(sy(outerY) - sy(baseY)) + 10);
          const centres = railButtonCentres(component);
          for (const centre of centres) {
            railButtonPath(context, projection, centre, rollRadians, sx, sy);
            context.fillStyle = selected ? "rgba(201,35,53,.16)" : (darkTheme ? "rgba(190,186,188,.28)" : "rgba(45,43,44,.16)");
            context.strokeStyle = selected ? accent : (darkTheme ? "#b0abad" : "#343234");
            context.lineWidth = selected ? 2.2 : 1.25;
            context.fill();
            context.stroke();
            hits.push({
              id: component.id,
              x: sx(centre - rail.outerDiameter / 2) - 5,
              y: top,
              width: Math.max(10, rail.outerDiameter * scale + 10),
              height,
            });
          }
          if (selected && centres.length) {
            context.fillStyle = accent;
            context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
            const labelY = direction >= 0 ? sy(outerY) + 7 : sy(outerY) - 17;
            context.fillText(component.name.toUpperCase(), sx(centres[0] - rail.outerDiameter / 2), labelY);
          }
          continue;
        }
        componentPath(context, projection, sx, sy);
        const palette = colours(component);
        context.fillStyle = component.external ? (selected ? "rgba(201,35,53,.08)" : "rgba(40,39,40,.035)") : palette.fill;
        context.strokeStyle = selected ? accent : palette.stroke;
        context.lineWidth = selected ? 2.4 : component.external ? 1.45 : 1;
        context.fill(hasWall(component) ? "evenodd" : "nonzero");
        context.stroke();
        hits.push({ id: component.id, x: sx(component.x), y: sy(projection.y) - radius * scale - 7, width, height: radius * scale * 2 + 14 });

        const labelMainBody = component.external && component.parentId === null && width > 65;
        if (labelMainBody || selected) {
          context.fillStyle = selected ? accent : (darkTheme ? "#928b8c" : "#676164");
          context.font = selected ? "600 10px ui-monospace, SFMono-Regular, Menlo, monospace" : "9px ui-monospace, SFMono-Regular, Menlo, monospace";
          context.fillText(component.name.toUpperCase(), sx(component.x) + 7, sy(projection.y + radius) + 7);
        }
      }

      for (const component of activeModel.components.filter((item) => item.fin)) {
        const fin = component.fin!;
        const rootRadius = Math.max(component.foreRadius, component.aftRadius);
        const centreY = projectedY(component);
        const selected = component.id === selectedId;
        context.strokeStyle = selected ? accent : "#464244";
        context.fillStyle = selected ? "rgba(201,35,53,.14)" : "rgba(62,59,61,.07)";
        context.lineWidth = selected ? 2.4 : 1.4;
        const projectedExtents: number[] = [];
        const finCount = Math.max(1, Math.round(fin.count));
        for (let finIndex = 0; finIndex < finCount; finIndex += 1) {
          const angle = fin.rotation + rollRadians + finIndex * Math.PI * 2 / finCount;
          const direction = -Math.cos(angle);
          const radialY = (radius: number) => centreY + direction * radius;
          context.beginPath();
          if (component.kind === "freeformfinset" && fin.points.length > 2) {
            fin.points.forEach((point, index) => {
              const px = sx(component.x + point.x);
              const py = sy(radialY(rootRadius + point.y));
              projectedExtents.push(radialY(rootRadius + point.y));
              if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
            });
          } else {
            context.moveTo(sx(component.x), sy(radialY(rootRadius)));
            context.lineTo(sx(component.x + fin.sweep), sy(radialY(rootRadius + fin.span)));
            context.lineTo(sx(component.x + fin.sweep + fin.tip), sy(radialY(rootRadius + fin.span)));
            context.lineTo(sx(component.x + fin.root), sy(radialY(rootRadius)));
            projectedExtents.push(radialY(rootRadius), radialY(rootRadius + fin.span));
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        hits.push({
          id: component.id,
          x: sx(component.x),
          y: sy(Math.min(...projectedExtents)) - 7,
          width: Math.max(fin.root, fin.sweep + fin.tip) * scale,
          height: Math.max(10, (Math.max(...projectedExtents) - Math.min(...projectedExtents)) * scale + 14),
        });
      }

      context.fillStyle = darkTheme ? "#e7e2e2" : "#2d292b";
      context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(`${activeModel.name.toUpperCase()}  /  ${(activeModel.length * 1000).toFixed(0)} MM  /  Ø ${(activeModel.maxRadius * 2000).toFixed(0)} MM`, 18, 13);
      context.textAlign = "right";
      context.fillStyle = "#746f70";
      context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText("COMPONENT SECTION · GEOMETRY FROM .ORK", rect.width - 18, 15);
      context.textAlign = "left";
      hitsRef.current = hits;
    }

    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);

    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (event.ctrlKey) {
        onRoll(event.deltaY < 0 ? -5 : 5);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      changeZoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }
    function pointerDown(event: PointerEvent) {
      drag = { active: true, moved: false, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: PointerEvent) {
      if (!drag.active) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      panRef.current.x += dx;
      panRef.current.y += dy;
      drag.x = event.clientX;
      drag.y = event.clientY;
      draw();
    }
    function pointerUp(event: PointerEvent) {
      if (!drag.active) return;
      canvas.releasePointerCapture(event.pointerId);
      if (!drag.moved) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hit = [...hitsRef.current].reverse().find((region) => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height);
        onSelect(hit?.id ?? null);
      }
      drag.active = false;
    }
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      drawRef.current = () => undefined;
    };
  }, [accent, model, onRoll, onSelect, rollDegrees, selectedId, themeKey]);

  return (
    <div className="rocket-section">
      <canvas ref={canvasRef} aria-label="OpenRocket component section" />
      <div className="section-hint">WHEEL TO ZOOM · CTRL + WHEEL TO ROLL · DRAG TO PAN · CLICK EMPTY SPACE TO DESELECT</div>
    </div>
  );
});
