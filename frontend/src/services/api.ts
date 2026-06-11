/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_WS_URL: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

import { Booking } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000";

export class BookingConflictError extends Error {
  constructor(message: string = "Slot already booked") {
    super(message);
    this.name = "BookingConflictError";
  }
}

export interface BookingCreatePayload {
  dockId: string;
  startTime: string;
  endTime: string;
  requesterName: string;
  truckReference: string;
  driverName: string;
  driverPhone: string;
  licensePlate: string;
  type: "manual" | "automatic";
  direction: "inbound" | "outbound";
}

interface BookingBatchRequest {
  bookings: BookingCreatePayload[];
}

type BookingWebSocketMessage =
  | { type: "bookings:init"; bookings: Booking[] }
  | { type: "booking:created"; booking: Booking }
  | { type: "booking:updated"; booking: Booking }
  | { type: "booking:deleted"; id: string };

function normalizeBooking(raw: any): Booking {
  return {
    id: raw.id,
    dockId: raw.dockId,
    startTime: raw.startTime,
    endTime: raw.endTime,
    requesterName: raw.requesterName,
    truckReference: raw.truckReference,
    driverName: raw.driverName,
    driverPhone: raw.driverPhone,
    licensePlate: raw.licensePlate,
    type: raw.type,
    truckCount: raw.truckCount,
    createdAt: raw.createdAt,
    direction: raw.direction,
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 409) {
      throw new BookingConflictError(text || "Slot already booked");
    }
    throw new Error(
      text || `API request failed with status ${response.status}`,
    );
  }
  return text ? JSON.parse(text) : ({} as T);
}

export async function fetchBookings(): Promise<Booking[]> {
  const response = await fetch(`${API_BASE_URL}/bookings`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await handleResponse<any>(response);
  return Array.isArray(data) ? data.map(normalizeBooking) : [];
}

export async function createBookings(
  bookings: BookingCreatePayload[],
): Promise<Booking[]> {
  const response = await fetch(`${API_BASE_URL}/bookings/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookings } as BookingBatchRequest),
  });
  const data = await handleResponse<any>(response);
  return Array.isArray(data) ? data.map(normalizeBooking) : [];
}

export async function updateBooking(
  id: string,
  booking: Partial<BookingCreatePayload>,
): Promise<Booking> {
  const response = await fetch(`${API_BASE_URL}/bookings/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  });
  const data = await handleResponse<any>(response);
  return normalizeBooking(data);
}

export async function deleteBooking(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/bookings/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  await handleResponse(response);
}

export function connectBookingWebSocket(options: {
  onInit: (bookings: Booking[]) => void;
  onCreated: (booking: Booking) => void;
  onUpdated: (booking: Booking) => void;
  onDeleted: (id: string) => void;
  onError?: (error: Error) => void;
}): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let reconnectDelay = 3000;
  const maxReconnectDelay = 30000;

  function connect() {
    if (destroyed) return;

    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      console.log("Booking WS connected");
      // Reset delay on successful connection
      reconnectDelay = 3000;
    });

    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as BookingWebSocketMessage;
        switch (message.type) {
          case "bookings:init":
            options.onInit(
              Array.isArray(message.bookings)
                ? message.bookings.map(normalizeBooking)
                : [],
            );
            break;
          case "booking:created":
            options.onCreated(normalizeBooking(message.booking));
            break;
          case "booking:updated":
            options.onUpdated(normalizeBooking(message.booking));
            break;
          case "booking:deleted":
            options.onDeleted(message.id);
            break;
          default:
            break;
        }
      } catch (error) {
        console.error("Failed to parse booking WS message", error);
        options.onError?.(
          error instanceof Error ? error : new Error("WS parse error"),
        );
      }
    });

    ws.addEventListener("error", () => {
      options.onError?.(
        new Error(
          `WebSocket connection failed. Check that your backend is running at ${WS_URL}`,
        ),
      );
    });

    ws.addEventListener("close", (event) => {
      if (destroyed) return;

      console.warn(
        `Booking WS closed (code: ${event.code}). Reconnecting in ${reconnectDelay / 1000}s...`,
      );

      reconnectTimer = setTimeout(() => {
        // Exponential backoff, capped at maxReconnectDelay
        reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay);
        connect();
      }, reconnectDelay);
    });
  }

  connect();

  // Return a cleanup function to stop reconnecting and close the socket
  return () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
