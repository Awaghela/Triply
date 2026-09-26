use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct WsEvent {
    pub trip_id: Uuid,
    pub event: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub trip_id: Uuid,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, q.trip_id))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, trip_id: Uuid) {
    let mut rx = state.ws_tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(evt) if evt.trip_id == trip_id => {
                        let payload = serde_json::to_string(&evt).unwrap_or_default();
                        if socket.send(Message::Text(payload)).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => continue, // clients don't send us anything meaningful
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

pub fn broadcast(state: &AppState, trip_id: Uuid, event: &str, payload: serde_json::Value) {
    let _ = state.ws_tx.send(WsEvent {
        trip_id,
        event: event.to_string(),
        payload,
    });
}
