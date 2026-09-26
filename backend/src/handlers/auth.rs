use axum::{extract::State, Json};
use serde_json::json;
use validator::Validate;

use crate::{
    auth::{hash_password, issue_token, verify_password, AuthUser},
    error::{ApiError, ApiResult},
    models::{LoginRequest, PublicUser, RegisterRequest, User},
    state::AppState,
};

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    req.validate()?;

    let existing: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(&req.email)
            .fetch_optional(&state.db)
            .await?;
    if existing.is_some() {
        return Err(ApiError::Conflict("email already registered".into()));
    }

    let hash = hash_password(&req.password).map_err(ApiError::Other)?;
    // Deterministic-looking but varied avatar color from a small travel-themed palette.
    let palette = ["#1F6B66", "#E4A33B", "#C0503A", "#3B5B92", "#7A5C99"];
    let color = palette[(req.email.bytes().map(|b| b as usize).sum::<usize>()) % palette.len()];

    let user: User = sqlx::query_as(
        r#"INSERT INTO users (name, email, password_hash, avatar_color)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, password_hash, avatar_color, created_at"#,
    )
    .bind(&req.name)
    .bind(&req.email)
    .bind(&hash)
    .bind(color)
    .fetch_one(&state.db)
    .await?;

    let token = issue_token(state.jwt_secret.as_bytes(), user.id, &user.email).map_err(ApiError::Other)?;
    let public: PublicUser = user.into();
    Ok(Json(json!({ "token": token, "user": public })))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    req.validate()?;

    let user: User = sqlx::query_as(
        "SELECT id, name, email, password_hash, avatar_color, created_at FROM users WHERE email = $1",
    )
    .bind(&req.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::Unauthorized)?;

    if !verify_password(&req.password, &user.password_hash) {
        return Err(ApiError::Unauthorized);
    }

    let token = issue_token(state.jwt_secret.as_bytes(), user.id, &user.email).map_err(ApiError::Other)?;
    let public: PublicUser = user.into();
    Ok(Json(json!({ "token": token, "user": public })))
}

pub async fn me(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<PublicUser>> {
    let user: User = sqlx::query_as(
        "SELECT id, name, email, password_hash, avatar_color, created_at FROM users WHERE id = $1",
    )
    .bind(auth.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::Unauthorized)?;
    Ok(Json(user.into()))
}
