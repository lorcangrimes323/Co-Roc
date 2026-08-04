export type FlightChannel =
  | "time"
  | "latitude"
  | "longitude"
  | "altitude"
  | "velocity"
  | "verticalVelocity"
  | "acceleration"
  | "pressure"
  | "temperature"
  | "battery"
  | "north"
  | "east";

export type FlightColumnMapping = Partial<Record<FlightChannel, string>>;

export type FlightImportOptions = {
  mapping?: FlightColumnMapping;
  launchLatitude: number;
  launchLongitude: number;
  launchAltitude: number;
  headingDegrees?: number;
};

export type FlightPoint = {
  time: number;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity?: number;
  verticalVelocity?: number;
  acceleration?: number;
  pressure?: number;
  temperature?: number;
  battery?: number;
};

export type FlightSummary = {
  sampleCount: number;
  duration: number;
  apogee: number;
  maxVelocity: number | null;
  maxAcceleration: number | null;
  maxDistance: number;
  landingDistance: number;
  hasGps: boolean;
};

export type ParsedFlightData = {
  columns: string[];
  mapping: FlightColumnMapping;
  points: FlightPoint[];
  summary: FlightSummary;
  sourceRows: number;
  warnings: string[];
};

const aliases: Record<FlightChannel, string[]> = {
  time: ["time", "times", "time sec", "time s", "elapsed", "elapsed time", "timestamp", "mission time", "flight time"],
  latitude: ["latitude", "lat", "gps latitude", "gnss latitude", "gps lat", "position lat"],
  longitude: ["longitude", "lon", "long", "lng", "gps longitude", "gnss longitude", "gps lon", "position lon"],
  altitude: ["altitude", "alt", "height", "baro altitude", "filtered altitude", "kalman altitude", "gps altitude", "gnss altitude", "relative altitude"],
  velocity: ["velocity", "speed", "total velocity", "ground speed", "gps speed", "velocity magnitude"],
  verticalVelocity: ["vertical velocity", "vertical speed", "velocity z", "vel z", "vz", "climb rate", "kalman velocity"],
  acceleration: ["acceleration", "accel", "total acceleration", "acceleration magnitude", "linear acceleration"],
  pressure: ["pressure", "barometric pressure", "baro pressure", "static pressure"],
  temperature: ["temperature", "temp", "board temperature", "imu temperature"],
  battery: ["battery", "battery voltage", "voltage", "vbat", "supply voltage"],
  north: ["north", "northing", "north offset", "position north", "ned north"],
  east: ["east", "easting", "east offset", "position east", "ned east"],
};

function canonical(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDelimiter(line: string) {
  const candidates = [",", "\t", ";"];
  return candidates.map((delimiter) => ({ delimiter, count: line.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

function parseDelimitedLine(line: string, delimiter: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      fields.push(value.trim());
      value = "";
    } else value += character;
  }
  fields.push(value.trim());
  return fields;
}

export function parseFlightTable(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { columns: [] as string[], rows: [] as Record<string, string>[] };
  const headerIndex = Math.max(0, lines.findIndex((line) => /time|alt|lat|pressure|accel/i.test(line)));
  const delimiter = detectDelimiter(lines[headerIndex]);
  const columns = parseDelimitedLine(lines[headerIndex], delimiter).map((column, index) => column || `Column ${index + 1}`);
  const rows = lines.slice(headerIndex + 1).map((line) => parseDelimitedLine(line, delimiter)).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""])),
  );
  return { columns, rows };
}

export function inferFlightMapping(columns: string[]): FlightColumnMapping {
  const normalized = columns.map((column) => ({ column, value: canonical(column) }));
  const mapping: FlightColumnMapping = {};
  (Object.keys(aliases) as FlightChannel[]).forEach((channel) => {
    const match = normalized.find(({ value }) => aliases[channel].includes(value))
      ?? normalized.find(({ value }) => aliases[channel].some((alias) => value.includes(alias) || alias.includes(value)));
    if (match) mapping[channel] = match.column;
  });
  return mapping;
}

function numberFrom(row: Record<string, string>, column?: string) {
  if (!column) return undefined;
  const value = Number(String(row[column] ?? "").trim().replace(/\s/g, "").replace(/,(?=\d{3}(?:\D|$))/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function unitHint(column?: string) {
  return String(column ?? "").toLowerCase();
}

function timeSeconds(value: number | undefined, column?: string) {
  if (value === undefined) return undefined;
  const hint = unitHint(column);
  if (/\b(?:ms|millisecond)/.test(hint)) return value / 1000;
  if (/\b(?:us|microsecond)/.test(hint)) return value / 1_000_000;
  return value;
}

function metres(value: number | undefined, column?: string) {
  if (value === undefined) return undefined;
  const hint = unitHint(column);
  if (/\bft\b|feet|foot/.test(hint)) return value * 0.3048;
  if (/\bmm\b|millimet/.test(hint)) return value / 1000;
  return value;
}

function speedMs(value: number | undefined, column?: string) {
  if (value === undefined) return undefined;
  const hint = unitHint(column);
  if (/mph/.test(hint)) return value * 0.44704;
  if (/km\/?h|kph/.test(hint)) return value / 3.6;
  if (/ft\/?s/.test(hint)) return value * 0.3048;
  return value;
}

function accelerationMs2(value: number | undefined, column?: string) {
  if (value === undefined) return undefined;
  const hint = unitHint(column);
  if (/\bg\b|g force|gforce/.test(hint)) return value * 9.80665;
  if (/ft\/?s/.test(hint)) return value * 0.3048;
  return value;
}

function gpsDegrees(value: number | undefined) {
  if (value === undefined) return undefined;
  return Math.abs(value) > 180 ? value / 10_000_000 : value;
}

function offsetCoordinate(latitude: number, longitude: number, north: number, east: number) {
  const earthRadius = 6_378_137;
  return {
    latitude: latitude + north / earthRadius * 180 / Math.PI,
    longitude: longitude + east / (earthRadius * Math.cos(latitude * Math.PI / 180)) * 180 / Math.PI,
  };
}

export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function summariseFlight(points: FlightPoint[], hasGps: boolean): FlightSummary {
  const first = points[0];
  const last = points.at(-1);
  const launch = first ?? { latitude: 0, longitude: 0 };
  return {
    sampleCount: points.length,
    duration: first && last ? Math.max(0, last.time - first.time) : 0,
    apogee: points.reduce((maximum, point) => Math.max(maximum, point.altitude), points[0]?.altitude ?? 0),
    maxVelocity: points.reduce<number | null>((maximum, point) => point.velocity === undefined ? maximum : Math.max(maximum ?? -Infinity, Math.abs(point.velocity)), null),
    maxAcceleration: points.reduce<number | null>((maximum, point) => point.acceleration === undefined ? maximum : Math.max(maximum ?? -Infinity, Math.abs(point.acceleration)), null),
    maxDistance: points.reduce((maximum, point) => Math.max(maximum, distanceMetres(launch, point)), 0),
    landingDistance: last ? distanceMetres(launch, last) : 0,
    hasGps,
  };
}

export function buildFlightData(text: string, options: FlightImportOptions): ParsedFlightData {
  const { columns, rows } = parseFlightTable(text);
  const mapping = { ...inferFlightMapping(columns), ...options.mapping };
  if (!mapping.time) throw new Error("Choose the elapsed-time column before importing this flight.");
  if (!mapping.altitude) throw new Error("Choose an altitude column before importing this flight.");
  const heading = (options.headingDegrees ?? 0) * Math.PI / 180;
  let travelled = 0;
  let previousTime = 0;
  const rawPoints: FlightPoint[] = [];
  let nativeGpsCount = 0;
  for (const row of rows) {
    const time = timeSeconds(numberFrom(row, mapping.time), mapping.time);
    const rawAltitude = metres(numberFrom(row, mapping.altitude), mapping.altitude);
    if (time === undefined || rawAltitude === undefined) continue;
    const gpsLat = gpsDegrees(numberFrom(row, mapping.latitude));
    const gpsLon = gpsDegrees(numberFrom(row, mapping.longitude));
    const north = metres(numberFrom(row, mapping.north), mapping.north);
    const east = metres(numberFrom(row, mapping.east), mapping.east);
    const velocity = speedMs(numberFrom(row, mapping.velocity), mapping.velocity);
    const verticalVelocity = speedMs(numberFrom(row, mapping.verticalVelocity), mapping.verticalVelocity);
    const deltaTime = Math.max(0, Math.min(2, time - previousTime));
    previousTime = time;
    const horizontalVelocity = velocity === undefined ? 0 : Math.sqrt(Math.max(0, velocity ** 2 - (verticalVelocity ?? 0) ** 2));
    travelled += horizontalVelocity * deltaTime;
    const projected = offsetCoordinate(
      options.launchLatitude,
      options.launchLongitude,
      north ?? travelled * Math.cos(heading),
      east ?? travelled * Math.sin(heading),
    );
    const validGps = gpsLat !== undefined && gpsLon !== undefined && Math.abs(gpsLat) <= 90 && Math.abs(gpsLon) <= 180 && !(gpsLat === 0 && gpsLon === 0);
    if (validGps) nativeGpsCount += 1;
    rawPoints.push({
      time,
      latitude: validGps ? gpsLat : projected.latitude,
      longitude: validGps ? gpsLon : projected.longitude,
      altitude: /relative|height/i.test(mapping.altitude) ? options.launchAltitude + rawAltitude : rawAltitude,
      velocity,
      verticalVelocity,
      acceleration: accelerationMs2(numberFrom(row, mapping.acceleration), mapping.acceleration),
      pressure: numberFrom(row, mapping.pressure),
      temperature: numberFrom(row, mapping.temperature),
      battery: numberFrom(row, mapping.battery),
    });
  }
  if (rawPoints.length < 2) throw new Error("The selected columns did not contain enough numeric flight samples.");
  const timeOrigin = rawPoints[0].time;
  const normalized = rawPoints.map((point) => ({ ...point, time: point.time - timeOrigin }));
  const stride = Math.max(1, Math.ceil(normalized.length / 5000));
  const points = normalized.filter((_, index) => index % stride === 0 || index === normalized.length - 1);
  const hasGps = nativeGpsCount >= Math.min(3, rawPoints.length * 0.5);
  const warnings: string[] = [];
  if (!hasGps) warnings.push("No continuous GNSS coordinates were found. The ground track is reconstructed from available offsets or speed and the selected launch heading.");
  if (!mapping.velocity && !mapping.verticalVelocity) warnings.push("No velocity channel was mapped; speed is unavailable and non-GPS samples are shown vertically above the launch site.");
  return { columns, mapping, points, summary: summariseFlight(points, hasGps), sourceRows: rows.length, warnings };
}

export function simulatedGroundTrack(samples: Array<{ time: number; altitude: number; velocity: number; verticalVelocity: number }>, site: { latitude: number; longitude: number; altitude: number; headingDegrees: number }) {
  let distance = 0;
  return samples.map((sample, index) => {
    const previous = samples[index - 1];
    const deltaTime = previous ? Math.max(0, sample.time - previous.time) : 0;
    distance += Math.sqrt(Math.max(0, sample.velocity ** 2 - sample.verticalVelocity ** 2)) * deltaTime;
    const heading = site.headingDegrees * Math.PI / 180;
    const location = offsetCoordinate(site.latitude, site.longitude, distance * Math.cos(heading), distance * Math.sin(heading));
    return { time: sample.time, altitude: site.altitude + sample.altitude, ...location };
  });
}
