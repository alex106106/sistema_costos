import test from "node:test";
import assert from "node:assert/strict";
import { buildDailySummary, calculateReportRows } from "./report-model.js";

test("recalculates balances and identifies statement differences", () => {
  const rows = calculateReportRows(
    [
      { date: "2026-03-01", debit: 10, credit: 0, exchangeRate: 18, balanceFromPdf: 90 },
      { date: "2026-03-02", debit: 0, credit: 5, exchangeRate: 20, balanceFromPdf: 95 }
    ],
    100,
    1800
  );

  assert.equal(rows[0].balanceCurrency, 90);
  assert.equal(rows[0].debitMXN, 180);
  assert.equal(rows[0].balanceMXN, 1620);
  assert.equal(rows[0].reconciliationStatus, "Cuadra");
  assert.equal(rows[1].balanceCurrency, 95);
  assert.equal(rows[1].actnUtilPer, 180);
  assert.equal(rows[1].balanceMXN, 1900);
  assert.equal(rows[1].reconciliationDifference, 0);
});

test("supports a manual exchange adjustment override", () => {
  const [row] = calculateReportRows(
    [{ debit: 0, credit: 0, exchangeRate: 20, actnUtilPer: -25, actnUtilPerManual: true }],
    100,
    1800
  );

  assert.equal(row.actnUtilPer, -25);
  assert.equal(row.balanceMXN, 1775);
});

test("summarizes each calendar day and carries forward balances", () => {
  const rows = calculateReportRows(
    [
      { date: "2026-03-01", debit: 10, credit: 0, exchangeRate: 1, balanceFromPdf: 90 },
      { date: "2026-03-03", debit: 0, credit: 5, exchangeRate: 1, balanceFromPdf: 95 }
    ],
    100,
    100
  );
  const summary = buildDailySummary(rows, 100, 100);

  assert.equal(summary.length, 3);
  assert.deepEqual(
    summary.map(({ date, balanceCurrency, transactionCount }) => [
      date,
      balanceCurrency,
      transactionCount
    ]),
    [
      ["2026-03-01", 90, 1],
      ["2026-03-02", 90, 0],
      ["2026-03-03", 95, 1]
    ]
  );
  assert.equal(summary[1].balanceMXN, 90);
});

test("keeps unreconciled balances visible and does not invent missing statement balances", () => {
  const rows = calculateReportRows([
    { date: "2026-03-01", debit: 12, credit: 0, exchangeRate: 1, balanceFromPdf: 80 },
    { date: "2026-03-02", debit: 0, credit: 2, exchangeRate: 1, balanceFromPdf: null }
  ], 100);

  assert.equal(rows[0].reconciliationStatus, "Revisar");
  assert.equal(rows[0].reconciliationDifference, -8);
  assert.equal(rows[1].reconciliationStatus, "Sin saldo del estado de cuenta");
  assert.equal(rows[1].reconciliationDifference, null);
});
