"use client";

import { forwardRef, MouseEvent, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { OpenRocketComponent, OpenRocketModel } from "../lib/openrocket";

export type RocketViewerHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

const SHELL_KINDS = new Set(["nosecone", "bodytube", "transition", "innertube", "tubecoupler", "launchlug"]);

function hasWall(component: OpenRocketComponent) {
  return SHELL_KINDS.has(component.kind) && component.thickness > 0;
}

function haackRadius(x: number, length: number, radius: number, parameter: number) {
  if (length <= 0) return radius;
  const theta = Math.acos(1 - 2 * THREE.MathUtils.clamp(x / length, 0, 1));
  const value = theta - Math.sin(2 * theta) / 2 + parameter * Math.sin(theta) ** 3;
  return radius * Math.sqrt(Math.max(0, value) / Math.PI);
}

function noseRadius(component: OpenRocketComponent, distance: number) {
  const length = component.length || 1;
  const u = THREE.MathUtils.clamp(distance / length, 0, 1);
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

function radiusAt(component: OpenRocketComponent, distance: number) {
  if (component.kind === "nosecone") {
    return component.flipped
      ? noseRadius(component, component.length - distance)
      : noseRadius(component, distance);
  }
  const u = component.length ? distance / component.length : 0;
  return THREE.MathUtils.lerp(component.foreRadius, component.aftRadius, u);
}

function revolvedGeometry(component: OpenRocketComponent) {
  const axialSegments = component.kind === "nosecone" ? 72 : 2;
  const radialSegments = 36;
  const positions: number[] = [];
  const indices: number[] = [];
  const shell = hasWall(component);
  for (let axial = 0; axial <= axialSegments; axial += 1) {
    const distance = component.length * axial / axialSegments;
    const radius = radiusAt(component, distance);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial * Math.PI * 2 / radialSegments;
      positions.push(component.x + distance, radius * Math.cos(angle), radius * Math.sin(angle));
    }
  }
  const innerOffset = positions.length / 3;
  if (shell) {
    for (let axial = 0; axial <= axialSegments; axial += 1) {
      const distance = component.length * axial / axialSegments;
      const radius = Math.max(0, radiusAt(component, distance) - component.thickness);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const angle = radial * Math.PI * 2 / radialSegments;
        positions.push(component.x + distance, radius * Math.cos(angle), radius * Math.sin(angle));
      }
    }
  }
  for (let axial = 0; axial < axialSegments; axial += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      const a = axial * radialSegments + radial;
      const b = axial * radialSegments + next;
      const c = (axial + 1) * radialSegments + next;
      const d = (axial + 1) * radialSegments + radial;
      indices.push(a, b, d, b, c, d);
      if (shell) {
        const ia = innerOffset + a;
        const ib = innerOffset + b;
        const ic = innerOffset + c;
        const id = innerOffset + d;
        indices.push(ia, id, ib, ib, id, ic);
      }
    }
  }
  if (shell) {
    const aftOuter = axialSegments * radialSegments;
    const aftInner = innerOffset + aftOuter;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(radial, innerOffset + radial, next, next, innerOffset + radial, innerOffset + next);
      indices.push(aftOuter + radial, aftOuter + next, aftInner + radial, aftOuter + next, aftInner + next, aftInner + radial);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function finGeometry(component: OpenRocketComponent, angle: number) {
  const fin = component.fin!;
  const rootRadius = Math.max(component.foreRadius, component.aftRadius);
  const points = component.kind === "freeformfinset" && fin.points.length > 2
    ? fin.points.map((point) => ({ x: component.x + point.x, r: rootRadius + point.y }))
    : [
      { x: component.x, r: rootRadius },
      { x: component.x + fin.sweep, r: rootRadius + fin.span },
      { x: component.x + fin.sweep + fin.tip, r: rootRadius + fin.span },
      { x: component.x + fin.root, r: rootRadius },
    ];
  const radial = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
  const tangent = new THREE.Vector3(0, -Math.sin(angle), Math.cos(angle));
  const halfThickness = Math.max(component.thickness / 2, 0.0008);
  const vertices: number[] = [];
  for (const side of [-1, 1]) {
    for (const point of points) {
      const position = radial.clone().multiplyScalar(point.r).add(tangent.clone().multiplyScalar(side * halfThickness));
      vertices.push(point.x, position.y, position.z);
    }
  }
  const count = points.length;
  const indices: number[] = [];
  for (let index = 1; index < count - 1; index += 1) {
    indices.push(0, index, index + 1, count, count + index + 1, count + index);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + index, next, count + next, count + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function railButtonAssembly(component: OpenRocketComponent, centreX: number, darkTheme: boolean) {
  const rail = component.railButton!;
  const assembly = new THREE.Group();
  const radial = new THREE.Vector3(0, Math.cos(rail.angle), Math.sin(rail.angle)).normalize();
  const origin = new THREE.Vector3(centreX, -component.y, component.z);
  const material = materialFor(component, darkTheme);

  function addCylinder(radius: number, height: number, start: number) {
    if (radius <= 0 || height <= 0) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 28, 1, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);
    mesh.position.copy(origin).addScaledVector(radial, rail.mountingRadius + start + height / 2);
    mesh.userData.componentId = component.id;
    assembly.add(mesh);
  }

  const neckHeight = Math.max(0, rail.height - rail.baseHeight - rail.flangeHeight);
  addCylinder(rail.outerDiameter / 2, rail.baseHeight, 0);
  addCylinder(rail.innerDiameter / 2, neckHeight, rail.baseHeight);
  addCylinder(rail.outerDiameter / 2, rail.flangeHeight, rail.baseHeight + neckHeight);
  addCylinder(rail.innerDiameter / 2, rail.screwHeight, rail.height);
  assembly.userData.componentId = component.id;
  return assembly;
}

function materialFor(component: OpenRocketComponent, darkTheme: boolean) {
  const internal = !component.external;
  const colour = darkTheme
    ? component.kind === "motor" ? 0x56535a : component.kind === "railbutton" ? 0x747078 : component.fin ? 0x66636a : component.kind === "nosecone" ? 0x7a777f : 0x8a878e
    : component.kind === "motor" ? 0x353236 : component.kind === "railbutton" ? 0x29272a : component.fin ? 0x4d4b4e : component.kind === "nosecone" ? 0x656267 : 0x777479;
  return new THREE.MeshStandardMaterial({
    color: colour,
    emissive: darkTheme ? 0x08080a : 0x120305,
    emissiveIntensity: darkTheme ? 0.16 : 0.25,
    metalness: component.kind === "motor" ? 0.55 : 0.28,
    roughness: 0.56,
    transparent: true,
    opacity: internal ? 0.22 : component.kind === "nosecone" ? 0.92 : 0.78,
    side: THREE.DoubleSide,
    depthWrite: !internal,
  });
}

export const RocketViewer = forwardRef<RocketViewerHandle, {
  model: OpenRocketModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  themeKey: string;
  rollDegrees: number;
}>(function RocketViewer({ model, selectedId, onSelect, accent, themeKey, rollDegrees }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const initialCameraRef = useRef(new THREE.Vector3());
  const pointerStart = useRef({ x: 0, y: 0 });

  function dolly(factor: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => dolly(0.8),
    zoomOut: () => dolly(1.25),
    reset: () => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || !model) return;
      camera.position.copy(initialCameraRef.current);
      controls.target.set(model.length / 2, 0, 0);
      controls.update();
    },
  }), [model]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !model) return;
    const scene = new THREE.Scene();
    const darkTheme = themeKey === "dark";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x080808, 0);
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 50);
    const target = new THREE.Vector3(model.length / 2, 0, 0);
    const initialCamera = new THREE.Vector3(model.length / 2, model.length * 0.18, model.length * 1.72);
    camera.position.copy(initialCamera);
    initialCameraRef.current.copy(initialCamera);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.55;
    controls.minDistance = model.length * 0.42;
    controls.maxDistance = model.length * 4;
    controls.update();
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(darkTheme ? 0xe5e5ea : 0xffd7d9, darkTheme ? 0x030304 : 0x090202, darkTheme ? 1.9 : 1.7));
    const key = new THREE.DirectionalLight(darkTheme ? 0xffffff : 0xffe8e9, darkTheme ? 2.8 : 2.5);
    key.position.set(model.length * 0.4, model.length, model.length);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 1.4);
    rim.position.set(model.length, -model.length * 0.6, -model.length);
    scene.add(rim);

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);
    for (const component of model.components) {
      if (component.railButton) {
        const rail = component.railButton;
        const firstCentre = component.x + component.length / 2;
        for (let index = 0; index < rail.instanceCount; index += 1) {
          group.add(railButtonAssembly(component, firstCentre + index * rail.instanceSeparation, darkTheme));
        }
        continue;
      }
      if (component.fin) {
        for (let index = 0; index < component.fin.count; index += 1) {
          const angle = component.fin.rotation + index * Math.PI * 2 / component.fin.count;
          const mesh = new THREE.Mesh(finGeometry(component, angle), materialFor(component, darkTheme));
          mesh.userData.componentId = component.id;
          group.add(mesh);
        }
        continue;
      }
      const drawable = component.external || ["motor", "innertube", "tubecoupler"].includes(component.kind);
      if (!drawable || component.length <= 0 || Math.max(component.foreRadius, component.aftRadius) <= 0) continue;
      const mesh = new THREE.Mesh(revolvedGeometry(component), materialFor(component, darkTheme));
      mesh.position.y = -component.y;
      mesh.position.z = component.z;
      mesh.userData.componentId = component.id;
      group.add(mesh);
      if (component.external) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, component.kind === "nosecone" ? 28 : 12),
          new THREE.LineBasicMaterial({ color: darkTheme ? 0xc4c0c6 : 0x69666a, transparent: true, opacity: darkTheme ? 0.7 : 0.62 }),
        );
        edges.userData.componentId = component.id;
        mesh.add(edges);
      }
    }

    const floor = new THREE.GridHelper(model.length * 1.35, 24, darkTheme ? 0x5a5760 : 0x716d71, darkTheme ? 0x343239 : 0xb8b4b7);
    floor.rotation.z = Math.PI / 2;
    floor.position.set(model.length / 2, -Math.max(model.maxRadius * 2.8, 0.15), 0);
    const floorMaterials = Array.isArray(floor.material) ? floor.material : [floor.material];
    floorMaterials.forEach((material) => { material.transparent = true; material.opacity = darkTheme ? 0.3 : 0.2; });
    scene.add(floor);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    function select(event: globalThis.MouseEvent) {
      if (Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(group.children, true).find((entry) => entry.object.userData.componentId || entry.object.parent?.userData.componentId);
      const id = hit?.object.userData.componentId || hit?.object.parent?.userData.componentId;
      onSelect(id ?? null);
    }
    renderer.domElement.addEventListener("click", select);

    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    });
    observer.observe(host);

    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("click", select);
      controls.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      controlsRef.current = null;
      cameraRef.current = null;
      groupRef.current = null;
    };
  }, [accent, model, onSelect, themeKey]);

  useEffect(() => {
    groupRef.current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const selected = object.userData.componentId === selectedId;
      const darkTheme = themeKey === "dark";
      object.material.emissive.setHex(selected ? new THREE.Color(accent).getHex() : (darkTheme ? 0x08080a : 0x120305));
      object.material.emissiveIntensity = selected ? 1.1 : (darkTheme ? 0.16 : 0.25);
    });
  }, [accent, selectedId, themeKey]);

  useEffect(() => {
    if (groupRef.current) groupRef.current.rotation.x = THREE.MathUtils.degToRad(rollDegrees);
  }, [rollDegrees]);

  function pointerDown(event: MouseEvent<HTMLDivElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }

  return (
    <div ref={hostRef} className="rocket-3d" onMouseDown={pointerDown}>
      <div className="viewer-hint">DRAG TO ORBIT · WHEEL TO ZOOM · USE ROLL CONTROL FOR LONGITUDINAL ROTATION</div>
      <div className="viewer-axis"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
    </div>
  );
});
