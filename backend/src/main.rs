mod activity;
mod auth;
mod authz;
mod balances;
mod error;
mod handlers;
mod hashchain;
mod idempotency;
mod local_uploads;
mod models;
mod s3_presign;
mod splits;
mod state;
mod ws;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method},
    routing::{delete, get, post, put},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tower_http::{
    cors::{AllowHeaders, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "triply_backend=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://triply:triply@localhost:5432/triply".to_string());
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-jwt-secret-change-me".into());
    let activity_secret =
        std::env::var("ACTIVITY_HMAC_SECRET").unwrap_or_else(|_| "dev-activity-secret-change-me".into());

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;

    let (ws_tx, _) = broadcast::channel(1024);

    let s3 = match std::env::var("AWS_S3_BUCKET") {
        Ok(bucket) if !bucket.is_empty() => {
            let access_key_id = std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_default();
            let secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default();
            let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string());
            if access_key_id.is_empty() || secret_access_key.is_empty() {
                tracing::warn!(
                    "AWS_S3_BUCKET set but AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are missing; \
                     falling back to local-disk receipt storage"
                );
                None
            } else {
                Some(s3_presign::S3Config {
                    access_key_id,
                    secret_access_key,
                    region,
                    bucket,
                })
            }
        }
        _ => {
            tracing::info!(
                "AWS_S3_BUCKET not set; receipts will be stored on local disk \
                 (dev/testing only -- see local_uploads.rs)"
            );
            None
        }
    };

    let local_uploads_dir = std::env::var("LOCAL_UPLOADS_DIR")
        .unwrap_or_else(|_| "./uploads".to_string())
        .into();
    let public_base_url =
        std::env::var("PUBLIC_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());

    if s3.is_none() {
        tokio::fs::create_dir_all(&local_uploads_dir).await?;
    }

    let state = AppState {
        db,
        jwt_secret,
        activity_hmac_secret: Arc::new(activity_secret.into_bytes()),
        ws_tx,
        s3,
        local_uploads_dir,
        public_base_url,
    };

    // CORS_ALLOWED_ORIGINS: comma-separated list of exact origins allowed to
    // call this API (e.g. "https://triply.vercel.app"). Unset/empty falls
    // back to allowing any origin, which is fine for local dev but should
    // always be set to your real frontend origin(s) in production.
    let cors = match std::env::var("CORS_ALLOWED_ORIGINS") {
        Ok(origins) if !origins.trim().is_empty() => {
            let parsed: Vec<HeaderValue> = origins
                .split(',')
                .map(|o| o.trim())
                .filter(|o| !o.is_empty())
                .filter_map(|o| HeaderValue::from_str(o).ok())
                .collect();
            tracing::info!(?parsed, "CORS restricted to configured origins");
            CorsLayer::new()
                .allow_origin(parsed)
                .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PUT, Method::OPTIONS])
                .allow_headers(AllowHeaders::any())
        }
        _ => {
            tracing::warn!(
                "CORS_ALLOWED_ORIGINS not set; allowing any origin. Set this in production."
            );
            CorsLayer::permissive()
        }
    };

    let app = build_router(state, cors);

    // Hosting platforms like Railway/Render/Fly assign a port at runtime
    // via $PORT and expect the app to bind to it; BIND_ADDR (used by
    // docker-compose and local dev) is the fallback for everywhere else.
    let addr = std::env::var("PORT")
        .map(|port| format!("0.0.0.0:{port}"))
        .or_else(|_| std::env::var("BIND_ADDR"))
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    tracing::info!("triply backend listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn build_router(state: AppState, cors: CorsLayer) -> Router {
    use handlers::*;

    let uploads_dir = state.local_uploads_dir.clone();

    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/me", get(auth::me))
        .route("/trips", get(trips::list_trips).post(trips::create_trip))
        .route("/trips/:trip_id", get(trips::get_trip))
        .route("/trips/:trip_id/members", get(trips::list_members).post(trips::invite_member))
        .route("/trips/:trip_id/members/:user_id", delete(trips::remove_member))
        .route(
            "/trips/:trip_id/itinerary",
            get(itinerary::list_items).post(itinerary::create_item),
        )
        .route("/trips/:trip_id/itinerary/:item_id", delete(itinerary::delete_item))
        .route(
            "/trips/:trip_id/expenses",
            get(expenses::list_expenses).post(expenses::create_expense),
        )
        .route("/trips/:trip_id/expenses/:expense_id", delete(expenses::delete_expense))
        .route("/trips/:trip_id/receipts/presign", post(receipts::presign_receipt_upload))
        // Local-mode receipt storage (see local_uploads.rs): only reachable
        // when the server actually falls back to it, but always routed so
        // presign responses referencing it resolve.
        .route(
            "/local-uploads/:trip_id/:filename",
            put(local_uploads::receive_upload).layer(DefaultBodyLimit::max(local_uploads::MAX_UPLOAD_BYTES)),
        )
        .nest_service("/uploads", ServeDir::new(uploads_dir))
        .route("/trips/:trip_id/balances", get(settlements::get_balances))
        .route(
            "/trips/:trip_id/settlements",
            get(settlements::list_settlements).post(settlements::create_settlement),
        )
        .route("/trips/:trip_id/activity", get(activity::list_activity))
        .route("/trips/:trip_id/activity/verify", get(activity::verify_activity))
        .route("/trips/:trip_id/metrics", get(metrics::trip_metrics))
        .route("/ws", get(ws::ws_handler))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}