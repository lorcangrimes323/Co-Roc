import { env } from "cloudflare:workers";

type SimulationEnvironment = {
  DB: D1Database;
  FILES: R2Bucket;
  OPENROCKET_SIM_URL?: string;
  OPENROCKET_SIM_TOKEN?: string;
};

export function getSimulationEnvironment() {
  return env as unknown as SimulationEnvironment;
}

export async function ensureSimulationSchema() {
  const { DB } = getSimulationEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      ork_version INTEGER NOT NULL,
      ork_sha256 TEXT NOT NULL,
      simulation_index INTEGER NOT NULL,
      simulation_name TEXT NOT NULL,
      engine TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      result_object_key TEXT NOT NULL UNIQUE,
      max_altitude REAL,
      max_velocity REAL,
      max_acceleration REAL,
      max_mach REAL,
      warning_count INTEGER DEFAULT 0 NOT NULL,
      run_by_name TEXT NOT NULL,
      run_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS simulation_runs_project_idx
      ON simulation_runs (project_id, created_at)`),
  ]);
}
