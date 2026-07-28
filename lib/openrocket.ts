import { strFromU8, strToU8, unzipSync, zip, zipSync } from "fflate";

export type OpenRocketComponent = {
  id: string;
  parentId: string | null;
  stage: string;
  depth: number;
  kind: string;
  name: string;
  material: string;
  mass: number;
  x: number;
  y: number;
  z: number;
  length: number;
  foreRadius: number;
  aftRadius: number;
  innerRadius: number;
  thickness: number;
  external: boolean;
  flipped: boolean;
  shape: string;
  shapeParameter: number;
  fin?: { root: number; tip: number; sweep: number; span: number; count: number; rotation: number; points: Array<{ x: number; y: number }> };
  railButton?: {
    outerDiameter: number;
    innerDiameter: number;
    height: number;
    baseHeight: number;
    flangeHeight: number;
    screwHeight: number;
    angle: number;
    instanceCount: number;
    instanceSeparation: number;
    mountingRadius: number;
  };
};

export type OpenRocketModel = {
  name: string;
  designer: string;
  sourceName: string;
  stages: string[];
  length: number;
  maxRadius: number;
  components: OpenRocketComponent[];
  rawXml: string;
  sourceEntryName: string;
  archiveEntries: Record<string, Uint8Array>;
};

export type OpenRocketEditableField = "name" | "length" | "diameter" | "wallThickness" | "mass" | "material";

const AXIAL_KINDS = new Set(["nosecone", "bodytube", "transition"]);
const LENGTH_KINDS = new Set([
  "nosecone", "bodytube", "transition", "innertube", "tubecoupler", "bulkhead",
  "centeringring", "engineblock", "launchlug",
]);

function children(node: Element | null, tag?: string) {
  if (!node) return [];
  return Array.from(node.children).filter((child) => !tag || child.tagName === tag);
}

function child(node: Element | null, tag: string) {
  return children(node, tag)[0] ?? null;
}

function text(node: Element | null, tag: string, fallback = "") {
  return child(node, tag)?.textContent?.trim() || fallback;
}

function numberText(value: string, fallback = 0) {
  const match = value.match(/-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function number(node: Element | null, tag: string, fallback = 0) {
  return numberText(text(node, tag), fallback);
}

function bool(node: Element | null, tag: string) {
  return text(node, tag) === "true";
}

function finPoints(node: Element) {
  const container = child(node, "finpoints") ?? child(node, "points");
  return children(container, "point").map((point) => ({
    x: numberText(point.getAttribute("x") || "0"),
    y: numberText(point.getAttribute("y") || "0"),
  }));
}

function componentLength(node: Element) {
  if (LENGTH_KINDS.has(node.tagName)) return number(node, "length");
  if (node.tagName === "trapezoidfinset" || node.tagName === "ellipticalfinset" || node.tagName === "freeformfinset") {
    const points = finPoints(node);
    return number(node, "rootchord", points.reduce((max, point) => Math.max(max, point.x), 0));
  }
  if (["masscomponent", "parachute", "streamer", "shockcord"].includes(node.tagName)) {
    return number(node, "packedlength", 0.02);
  }
  if (node.tagName === "railbutton") return number(node, "height", 0.01);
  if (node.tagName === "podset" || node.tagName === "parallelstage") {
    const subs = child(node, "subcomponents");
    return children(subs).reduce((sum, item) => sum + componentLength(item), 0);
  }
  return 0.01;
}

function radiusValue(node: Element, tag: string, fallback: number) {
  const raw = text(node, tag);
  if (!raw) return fallback;
  if (raw.startsWith("auto")) return numberText(raw.replace("auto", ""), fallback);
  return numberText(raw, fallback);
}

function haackProfileRadius(distance: number, length: number, radius: number, parameter: number) {
  if (length <= 0) return radius;
  const u = Math.max(0, Math.min(1, distance / length));
  const theta = Math.acos(1 - 2 * u);
  const value = theta - Math.sin(2 * theta) / 2 + parameter * Math.sin(theta) ** 3;
  return radius * Math.sqrt(Math.max(0, value) / Math.PI);
}

function componentRadiusAt(component: OpenRocketComponent, distance: number) {
  const length = Math.max(component.length, 0.000001);
  const local = Math.max(0, Math.min(length, component.flipped ? length - distance : distance));
  const u = local / length;
  if (component.kind !== "nosecone") {
    return component.flipped
      ? component.aftRadius + (component.foreRadius - component.aftRadius) * u
      : component.foreRadius + (component.aftRadius - component.foreRadius) * u;
  }
  const radius = component.flipped ? component.foreRadius : component.aftRadius;
  if (component.shape === "conical") return radius * u;
  if (component.shape === "ellipsoid") return radius * Math.sqrt(Math.max(0, 1 - (u - 1) ** 2));
  if (component.shape === "power") return radius * u ** Math.max(0.01, component.shapeParameter || 0.5);
  if (component.shape === "parabolic") return radius * (2 * u - u * u);
  if (component.shape === "ogive") {
    const rho = (radius * radius + length * length) / (2 * Math.max(radius, 0.000001));
    return Math.sqrt(Math.max(0, rho * rho - (length - local) ** 2)) + radius - rho;
  }
  return haackProfileRadius(local, length, radius, component.shapeParameter);
}

function resolveLocalX(node: Element, parentLength: number, ownLength: number) {
  const offsetNode = child(node, "axialoffset") ?? child(node, "position");
  const offset = offsetNode ? numberText(offsetNode.textContent || "0") : 0;
  const method = offsetNode?.getAttribute("method") || offsetNode?.getAttribute("type") || "top";
  if (method === "bottom") return parentLength + offset - ownLength;
  if (method === "middle") return parentLength / 2 + offset - ownLength / 2;
  return offset;
}

function makeComponent(
  node: Element,
  stage: string,
  parentId: string | null,
  depth: number,
  x: number,
  y: number,
  length: number,
  foreRadius: number,
  aftRadius: number,
  external: boolean,
  z = 0,
): OpenRocketComponent {
  const explicitMass = number(node, "overridemass", number(node, "mass", 0));
  const innerRadius = radiusValue(node, "innerradius", Math.max(0, aftRadius - number(node, "thickness", 0)));
  const component: OpenRocketComponent = {
    id: text(node, "id", `${stage}-${node.tagName}-${x}`),
    parentId,
    stage,
    depth,
    kind: node.tagName,
    name: text(node, "name", node.tagName),
    material: text(node, "material", "—"),
    mass: explicitMass,
    x,
    y,
    z,
    length,
    foreRadius,
    aftRadius,
    innerRadius,
    thickness: number(node, "thickness"),
    external,
    flipped: bool(node, "isflipped"),
    shape: text(node, "shape", node.tagName === "nosecone" ? "ogive" : "linear"),
    shapeParameter: number(node, "shapeparameter"),
  };
  if (["trapezoidfinset", "ellipticalfinset", "freeformfinset"].includes(node.tagName)) {
    const points = finPoints(node);
    component.fin = {
      root: number(node, "rootchord", points.reduce((max, point) => Math.max(max, point.x), length)),
      tip: number(node, "tipchord"),
      sweep: number(node, "sweeplength"),
      span: number(node, "height", points.reduce((max, point) => Math.max(max, Math.abs(point.y)), 0)),
      count: number(node, "fincount", 1),
      rotation: number(node, "rotation"),
      points,
    };
  }
  return component;
}

function addMotor(node: Element, mount: OpenRocketComponent, components: OpenRocketComponent[]) {
  const motor = child(child(node, "motormount"), "motor");
  if (!motor) return;
  const length = number(motor, "length");
  const radius = number(motor, "diameter") / 2;
  if (!length || !radius) return;
  const overhang = number(node, "motoroverhang");
  components.push({
    id: `${mount.id}-motor`,
    parentId: mount.id,
    stage: mount.stage,
    depth: mount.depth + 1,
    kind: "motor",
    name: text(motor, "designation", "Motor"),
    material: text(motor, "manufacturer", "Motor"),
    mass: 0,
    x: mount.x + mount.length + overhang - length,
    y: mount.y,
    z: mount.z,
    length,
    foreRadius: radius,
    aftRadius: radius,
    innerRadius: 0,
    thickness: 0,
    external: false,
    flipped: false,
    shape: "linear",
    shapeParameter: 0,
  });
}

function addNested(
  parentNode: Element,
  parent: OpenRocketComponent,
  components: OpenRocketComponent[],
) {
  const subs = child(parentNode, "subcomponents");
  for (const node of children(subs)) {
    const kind = node.tagName;
    const length = componentLength(node);
    const localX = resolveLocalX(node, parent.length, length);
    const localParentRadius = componentRadiusAt(parent, localX + length / 2);
    const localParentInnerRadius = Math.max(0, localParentRadius - parent.thickness);
    const radialPosition = number(node, "radialposition");
    const radialDirection = number(node, "radialdirection");
    const y = parent.y - radialPosition * Math.cos(radialDirection);
    const z = parent.z + radialPosition * Math.sin(radialDirection);

    if (kind === "podset" || kind === "parallelstage") {
      const podRadiusOffset = number(node, "radiusoffset");
      const podRadiusNode = child(node, "radiusoffset");
      const podRadiusMethod = podRadiusNode?.getAttribute("method") || "relative";
      const podAngle = number(node, "angleoffset");
      const podX = parent.x + localX;
      let cursor = podX;
      for (const podNode of children(child(node, "subcomponents"))) {
        const podLength = componentLength(podNode);
        const fallbackRadius = radiusValue(podNode, "aftradius", parent.aftRadius / 2);
        let fore = radiusValue(podNode, "foreradius", kind === "nosecone" ? 0 : fallbackRadius);
        let aft = radiusValue(podNode, "aftradius", radiusValue(podNode, "outerradius", fallbackRadius));
        if (bool(podNode, "isflipped")) [fore, aft] = [aft, fore];
        // OpenRocket stores pod-set radius offsets to the pod centreline. A zero-degree
        // radial direction is above the parent in side elevation, so canvas Y is negative.
        const podCentreRadius = podRadiusMethod === "free"
          ? podRadiusOffset
          : parent.aftRadius + podRadiusOffset;
        const podY = parent.y - podCentreRadius * Math.cos(podAngle);
        const podZ = parent.z + podCentreRadius * Math.sin(podAngle);
        const podComponent = makeComponent(podNode, parent.stage, parent.id, parent.depth + 2, cursor, podY, podLength, fore, aft, true, podZ);
        components.push(podComponent);
        addNested(podNode, podComponent, components);
        cursor += podLength;
      }
      continue;
    }

    const surfaceMounted = ["trapezoidfinset", "ellipticalfinset", "freeformfinset", "launchlug", "railbutton"].includes(kind);
    const railButton = kind === "railbutton" ? {
      outerDiameter: number(node, "outerdiameter", 0.01),
      innerDiameter: number(node, "innerdiameter", number(node, "outerdiameter", 0.01) * 0.6),
      height: number(node, "height", 0.01),
      baseHeight: number(node, "baseheight", 0.002),
      flangeHeight: number(node, "flangeheight", 0.002),
      screwHeight: number(node, "screwheight", 0),
      angle: number(node, "angleoffset") * Math.PI / 180,
      instanceCount: Math.max(1, Math.round(number(node, "instancecount", 1))),
      instanceSeparation: number(node, "instanceseparation"),
      mountingRadius: localParentRadius,
    } : undefined;
    const fallbackRadius = ["masscomponent", "parachute", "streamer", "shockcord"].includes(kind)
      ? radiusValue(node, "packedradius", Math.min(parent.aftRadius, 0.01))
      : kind === "railbutton"
        ? (railButton?.outerDiameter ?? 0.01) / 2
        : radiusValue(node, "outerradius", surfaceMounted ? localParentRadius : localParentInnerRadius);
    let fore = kind === "nosecone" ? 0 : radiusValue(node, "foreradius", fallbackRadius);
    let aft = radiusValue(node, "aftradius", fallbackRadius);
    if (bool(node, "isflipped")) [fore, aft] = [aft, fore];
    const component = makeComponent(
      node,
      parent.stage,
      parent.id,
      parent.depth + 1,
      parent.x + localX - (kind === "railbutton" ? length / 2 : 0),
      kind === "railbutton" ? parent.y : y,
      length,
      fore,
      aft,
      kind === "trapezoidfinset" || kind === "ellipticalfinset" || kind === "freeformfinset" || kind === "railbutton",
      kind === "railbutton" ? parent.z : z,
    );
    component.railButton = railButton;
    components.push(component);
    addMotor(node, component, components);
    addNested(node, component, components);
  }
}

export async function parseOpenRocket(buffer: ArrayBuffer, sourceName: string): Promise<OpenRocketModel> {
  const archive = unzipSync(new Uint8Array(buffer));
  const sourceEntryName = archive["rocket.ork"] ? "rocket.ork" : Object.keys(archive).find((name) => name.endsWith(".ork")) || "";
  const entry = archive[sourceEntryName];
  if (!entry) throw new Error("This archive does not contain rocket.ork");
  const rawXml = strFromU8(entry);
  const document = new DOMParser().parseFromString(rawXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The OpenRocket XML could not be read");
  const rocket = document.querySelector("openrocket > rocket");
  if (!rocket) throw new Error("No rocket definition was found");

  const components: OpenRocketComponent[] = [];
  const stageNames: string[] = [];
  let cursor = 0;
  let previousRadius = 0;
  const stages = children(child(rocket, "subcomponents"), "stage");

  for (const stageNode of stages) {
    const stageName = text(stageNode, "name", `Stage ${stageNames.length + 1}`);
    stageNames.push(stageName);
    const directComponents = children(child(stageNode, "subcomponents")).filter((node) => AXIAL_KINDS.has(node.tagName));
    for (const node of directComponents) {
      const length = componentLength(node);
      const kind = node.tagName;
      let fore = kind === "nosecone" ? 0 : radiusValue(node, "foreradius", radiusValue(node, "outerradius", previousRadius));
      let aft = kind === "nosecone"
        ? radiusValue(node, "aftradius", previousRadius)
        : radiusValue(node, "aftradius", radiusValue(node, "outerradius", fore || previousRadius));
      if (!fore && kind === "bodytube") fore = aft;
      if (!aft && kind === "bodytube") aft = fore;
      if (bool(node, "isflipped")) [fore, aft] = [aft, fore];
      const component = makeComponent(node, stageName, null, 0, cursor, 0, length, fore, aft, true);
      components.push(component);
      addMotor(node, component, components);
      addNested(node, component, components);
      cursor += length;
      previousRadius = aft;
    }
  }

  const maxRadius = components
    .filter((component) => component.parentId === null && AXIAL_KINDS.has(component.kind))
    .reduce((max, component) => Math.max(max, component.foreRadius, component.aftRadius), 0);

  return {
    name: text(rocket, "name", sourceName.replace(/\.ork$/i, "")),
    designer: text(rocket, "designer"),
    sourceName,
    stages: stageNames,
    length: cursor,
    maxRadius,
    components,
    rawXml,
    sourceEntryName,
    archiveEntries: archive,
  };
}

function setXmlValue(document: XMLDocument, node: Element, tag: string, value: string) {
  let target = child(node, tag);
  if (!target) {
    target = document.createElement(tag);
    node.appendChild(target);
  }
  target.textContent = value;
}

export function applyOpenRocketEdit(
  model: OpenRocketModel,
  componentId: string,
  field: OpenRocketEditableField,
  value: string | number,
) {
  const document = new DOMParser().parseFromString(model.rawXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The working OpenRocket XML is invalid");
  const idNode = Array.from(document.querySelectorAll("id")).find((node) => node.textContent?.trim() === componentId);
  const node = idNode?.parentElement;
  const component = model.components.find((item) => item.id === componentId);
  if (!node || !component) throw new Error("The edited component no longer exists in the working .ork file");

  const numeric = typeof value === "number" ? value : Number(value);
  const nextComponent = { ...component };
  if (field === "name") {
    const next = String(value).trim() || component.name;
    setXmlValue(document, node, "name", next);
    nextComponent.name = next;
  } else if (field === "length" && Number.isFinite(numeric)) {
    const metres = Math.max(0, numeric) / 1000;
    const tag = ["masscomponent", "parachute", "streamer", "shockcord"].includes(component.kind) ? "packedlength" : "length";
    setXmlValue(document, node, tag, String(metres));
    nextComponent.length = metres;
  } else if (field === "diameter" && Number.isFinite(numeric)) {
    const radius = Math.max(0, numeric) / 2000;
    const currentMax = Math.max(component.foreRadius, component.aftRadius);
    if (component.kind === "transition") {
      const scale = currentMax > 0 ? radius / currentMax : 1;
      nextComponent.foreRadius *= scale;
      nextComponent.aftRadius *= scale;
      setXmlValue(document, node, "foreradius", String(nextComponent.foreRadius));
      setXmlValue(document, node, "aftradius", String(nextComponent.aftRadius));
    } else if (component.kind === "nosecone") {
      nextComponent.aftRadius = radius;
      setXmlValue(document, node, "aftradius", String(radius));
    } else if (["masscomponent", "parachute", "streamer", "shockcord"].includes(component.kind)) {
      nextComponent.foreRadius = radius;
      nextComponent.aftRadius = radius;
      setXmlValue(document, node, "packedradius", String(radius));
    } else {
      nextComponent.foreRadius = radius;
      nextComponent.aftRadius = radius;
      setXmlValue(document, node, "outerradius", String(radius));
    }
    nextComponent.innerRadius = Math.max(0, nextComponent.aftRadius - nextComponent.thickness);
  } else if (field === "wallThickness" && Number.isFinite(numeric)) {
    const thickness = Math.max(0, numeric) / 1000;
    setXmlValue(document, node, "thickness", String(thickness));
    nextComponent.thickness = thickness;
    nextComponent.innerRadius = Math.max(0, nextComponent.aftRadius - thickness);
  } else if (field === "mass" && Number.isFinite(numeric)) {
    const mass = Math.max(0, numeric);
    const tag = ["masscomponent", "parachute", "streamer", "shockcord"].includes(component.kind) ? "mass" : "overridemass";
    setXmlValue(document, node, tag, String(mass));
    nextComponent.mass = mass;
  } else if (field === "material") {
    const next = String(value).trim() || component.material;
    setXmlValue(document, node, "material", next);
    nextComponent.material = next;
  }

  const rawXml = new XMLSerializer().serializeToString(document);
  return {
    ...model,
    rawXml,
    archiveEntries: { ...model.archiveEntries, [model.sourceEntryName]: strToU8(rawXml) },
    components: model.components.map((item) => item.id === componentId ? nextComponent : item),
  };
}

export function encodeOpenRocket(model: OpenRocketModel) {
  const bytes = zipSync(model.archiveEntries, { level: 6 });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeOpenRocketAsync(model: OpenRocketModel) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    zip(model.archiveEntries, { level: 6 }, (error, bytes) => {
      if (error) { reject(error); return; }
      resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    });
  });
}
