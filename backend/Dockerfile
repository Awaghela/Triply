FROM rust:1.90-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
COPY migrations ./migrations
# No SQLX_OFFLINE / query cache needed: every query in this codebase uses
# sqlx's runtime API (query/query_as/query_scalar with .bind(...)), not the
# compile-time-checked query!/query_as! macros, so building this image never
# needs a live database connection.
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/triply-backend /app/triply-backend
COPY migrations ./migrations
EXPOSE 8080
CMD ["/app/triply-backend"]
