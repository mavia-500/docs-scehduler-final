import express from "express";
import cors from "cors";
import { createServer } from "http";
import { PrismaClient, Prisma } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const TRUCKS_PER_SLOT = 3;

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

function serializeBooking(booking: any) {
  return {
    id: booking.id,
    dockId: booking.dockId,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    requesterName: booking.requesterName,
    truckReference: booking.truckReference,
    driverName: booking.driverName,
    driverPhone: booking.driverPhone,
    licensePlate: booking.licensePlate,
    type: booking.type,
    direction: booking.direction,
    createdAt: booking.createdAt.toISOString(),
  };
}

app.get("/api/bookings", async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: { startTime: "asc" },
    });
    res.json(bookings.map(serializeBooking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load bookings" });
  }
});

app.post("/api/bookings/batch", async (req, res) => {
  const bookingRequests = req.body.bookings;
  if (!Array.isArray(bookingRequests) || bookingRequests.length === 0) {
    return res.status(400).json({ error: "Booking list is required" });
  }

  try {
    const slotCounts = new Map<
      string,
      { existingCount: number; newCount: number }
    >();

    const createdBookings = await prisma.$transaction(async (tx) => {
      const created: any[] = [];

      for (const booking of bookingRequests) {
        const startTime = new Date(booking.startTime);
        const endTime = new Date(booking.endTime);
        const slotKey = `${booking.dockId}:${startTime.toISOString()}:${endTime.toISOString()}`;

        if (!slotCounts.has(slotKey)) {
          const existingCount = await tx.booking.count({
            where: { dockId: booking.dockId, startTime, endTime },
          });
          slotCounts.set(slotKey, { existingCount, newCount: 0 });
        }

        const slotInfo = slotCounts.get(slotKey)!;
        if (slotInfo.existingCount + slotInfo.newCount >= TRUCKS_PER_SLOT) {
          throw new Error("SLOT_FULL");
        }

        const createdBooking = await tx.booking.create({
          data: {
            dockId: booking.dockId,
            startTime,
            endTime,
            requesterName: booking.requesterName,
            truckReference: booking.truckReference,
            driverName: booking.driverName,
            driverPhone: booking.driverPhone,
            licensePlate: booking.licensePlate,
            type: booking.type,
            direction: booking.direction ?? "inbound",
          },
        });

        slotInfo.newCount += 1;
        slotCounts.set(slotKey, slotInfo);
        created.push(createdBooking);
      }

      return created;
    });

    res.status(201).json(createdBookings.map(serializeBooking));
  } catch (error) {
    console.error(error);
    if (error instanceof Error && error.message === "SLOT_FULL") {
      return res.status(409).json({ error: "This dock slot is full." });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({ error: "This dock slot is already booked." });
    }
    res.status(500).json({ error: "Unable to create bookings." });
  }
});

app.put("/api/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;
  const payload = req.body;

  try {
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        dockId: payload.dockId,
        startTime: new Date(payload.startTime),
        endTime: new Date(payload.endTime),
        requesterName: payload.requesterName,
        truckReference: payload.truckReference,
        driverName: payload.driverName,
        driverPhone: payload.driverPhone,
        licensePlate: payload.licensePlate,
        type: payload.type,
        direction: payload.direction ?? "inbound",
      },
    });
    res.json(serializeBooking(updated));
  } catch (error) {
    console.error(error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({ error: "This dock slot is already booked." });
    }
    res.status(500).json({ error: "Unable to update booking." });
  }
});

app.delete("/api/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;
  try {
    await prisma.booking.delete({ where: { id: bookingId } });
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to delete booking." });
  }
});

const server = createServer(app);
server.listen(PORT, () => {
  console.log(`Booking API server running on http://localhost:${PORT}`);
});