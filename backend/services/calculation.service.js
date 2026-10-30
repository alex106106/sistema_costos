function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateRows(rows, initialBalanceCurrency, initialBalanceMXN) {
  let previousCurrencyBalance = Number(initialBalanceCurrency || 0);
  let previousMXNBalance = Number(initialBalanceMXN || 0);

  return rows.map((row, index) => {
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    const tc = Number(row.exchangeRate || 0);
    const actn = Number(row.actnUtilPer || 0);

    const balanceCurrency = round2(previousCurrencyBalance - debit + credit);

    const debitMXN = round2(debit * tc);
    const creditMXN = round2(credit * tc);

    const balanceMXN = round2(
      previousMXNBalance - debitMXN + creditMXN + actn
    );

    previousCurrencyBalance = balanceCurrency;
    previousMXNBalance = balanceMXN;

    return {
      ...row,
      index: index + 1,
      balanceCurrency,
      debitMXN,
      creditMXN,
      actnUtilPer: actn,
      balanceMXN
    };
  });
}

module.exports = { calculateRows };