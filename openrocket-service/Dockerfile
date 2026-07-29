FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /source
COPY pom.xml .
COPY src src
RUN mvn --batch-mode package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /service
COPY --from=build /source/target/openrocket-service-0.1.0.jar service.jar
ENV PORT=8080
EXPOSE 8080
USER 10001
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/service/service.jar"]
