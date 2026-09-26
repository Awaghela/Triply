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
    models::{CreateTripRequest, InviteMemberRequest, MemberRole, Trip, TripMember},
    state::AppState,
    ws,
};

pub async fn list_trips(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<Trip>>> {
    let trips: Vec<Trip> = sqlx::query_as(
        r#"SELECT t.id, t.name, t.description, t.destination, t.cover_color,
                  t.start_date, t.end_date, t.currency, t.created_by, t.created_at, t.updated_at
           FROM trips t
           JOIN trip_members m ON m.trip_id = t.id
           WHERE m.user_id = $1
           ORDER BY t.created_at DESC"#,
    )
    .bind(auth.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(trips))
}

pub async fn create_trip(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateTripRequest>,
) -> ApiResult<Json<Trip>> {
    req.validate()?;

    let mut tx = state.db.begin().await?;

    let trip: Trip = sqlx::query_as(
        r#"INSERT INTO trips (name, description, destination, cover_color, start_date, end_date, currency, created_by)
           VALUES ($1, $2, $3, COALESCE($4, '#E4A33B'), $5, $6, COALESCE($7, 'USD'), $8)
           RETURNING id, name, description, destination, cover_color, start_date, end_date, currency, created_by, created_at, updated_at"#,
    )
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.destination)
    .bind(&req.cover_color)
    .bind(req.start_date)
    .bind(req.end_date)
    .bind(&req.currency)
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(r#"INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, 'owner')"#)
        .bind(trip.id)
        .bind(auth.id)
        .execute(&mut *tx)
        .await?;

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip.id,
        Some(auth.id),
        "trip.created",
        json!({ "name": trip.name }),
    )
    .await?;

    tx.commit().await?;
    Ok(Json(trip))
}

pub async fn get_trip(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Trip>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;
    let trip: Trip = sqlx::query_as(
        r#"SELECT id, name, description, destination, cover_color, start_date, end_date, currency, created_by, created_at, updated_at
           FROM trips WHERE id = $1"#,
    )
    .bind(trip_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("trip not found".into()))?;
    Ok(Json(trip))
}

pub async fn list_members(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Vec<TripMember>>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;
    let members: Vec<TripMember> = sqlx::query_as(
        r#"SELECT m.id, m.trip_id, m.user_id, m.role, m.joined_at,
                  u.name, u.email, u.avatar_color
           FROM trip_members m JOIN users u ON u.id = m.user_id
           WHERE m.trip_id = $1
           ORDER BY m.joined_at ASC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(members))
}

/// Invites a member by email. If the user already has an account, they're
/// added directly; otherwise a pending invite row is created (in a real
/// deployment this would also send an email with a signup+accept link).
pub async fn invite_member(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
    Json(req): Json<InviteMemberRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    req.validate()?;
    authz::require_admin(&state.db, trip_id, auth.id).await?;

    let role = req.role.unwrap_or(MemberRole::Member);
    let mut tx = state.db.begin().await?;

    let existing_user: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&mut *tx)
        .await?;

    let result = if let Some(user_id) = existing_user {
        let already: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2",
        )
        .bind(trip_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;
        if already.is_some() {
            return Err(ApiError::Conflict("user is already a member".into()));
        }
        sqlx::query("INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3)")
            .bind(trip_id)
            .bind(user_id)
            .bind(role)
            .execute(&mut *tx)
            .await?;

        crate::activity::record(
            &mut tx,
            state.activity_hmac_secret.as_slice(),
            trip_id,
            Some(auth.id),
            "member.added",
            json!({ "email": req.email }),
        )
        .await?;

        json!({ "status": "added", "email": req.email })
    } else {
        let token = Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO trip_invites (trip_id, email, role, token, invited_by)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(trip_id)
        .bind(&req.email)
        .bind(role)
        .bind(&token)
        .bind(auth.id)
        .execute(&mut *tx)
        .await?;

        crate::activity::record(
            &mut tx,
            state.activity_hmac_secret.as_slice(),
            trip_id,
            Some(auth.id),
            "member.invited",
            json!({ "email": req.email }),
        )
        .await?;

        json!({ "status": "invited", "email": req.email, "invite_token": token })
    };

    tx.commit().await?;
    ws::broadcast(&state, trip_id, "member.changed", result.clone());
    Ok(Json(result))
}

pub async fn remove_member(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((trip_id, member_user_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_admin(&state.db, trip_id, auth.id).await?;

    if member_user_id == auth.id {
        return Err(ApiError::BadRequest(
            "use the leave-trip action to remove yourself".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let deleted = sqlx::query("DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2")
        .bind(trip_id)
        .bind(member_user_id)
        .execute(&mut *tx)
        .await?;

    if deleted.rows_affected() == 0 {
        return Err(ApiError::NotFound("member not found".into()));
    }

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "member.removed",
        json!({ "user_id": member_user_id }),
    )
    .await?;

    tx.commit().await?;
    ws::broadcast(&state, trip_id, "member.changed", json!({ "removed": member_user_id }));
    Ok(Json(json!({ "status": "removed" })))
}
