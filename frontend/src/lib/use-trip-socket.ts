"use client";

import { useEffect, useRef } from "react";
import { wsUrl } from "./api";

interface TripEvent {
  trip_id: string;
  event: string;
  payload: unknown;
}

/** Subscribes to live trip updates and calls `onEvent` for each one. Silently
 * no-ops (no retry storm) if the backend WS endpoint isn't reachable, since
 * the rest of the app works fine on plain polling/refetch as a fallback. */
export function useTripSocket(tripId: string, onEvent: (evt: TripEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(tripId));
    } catch {
      return;
    }
    socket.onmessage = (msg) => {
      try {
        handlerRef.current(JSON.parse(msg.data));
      } catch {
        // ignore malformed frames
      }
    };
    return () => socket.close();
  }, [tripId]);
}
