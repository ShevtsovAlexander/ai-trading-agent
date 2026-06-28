-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "coinId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "highPrice" DOUBLE PRECISION NOT NULL,
    "lowPrice" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "closedPrice" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Position_coinId_status_idx" ON "Position"("coinId", "status");
