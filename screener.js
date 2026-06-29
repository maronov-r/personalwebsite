// ===== HELPERS =====
const fmt$ = v => '$' + Math.round(v).toLocaleString();
const fmtPct = v => v.toFixed(2) + '%';
const fmtX = v => v.toFixed(2) + '×';
const el = id => document.getElementById(id);

function get(id) {
  return parseFloat(document.getElementById(id).value) || 0;
}

// ===== MONTHLY MORTGAGE PAYMENT =====
function monthlyPayment(principal, annualRate, years) {
  if (annualRate === 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// ===== IRR via Newton's method =====
function calcIRR(cashflows) {
  let rate = 0.1;
  for (let i = 0; i < 1000; i++) {
    let npv = 0, dnpv = 0;
    cashflows.forEach((cf, t) => {
      npv  += cf / Math.pow(1 + rate, t);
      dnpv -= t * cf / Math.pow(1 + rate, t + 1);
    });
    if (Math.abs(npv) < 0.01) break;
    if (dnpv === 0) break;
    rate -= npv / dnpv;
  }
  return rate * 100;
}

// ===== MAIN CALCULATION =====
function calculate() {
  // Inputs
  const purchasePrice = get('purchasePrice');
  const downPct       = get('downPayment') / 100;
  const intRate       = get('interestRate');
  const loanTerm      = get('loanTerm');
  const grossRent     = get('grossRent');
  const vacancyPct    = get('vacancyRate') / 100;
  const opexPct       = get('opexRate') / 100;
  const closingCostPct= get('closingCosts') / 100;
  const capexAnnual   = get('capex');
  const holdPeriod    = Math.round(get('holdPeriod'));
  const rentGrowthPct = get('rentGrowth') / 100;
  const exitCapPct    = get('exitCapRate') / 100;

  // Financing
  const equity       = purchasePrice * downPct;
  const loanAmount   = purchasePrice * (1 - downPct);
  const closingCosts = purchasePrice * closingCostPct;
  const totalEquity  = equity + closingCosts;
  const monthlyPmt   = monthlyPayment(loanAmount, intRate, loanTerm);
  const annualDebtSvc= monthlyPmt * 12;

  // Year 1 income / expenses
  const egi       = grossRent * (1 - vacancyPct);
  const opex      = egi * opexPct;
  const noi       = egi - opex;
  const capRate   = (noi / purchasePrice) * 100;
  const dscr      = noi / annualDebtSvc;
  const cashFlow1 = noi - annualDebtSvc - capexAnnual;
  const coc       = (cashFlow1 / totalEquity) * 100;

  // Multi-year DCF
  const years = [];
  for (let yr = 1; yr <= holdPeriod; yr++) {
    const g     = Math.pow(1 + rentGrowthPct, yr - 1);
    const rent  = grossRent * g;
    const egiYr = rent * (1 - vacancyPct);
    const opexYr= egiYr * opexPct;
    const noiYr = egiYr - opexYr;
    const cf    = noiYr - annualDebtSvc - capexAnnual;
    years.push({ yr, rent, egi: egiYr, opex: opexYr, noi: noiYr, cf });
  }

  // Exit
  const lastNOI      = years[holdPeriod - 1].noi;
  const exitValue    = lastNOI / exitCapPct;
  // Remaining loan balance
  const n = loanTerm * 12;
  const r = intRate / 100 / 12;
  const pmtsMade = holdPeriod * 12;
  let loanBalance = 0;
  if (intRate > 0) {
    loanBalance = loanAmount * (Math.pow(1 + r, n) - Math.pow(1 + r, pmtsMade)) / (Math.pow(1 + r, n) - 1);
  } else {
    loanBalance = loanAmount - (loanAmount / (loanTerm * 12)) * pmtsMade;
  }
  const saleProceeds = exitValue - loanBalance;

  // IRR
  const cfArr = [-totalEquity, ...years.map(y => y.cf)];
  cfArr[cfArr.length - 1] += saleProceeds;
  const irr = calcIRR(cfArr);

  // Equity multiple
  const totalCashIn  = totalEquity;
  const totalCashOut = years.reduce((s, y) => s + y.cf, 0) + saleProceeds;
  const equityMult   = totalCashOut / totalCashIn;

  // ===== RENDER =====

  // Metrics
  const setMetric = (id, value, benchmarkPass) => {
    el(id).textContent = value;
    const card = el(id).closest('.metric-card');
    card.className = 'metric-card ' + (benchmarkPass === null ? '' : benchmarkPass ? 'good' : 'bad');
  };

  setMetric('capRate',       fmtPct(capRate),      capRate > 5.5);
  setMetric('cocReturn',     fmtPct(coc),           coc > 7);
  setMetric('dscr',          fmtX(dscr),            dscr > 1.25);
  setMetric('equityMultiple',fmtX(equityMult),      equityMult > 1.5);
  setMetric('irr',           fmtPct(irr),           irr > 12);
  setMetric('noi',           fmt$(noi),             null);

  // Verdict
  const passes = [capRate > 5.5, coc > 7, dscr > 1.25].filter(Boolean).length;
  const vc = el('verdictCard');
  vc.className = 'verdict-card';
  if (passes === 3) {
    vc.classList.add('');
    el('verdictIcon').textContent = '✓';
    el('verdictLabel').textContent = 'Deal Pencils';
    el('verdictReason').textContent = 'Cap rate, cash-on-cash, and DSCR all clear minimum thresholds.';
  } else if (passes >= 2) {
    vc.classList.add('warn');
    el('verdictIcon').textContent = '⚠';
    el('verdictLabel').textContent = 'Marginal Deal';
    el('verdictReason').textContent = 'Some metrics are below target. Worth a closer look before proceeding.';
  } else {
    vc.classList.add('fail');
    el('verdictIcon').textContent = '✕';
    el('verdictLabel').textContent = 'Deal Doesn\'t Pencil';
    el('verdictReason').textContent = 'Multiple key metrics fall short. Renegotiate price or improve income.';
  }

  // Waterfall
  const maxVal = grossRent;
  const wfData = [
    { label: 'Gross Potential Rent',  val: grossRent,          cls: 'wf-income',   indent: false },
    { label: 'Less: Vacancy',         val: -(grossRent * vacancyPct), cls: '',     indent: true  },
    { label: 'Effective Gross Income',val: egi,                cls: 'wf-subtotal', indent: false },
    { label: 'Less: Operating Expenses', val: -opex,           cls: '',            indent: true  },
    { label: 'Net Operating Income',  val: noi,                cls: 'wf-noi',      indent: false },
    { label: 'Less: Debt Service',    val: -annualDebtSvc,     cls: '',            indent: true  },
    { label: 'Less: CapEx Reserve',   val: -capexAnnual,       cls: '',            indent: true  },
    { label: 'Cash Flow (Year 1)',     val: cashFlow1,          cls: 'wf-total',    indent: false },
  ];

  el('waterfallRows').innerHTML = wfData.map(row => {
    const barPct = Math.min(100, Math.abs(row.val) / maxVal * 100);
    const isNeg  = row.val < 0;
    return `<div class="wf-row ${row.cls}">
      <span class="wf-label" style="${row.indent ? 'padding-left:16px;color:var(--ink-muted)' : ''}">${row.label}</span>
      <span class="wf-amount" style="color:${isNeg ? 'var(--accent)' : 'inherit'}">${isNeg ? '(' + fmt$(Math.abs(row.val)) + ')' : fmt$(row.val)}</span>
      <div class="wf-bar-wrap"><div class="wf-bar"><div class="wf-bar-fill" style="width:${barPct}%;background:${isNeg ? 'var(--accent)' : row.cls === 'wf-noi' ? 'var(--ink)' : 'var(--green)'}"></div></div></div>
    </div>`;
  }).join('');

  // DCF table
  const rows = [
    { label: 'Gross Rent',          vals: years.map(y => fmt$(y.rent)),  cls: '' },
    { label: 'Effective Gross Income', vals: years.map(y => fmt$(y.egi)), cls: '' },
    { label: 'Operating Expenses',  vals: years.map(y => '(' + fmt$(y.opex) + ')'), cls: '' },
    { label: 'NOI',                 vals: years.map(y => fmt$(y.noi)),   cls: 'dcf-section' },
    { label: 'Debt Service',        vals: years.map(() => '(' + fmt$(annualDebtSvc) + ')'), cls: '' },
    { label: 'CapEx Reserve',       vals: years.map(() => '(' + fmt$(capexAnnual) + ')'),  cls: '' },
    { label: 'Cash Flow',           vals: years.map(y => fmt$(y.cf)),    cls: 'dcf-highlight' },
  ];

  // Add exit row
  const exitRow = { label: 'Exit / Sale Proceeds', vals: years.map((y, i) => i === holdPeriod - 1 ? fmt$(saleProceeds) : '—'), cls: 'dcf-cf' };
  rows.push(exitRow);

  el('dcfBody').innerHTML = rows.map(row =>
    `<tr class="${row.cls}"><td>${row.label}</td>${row.vals.map(v => `<td>${v}</td>`).join('')}</tr>`
  ).join('');
}

// Wire up all inputs
document.querySelectorAll('input[type=number]').forEach(input => {
  input.addEventListener('input', calculate);
});

// Initial run
calculate();
