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

export type OpenRocketSimulationSample = {
  time: number;
  altitude: number;
  velocity: number;
  verticalVelocity: number;
  acceleration: number;
  mach: number;
  stability: number;
  cg: number;
  cp: number;
  mass: number;
  motorMass: number;
};

export type OpenRocketSimulation = {
  id: string;
  name: string;
  status: string;
  configurationId: string;
  branchName: string;
  windSpeed: number;
  launchRodLength: number;
  launchIntoWind: boolean;
  launchRodAngle: number;
  launchRodDirection: number;
  launchAltitude: number;
  launchLatitude: number;
  launchLongitude: number;
  geodeticMethod: string;
  isaAtmosphere: boolean;
  launchTemperature: number;
  launchPressure: number;
  timeStep: number;
  maxSimulationTime: number;
  maxStepAngle: number;
  randomSeed: number;
  windModelType: string;
  windDeviation: number;
  windTurbulence: number;
  windDirection: number;
  windLevels: Array<{ altitude: number; speed: number; direction: number; standardDeviation: number }>;
  maxAltitude: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxMach: number;
  timeToApogee: number;
  flightTime: number;
  groundHitVelocity: number;
  launchRodVelocity: number;
  deploymentVelocity: number;
  optimumDelay: number;
  railExitStability: number;
  railExitCg: number;
  railExitCp: number;
  launchMass: number;
  launchMotorMass: number;
  referenceMach: number;
  referenceStability: number;
  referenceCg: number;
  referenceCp: number;
  warnings: Array<{ type: string; priority: string; description: string }>;
  events: Array<{ type: string; time: number }>;
  series: OpenRocketSimulationSample[];
};

export type OpenRocketSimulationSetup = {
  name: string;
  launchRodLength: number;
  launchIntoWind: boolean;
  launchRodAngleDegrees: number;
  launchRodDirectionDegrees: number;
  windModelType: "AVERAGE" | "MULTI_LEVEL";
  windSpeed: number;
  windDeviation: number;
  windTurbulence: number;
  windDirectionDegrees: number;
  windAltitudeReference: "MSL" | "AGL";
  windLevels: Array<{ altitude: number; speed: number; directionDegrees: number; standardDeviation: number }>;
  launchAltitude: number;
  launchLatitude: number;
  launchLongitude: number;
  geodeticMethod: "FLAT" | "SPHERICAL" | "WGS84";
  isaAtmosphere: boolean;
  launchTemperatureC: number;
  launchPressureHpa: number;
  timeStep: number;
  maxSimulationTime: number;
  maxStepAngleDegrees: number;
  randomSeed: number;
};

export type OpenRocketModel = {
  name: string;
  designer: string;
  sourceName: string;
  stages: string[];
  length: number;
  maxRadius: number;
  components: OpenRocketComponent[];
  simulations: OpenRocketSimulation[];
  rawXml: string;
  sourceEntryName: string;
  archiveEntries: Record<string, Uint8Array>;
};

export type OpenRocketEditableField = "name" | "length" | "diameter" | "wallThickness" | "mass" | "material" | "simulationSetup";

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

function componentLength(node: Element): number {
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

function finiteNumber(value: string | null | undefined, fallback = Number.NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSimulations(document: XMLDocument, referenceDiameter: number): OpenRocketSimulation[] {
  const configurationNames = new Map(Array.from(document.querySelectorAll("openrocket > rocket > motorconfiguration")).map((configuration) => [
    configuration.getAttribute("configid") || "",
    text(configuration, "name", "Flight configuration"),
  ]));
  return Array.from(document.querySelectorAll("openrocket > simulations > simulation")).flatMap((simulation, simulationIndex) => {
    const flightData = child(simulation, "flightdata");
    const conditions = child(simulation, "conditions");
    const branch = child(flightData, "databranch");
    const typeNames = (branch?.getAttribute("types") ?? "").split(",").map((value) => value.trim());
    const typeIndex = (name: string) => typeNames.indexOf(name);
    const dataNodes = branch ? children(branch, "datapoint") : [];
    const allSamples = dataNodes.map((dataNode) => {
      const values = (dataNode.textContent ?? "").trim().split(",");
      const value = (name: string) => finiteNumber(values[typeIndex(name)]);
      return {
        time: value("Time"),
        altitude: value("Altitude"),
        velocity: value("Total velocity"),
        verticalVelocity: value("Vertical velocity"),
        acceleration: value("Total acceleration"),
        mach: value("Mach number"),
        stability: value("Stability margin calibers"),
        cg: value("CG location"),
        cp: value("CP location"),
        mass: value("Mass"),
        motorMass: value("Motor mass"),
      };
    }).filter((sample) => Number.isFinite(sample.time));
    const stride = Math.max(1, Math.ceil(allSamples.length / 420));
    const series = allSamples.filter((_sample, index) => index % stride === 0 || index === allSamples.length - 1);
    const events = branch ? children(branch, "event").map((event) => ({
      type: event.getAttribute("type") || "event",
      time: finiteNumber(event.getAttribute("time"), 0),
    })) : [];
    const railExitTime = events.find((event) => event.type === "launchrod")?.time ?? 0;
    const railExit = allSamples.reduce<OpenRocketSimulationSample | null>((nearest, sample) => {
      if (!Number.isFinite(sample.stability)) return nearest;
      if (!nearest || Math.abs(sample.time - railExitTime) < Math.abs(nearest.time - railExitTime)) return sample;
      return nearest;
    }, null);
    const launchSample = allSamples.find((sample) => Number.isFinite(sample.mass)) ?? null;
    const motorMassSample = allSamples.find((sample) => Number.isFinite(sample.motorMass)) ?? null;
    const launchCgSample = allSamples.find((sample) => Number.isFinite(sample.cg)) ?? null;
    const referenceSample = allSamples
      .filter((sample) => Number.isFinite(sample.cp) && Number.isFinite(sample.cg) && Number.isFinite(sample.stability) && Number.isFinite(sample.mach))
      .reduce<OpenRocketSimulationSample | null>((nearest, sample) => !nearest || Math.abs(sample.mach - 0.3) < Math.abs(nearest.mach - 0.3) ? sample : nearest, null);
    const wind = conditions ? child(conditions, "wind") : null;
    const winds = conditions ? children(conditions, "wind") : [];
    const averageWind = winds.find((item) => item.getAttribute("model") === "average") ?? wind;
    const multiLevelWind = winds.find((item) => item.getAttribute("model") === "multilevel");
    const atmosphere = conditions ? child(conditions, "atmosphere") : null;
    const rawLaunchRodAngle = number(conditions, "launchrodangle");
    const rawLaunchRodDirection = number(conditions, "launchroddirection");
    const angleUnit = conditions?.getAttribute("coroc-angle-unit");
    const legacyCoRocRadians = angleUnit !== "degrees"
      && Boolean(child(simulation, "id"))
      && Math.abs(rawLaunchRodDirection) <= Math.PI * 2 + 1e-9;
    const summary = (attribute: string) => finiteNumber(flightData?.getAttribute(attribute));
    const configurationId = text(conditions, "configid");
    const referenceCg = launchCgSample?.cg ?? Number.NaN;
    const referenceCp = referenceSample?.cp ?? Number.NaN;
    const referenceStability = Number.isFinite(referenceCg) && Number.isFinite(referenceCp) && referenceDiameter > 0
      ? (referenceCp - referenceCg) / referenceDiameter
      : referenceSample?.stability ?? Number.NaN;
    return [{
      id: simulation.querySelector(":scope > id")?.textContent?.trim() || `simulation-${simulationIndex + 1}`,
      name: text(simulation, "name", `Simulation ${simulationIndex + 1}`),
      status: simulation.getAttribute("status") || "unknown",
      configurationId,
      branchName: configurationNames.get(configurationId) || branch?.getAttribute("name") || "Flight configuration",
      windSpeed: number(averageWind, "speed", number(conditions, "windaverage")),
      launchRodLength: number(conditions, "launchrodlength"),
      launchIntoWind: text(conditions, "launchintowind", "true") !== "false",
      launchRodAngle: legacyCoRocRadians ? rawLaunchRodAngle * 180 / Math.PI : rawLaunchRodAngle,
      launchRodDirection: legacyCoRocRadians ? rawLaunchRodDirection * 180 / Math.PI : rawLaunchRodDirection,
      launchAltitude: number(conditions, "launchaltitude"),
      launchLatitude: number(conditions, "launchlatitude"),
      launchLongitude: number(conditions, "launchlongitude"),
      geodeticMethod: text(conditions, "geodeticmethod", "spherical").toLowerCase(),
      isaAtmosphere: atmosphere?.getAttribute("model") !== "extendedisa",
      launchTemperature: finiteNumber(atmosphere?.getAttribute("temperature")),
      launchPressure: finiteNumber(atmosphere?.getAttribute("pressure")),
      timeStep: number(conditions, "timestep"),
      maxSimulationTime: number(conditions, "maxtime", 1200),
      maxStepAngle: number(conditions, "maximumangle", 0.0523598776),
      randomSeed: number(conditions, "randomseed", 0),
      windModelType: text(conditions, "windmodeltype", "Average"),
      windDeviation: number(averageWind, "standarddeviation", number(conditions, "winddeviation")),
      windTurbulence: number(conditions, "windturbulence"),
      windDirection: number(averageWind, "direction", number(conditions, "winddirection")),
      windLevels: multiLevelWind ? children(multiLevelWind, "windlevel").map((level) => ({
        altitude: finiteNumber(level.getAttribute("altitude"), 0),
        speed: finiteNumber(level.getAttribute("speed"), 0),
        direction: finiteNumber(level.getAttribute("direction"), 0),
        standardDeviation: finiteNumber(level.getAttribute("standarddeviation"), 0),
      })) : [],
      maxAltitude: summary("maxaltitude"),
      maxVelocity: summary("maxvelocity"),
      maxAcceleration: summary("maxacceleration"),
      maxMach: summary("maxmach"),
      timeToApogee: summary("timetoapogee"),
      flightTime: summary("flighttime"),
      groundHitVelocity: summary("groundhitvelocity"),
      launchRodVelocity: summary("launchrodvelocity"),
      deploymentVelocity: summary("deploymentvelocity"),
      optimumDelay: summary("optimumdelay"),
      railExitStability: railExit?.stability ?? Number.NaN,
      railExitCg: railExit?.cg ?? Number.NaN,
      railExitCp: railExit?.cp ?? Number.NaN,
      launchMass: launchSample?.mass ?? Number.NaN,
      launchMotorMass: motorMassSample?.motorMass ?? Number.NaN,
      referenceMach: referenceSample?.mach ?? Number.NaN,
      referenceStability,
      referenceCg,
      referenceCp,
      warnings: children(flightData, "warning").map((warning) => ({
        type: warning.getAttribute("type") || "Warning",
        priority: text(warning, "priority", "NORMAL"),
        description: text(warning, "description", warning.textContent?.trim() || "Simulation warning"),
      })),
      events,
      series,
    }];
  });
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
  const explicitMassNode = child(node, "overridemass") ?? child(node, "mass");
  const explicitMass = explicitMassNode ? numberText(explicitMassNode.textContent || "0") : Number.NaN;
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
  if (!Number.isFinite(component.mass)) component.mass = calculatedComponentMass(node, component);
  return component;
}

function calculatedComponentMass(node: Element, component: OpenRocketComponent) {
  const material = child(node, "material");
  const density = finiteNumber(material?.getAttribute("density"), 0);
  if (!(density > 0)) return 0;
  if (component.kind === "parachute") {
    const diameter = number(node, "diameter");
    const canopyMass = Math.PI * (diameter / 2) ** 2 * density;
    const lineMaterial = child(node, "linematerial");
    const lineDensity = finiteNumber(lineMaterial?.getAttribute("density"), 0);
    return canopyMass + number(node, "linecount") * number(node, "linelength") * lineDensity;
  }
  if (component.kind === "shockcord") return number(node, "cordlength", component.length) * density;
  if (component.kind === "streamer") return number(node, "stripwidth") * number(node, "striplength") * density;
  const outer = Math.max(component.foreRadius, component.aftRadius);
  const inner = Math.max(0, component.innerRadius);
  const tubeVolume = Math.PI * Math.max(0, outer * outer - inner * inner) * component.length;
  if (["bodytube", "innertube", "tubecoupler", "launchlug", "centeringring", "bulkhead", "engineblock"].includes(component.kind)) {
    return tubeVolume * density;
  }
  if (component.kind === "transition" || component.kind === "nosecone") {
    const outerVolume = Math.PI * component.length / 3 * (
      component.foreRadius ** 2 + component.foreRadius * component.aftRadius + component.aftRadius ** 2
    );
    const innerFore = Math.max(0, component.foreRadius - component.thickness);
    const innerAft = Math.max(0, component.aftRadius - component.thickness);
    const innerVolume = Math.PI * component.length / 3 * (innerFore ** 2 + innerFore * innerAft + innerAft ** 2);
    const shapeFactor = component.kind === "nosecone" && component.shape !== "conical" ? 1.65 : 1;
    return Math.max(0, outerVolume - innerVolume) * shapeFactor * density;
  }
  if (component.fin) {
    const area = component.kind === "ellipticalfinset"
      ? Math.PI * component.fin.root * component.fin.span / 4
      : component.fin.points.length >= 3
        ? Math.abs(component.fin.points.reduce((sum, point, index, points) => {
            const next = points[(index + 1) % points.length];
            return sum + point.x * next.y - next.x * point.y;
          }, 0)) / 2
        : (component.fin.root + component.fin.tip) * component.fin.span / 2;
    return area * component.thickness * component.fin.count * density;
  }
  if (material?.getAttribute("type") === "line") return component.length * density;
  return 0;
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
        let fore = radiusValue(podNode, "foreradius", podNode.tagName === "nosecone" ? 0 : fallbackRadius);
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
  const simulations = parseSimulations(document, maxRadius * 2);

  return {
    name: text(rocket, "name", sourceName.replace(/\.ork$/i, "")),
    designer: text(rocket, "designer"),
    sourceName,
    stages: stageNames,
    length: cursor,
    maxRadius,
    components,
    simulations,
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
  document.querySelectorAll("openrocket > simulations > simulation").forEach((simulation) => simulation.setAttribute("status", "outdated"));

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
    simulations: model.simulations.map((simulation) => ({ ...simulation, status: "outdated" })),
  };
}

function simulationWind(document: XMLDocument, conditions: Element, model: string) {
  let wind = children(conditions, "wind").find((item) => item.getAttribute("model") === model);
  if (!wind) {
    wind = document.createElement("wind");
    wind.setAttribute("model", model);
    conditions.appendChild(wind);
  }
  return wind;
}

export function saveOpenRocketSimulation(
  model: OpenRocketModel,
  sourceIndex: number,
  setup: OpenRocketSimulationSetup,
  simulationId?: string,
) {
  const document = new DOMParser().parseFromString(model.rawXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The working OpenRocket XML is invalid");
  const container = document.querySelector("openrocket > simulations");
  const simulations = container ? children(container, "simulation") : [];
  const source = simulations[sourceIndex];
  if (!container || !source) throw new Error("The selected OpenRocket simulation no longer exists");
  let target = simulationId
    ? simulations.find((simulation) => text(simulation, "id") === simulationId)
    : undefined;
  const id = target ? text(target, "id") : crypto.randomUUID();
  if (!target) {
    target = source.cloneNode(true) as Element;
    setXmlValue(document, target, "id", id);
    container.appendChild(target);
  }
  setXmlValue(document, target, "name", setup.name.trim() || "New simulation");
  target.setAttribute("status", "not_simulated");
  children(target, "flightdata").forEach((node) => node.remove());
  let conditions = child(target, "conditions");
  if (!conditions) {
    conditions = document.createElement("conditions");
    target.appendChild(conditions);
  }
  setXmlValue(document, conditions, "launchrodlength", String(setup.launchRodLength));
  setXmlValue(document, conditions, "launchintowind", String(setup.launchIntoWind));
  conditions.setAttribute("coroc-angle-unit", "degrees");
  setXmlValue(document, conditions, "launchrodangle", String(setup.launchRodAngleDegrees));
  setXmlValue(document, conditions, "launchroddirection", String(setup.launchRodDirectionDegrees));
  setXmlValue(document, conditions, "windaverage", String(setup.windSpeed));
  setXmlValue(document, conditions, "winddeviation", String(setup.windDeviation));
  setXmlValue(document, conditions, "windturbulence", String(setup.windTurbulence));
  setXmlValue(document, conditions, "winddirection", String(setup.windDirectionDegrees * Math.PI / 180));
  setXmlValue(document, conditions, "windmodeltype", setup.windModelType === "MULTI_LEVEL" ? "MultiLevel" : "Average");
  const averageWind = simulationWind(document, conditions, "average");
  setXmlValue(document, averageWind, "speed", String(setup.windSpeed));
  setXmlValue(document, averageWind, "direction", String(setup.windDirectionDegrees * Math.PI / 180));
  setXmlValue(document, averageWind, "standarddeviation", String(setup.windDeviation));
  const multiLevelWind = simulationWind(document, conditions, "multilevel");
  multiLevelWind.setAttribute("altituderef", setup.windAltitudeReference.toLowerCase());
  children(multiLevelWind, "windlevel").forEach((node) => node.remove());
  setup.windLevels.forEach((level) => {
    const node = document.createElement("windlevel");
    node.setAttribute("altitude", String(level.altitude));
    node.setAttribute("speed", String(level.speed));
    node.setAttribute("direction", String(level.directionDegrees * Math.PI / 180));
    node.setAttribute("standarddeviation", String(level.standardDeviation));
    multiLevelWind!.appendChild(node);
  });
  setXmlValue(document, conditions, "launchaltitude", String(setup.launchAltitude));
  setXmlValue(document, conditions, "launchlatitude", String(setup.launchLatitude));
  setXmlValue(document, conditions, "launchlongitude", String(setup.launchLongitude));
  setXmlValue(document, conditions, "geodeticmethod", setup.geodeticMethod.toLowerCase());
  let atmosphere = child(conditions, "atmosphere");
  if (!atmosphere) {
    atmosphere = document.createElement("atmosphere");
    conditions.appendChild(atmosphere);
  }
  atmosphere.setAttribute("model", setup.isaAtmosphere ? "isa" : "extendedisa");
  atmosphere.setAttribute("temperature", String(setup.launchTemperatureC + 273.15));
  atmosphere.setAttribute("pressure", String(setup.launchPressureHpa * 100));
  setXmlValue(document, conditions, "timestep", String(setup.timeStep));
  setXmlValue(document, conditions, "maxtime", String(setup.maxSimulationTime));
  setXmlValue(document, conditions, "maximumangle", String(setup.maxStepAngleDegrees * Math.PI / 180));
  setXmlValue(document, conditions, "randomseed", String(Math.trunc(setup.randomSeed)));
  const rawXml = new XMLSerializer().serializeToString(document);
  return {
    simulationId: id,
    model: {
      ...model,
      rawXml,
      archiveEntries: { ...model.archiveEntries, [model.sourceEntryName]: strToU8(rawXml) },
    simulations: parseSimulations(document, model.maxRadius * 2),
    },
  };
}

export function saveOpenRocketSimulationResult(
  model: OpenRocketModel,
  sourceIndex: number,
  result: OpenRocketSimulation,
) {
  const document = new DOMParser().parseFromString(model.rawXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The working OpenRocket XML is invalid");
  const simulation = Array.from(document.querySelectorAll("openrocket > simulations > simulation"))[sourceIndex];
  if (!simulation) throw new Error("The calculated OpenRocket simulation no longer exists");
  simulation.setAttribute("status", "uptodate");
  children(simulation, "flightdata").forEach((node) => node.remove());

  const flightData = document.createElement("flightdata");
  const summaries: Array<[string, number]> = [
    ["maxaltitude", result.maxAltitude], ["maxvelocity", result.maxVelocity],
    ["maxacceleration", result.maxAcceleration], ["maxmach", result.maxMach],
    ["timetoapogee", result.timeToApogee], ["flighttime", result.flightTime],
    ["groundhitvelocity", result.groundHitVelocity], ["launchrodvelocity", result.launchRodVelocity],
    ["deploymentvelocity", result.deploymentVelocity], ["optimumdelay", result.optimumDelay],
  ];
  summaries.forEach(([name, value]) => { if (Number.isFinite(value)) flightData.setAttribute(name, String(value)); });
  result.warnings.forEach((warning) => {
    const node = document.createElement("warning");
    node.setAttribute("type", warning.type || "Other");
    setXmlValue(document, node, "id", crypto.randomUUID());
    setXmlValue(document, node, "description", warning.description);
    setXmlValue(document, node, "priority", warning.priority || "NORMAL");
    flightData.appendChild(node);
  });

  const branch = document.createElement("databranch");
  branch.setAttribute("name", result.branchName || result.name);
  branch.setAttribute("types", "Time,Altitude,Vertical velocity,Total velocity,Total acceleration,Mach number,Stability margin calibers,CG location,CP location,Mass,Motor mass");
  result.events.forEach((event) => {
    const node = document.createElement("event");
    node.setAttribute("time", String(event.time));
    node.setAttribute("type", event.type);
    node.setAttribute("id", crypto.randomUUID());
    branch.appendChild(node);
  });
  const encoded = (value: number) => Number.isFinite(value) ? String(value) : "NaN";
  result.series.forEach((sample) => {
    const node = document.createElement("datapoint");
    node.textContent = [sample.time, sample.altitude, sample.verticalVelocity, sample.velocity, sample.acceleration,
      sample.mach, sample.stability, sample.cg, sample.cp, sample.mass, sample.motorMass].map(encoded).join(",");
    branch.appendChild(node);
  });
  flightData.appendChild(branch);
  simulation.appendChild(flightData);
  const rawXml = new XMLSerializer().serializeToString(document);
  return {
    simulationId: text(simulation, "id", result.id),
    model: {
      ...model,
      rawXml,
      archiveEntries: { ...model.archiveEntries, [model.sourceEntryName]: strToU8(rawXml) },
      simulations: parseSimulations(document, model.maxRadius * 2),
    },
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
