import * as XLSX from "@e965/xlsx";
import { MOVEMENT_CATALOG } from "./report-model.js";

const moneyFormat = '#,##0.00;[Red]-#,##0.00';
const rateFormat = '#,##0.000000';

function appendSheet(workbook, name, headers, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  if (rows.length) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: headers.length - 1 }
      })
    };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

function setNumberFormat(sheet, column, rowCount, format) {
  for (let row = 1; row <= rowCount; row += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (cell && typeof cell.v === "number") cell.z = format;
  }
}

export function createReportWorkbook({
  rows,
  dailySummary,
  currency,
  bank,
  accountName,
  initialBalanceCurrency,
  initialBalanceMXN,
  exchangeRate,
  statementControl,
  statementControlResults
}) {
  const workbook = XLSX.utils.book_new();
  const reconciledCount = rows.filter((row) => row.reconciliationStatus === "Cuadra").length;
  const reviewCount = rows.filter((row) => row.reconciliationStatus.startsWith("Revisar")).length;
  const noBalanceCount = rows.filter(
    (row) => row.reconciliationStatus === "Sin saldo del estado de cuenta"
  ).length;
  const totalDebit = rows.reduce((total, row) => total + row.debit, 0);
  const totalCredit = rows.reduce((total, row) => total + row.credit, 0);
  const lastRow = rows[rows.length - 1];
  const firstDate = rows[0]?.date || "";
  const lastDate = lastRow?.date || "";

  const summaryRows = [
    ["Banco / formato", bank || "No identificado"],
    ["Cuenta / referencia", accountName || ""],
    ["Moneda", currency || ""],
    ["Periodo", firstDate && lastDate ? `${firstDate} a ${lastDate}` : ""],
    ["Movimientos", rows.length],
    ["Saldo inicial en moneda", Number(initialBalanceCurrency || 0)],
    ["Saldo inicial en MXN", Number(initialBalanceMXN || 0)],
    ["Débitos del periodo", totalDebit],
    ["Créditos del periodo", totalCredit],
    ["Débitos del periodo en MXN", rows.reduce((total, row) => total + row.debitMXN, 0)],
    ["Créditos del periodo en MXN", rows.reduce((total, row) => total + row.creditMXN, 0)],
    ["Saldo final calculado", Number(lastRow?.balanceCurrency || 0)],
    ["Saldo final del estado de cuenta", lastRow?.balanceFromPdf ?? "Sin dato"],
    ["Saldo final calculado en MXN", Number(lastRow?.balanceMXN || 0)],
    ["Movimientos que cuadran", reconciledCount],
    ["Movimientos por revisar", reviewCount],
    ["Movimientos sin saldo bancario", noBalanceCount],
    ["Tipo de cambio histórico de referencia", exchangeRate?.rate ?? "Sin dato"],
    ["Fecha efectiva de la referencia", exchangeRate?.rateDate ?? "Sin dato"],
    ["Fuente del tipo de cambio", exchangeRate?.provider ?? "Sin dato"],
    ["Tipo de cambio del saldo inicial", exchangeRate?.openingBalanceRate ?? "Sin dato"],
    ["Fecha efectiva del tipo de cambio inicial", exchangeRate?.openingBalanceRateDate ?? "Sin dato"],
    [
      "Advertencia de tipo de cambio",
      "Cada movimiento usa su tasa histórica por fecha de operación; si no hubo publicación ese día, se usa la última fecha anterior disponible. Revisa la fecha efectiva en la hoja Movimientos."
    ]
  ];
  if (statementControl) {
    summaryRows.push(
      ["Abonos según el banco", statementControl.deposits ?? "Sin dato"],
      ["Cargos según el banco", statementControl.withdrawals ?? "Sin dato"],
      ["Saldo final según el banco", statementControl.closingBalance ?? "Sin dato"],
      [
        "Control de totales",
        statementControlResults?.matches ? "Cuadra" : "Revisar antes de contabilizar"
      ]
    );
  }
  const summary = XLSX.utils.aoa_to_sheet([["Campo", "Valor"], ...summaryRows]);
  summary["!cols"] = [{ wch: 38 }, { wch: 105 }];
  XLSX.utils.book_append_sheet(workbook, summary, "Resumen");

  const movementRows = rows.map((row) => {
    const category = MOVEMENT_CATALOG.find((item) => item.code === Number(row.categoryCode));
    return [
      row.index,
      row.date,
      row.text,
      row.categoryCode ?? "",
      category?.type || "SIN CLASIFICAR",
      category?.description || "SIN CLASIFICAR",
      row.debit,
      row.credit,
      row.balanceFromPdf ?? "",
      row.reconciliationDifference ?? "",
      row.exchangeRate,
      row.exchangeRateDate ?? "",
      row.debitMXN,
      row.creditMXN,
      row.actnUtilPer,
      row.balanceMXN,
      row.balanceCurrency,
      row.reconciliationStatus
    ];
  });
  const movements = appendSheet(
    workbook,
    "Movimientos",
    [
      "#", "Fecha", "Descripción", "Código", "Tipo", "Concepto", `Débito ${currency}`,
      `Crédito ${currency}`, `Saldo estado ${currency}`, "Diferencia", "Tipo de cambio",
      "Fecha efectiva TC", "Débito MXN", "Crédito MXN", "Utilidad / pérdida MXN", "Saldo MXN",
      `Saldo calculado ${currency}`, "Estado conciliación"
    ],
    movementRows,
    [7, 14, 48, 10, 18, 38, 17, 17, 21, 17, 17, 17, 17, 17, 23, 18, 23, 28]
  );
  [6, 7, 8, 9, 12, 13, 14, 15, 16].forEach((column) =>
    setNumberFormat(movements, column, movementRows.length, moneyFormat)
  );
  setNumberFormat(movements, 10, movementRows.length, rateFormat);

  const dailyRows = dailySummary.map((day) => [
    day.date,
    day.openingBalance,
    day.debit,
    day.credit,
    day.balanceCurrency,
    day.statementBalance ?? "",
    day.difference ?? "",
    day.debitMXN,
    day.creditMXN,
    day.actnUtilPer,
    day.balanceMXN,
    day.transactionCount
  ]);
  const daily = appendSheet(
    workbook,
    "Saldos diarios",
    [
      "Fecha", `Saldo inicial ${currency}`, `Débitos ${currency}`, `Créditos ${currency}`,
      `Saldo calculado ${currency}`, `Saldo estado ${currency}`, "Diferencia",
      "Débitos MXN", "Créditos MXN", "Utilidad / pérdida MXN", "Saldo MXN", "Movimientos"
    ],
    dailyRows,
    [14, 20, 18, 18, 23, 21, 17, 18, 18, 25, 18, 14]
  );
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((column) =>
    setNumberFormat(daily, column, dailyRows.length, moneyFormat)
  );

  const reconciliationRows = rows.map((row) => [
    row.date,
    row.text,
    row.balanceFromPdf ?? "",
    row.balanceCurrency,
    row.reconciliationDifference ?? "",
    row.reconciliationStatus
  ]);
  const reconciliation = appendSheet(
    workbook,
    "Conciliación",
    [
      "Fecha", "Descripción", `Saldo estado ${currency}`, `Saldo calculado ${currency}`,
      "Diferencia", "Resultado"
    ],
    reconciliationRows,
    [14, 48, 23, 25, 18, 30]
  );
  [2, 3, 4].forEach((column) =>
    setNumberFormat(reconciliation, column, reconciliationRows.length, moneyFormat)
  );

  appendSheet(
    workbook,
    "Catálogo",
    ["Código", "Tipo", "Concepto"],
    [
      ...MOVEMENT_CATALOG.map((item) => [item.code, item.type, item.description]),
      ["", "PENDIENTE", "SIN CLASIFICAR"]
    ],
    [12, 18, 48]
  );

  if (statementControl) {
    appendSheet(
      workbook,
      "Control banco",
      ["Concepto", "Total del estado", "Total extraído/calculado", "Diferencia", "Resultado"],
      [
        [
          "Abonos",
          statementControl.deposits ?? "",
          statementControlResults?.extractedCredits ?? "",
          statementControlResults?.differences.deposits ?? "",
          statementControlResults?.differences.deposits === null
            ? "Sin dato"
            : Math.abs(statementControlResults.differences.deposits) <= 0.01
              ? "Cuadra"
              : "Revisar"
        ],
        [
          "Cargos",
          statementControl.withdrawals ?? "",
          statementControlResults?.extractedDebits ?? "",
          statementControlResults?.differences.withdrawals ?? "",
          statementControlResults?.differences.withdrawals === null
            ? "Sin dato"
            : Math.abs(statementControlResults.differences.withdrawals) <= 0.01
              ? "Cuadra"
              : "Revisar"
        ],
        [
          "Saldo final",
          statementControl.closingBalance ?? "",
          statementControlResults?.calculatedClosingBalance ?? "",
          statementControlResults?.differences.closingBalance ?? "",
          statementControlResults?.differences.closingBalance === null
            ? "Sin dato"
            : Math.abs(statementControlResults.differences.closingBalance) <= 0.01
              ? "Cuadra"
              : "Revisar"
        ]
      ],
      [24, 24, 32, 18, 24]
    );
  }

  const exchangeRows = rows.map((row) => [
    row.date,
    row.text,
    row.exchangeRate,
    row.exchangeRateDate ?? "",
    row.exchangeRateProvider || exchangeRate?.provider || "Editable; validar contra la fuente"
  ]);
  const exchangeSheet = appendSheet(
    workbook,
    "Tipos de cambio",
    ["Fecha del movimiento", "Movimiento", "Tipo de cambio aplicado", "Fecha efectiva", "Fuente / nota"],
    exchangeRows,
    [18, 48, 25, 18, 55]
  );
  setNumberFormat(exchangeSheet, 2, exchangeRows.length, rateFormat);

  return workbook;
}

export function downloadReportWorkbook(options, fileName) {
  const workbook = createReportWorkbook(options);
  XLSX.writeFile(workbook, fileName, { compression: true });
}
