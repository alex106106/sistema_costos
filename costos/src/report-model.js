export const MOVEMENT_CATALOG = [
  { code: 101, type: "DEPOSITO", description: "COBRANZA" },
  { code: 102, type: "DEPOSITO", description: "REDUCCION DE INVERSIONES" },
  { code: 103, type: "DEPOSITO", description: "PRESTAMOS RECIBIDOS PNR" },
  { code: 104, type: "DEPOSITO", description: "OPERACION CAMBIO" },
  { code: 105, type: "DEPOSITO", description: "INTERESES A FAVOR" },
  { code: 106, type: "DEPOSITO", description: "PRESTAMOS RECIBIDOS PR" },
  { code: 107, type: "DEPOSITO", description: "COBRO DE PRINCIPAL (PRESTAMOS)" },
  { code: 108, type: "DEPOSITO", description: "REVERSA DE COMISIONES" },
  { code: 201, type: "RETIRO", description: "PAGO A PROVEEDORES" },
  { code: 202, type: "RETIRO", description: "INCREMENTO DE INVERSIONES" },
  { code: 203, type: "RETIRO", description: "INTERESES PAGADOS" },
  { code: 204, type: "RETIRO", description: "COMISIONES BANCARIAS" },
  { code: 205, type: "RETIRO", description: "OPERACION CAMBIO" },
  { code: 206, type: "RETIRO", description: "AMORTIZACION AL PRINCIPAL (PRESTAMOS)" },
  { code: 207, type: "RETIRO", description: "PAGO DE ARRENDAMIENTO FINANCIERO" },
  { code: 208, type: "RETIRO", description: "PAGO SWAP" },
  { code: 209, type: "RETIRO", description: "APORTACION SOHO PANAMA" },
  { code: 210, type: "RETIRO", description: "FORWARD CSUISSE" },
  { code: 211, type: "RETIRO", description: "FORWARD JULIUS" }
];

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function classifyMovement(row) {
  const description = String(row.text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (/INTERES/.test(description)) return row.credit > 0 ? 105 : 203;
  if (/COMISION|FEE/.test(description)) return row.credit > 0 ? 108 : 204;
  if (/FORWARD/.test(description)) return /JULIUS/.test(description) ? 211 : 210;
  if (/SWAP/.test(description)) return 208;
  if (/ARRENDAMIENTO|LEASING/.test(description)) return 207;
  if (/PRESTAMO|LOAN/.test(description)) return row.credit > 0 ? 103 : 206;
  if (/INVERSION|INVESTMENT/.test(description)) return row.credit > 0 ? 102 : 202;
  if (/CAMBIO|EXCHANGE|FX /.test(description)) return row.credit > 0 ? 104 : 205;
  if (/COBRANZA|COLLECTION/.test(description)) return 101;
  if (row.credit > 0) return 101;
  if (row.debit > 0) return 201;
  return null;
}

export function calculateReportRows(rows, initialBalanceCurrency = 0, initialBalanceMXN = 0) {
  let currencyBalance = amount(initialBalanceCurrency);
  let mxnBalance = amount(initialBalanceMXN);
  let previousExchangeRate =
    currencyBalance !== 0 ? mxnBalance / currencyBalance : null;

  return rows.map((row, index) => {
    const debit = amount(row.debit);
    const credit = amount(row.credit);
    const exchangeRate = amount(row.exchangeRate);
    const actnUtilPer =
      row.actnUtilPerManual === true
        ? amount(row.actnUtilPer)
        : round2(
            currencyBalance *
              (exchangeRate - (previousExchangeRate ?? exchangeRate))
          );
    const balanceCurrency = round2(currencyBalance - debit + credit);
    const debitMXN = round2(debit * exchangeRate);
    const creditMXN = round2(credit * exchangeRate);
    const balanceMXN = round2(mxnBalance - debitMXN + creditMXN + actnUtilPer);
    const hasStatementBalance =
      row.balanceFromPdf !== null &&
      row.balanceFromPdf !== undefined &&
      Number.isFinite(Number(row.balanceFromPdf));
    const reconciliationDifference = hasStatementBalance
      ? round2(Number(row.balanceFromPdf) - balanceCurrency)
      : null;
    const categoryCode = row.categoryCode || classifyMovement({ ...row, debit, credit });

    currencyBalance = balanceCurrency;
    mxnBalance = balanceMXN;
    previousExchangeRate = exchangeRate;

    return {
      ...row,
      index: row.index || index + 1,
      debit,
      credit,
      exchangeRate,
      actnUtilPer,
      actnUtilPerManual: row.actnUtilPerManual === true,
      balanceCurrency,
      debitMXN,
      creditMXN,
      balanceMXN,
      categoryCode,
      reconciliationDifference,
      reconciliationStatus:
        row.requiresReview
          ? "Revisar movimiento"
          : reconciliationDifference === null
          ? "Sin saldo del estado de cuenta"
          : Math.abs(reconciliationDifference) <= 0.01
            ? "Cuadra"
            : "Revisar"
    };
  });
}

export function buildDailySummary(rows, initialBalanceCurrency = 0, initialBalanceMXN = 0) {
  if (!rows.length) return [];

  const movementsByDate = new Map();
  for (const row of rows) {
    if (!row.date) continue;
    const day = movementsByDate.get(row.date) || [];
    day.push(row);
    movementsByDate.set(row.date, day);
  }

  const dates = [...movementsByDate.keys()].sort();
  if (!dates.length) return [];

  const start = new Date(`${dates[0]}T00:00:00Z`);
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const dayCount = Math.floor((end - start) / 86400000) + 1;
  const days = dayCount <= 10000
    ? Array.from({ length: dayCount }, (_, index) => {
        const date = new Date(start.getTime() + index * 86400000);
        return date.toISOString().slice(0, 10);
      })
    : dates;

  let previousBalance = amount(initialBalanceCurrency);
  let previousBalanceMXN = amount(initialBalanceMXN);
  return days.map((date) => {
    const dayRows = movementsByDate.get(date) || [];
    const openingBalance = previousBalance;
    const debit = round2(dayRows.reduce((total, row) => total + amount(row.debit), 0));
    const credit = round2(dayRows.reduce((total, row) => total + amount(row.credit), 0));
    const balanceCurrency = dayRows.length
      ? amount(dayRows[dayRows.length - 1].balanceCurrency)
      : round2(openingBalance);
    const openingBalanceMXN = previousBalanceMXN;
    const debitMXN = round2(dayRows.reduce((total, row) => total + amount(row.debitMXN), 0));
    const creditMXN = round2(dayRows.reduce((total, row) => total + amount(row.creditMXN), 0));
    const actnUtilPer = round2(dayRows.reduce((total, row) => total + amount(row.actnUtilPer), 0));
    const balanceMXN = dayRows.length
      ? amount(dayRows[dayRows.length - 1].balanceMXN)
      : round2(openingBalanceMXN);
    const statementRows = dayRows.filter(
      (row) => row.balanceFromPdf !== null && row.balanceFromPdf !== undefined
    );
    const statementBalance = statementRows.length
      ? Number(statementRows[statementRows.length - 1].balanceFromPdf)
      : null;

    previousBalance = balanceCurrency;
    previousBalanceMXN = balanceMXN;

    return {
      date,
      openingBalance,
      debit,
      credit,
      balanceCurrency,
      openingBalanceMXN,
      debitMXN,
      creditMXN,
      actnUtilPer,
      balanceMXN,
      statementBalance,
      difference:
        statementBalance === null ? null : round2(statementBalance - balanceCurrency),
      transactionCount: dayRows.length
    };
  });
}
