package app.rocketconfiguration.simulation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.AbstractModule;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import info.openrocket.core.database.ComponentPresetDao;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.logging.Warning;
import info.openrocket.core.models.wind.WindModel;
import info.openrocket.core.models.wind.WindModelType;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.simulation.FlightDataBranch;
import info.openrocket.core.simulation.FlightDataType;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.simulation.SimulationOptions;
import info.openrocket.core.startup.OpenRocketCore;
import info.openrocket.core.util.GeodeticComputationStrategy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

public final class SimulationServer {
    private static final int MAX_ORK_BYTES = 25 * 1024 * 1024;
    private static final int MAX_SAMPLES = 500;
    private static final Object SIMULATION_LOCK = new Object();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SERVICE_TOKEN = System.getenv().getOrDefault("SIMULATION_SERVICE_TOKEN", "");

    private SimulationServer() {}

    public static void main(String[] args) throws IOException {
        OpenRocketCore.initialize(new PluginModule(), new AbstractModule() {
            @Override
            protected void configure() {
                bind(ComponentPresetDao.class).to(ComponentPresetDatabase.class);
            }
        });
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", SimulationServer::health);
        server.createContext("/simulate", SimulationServer::simulate);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.printf("OpenRocket Core 24.12 service listening on %d%n", port);
    }

    private static void health(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            send(exchange, 405, Map.of("error", "Method not allowed"));
            return;
        }
        send(exchange, 200, Map.of(
                "status", "ready",
                "engine", "OpenRocket Core",
                "engineVersion", "24.12",
                "serialized", true
        ));
    }

    private static void simulate(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            send(exchange, 405, Map.of("error", "Method not allowed"));
            return;
        }
        if (!authorized(exchange)) {
            send(exchange, 401, Map.of("error", "Invalid simulation service token"));
            return;
        }
        byte[] ork = exchange.getRequestBody().readNBytes(MAX_ORK_BYTES + 1);
        if (ork.length == 0 || ork.length > MAX_ORK_BYTES) {
            send(exchange, 413, Map.of("error", "A non-empty .ork file no larger than 25 MB is required"));
            return;
        }
        int requestedIndex;
        Map<String, Object> overrides;
        try {
            requestedIndex = simulationIndex(exchange.getRequestURI().getRawQuery());
            overrides = simulationOverrides(exchange);
        } catch (IllegalArgumentException error) {
            send(exchange, 400, Map.of("error", error.getMessage()));
            return;
        }

        try {
            Map<String, Object> result;
            synchronized (SIMULATION_LOCK) {
                result = run(ork, requestedIndex, overrides);
            }
            send(exchange, 200, result);
        } catch (IndexOutOfBoundsException error) {
            send(exchange, 404, Map.of("error", error.getMessage()));
        } catch (Exception error) {
            error.printStackTrace();
            send(exchange, 422, Map.of(
                    "error", "OpenRocket could not run this simulation",
                    "detail", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()
            ));
        }
    }

    private static Map<String, Object> run(byte[] ork, int simulationIndex, Map<String, Object> overrides) throws Exception {
        Path temporaryOrk = Files.createTempFile("rocket-configuration-", ".ork");
        OpenRocketDocument document;
        try {
            Files.write(temporaryOrk, ork);
            document = new GeneralRocketLoader(temporaryOrk.toFile()).load();
        } finally {
            Files.deleteIfExists(temporaryOrk);
        }
        if (simulationIndex < 0 || simulationIndex >= document.getSimulationCount()) {
            throw new IndexOutOfBoundsException("Simulation index " + simulationIndex + " does not exist");
        }
        Simulation simulation = document.getSimulation(simulationIndex);
        applyOverrides(simulation, overrides);
        simulation.simulate();
        FlightData data = simulation.getSimulatedData();
        if (data == null || data.getBranchCount() == 0) {
            throw new IllegalStateException("OpenRocket returned no flight data");
        }

        SimulationOptions options = simulation.getOptions();
        FlightDataBranch branch = data.getBranch(0);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("engine", "OpenRocket Core");
        result.put("engineVersion", "24.12");
        result.put("calculatedAt", Instant.now().toString());
        result.put("simulationIndex", simulationIndex);
        result.put("name", stringValue(overrides.get("name"), simulation.getName()));
        result.put("status", simulation.getStatus().name().toLowerCase());
        result.put("branchName", branch.getName());
        result.put("conditions", conditions(options));
        result.put("summary", summary(data, branch));
        result.put("warnings", warnings(data));
        result.put("events", events(branch));
        result.put("series", series(branch));
        return result;
    }

    private static void applyOverrides(Simulation simulation, Map<String, Object> values) {
        if (values.isEmpty()) return;
        SimulationOptions options = simulation.getOptions();
        options.setLaunchRodLength(numberValue(values, "launchRodLength", options.getLaunchRodLength(), 0.01, 1000));
        options.setLaunchIntoWind(booleanValue(values, "launchIntoWind", options.getLaunchIntoWind()));
        options.setLaunchRodAngle(Math.toRadians(numberValue(values, "launchRodAngleDegrees", Math.toDegrees(options.getLaunchRodAngle()), 0, 30)));
        options.setLaunchRodDirection(Math.toRadians(numberValue(values, "launchRodDirectionDegrees", Math.toDegrees(options.getLaunchRodDirection()), 0, 360)));

        String windModel = stringValue(values.get("windModelType"), options.getWindModelType().name());
        WindModelType type = windModel.replace('-', '_').equalsIgnoreCase("MULTI_LEVEL") ? WindModelType.MULTI_LEVEL : WindModelType.AVERAGE;
        options.setWindModelType(type);
        if (type == WindModelType.MULTI_LEVEL && values.get("windLevels") instanceof List<?> levels) {
            options.getMultiLevelWindModel().clearLevels();
            for (Object item : levels) {
                if (!(item instanceof Map<?, ?> level)) continue;
                double altitude = numberValue(level, "altitude", 0, -1000, 100000);
                double speed = numberValue(level, "speed", 0, 0, 300);
                double direction = Math.toRadians(numberValue(level, "directionDegrees", 0, 0, 360));
                double deviation = numberValue(level, "standardDeviation", 0, 0, 100);
                options.getMultiLevelWindModel().addWindLevel(altitude, speed, direction, deviation);
            }
            if (options.getMultiLevelWindModel().getLevels().isEmpty()) {
                options.getMultiLevelWindModel().addWindLevel(0, 0, 0, 0.0);
            }
            String altitudeReference = stringValue(values.get("windAltitudeReference"), "MSL");
            options.getMultiLevelWindModel().setAltitudeReference(
                    altitudeReference.equalsIgnoreCase("AGL") ? WindModel.AltitudeReference.AGL : WindModel.AltitudeReference.MSL);
        } else {
            options.setWindSpeedAverage(numberValue(values, "windSpeed", options.getWindSpeedAverage(), 0, 300));
            options.setWindSpeedDeviation(numberValue(values, "windDeviation", options.getWindSpeedDeviation(), 0, 100));
            options.setWindTurbulenceIntensity(numberValue(values, "windTurbulence", options.getWindTurbulenceIntensity(), 0, 1));
            options.setWindDirection(Math.toRadians(numberValue(values, "windDirectionDegrees", Math.toDegrees(options.getWindDirection()), 0, 360)));
        }

        options.setLaunchAltitude(numberValue(values, "launchAltitude", options.getLaunchAltitude(), -1000, 100000));
        options.setLaunchLatitude(numberValue(values, "launchLatitude", options.getLaunchLatitude(), -90, 90));
        options.setLaunchLongitude(numberValue(values, "launchLongitude", options.getLaunchLongitude(), -180, 180));
        String geodetic = stringValue(values.get("geodeticMethod"), options.getGeodeticComputation().name()).toUpperCase();
        try { options.setGeodeticComputation(GeodeticComputationStrategy.valueOf(geodetic)); }
        catch (IllegalArgumentException ignored) { throw new IllegalArgumentException("Unknown geodetic method: " + geodetic); }

        boolean isa = booleanValue(values, "isaAtmosphere", options.isISAAtmosphere());
        options.setISAAtmosphere(isa);
        if (!isa) {
            options.setLaunchTemperature(numberValue(values, "launchTemperatureC", options.getLaunchTemperature() - 273.15, -90, 70) + 273.15);
            options.setLaunchPressure(numberValue(values, "launchPressureHpa", options.getLaunchPressure() / 100, 100, 1200) * 100);
        }
        options.setTimeStep(numberValue(values, "timeStep", options.getTimeStep(), 0.001, 1));
        options.setMaxSimulationTime(numberValue(values, "maxSimulationTime", options.getMaxSimulationTime(), 1, 86400));
        options.setMaximumStepAngle(Math.toRadians(numberValue(values, "maxStepAngleDegrees", Math.toDegrees(options.getMaximumStepAngle()), 0.01, 30)));
        if (values.containsKey("randomSeed")) options.setRandomSeed((int) numberValue(values, "randomSeed", options.getRandomSeed(), Integer.MIN_VALUE, Integer.MAX_VALUE));
    }

    private static Map<String, Object> conditions(SimulationOptions options) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("launchRodLength", options.getLaunchRodLength());
        values.put("launchIntoWind", options.getLaunchIntoWind());
        values.put("launchRodAngleDegrees", Math.toDegrees(options.getLaunchRodAngle()));
        values.put("launchRodDirectionDegrees", Math.toDegrees(options.getLaunchRodDirection()));
        values.put("windModelType", options.getWindModelType().name());
        values.put("windSpeed", options.getWindSpeedAverage());
        values.put("windDeviation", options.getWindSpeedDeviation());
        values.put("windTurbulence", options.getWindTurbulenceIntensity());
        values.put("windDirectionDegrees", Math.toDegrees(options.getWindDirection()));
        values.put("windAltitudeReference", options.getMultiLevelWindModel().getAltitudeReference().name());
        List<Map<String, Object>> levels = new ArrayList<>();
        for (var level : options.getMultiLevelWindModel().getLevels()) {
            levels.add(Map.of(
                    "altitude", level.getAltitude(),
                    "speed", level.getSpeed(),
                    "directionDegrees", Math.toDegrees(level.getDirection()),
                    "standardDeviation", level.getStandardDeviation()
            ));
        }
        values.put("windLevels", levels);
        values.put("launchAltitude", options.getLaunchAltitude());
        values.put("launchLatitude", options.getLaunchLatitude());
        values.put("launchLongitude", options.getLaunchLongitude());
        values.put("geodeticMethod", options.getGeodeticComputation().name());
        values.put("isaAtmosphere", options.isISAAtmosphere());
        values.put("launchTemperatureC", options.getLaunchTemperature() - 273.15);
        values.put("launchPressureHpa", options.getLaunchPressure() / 100);
        values.put("timeStep", options.getTimeStep());
        values.put("maxSimulationTime", options.getMaxSimulationTime());
        values.put("maxStepAngleDegrees", Math.toDegrees(options.getMaximumStepAngle()));
        values.put("randomSeed", options.getRandomSeed());
        return values;
    }

    private static Map<String, Object> summary(FlightData data, FlightDataBranch branch) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("maxAltitude", finite(data.getMaxAltitude()));
        summary.put("maxVelocity", finite(data.getMaxVelocity()));
        summary.put("maxAcceleration", finite(data.getMaxAcceleration()));
        summary.put("maxMach", finite(data.getMaxMachNumber()));
        summary.put("timeToApogee", finite(data.getTimeToApogee()));
        summary.put("flightTime", finite(data.getFlightTime()));
        summary.put("groundHitVelocity", finite(data.getGroundHitVelocity()));
        summary.put("launchRodVelocity", finite(data.getLaunchRodVelocity()));
        summary.put("deploymentVelocity", finite(data.getDeploymentVelocity()));
        summary.put("optimumDelay", finite(data.getOptimumDelay()));

        FlightEvent railExit = branch.getFirstEvent(FlightEvent.Type.LAUNCHROD);
        int railIndex = nearestIndex(branch, railExit == null ? 0 : railExit.getTime());
        summary.put("railExitStability", value(branch, FlightDataType.TYPE_STABILITY, railIndex));
        summary.put("railExitCg", value(branch, FlightDataType.TYPE_CG_LOCATION, railIndex));
        summary.put("railExitCp", value(branch, FlightDataType.TYPE_CP_LOCATION, railIndex));
        return summary;
    }

    private static List<Map<String, Object>> warnings(FlightData data) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Warning warning : data.getWarningSet()) {
            result.add(Map.of(
                    "type", warning.getClass().getSimpleName(),
                    "priority", warning.getPriority().name(),
                    "description", warning.toString()
            ));
        }
        return result;
    }

    private static List<Map<String, Object>> events(FlightDataBranch branch) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (FlightEvent event : branch.getEvents()) {
            result.add(Map.of("type", event.getType().name().toLowerCase(), "time", event.getTime()));
        }
        return result;
    }

    private static List<Map<String, Object>> series(FlightDataBranch branch) {
        List<Map<String, Object>> result = new ArrayList<>();
        int length = branch.getLength();
        int stride = Math.max(1, (int) Math.ceil(length / (double) MAX_SAMPLES));
        for (int index = 0; index < length; index += stride) {
            result.add(sample(branch, index));
        }
        if (length > 0 && (length - 1) % stride != 0) result.add(sample(branch, length - 1));
        return result;
    }

    private static Map<String, Object> sample(FlightDataBranch branch, int index) {
        Map<String, Object> sample = new LinkedHashMap<>();
        sample.put("time", value(branch, FlightDataType.TYPE_TIME, index));
        sample.put("altitude", value(branch, FlightDataType.TYPE_ALTITUDE, index));
        sample.put("velocity", value(branch, FlightDataType.TYPE_VELOCITY_TOTAL, index));
        sample.put("verticalVelocity", value(branch, FlightDataType.TYPE_VELOCITY_Z, index));
        sample.put("acceleration", value(branch, FlightDataType.TYPE_ACCELERATION_TOTAL, index));
        sample.put("mach", value(branch, FlightDataType.TYPE_MACH_NUMBER, index));
        sample.put("stability", value(branch, FlightDataType.TYPE_STABILITY, index));
        sample.put("cg", value(branch, FlightDataType.TYPE_CG_LOCATION, index));
        sample.put("cp", value(branch, FlightDataType.TYPE_CP_LOCATION, index));
        return sample;
    }

    private static int nearestIndex(FlightDataBranch branch, double time) {
        int nearest = 0;
        double difference = Double.POSITIVE_INFINITY;
        for (int index = 0; index < branch.getLength(); index++) {
            Double value = branch.getByIndex(FlightDataType.TYPE_TIME, index);
            if (value != null && Double.isFinite(value) && Math.abs(value - time) < difference) {
                difference = Math.abs(value - time);
                nearest = index;
            }
        }
        return nearest;
    }

    private static Object value(FlightDataBranch branch, FlightDataType type, int index) {
        return finite(branch.getByIndex(type, index));
    }

    private static Object finite(Double value) {
        return value != null && Double.isFinite(value) ? value : null;
    }

    private static int simulationIndex(String query) {
        if (query == null || query.isBlank()) return 0;
        for (String item : query.split("&")) {
            String[] parts = item.split("=", 2);
            if (parts.length == 2 && "index".equals(parts[0])) {
                try {
                    return Integer.parseInt(parts[1]);
                } catch (NumberFormatException error) {
                    throw new IllegalArgumentException("Simulation index must be an integer");
                }
            }
        }
        return 0;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> simulationOverrides(HttpExchange exchange) {
        String encoded = exchange.getRequestHeaders().getFirst("X-OpenRocket-Options");
        if (encoded == null || encoded.isBlank()) return Map.of();
        try {
            byte[] json = Base64.getUrlDecoder().decode(encoded);
            Object value = JSON.readValue(json, Object.class);
            if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("Simulation options must be a JSON object");
            return (Map<String, Object>) map;
        } catch (IllegalArgumentException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalArgumentException("Simulation options are not valid JSON");
        }
    }

    private static double numberValue(Map<?, ?> values, String key, double fallback, double minimum, double maximum) {
        Object raw = values.get(key);
        if (raw == null) return fallback;
        final double parsed;
        try { parsed = raw instanceof Number number ? number.doubleValue() : Double.parseDouble(String.valueOf(raw)); }
        catch (NumberFormatException error) { throw new IllegalArgumentException(key + " must be a number"); }
        if (!Double.isFinite(parsed) || parsed < minimum || parsed > maximum) {
            throw new IllegalArgumentException(key + " must be between " + minimum + " and " + maximum);
        }
        return parsed;
    }

    private static boolean booleanValue(Map<?, ?> values, String key, boolean fallback) {
        Object raw = values.get(key);
        if (raw == null) return fallback;
        if (raw instanceof Boolean value) return value;
        if ("true".equalsIgnoreCase(String.valueOf(raw))) return true;
        if ("false".equalsIgnoreCase(String.valueOf(raw))) return false;
        throw new IllegalArgumentException(key + " must be true or false");
    }

    private static String stringValue(Object value, String fallback) {
        String result = value == null ? "" : String.valueOf(value).trim();
        return result.isEmpty() ? fallback : result;
    }

    private static boolean authorized(HttpExchange exchange) {
        if (SERVICE_TOKEN.isBlank()) return true;
        return ("Bearer " + SERVICE_TOKEN).equals(exchange.getRequestHeaders().getFirst("Authorization"));
    }

    private static void send(HttpExchange exchange, int status, Object payload) throws IOException {
        byte[] body = JSON.writeValueAsBytes(payload);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
