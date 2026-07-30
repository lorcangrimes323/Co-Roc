import type { OpenRocketComponent, OpenRocketModel, OpenRocketSimulation } from "./openrocket";

export type OrkProposalFieldChange = {
  field: string;
  label: string;
  previousValue: string;
  nextValue: string;
  category: "geometry" | "mass" | "material" | "configuration" | "structure";
};

export type OrkProposalComponentChange = {
  componentId: string;
  componentCode: string;
  componentName: string;
  componentKind: string;
  changeType: "added" | "removed" | "modified";
  geometryChanged: boolean;
  changes: OrkProposalFieldChange[];
};

export type OrkModelComparison = {
  components: OrkProposalComponentChange[];
  changedComponents: number;
  geometryChanges: number;
  addedComponents: number;
  removedComponents: number;
  fieldChanges: number;
};

const componentPrefixes: Record<string, string> = {
  nosecone: "NC", bodytube: "BT", transition: "TR", trapezoidfinset: "FIN", ellipticalfinset: "FIN",
  freeformfinset: "FIN", innertube: "IT", tubecoupler: "TC", bulkhead: "BH", centeringring: "CR",
  engineblock: "EB", masscomponent: "MAS", shockcord: "SC", parachute: "PAR", streamer: "STR",
  railbutton: "RB", launchlug: "LL", podset: "POD", parallelstage: "BST", motor: "MTR",
};

function codeMap(model: OpenRocketModel) {
  const counters = new Map<string, number>();
  return new Map(model.components.map((component) => {
    const prefix = componentPrefixes[component.kind] ?? component.kind.slice(0, 3).toUpperCase();
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    return [component.id, `${prefix}-${String(count).padStart(3, "0")}`];
  }));
}

function shownNumber(value: number, unit: "mm" | "g" | "deg" | "count" | "raw") {
  if (!Number.isFinite(value)) return "—";
  if (unit === "mm") return `${Number((value * 1000).toFixed(3))} mm`;
  if (unit === "g") return `${Number((value * 1000).toFixed(3))} g`;
  if (unit === "deg") return `${Number(value.toFixed(3))}°`;
  if (unit === "count") return String(Math.round(value));
  return String(Number(value.toFixed(6)));
}

function sameNumber(left: number, right: number) {
  if (!Number.isFinite(left) && !Number.isFinite(right)) return true;
  return Math.abs(left - right) <= Math.max(1e-7, Math.abs(left) * 1e-6, Math.abs(right) * 1e-6);
}

function addNumberChange(
  result: OrkProposalFieldChange[],
  field: string,
  label: string,
  previousValue: number,
  nextValue: number,
  unit: "mm" | "g" | "deg" | "count" | "raw",
  category: OrkProposalFieldChange["category"],
) {
  if (sameNumber(previousValue, nextValue)) return;
  result.push({ field, label, previousValue: shownNumber(previousValue, unit), nextValue: shownNumber(nextValue, unit), category });
}

function addTextChange(
  result: OrkProposalFieldChange[],
  field: string,
  label: string,
  previousValue: string | boolean,
  nextValue: string | boolean,
  category: OrkProposalFieldChange["category"],
) {
  if (previousValue === nextValue) return;
  result.push({ field, label, previousValue: String(previousValue || "—"), nextValue: String(nextValue || "—"), category });
}

function finDescription(component: OpenRocketComponent) {
  if (!component.fin) return "none";
  const fin = component.fin;
  return JSON.stringify({ root: fin.root, tip: fin.tip, sweep: fin.sweep, span: fin.span, count: fin.count, rotation: fin.rotation, points: fin.points });
}

function railDescription(component: OpenRocketComponent) {
  if (!component.railButton) return "none";
  return JSON.stringify(component.railButton);
}

function compareComponent(previous: OpenRocketComponent, next: OpenRocketComponent) {
  const changes: OrkProposalFieldChange[] = [];
  addTextChange(changes, "name", "Component name", previous.name, next.name, "structure");
  addTextChange(changes, "kind", "Component type", previous.kind, next.kind, "structure");
  addTextChange(changes, "parentId", "Parent component", previous.parentId ?? "vehicle", next.parentId ?? "vehicle", "structure");
  addTextChange(changes, "stage", "Stage", previous.stage, next.stage, "structure");
  addNumberChange(changes, "x", "Axial position", previous.x, next.x, "mm", "geometry");
  addNumberChange(changes, "y", "Radial Y position", previous.y, next.y, "mm", "geometry");
  addNumberChange(changes, "z", "Radial Z position", previous.z, next.z, "mm", "geometry");
  addNumberChange(changes, "length", "Length", previous.length, next.length, "mm", "geometry");
  addNumberChange(changes, "foreRadius", "Fore diameter", previous.foreRadius * 2, next.foreRadius * 2, "mm", "geometry");
  addNumberChange(changes, "aftRadius", "Aft diameter", previous.aftRadius * 2, next.aftRadius * 2, "mm", "geometry");
  addNumberChange(changes, "innerRadius", "Inner diameter", previous.innerRadius * 2, next.innerRadius * 2, "mm", "geometry");
  addNumberChange(changes, "thickness", "Wall thickness", previous.thickness, next.thickness, "mm", "geometry");
  addTextChange(changes, "shape", "Profile", previous.shape, next.shape, "geometry");
  addNumberChange(changes, "shapeParameter", "Profile parameter", previous.shapeParameter, next.shapeParameter, "raw", "geometry");
  addTextChange(changes, "external", "External geometry", previous.external, next.external, "geometry");
  addTextChange(changes, "flipped", "Flipped", previous.flipped, next.flipped, "geometry");
  addTextChange(changes, "finGeometry", "Fin geometry", finDescription(previous), finDescription(next), "geometry");
  addTextChange(changes, "railButtonGeometry", "Rail-button geometry", railDescription(previous), railDescription(next), "geometry");
  addNumberChange(changes, "mass", "Component mass", previous.mass, next.mass, "g", "mass");
  addTextChange(changes, "material", "Material", previous.material, next.material, "material");
  return changes;
}

function simulationFields(simulation: OpenRocketSimulation) {
  return {
    name: simulation.name,
    configurationId: simulation.configurationId,
    windSpeed: simulation.windSpeed,
    windDeviation: simulation.windDeviation,
    windTurbulence: simulation.windTurbulence,
    windDirection: simulation.windDirection,
    launchRodLength: simulation.launchRodLength,
    launchRodAngle: simulation.launchRodAngle,
    launchRodDirection: simulation.launchRodDirection,
    launchAltitude: simulation.launchAltitude,
    launchLatitude: simulation.launchLatitude,
    launchLongitude: simulation.launchLongitude,
    launchTemperature: simulation.launchTemperature,
    launchPressure: simulation.launchPressure,
    timeStep: simulation.timeStep,
    maxSimulationTime: simulation.maxSimulationTime,
    randomSeed: simulation.randomSeed,
  };
}

function compareSimulation(previous: OpenRocketSimulation, next: OpenRocketSimulation) {
  const before = simulationFields(previous);
  const after = simulationFields(next);
  return Object.keys(before).flatMap((field) => {
    const previousValue = before[field as keyof typeof before];
    const nextValue = after[field as keyof typeof after];
    const equal = typeof previousValue === "number" && typeof nextValue === "number"
      ? sameNumber(previousValue, nextValue)
      : previousValue === nextValue;
    return equal ? [] : [{
      field: `simulation.${field}`,
      label: field.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
      previousValue: String(previousValue),
      nextValue: String(nextValue),
      category: "configuration" as const,
    }];
  });
}

export function compareOrkModels(previous: OpenRocketModel, next: OpenRocketModel): OrkModelComparison {
  const previousById = new Map(previous.components.map((component) => [component.id, component]));
  const nextById = new Map(next.components.map((component) => [component.id, component]));
  const previousCodes = codeMap(previous);
  const nextCodes = codeMap(next);
  const components: OrkProposalComponentChange[] = [];

  for (const component of previous.components) {
    const proposed = nextById.get(component.id);
    if (!proposed) {
      components.push({
        componentId: component.id,
        componentCode: previousCodes.get(component.id) ?? "PART",
        componentName: component.name,
        componentKind: component.kind,
        changeType: "removed",
        geometryChanged: true,
        changes: [{ field: "component.removed", label: "Component", previousValue: component.name, nextValue: "Removed", category: "structure" }],
      });
      continue;
    }
    const changes = compareComponent(component, proposed);
    if (!changes.length) continue;
    components.push({
      componentId: component.id,
      componentCode: previousCodes.get(component.id) ?? nextCodes.get(component.id) ?? "PART",
      componentName: proposed.name,
      componentKind: proposed.kind,
      changeType: "modified",
      geometryChanged: changes.some((change) => change.category === "geometry" || change.category === "structure"),
      changes,
    });
  }

  for (const component of next.components) {
    if (previousById.has(component.id)) continue;
    components.push({
      componentId: component.id,
      componentCode: nextCodes.get(component.id) ?? "PART",
      componentName: component.name,
      componentKind: component.kind,
      changeType: "added",
      geometryChanged: true,
      changes: [{ field: "component.added", label: "Component", previousValue: "Not present", nextValue: component.name, category: "structure" }],
    });
  }

  const previousSimulations = new Map(previous.simulations.map((simulation) => [simulation.id, simulation]));
  const nextSimulations = new Map(next.simulations.map((simulation) => [simulation.id, simulation]));
  previous.simulations.forEach((simulation, index) => {
    const proposed = nextSimulations.get(simulation.id);
    const changes = proposed ? compareSimulation(simulation, proposed) : [{ field: "simulation.removed", label: "Simulation case", previousValue: simulation.name, nextValue: "Removed", category: "configuration" as const }];
    if (!changes.length) return;
    components.push({ componentId: `simulation:${simulation.id}`, componentCode: `SIM-${String(index + 1).padStart(3, "0")}`, componentName: proposed?.name ?? simulation.name, componentKind: "flight configuration", changeType: proposed ? "modified" : "removed", geometryChanged: false, changes });
  });
  next.simulations.forEach((simulation, index) => {
    if (previousSimulations.has(simulation.id)) return;
    components.push({ componentId: `simulation:${simulation.id}`, componentCode: `SIM-${String(index + 1).padStart(3, "0")}`, componentName: simulation.name, componentKind: "flight configuration", changeType: "added", geometryChanged: false, changes: [{ field: "simulation.added", label: "Simulation case", previousValue: "Not present", nextValue: simulation.name, category: "configuration" }] });
  });

  if (previous.name !== next.name || previous.designer !== next.designer) {
    const changes: OrkProposalFieldChange[] = [];
    addTextChange(changes, "vehicle.name", "Vehicle name", previous.name, next.name, "structure");
    addTextChange(changes, "vehicle.designer", "Designer", previous.designer, next.designer, "configuration");
    components.unshift({ componentId: "vehicle", componentCode: "ORK", componentName: next.name, componentKind: "vehicle", changeType: "modified", geometryChanged: changes.some((change) => change.category === "structure"), changes });
  }

  return {
    changedComponents: components.length,
    geometryChanges: components.filter((component) => component.geometryChanged).length,
    addedComponents: components.filter((component) => component.changeType === "added").length,
    removedComponents: components.filter((component) => component.changeType === "removed").length,
    fieldChanges: components.reduce((total, component) => total + component.changes.length, 0),
    components,
  };
}
