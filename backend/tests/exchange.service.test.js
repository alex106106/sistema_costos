const test = require("node:test");
const assert = require("node:assert/strict");
const { applyExchangeRates, selectHistoricalRate } = require("../services/exchange.service");

test("uses the historical rate published on the movement date", () => {
  const result = selectHistoricalRate("2026-08-10", {
    "2026-08-07": { MXN: 17.1551 },
    "2026-08-10": { MXN: 17.1512 },
    "2026-08-11": { MXN: 17.1223 }
  });

  assert.deepEqual(result, { rate: 17.1512, rateDate: "2026-08-10" });
});

test("uses the previous published rate for weekends and holidays", () => {
  const result = selectHistoricalRate("2026-08-09", {
    "2026-08-07": { MXN: 17.1551 },
    "2026-08-10": { MXN: 17.1512 }
  });

  assert.deepEqual(result, { rate: 17.1551, rateDate: "2026-08-07" });
});

test("rejects a date without a historical rate on or before it", () => {
  assert.throws(
    () => selectHistoricalRate("2026-07-30", { "2026-07-31": { MXN: 17.3 } }),
    /No hay un tipo de cambio histórico/
  );
});

test("uses a rate of one for MXN movements without external lookup", async () => {
  const result = await applyExchangeRates(
    [{ date: "2026-08-10", debit: 100, credit: 0 }],
    "MXN"
  );

  assert.equal(result.rows[0].exchangeRate, 1);
  assert.equal(result.rows[0].exchangeRateDate, "2026-08-10");
  assert.equal(result.rows[0].exchangeRateProvider, "Moneda del estado de cuenta");
});

test("rejects movements without a valid date instead of applying today's rate", async () => {
  await assert.rejects(
    () => applyExchangeRates([{ date: "10/08/2026" }], "USD"),
    /No se puede asignar el tipo de cambio histórico/
  );
});
