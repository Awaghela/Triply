use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::{
    auth::AuthUser,
    authz,
    error::{ApiError, ApiResult},
    models::{CreateItineraryItemRequest, ItineraryItem},
    state::AppState,
    ws,
};

pub async fn list_items(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Vec<ItineraryItem>>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;
    let items: Vec<ItineraryItem> = sqlx::query_as(
        r#"SELECT id, trip_id, day_number, title, description, location,
                  start_time, end_time, category, created_by, created_at
           FROM itinerary_items WHERE trip_id = $1
           ORDER BY day_number ASC, start_time ASC NULLS LAST, created_at ASC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(items))
}

pub async fn create_item(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
    Json(req): Json<CreateItineraryItemRequest>,
) -> ApiResult<Json<ItineraryItem>> {
    req.validate()?;
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let mut tx = state.db.begin().await?;
    let item: ItineraryItem = sqlx::query_as(
        r#"INSERT INTO itinerary_items (trip_id, day_number, title, description, location, start_time, end_time, category, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'activity'), $9)
           RETURNING id, trip_id, day_number, title, description, location, start_time, end_time, category, created_by, created_at"#,
    )
    .bind(trip_id)
    .bind(req.day_number)
    .bind(&req.title)
    .bind(&req.description)
    .bind(&req.location)
    .bind(req.start_time)
    .bind(req.end_time)
    .bind(&req.category)
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "itinerary.created",
        json!({ "title": item.title, "day": item.day_number }),
    )
    .await?;

    tx.commit().await?;
    ws::broadcast(&state, trip_id, "itinerary.changed", json!({ "id": item.id }));
    Ok(Json(item))
}

pub async fn delete_item(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((trip_id, item_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let mut tx = state.db.begin().await?;
    let deleted = sqlx::query("DELETE FROM itinerary_items WHERE id = $1 AND trip_id = $2")
        .bind(item_id)
        .bind(trip_id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::NotFound("itinerary item not found".into()));
    }

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "itinerary.deleted",
        json!({ "id": item_id }),
    )
    .await?;

    tx.commit().await?;
    ws::broadcast(&state, trip_id, "itinerary.changed", json!({ "deleted": item_id }));
    Ok(Json(json!({ "status": "deleted" })))
}
