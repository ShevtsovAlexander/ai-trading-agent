-- Переименование, НЕ пересоздание: в таблице история индикаторов, на ней
-- стоят линии EMA/BB на графике. Сгенерированный Prisma вариант сделал бы
-- DROP TABLE + CREATE TABLE и стёр бы её (проверено migrate diff).

ALTER TABLE "TradeDecision" RENAME TO "MarketSnapshot";

-- Индексы и сиквенс ALTER TABLE ... RENAME за собой не переименовывает:
-- без этих трёх строк схема разъедется с тем, что ждёт Prisma, при зелёном
-- count(*) и стартующем приложении.
ALTER INDEX "TradeDecision_pkey" RENAME TO "MarketSnapshot_pkey";
ALTER INDEX "TradeDecision_coinId_createdAt_idx" RENAME TO "MarketSnapshot_coinId_createdAt_idx";
ALTER SEQUENCE "TradeDecision_id_seq" RENAME TO "MarketSnapshot_id_seq";
