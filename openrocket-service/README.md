# OpenRocket simulation service

This service runs the official OpenRocket Core 24.12 simulation engine. It does not reimplement or approximate OpenRocket's flight model.

## API

- `GET /health` returns the engine and readiness state.
- `POST /simulate?index=0` accepts the raw bytes of an `.ork` file and returns OpenRocket summary values, warnings, events and sampled time-series data.
- `X-OpenRocket-Options` can contain URL-safe base64 JSON overrides for the case name, launch guide, average or multi-level wind, launch site, geodetic calculation, atmosphere, time step, maximum duration, maximum step angle and random seed. Values are validated before they reach Core.

Set `SIMULATION_SERVICE_TOKEN` in production. Clients then send the same value as a bearer token. The service accepts files up to 25 MB and serializes simulation execution because OpenRocket simulation objects are not thread-safe.

## Run locally

```powershell
mvn --file openrocket-service/pom.xml package
$env:PORT = "8080"
java -jar openrocket-service/target/openrocket-service-0.1.0.jar
```

Or build and run the included Docker image. A production deployment needs a Java-capable container host; the Cloudflare website calls it server-to-server.

Configure the website with `OPENROCKET_SIM_URL` and `OPENROCKET_SIM_TOKEN`. On localhost the website automatically connects to `http://127.0.0.1:8080`; local demo runs are deliberately not stored. Authenticated project runs are stored against the exact ORK version and SHA-256.

OpenRocket Core is licensed under GPL-3.0. Deployments that distribute this combined service must comply with that licence.
