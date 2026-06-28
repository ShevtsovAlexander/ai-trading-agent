-- CreateTable
CREATE TABLE "TradeDecision" (
    "id" SERIAL NOT NULL,
    "market" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "previousPrice" DOUBLE PRECISION,
    "movingAverage" DOUBLE PRECISION,
    "trend" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "expectedValue" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "aiReasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeDecision_coinId_createdAt_idx" ON "TradeDecision"("coinId", "createdAt");
