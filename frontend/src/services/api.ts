/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

import { Booking } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

const POLL_INTERVAL_MS = 5000; // har 5 second mein refresh

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
      text || `API request failed with status ${response.status}`
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
  bookings: BookingCreatePayload[]
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
  booking: Partial<BookingCreatePayload>
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

// WebSocket ki jagah Polling — har 5 second mein server se bookings fetch karta hai
export function connectBookingWebSocket(options: {
  onInit: (bookings: Booking[]) => void;
  onCreated: (booking: Booking) => void;
  onUpdated: (booking: Booking) => void;
  onDeleted: (id: string) => void;
  onError?: (error: Error) => void;
}): () => void {
  let destroyed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let knownIds = new Set<string>();

  async function poll() {
    if (destroyed) return;

    try {
      const bookings = await fetchBookings();

      // Pehli baar — sab bookings ek saath bhejo
      if (knownIds.size === 0) {
        knownIds = new Set(bookings.map((b) => b.id));
        options.onInit(bookings);
      } else {
        const freshIds = new Set(bookings.map((b) => b.id));

        // Nayi bookings — created
        for (const booking of bookings) {
          if (!knownIds.has(booking.id)) {
            options.onCreated(booking);
          }
        }

        // Updated bookings
        for (const booking of bookings) {
          if (knownIds.has(booking.id)) {
            options.onUpdated(booking);
          }
        }

        // Delete hui bookings
        for (const oldId of knownIds) {
          if (!freshIds.has(oldId)) {
            options.onDeleted(oldId);
          }
        }

        knownIds = freshIds;
      }
    } catch (error) {
      console.error("Polling error:", error);
      options.onError?.(
        error instanceof Error ? error : new Error("Polling failed")
      );
    }

    if (!destroyed) {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  // Turant pehli baar chalaao
  poll();

  // Cleanup function — component unmount pe polling band karo
  return () => {
    destroyed = true;
    if (pollTimer) clearTimeout(pollTimer);
  };
}