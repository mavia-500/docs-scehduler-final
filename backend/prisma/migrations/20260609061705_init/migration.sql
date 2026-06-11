-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('manual', 'automatic');

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "dockId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "requesterName" TEXT NOT NULL,
    "truckReference" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "driverPhone" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "type" "BookingType" NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- unique slot constraint removed to allow multiple bookings per dock slot
-- CREATE UNIQUE INDEX "Booking_dockId_startTime_endTime_key" ON "Booking"("dockId", "startTime", "endTime");
