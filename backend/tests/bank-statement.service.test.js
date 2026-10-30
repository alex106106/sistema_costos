const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyManualMapping,
  detectBank,
  detectCurrency,
  detectOpeningBalance,
  extractBbvaStatementControl,
  extractAmounts,
  extractAutomaticRows,
  extractBbvaRows,
  normalizeDate,
  parseAmount,
  splitColumns
} = require("../services/bank-statement.service");

test("detects the supported bank profiles", () => {
  assert.deepEqual(detectBank("UBS Switzerland AG"), { id: "ubs", name: "UBS" });
  assert.deepEqual(detectBank("Estado de cuenta BBVA"), { id: "bbva", name: "BBVA" });
  assert.deepEqual(detectBank("Banco Santander"), { id: "santander", name: "Santander" });
  assert.deepEqual(detectBank("HSBC México"), { id: "hsbc", name: "HSBC" });
  assert.deepEqual(detectBank("J.P. Morgan (Suisse) SA"), {
    id: "jpmorgan",
    name: "J.P. Morgan (Suisse)"
  });
  assert.deepEqual(detectBank("Banco local"), { id: "other", name: "No identificado" });
});

test("detects explicit currencies without inventing a default", () => {
  assert.equal(detectCurrency("Account currency USD"), "USD");
  assert.equal(detectCurrency("Cuenta en MXN"), "MXN");
  assert.equal(detectCurrency("Kontowährung CHF"), "CHF");
  assert.equal(detectCurrency("Balance GBP"), "GBP");
  assert.equal(detectCurrency("CASH MANAGEMENT DLLS S INT"), "USD");
  assert.equal(detectCurrency("Información Financiera MONEDA NACIONAL"), "MXN");
  assert.equal(detectCurrency("Cuenta bancaria"), "N/D");
});

test("normalizes common date and amount formats", () => {
  assert.equal(normalizeDate("12.03.2026"), "2026-03-12");
  assert.equal(normalizeDate("2026-03-12"), "2026-03-12");
  assert.equal(normalizeDate("12/03/2026"), "2026-03-12");
  assert.equal(normalizeDate("03/12/2026", "MDY"), "2026-03-12");
  assert.equal(parseAmount("10,755.36"), 10755.36);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("(125,50)"), -125.5);
  assert.equal(parseAmount(""), null);
});

test("extracts UBS-style, debit, and credit rows and filters statement noise", () => {
  const rows = extractAutomaticRows(
    [
      "12.03.2026 Balance brought forward 10,755.36 12.03.2026 10,755.36",
      "16.03.2026 Compra supermercado -1,234.56 9,520.80",
      "20/03/2026 DEPÓSITO NÓMINA 1.500,00 11.020,80",
      "Displayed in Assets online on 11.04.2026 01.54.17 CET Page 1/1"
    ],
    "USD"
  );

  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-03-12");
  assert.equal(rows[0].credit, 10755.36);
  assert.equal(rows[1].debit, 1234.56);
  assert.equal(rows[1].balanceFromPdf, 9520.8);
  assert.equal(rows[2].credit, 1500);
  assert.equal(rows[2].balanceFromPdf, 11020.8);
});

test("maps separate debit, credit, and balance columns", () => {
  const rows = extractAutomaticRows(
    ["21/03/2026 TRANSFERENCIA 0,00 1.500,00 12.520,80"],
    "MXN"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].debit, 0);
  assert.equal(rows[0].credit, 1500);
  assert.equal(rows[0].balanceFromPdf, 12520.8);
});

test("does not claim a statement balance when the PDF only contains a movement amount", () => {
  const rows = extractAutomaticRows(["21/03/2026 PAGO PROVEEDOR -1.500,00"], "MXN");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].debit, 1500);
  assert.equal(rows[0].balanceFromPdf, null);
});

test("ignores account references and restores reverse-ordered UBS transactions", () => {
  const rows = extractAutomaticRows(
    [
      "30.06.2026 Interest calculation balance -35.31 30.06.2026 10,732.88",
      "09.06.2026 Fid Call UBS Jersey 6544408 -170,799.14 09.06.2026 10,768.19",
      "09.06.2026 Fid Call UBS Jersey 6544408 170,799.14 09.06.2026 181,567.33",
      "09.06.2026 Fid Call UBS Jersey 6544408 171,112.83 09.06.2026 10,768.19",
      "08.06.2026 Fid Call UBS Jersey 6544408 -171,100.00 08.06.2026 -160,344.64"
    ],
    "USD",
    "DMY",
    true
  );

  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.date), [
    "2026-06-08",
    "2026-06-09",
    "2026-06-09",
    "2026-06-09",
    "2026-06-30"
  ]);
  assert.equal(rows[0].debit, 171100);
  assert.equal(rows[1].credit, 171112.83);
  assert.equal(rows[2].credit, 170799.14);
  assert.equal(rows[3].debit, 170799.14);
  assert.equal(rows[4].debit, 35.31);
});

test("parses BBVA movements, inferred period dates, balances, and opening balance", () => {
  const lines = [
    "Periodo DEL 01/06/2026 AL 30/06/2026",
    "Saldo de Liquidación Inicial 121,057.42 19.22% A",
    "01/JUN 01/JUN T17 SPID ENVIADO INVEX 120,000.00",
    "01/JUN 01/JUN T20 SPID RECIBIDOVE POR MAS 10,709.35 11,766.77 11,766.77",
    "02/JUN 02/JUN E20 IVA TRANSF RECEPCION INT 4.80"
  ];
  const rows = extractBbvaRows(lines, "USD");

  assert.equal(detectOpeningBalance(lines), 121057.42);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-06-01");
  assert.equal(rows[0].debit, 120000);
  assert.equal(rows[0].balanceFromPdf, null);
  assert.equal(rows[1].credit, 10709.35);
  assert.equal(rows[1].balanceFromPdf, 11766.77);
  assert.equal(rows[2].debit, 4.8);
});

test("reads BBVA official totals without double-counting the commission breakdown", () => {
  const control = extractBbvaStatementControl([
    "Saldo Inicial 121,057.42 19.22% A",
    "Depósitos / Abonos (+) 27 544,275.89 86.44% B",
    "Comisiones (-) -120.00 -0.01% C",
    "Otros cargos (-) -629,644.99 -100.00% F",
    "Saldo Final 35,688.32 5.66% G"
  ]);

  assert.deepEqual(control, {
    openingBalance: 121057.42,
    deposits: 544275.89,
    withdrawals: 629644.99,
    closingBalance: 35688.32
  });
});

test("keeps duplicate BBVA payments because equal transactions can be distinct", () => {
  const rows = extractBbvaRows(
    [
      "Periodo DEL 01/06/2026 AL 30/06/2026",
      "02/JUN 02/JUN E18 TRANSF RECEPCION INTNAL 30.00",
      "02/JUN 02/JUN E18 TRANSF RECEPCION INTNAL 30.00"
    ],
    "USD"
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].debit, 30);
  assert.equal(rows[1].debit, 30);
});

test("uses BBVA transaction code before bank names that contain direction keywords", () => {
  const rows = extractBbvaRows(
    [
      "Periodo DEL 01/06/2026 AL 30/06/2026",
      "05/JUN 05/JUN T20 SPEI RECIBIDOMULTIVA BANC 2,977,710.09"
    ],
    "MXN"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].debit, 0);
  assert.equal(rows[0].credit, 2977710.09);
});

test("does not turn a wealth-statement date range into bank transactions", () => {
  const rows = extractAutomaticRows(
    [
      "01 junio - 30 junio 2026",
      "Valor neto total de mercado 0,00 0,00 0,00",
      "* Incluye operaciones pendientes, basadas en tipos de cambio a 30 junio 2026"
    ],
    "USD"
  );

  assert.equal(rows.length, 0);
});

test("maps manually selected columns and joins multiword descriptions", () => {
  const rows = applyManualMapping(
    ["12/03/2026  COMPRA  CAFÉ  125,50  0,00  874,50"],
    {
      delimiter: "columns",
      columns: {
        date: 0,
        description: 1,
        descriptionEnd: 2,
        debit: 3,
        credit: 4,
        balance: 5
      }
    },
    "MXN"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-03-12");
  assert.equal(rows[0].text, "COMPRA CAFÉ");
  assert.equal(rows[0].debit, 125.5);
  assert.equal(rows[0].credit, 0);
  assert.equal(rows[0].balanceFromPdf, 874.5);
  assert.equal(rows[0].currency, "MXN");
});

test("supports manual mapping when extracted PDF text has only single spaces", () => {
  const line = "12.03.2026 Balance brought forward 10,755.36 10,755.36";
  const parts = splitColumns(line, "words");
  assert.equal(parts[0], "12.03.2026");
  assert.equal(parts[1], "Balance");
  assert.equal(parts[5], "10,755.36");

  const rows = applyManualMapping(
    [line],
    {
      delimiter: "words",
      columns: {
        date: 0,
        description: 1,
        descriptionEnd: 3,
        debit: null,
        credit: 4,
        balance: 5
      }
    },
    "USD"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "Balance brought forward");
  assert.equal(rows[0].credit, 10755.36);
  assert.equal(rows[0].balanceFromPdf, 10755.36);
});

test("manual mapping can explicitly use US month-first dates", () => {
  const rows = applyManualMapping(
    ["03/12/2026  PURCHASE  COFFEE  12.50  500.00"],
    {
      delimiter: "words",
      dateOrder: "MDY",
      columns: {
        date: 0,
        description: 1,
        descriptionEnd: 2,
        debit: 3,
        credit: null,
        balance: 4
      }
    },
    "USD"
  );

  assert.equal(rows[0].date, "2026-03-12");
});
