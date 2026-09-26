use sqlx::PgPool;
use uuid::Uuid;

use crate::{error::ApiError, models::MemberRole};

/// Fetches the caller's role on a trip, or 403s if they're not a member.
pub async fn require_member(db: &PgPool, trip_id: Uuid, user_id: Uuid) -> Result<MemberRole, ApiError> {
    let role: Option<MemberRole> =
        sqlx::query_scalar("SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2")
            .bind(trip_id)
            .bind(user_id)
            .fetch_optional(db)
            .await?;
    role.ok_or_else(|| ApiError::Forbidden("you are not a member of this trip".into()))
}

/// 403s unless the caller is `owner` or `admin` on the trip.
pub async fn require_admin(db: &PgPool, trip_id: Uuid, user_id: Uuid) -> Result<MemberRole, ApiError> {
    let role = require_member(db, trip_id, user_id).await?;
    match role {
        MemberRole::Owner | MemberRole::Admin => Ok(role),
        MemberRole::Member => Err(ApiError::Forbidden(
            "this action requires admin or owner role".into(),
        )),
    }
}
