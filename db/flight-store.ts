import { env } from "cloudflare:workers";

type FlightEnvironment = { DB: D1Database; FILES: R2Bucket };

export function getFlightEnvironment() {
  return env as unknown as FlightEnvironment;
}

export async function ensureFlightSchema() {
  const { DB } = getFlightEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS flight_records (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      flight_date TEXT,
      computer TEXT DEFAULT 'CATS Vega' NOT NULL,
      source_file_name TEXT NOT NULL,
      source_format TEXT DEFAULT 'CSV' NOT NULL,
      launch_site_name TEXT DEFAULT '' NOT NULL,
      launch_latitude REAL NOT NULL,
      launch_longitude REAL NOT NULL,
      launch_altitude REAL NOT NULL,
      heading_degrees REAL DEFAULT 0 NOT NULL,
      ork_version INTEGER,
      raw_object_key TEXT NOT NULL UNIQUE,
      processed_object_key TEXT NOT NULL UNIQUE,
      source_size_bytes INTEGER DEFAULT 0 NOT NULL,
      processed_size_bytes INTEGER DEFAULT 0 NOT NULL,
      sample_count INTEGER DEFAULT 0 NOT NULL,
      duration REAL DEFAULT 0 NOT NULL,
      max_altitude REAL DEFAULT 0 NOT NULL,
      max_velocity REAL,
      max_acceleration REAL,
      max_distance REAL DEFAULT 0 NOT NULL,
      landing_distance REAL DEFAULT 0 NOT NULL,
      has_gps INTEGER DEFAULT 0 NOT NULL,
      mapping_json TEXT DEFAULT '{}' NOT NULL,
      warnings_json TEXT DEFAULT '[]' NOT NULL,
      imported_by_name TEXT NOT NULL,
      imported_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS flight_records_project_idx ON flight_records (project_id, created_at)`),
  ]);
}
