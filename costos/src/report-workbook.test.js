import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@e965/xlsx";
import { buildDailySummary, calculateReportRows } from "./report-model.js";
import { createReportWorkbook } from "./report-workbook.js";

test("exports a readable multi-sheet control workbook", () => {
  const rows = calculateReportRows(
    [
      {
        date: "2026-03-01",
        text: "Pago proveedor",
        debit: 10,
        credit: 0,
        balanceFromPdf: 90,
        exchangeRate: 18,
        exchangeRateDate: "2026-03-01",
        exchangeRateProvider: "Prueba"
      }
    ],
    100,
    1800
  );
  const workbook = createReportWorkbook({
    rows,
    dailySummary: buildDailySummary(rows, 100),
    currency: "USD",
    bank: "Banco de prueba",
    accountName: "Cuenta USD",
    initialBalanceCurrency: 100,
    initialBalanceMXN: 1800,
    exchangeRate: { rate: 18, provider: "Prueba" }
  });
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const reopened = XLSX.read(bytes, { type: "buffer" });

  assert.deepEqual(reopened.SheetNames, [
    "Resumen",
    "Movimientos",
    "Saldos diarios",
    "Conciliación",
    "Catálogo",
    "Tipos de cambio"
  ]);
  assert.equal(reopened.Sheets.Movimientos["D2"].v, 201);
  assert.equal(reopened.Sheets.Movimientos["L2"].v, "2026-03-01");
  assert.equal(reopened.Sheets["Tipos de cambio"]["D2"].v, "2026-03-01");
  assert.equal(reopened.Sheets["Saldos diarios"]["E2"].v, 90);
  assert.equal(reopened.Sheets.Conciliación["F2"].v, "Cuadra");
});

test("adds bank controls when the statement provides official movement totals", () => {
  const rows = calculateReportRows([{ debit: 12, credit: 8, exchangeRate: 1 }], 100, 100);
  const statementControl = {
    openingBalance: 100,
    deposits: 8,
    withdrawals: 12,
    closingBalance: 96
  };
  const workbook = createReportWorkbook({
    rows,
    dailySummary: buildDailySummary(rows, 100, 100),
    currency: "MXN",
    bank: "BBVA",
    accountName: "Cuenta de prueba",
    initialBalanceCurrency: 100,
    initialBalanceMXN: 100,
    exchangeRate: { rate: 1, provider: "Prueba" },
    statementControl,
    statementControlResults: {
      extractedDebits: 12,
      extractedCredits: 8,
      calculatedClosingBalance: 96,
      differences: { deposits: 0, withdrawals: 0, closingBalance: 0 },
      matches: true
    }
  });
  const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
    type: "buffer"
  });

  assert.ok(reopened.SheetNames.includes("Control banco"));
  assert.equal(reopened.Sheets["Control banco"]["E2"].v, "Cuadra");
});
