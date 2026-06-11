/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Booking {
  id: string;
  dockId: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  requesterName: string;
  truckReference: string;
  driverName: string;
  driverPhone: string;
  licensePlate: string;
  type: 'manual' | 'automatic';
  containerPlanningId?: string;
  truckCount?: number;
  createdAt: string;
   direction?: "inbound" | "outbound";
}


// export interface BookingCreatePayload {
//   dockId: string;
//   startTime: string;
//   endTime: string;
//   requesterName: string;
//   truckReference: string;
//   driverName: string;
//   driverPhone: string;
//   licensePlate: string;
//   type: "manual" | "automatic";
//   direction: "inbound" | "outbound";
// }
export interface Dock {
  id: string;
  name: string;
  enabled: boolean;
  capacity?: number; // optional capacity metadata
}

export interface TimeSlot {
  time: string; // HH:mm
  bookings: Booking[];
}
