use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// `sqlx(rename_all)` controls how this enum maps to/from the Postgres
// `member_role`/`split_type` types (used by `.bind()`/`FromRow`).
// `serde(rename_all)` separately controls how it maps to/from JSON (used by
// every request/response body). Both are needed -- without the serde one,
// serde falls back to matching the literal Rust identifiers ("Equal",
// "Percentage", ...), which rejects the lowercase strings ("equal",
// "percentage", ...) every client in this repo (frontend, seed script,
// curl examples) actually sends.
#[derive(Debug, Serialize, Deserialize, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "member_role", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MemberRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Serialize, Deserialize, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "split_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SplitType {
    Equal,
    Percentage,
    Custom,
    Selected,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub avatar_color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub avatar_color: String,
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        PublicUser {
            id: u.id,
            name: u.name,
            email: u.email,
            avatar_color: u.avatar_color,
        }
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Trip {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub destination: Option<String>,
    pub cover_color: String,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub currency: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TripMember {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub user_id: Uuid,
    pub role: MemberRole,
    pub joined_at: DateTime<Utc>,
    pub name: String,
    pub email: String,
    pub avatar_color: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItineraryItem {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub day_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub category: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Expense {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub description: String,
    pub amount: BigDecimal,
    pub currency: String,
    pub category: String,
    pub paid_by: Uuid,
    pub split_type: SplitType,
    pub receipt_url: Option<String>,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ExpenseSplit {
    pub id: Uuid,
    pub expense_id: Uuid,
    pub user_id: Uuid,
    pub amount: BigDecimal,
    pub percentage: Option<BigDecimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Settlement {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub from_user: Uuid,
    pub to_user: Uuid,
    pub amount: BigDecimal,
    pub note: Option<String>,
    pub settled_at: DateTime<Utc>,
    pub created_by: Uuid,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ActivityLogEntry {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub metadata: serde_json::Value,
    pub seq: i64,
    pub prev_hash: String,
    pub hash: String,
    pub created_at: DateTime<Utc>,
}

// ---- Request DTOs ----

#[derive(Debug, Deserialize, validator::Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 1, max = 80))]
    pub name: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
}

#[derive(Debug, Deserialize, validator::Validate)]
pub struct LoginRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1))]
    pub password: String,
}

#[derive(Debug, Deserialize, validator::Validate)]
pub struct CreateTripRequest {
    #[validate(length(min = 1, max = 120))]
    pub name: String,
    pub description: Option<String>,
    pub destination: Option<String>,
    pub cover_color: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub currency: Option<String>,
}

#[derive(Debug, Deserialize, validator::Validate)]
pub struct InviteMemberRequest {
    #[validate(email)]
    pub email: String,
    pub role: Option<MemberRole>,
}

#[derive(Debug, Deserialize, validator::Validate)]
pub struct CreateItineraryItemRequest {
    pub day_number: i32,
    #[validate(length(min = 1, max = 160))]
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SplitInput {
    pub user_id: Uuid,
    /// For `percentage` splits: 0-100. For `custom` splits: an exact amount.
    /// Ignored for `equal` and `selected`.
    pub value: Option<BigDecimal>,
}

#[derive(Debug, Deserialize, validator::Validate)]
pub struct CreateExpenseRequest {
    #[validate(length(min = 1, max = 200))]
    pub description: String,
    pub amount: BigDecimal,
    pub currency: Option<String>,
    pub category: Option<String>,
    pub paid_by: Uuid,
    pub split_type: SplitType,
    /// Participants + per-user split data. Required for all split types;
    /// for `equal`, only `user_id` is used (amount is computed).
    pub splits: Vec<SplitInput>,
    pub receipt_url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, validator::Validate)]
pub struct CreateSettlementRequest {
    pub from_user: Uuid,
    pub to_user: Uuid,
    pub amount: BigDecimal,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BalanceEntry {
    pub user_id: Uuid,
    pub name: String,
    pub avatar_color: String,
    /// Positive = this user is owed money overall. Negative = they owe.
    pub net: BigDecimal,
}

#[derive(Debug, Serialize)]
pub struct SuggestedTransfer {
    pub from_user: Uuid,
    pub from_name: String,
    pub to_user: Uuid,
    pub to_name: String,
    pub amount: BigDecimal,
}

#[derive(Debug, Serialize)]
pub struct TripMetrics {
    pub total_expenses: i64,
    pub total_amount: BigDecimal,
    pub member_count: i64,
    pub avg_expense: BigDecimal,
    pub by_category: Vec<CategoryTotal>,
    pub by_day: Vec<DayTotal>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryTotal {
    pub category: String,
    pub total: BigDecimal,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DayTotal {
    pub date: String,
    pub total: BigDecimal,
}
