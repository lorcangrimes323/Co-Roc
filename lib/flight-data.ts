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
  sourceFormat?: "CFL" | "CSV";
  firmwareVersion?: string;
  events?: CatsFlightEvent[];
};

export type CatsFlightEvent = {
  time: number;
  name: string;
  action: number;
  argument: number;
};

export type CatsCflInspection = {
  firmwareVersion: string;
  sampleCount: number;
  duration: number;
  launchLatitude?: number;
  launchLongitude?: number;
  channels: string[];
  events: CatsFlightEvent[];
};

type TimedValue<T> = T & { ts: number };
type CatsCflLog = {
  firmwareVersion: string;
  firstTimestamp: number;
  lastTimestamp: number;
  liftoffTimestamp: number;
  flight: TimedValue<{ height: number; velocity: number; acceleration: number }>[];
  filtered: TimedValue<{ height: number; acceleration: number }>[];
  barometer: TimedValue<{ pressure: number; temperature: number }>[];
  gnss: TimedValue<{ latitude: number; longitude: number; satellites: number }>[];
  voltage: TimedValue<{ voltage: number }>[];
  events: TimedValue<{ event: number; action: number; argument: number }>[];
  truncated: boolean;
};

const CATS_RECORD = {
  IMU: 1 << 4,
  BAROMETER: 1 << 5,
  FLIGHT: 1 << 6,
  ORIENTATION: 1 << 7,
  FILTERED: 1 << 8,
  FLIGHT_STATE: 1 << 9,
  EVENT: 1 << 10,
  ERROR: 1 << 11,
  GNSS: 1 << 12,
  VOLTAGE: 1 << 13,
} as const;

const CATS_RECORD_BYTES = new Map<number, number>([
  [CATS_RECORD.IMU, 12], [CATS_RECORD.BAROMETER, 8], [CATS_RECORD.FLIGHT, 12],
  [CATS_RECORD.ORIENTATION, 8], [CATS_RECORD.FILTERED, 8], [CATS_RECORD.FLIGHT_STATE, 4],
  [CATS_RECORD.EVENT, 8], [CATS_RECORD.ERROR, 4], [CATS_RECORD.GNSS, 9], [CATS_RECORD.VOLTAGE, 2],
]);

const CATS_EVENT_NAMES: Record<number, string> = {
  0: "Moving", 1: "Ready", 2: "Liftoff", 3: "Burnout", 4: "Apogee",
  5: "Main deployment", 6: "Touchdown", 7: "Custom event 1", 8: "Custom event 2",
};

const CATS_NATIVE_COLUMNS = [
  "Elapsed time (s)", "Flight height AGL (m)", "Velocity (m/s)", "Acceleration (m/s²)",
  "GNSS latitude", "GNSS longitude", "Barometric pressure (Pa)", "Temperature (°C)", "Battery voltage (V)",
];

function catsView(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readCatsVersion(view: DataView) {
  let offset = 0;
  let firmwareVersion = "";
  while (offset < Math.min(view.byteLength, 32)) {
    const code = view.getUint8(offset);
    offset += 1;
    if (code === 0) break;
    if (code < 32 || code > 126) throw new Error("This file does not contain a valid CATS CFL header.");
    firmwareVersion += String.fromCharCode(code);
  }
  if (!/^\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(firmwareVersion) || offset > view.byteLength || view.getUint8(offset - 1) !== 0) {
    throw new Error("This file does not contain a valid CATS CFL header.");
  }
  return { firmwareVersion, offset };
}

export function isCatsCfl(input: ArrayBuffer | Uint8Array) {
  try {
    const view = catsView(input);
    const { offset } = readCatsVersion(view);
    if (offset + 8 > view.byteLength) return false;
    const recordType = view.getUint32(offset + 4, true) & ~0x0f;
    return CATS_RECORD_BYTES.has(recordType);
  } catch {
    return false;
  }
}

function parseCatsCfl(input: ArrayBuffer | Uint8Array): CatsCflLog {
  const view = catsView(input);
  const header = readCatsVersion(view);
  let offset = header.offset;
  let firstTimestamp = -1;
  let lastTimestamp = -1;
  let truncated = false;
  const flight: CatsCflLog["flight"] = [];
  const filtered: CatsCflLog["filtered"] = [];
  const barometer: CatsCflLog["barometer"] = [];
  const gnss: CatsCflLog["gnss"] = [];
  const voltage: CatsCflLog["voltage"] = [];
  const events: CatsCflLog["events"] = [];

  while (offset + 8 <= view.byteLength) {
    const ts = view.getUint32(offset, true);
    const recordType = view.getUint32(offset + 4, true) & ~0x0f;
    const payloadBytes = CATS_RECORD_BYTES.get(recordType);
    offset += 8;
    if (!payloadBytes) throw new Error(`Unsupported CATS CFL record type 0x${recordType.toString(16)} at byte ${offset - 8}.`);
    if (offset + payloadBytes > view.byteLength) { truncated = true; break; }
    if (firstTimestamp < 0) firstTimestamp = ts;
    lastTimestamp = ts;
    if (recordType === CATS_RECORD.BAROMETER) {
      barometer.push({ ts, pressure: view.getUint32(offset, true), temperature: view.getUint32(offset + 4, true) / 100 });
    } else if (recordType === CATS_RECORD.FLIGHT) {
      flight.push({ ts, height: view.getFloat32(offset, true), velocity: view.getFloat32(offset + 4, true), acceleration: view.getFloat32(offset + 8, true) });
    } else if (recordType === CATS_RECORD.FILTERED) {
      filtered.push({ ts, height: view.getFloat32(offset, true), acceleration: view.getFloat32(offset + 4, true) });
    } else if (recordType === CATS_RECORD.EVENT) {
      events.push({ ts, event: view.getUint32(offset, true), action: view.getUint16(offset + 4, true), argument: view.getUint16(offset + 6, true) });
    } else if (recordType === CATS_RECORD.GNSS) {
      gnss.push({ ts, latitude: view.getFloat32(offset, true), longitude: view.getFloat32(offset + 4, true), satellites: view.getUint8(offset + 8) });
    } else if (recordType === CATS_RECORD.VOLTAGE) {
      voltage.push({ ts, voltage: view.getUint16(offset, true) / 1000 });
    }
    offset += payloadBytes;
  }
  if (!flight.length && !filtered.length) throw new Error("The CFL contains no CATS flight-estimate records.");
  const liftoffTimestamp = events.find((event) => event.event === 2)?.ts ?? firstTimestamp;
  return { firmwareVersion: header.firmwareVersion, firstTimestamp, lastTimestamp, liftoffTimestamp, flight, filtered, barometer, gnss, voltage, events, truncated };
}

function validCatsGnss(reading: { latitude: number; longitude: number; satellites: number } | undefined) {
  return Boolean(reading && reading.satellites >= 4 && Math.abs(reading.latitude) <= 90 && Math.abs(reading.longitude) <= 180
    && !(reading.latitude === 0 && reading.longitude === 0));
}

function catsEventList(log: CatsCflLog): CatsFlightEvent[] {
  const distinct = new Map<string, CatsCflLog["events"][number]>();
  for (const event of log.events) {
    const key = String(event.event);
    if (!distinct.has(key)) distinct.set(key, event);
  }
  return [...distinct.values()].map((event) => ({
    time: (event.ts - log.liftoffTimestamp) / 1000,
    name: CATS_EVENT_NAMES[event.event] ?? `Event ${event.event}`,
    action: event.action,
    argument: event.argument,
  }));
}

export function inspectCatsCfl(input: ArrayBuffer | Uint8Array): CatsCflInspection {
  const log = parseCatsCfl(input);
  const launch = log.gnss.find(validCatsGnss);
  const channels = ["Filtered altitude", "Velocity", "Acceleration"];
  if (log.gnss.some(validCatsGnss)) channels.push("GNSS position");
  if (log.barometer.length) channels.push("Pressure", "Temperature");
  if (log.voltage.length) channels.push("Battery voltage");
  return {
    firmwareVersion: log.firmwareVersion,
    sampleCount: log.flight.length || log.filtered.length,
    duration: Math.max(0, (log.lastTimestamp - log.firstTimestamp) / 1000),
    launchLatitude: launch?.latitude,
    launchLongitude: launch?.longitude,
    channels,
    events: catsEventList(log),
  };
}

export function buildCatsCflFlightData(input: ArrayBuffer | Uint8Array, options: FlightImportOptions): ParsedFlightData {
  const log = parseCatsCfl(input);
  const base = log.flight.length ? log.flight : log.filtered.map((sample) => ({ ...sample, velocity: 0 }));
  const stride = Math.max(1, Math.ceil(base.length / 5000));
  const sampled = base.filter((_, index) => index % stride === 0 || index === base.length - 1);
  let gnssIndex = 0;
  let barometerIndex = 0;
  let voltageIndex = 0;
  const points = sampled.map((sample) => {
    while (gnssIndex + 1 < log.gnss.length && log.gnss[gnssIndex + 1].ts <= sample.ts) gnssIndex += 1;
    while (barometerIndex + 1 < log.barometer.length && log.barometer[barometerIndex + 1].ts <= sample.ts) barometerIndex += 1;
    while (voltageIndex + 1 < log.voltage.length && log.voltage[voltageIndex + 1].ts <= sample.ts) voltageIndex += 1;
    const before = log.gnss[gnssIndex];
    const after = log.gnss[Math.min(gnssIndex + 1, log.gnss.length - 1)];
    let latitude = options.launchLatitude;
    let longitude = options.launchLongitude;
    if (validCatsGnss(before)) {
      latitude = before.latitude;
      longitude = before.longitude;
      if (after !== before && validCatsGnss(after) && after.ts > before.ts) {
        const fraction = Math.max(0, Math.min(1, (sample.ts - before.ts) / (after.ts - before.ts)));
        latitude += (after.latitude - before.latitude) * fraction;
        longitude += (after.longitude - before.longitude) * fraction;
      }
    }
    const barometer = log.barometer[barometerIndex];
    const voltage = log.voltage[voltageIndex];
    return {
      time: (sample.ts - log.liftoffTimestamp) / 1000,
      latitude,
      longitude,
      altitude: options.launchAltitude + sample.height,
      velocity: Math.abs(sample.velocity),
      verticalVelocity: sample.velocity,
      acceleration: sample.acceleration,
      pressure: barometer?.pressure,
      temperature: barometer?.temperature,
      battery: voltage?.voltage,
    } satisfies FlightPoint;
  });
  const hasGps = log.gnss.filter(validCatsGnss).length >= 3;
  const warnings: string[] = [];
  if (!hasGps) warnings.push("The CFL contains no continuous valid GNSS fix. Its measured altitude is shown above the selected launch datum without an inferred horizontal path.");
  if (log.truncated) warnings.push("The last CFL record was incomplete; all complete records before it were retained.");
  return {
    columns: CATS_NATIVE_COLUMNS,
    mapping: {
      time: CATS_NATIVE_COLUMNS[0], altitude: CATS_NATIVE_COLUMNS[1], velocity: CATS_NATIVE_COLUMNS[2],
      verticalVelocity: CATS_NATIVE_COLUMNS[2], acceleration: CATS_NATIVE_COLUMNS[3], latitude: CATS_NATIVE_COLUMNS[4],
      longitude: CATS_NATIVE_COLUMNS[5], pressure: CATS_NATIVE_COLUMNS[6], temperature: CATS_NATIVE_COLUMNS[7], battery: CATS_NATIVE_COLUMNS[8],
    },
    points,
    summary: summariseFlight(points, hasGps),
    sourceRows: base.length,
    warnings,
    sourceFormat: "CFL",
    firmwareVersion: log.firmwareVersion,
    events: catsEventList(log),
  };
}

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
  return { columns, mapping, points, summary: summariseFlight(points, hasGps), sourceRows: rows.length, warnings, sourceFormat: "CSV" };
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
