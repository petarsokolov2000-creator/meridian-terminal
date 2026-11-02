// Who supplies whom: a hand-checked list of well-documented business relationships for
// Meridian's built-in stocks (used by SUPP). It's a snapshot, not a live feed: relationships
// change, and big companies have thousands of suppliers, so only the notable ones are here.
//
// Each link: [supplier, customer, what is supplied, basis]
//   basis 'disclosed' = stated publicly by one of the two companies (annual report, supplier
//                       list, press release, court testimony)
//   basis 'reported'  = widely reported in the financial press, not confirmed by both
// Companies outside Meridian's list are written by their Yahoo Finance symbol and named below.

export const AS_OF = '2025';

export const OUTSIDE = {
  '2317.TW': 'Hon Hai (Foxconn)',
  '005930.KS': 'Samsung Electronics',
  '000660.KS': 'SK hynix',
  '373220.KS': 'LG Energy Solution',
  '300750.SZ': 'CATL',
  '6752.T': 'Panasonic',
  GLW: 'Corning',
  SWKS: 'Skyworks Solutions',
  CRUS: 'Cirrus Logic',
  'AIR.PA': 'Airbus',
  ERIC: 'Ericsson',
};

export const LINKS = [
  // ---- chips: making them
  ['TSM', 'AAPL', 'Manufactures its A-series and M-series chips', 'disclosed'],
  ['TSM', 'NVDA', 'Manufactures its GPUs and AI chips', 'disclosed'],
  ['TSM', 'AMD', 'Manufactures its CPUs and GPUs', 'disclosed'],
  ['TSM', 'QCOM', 'Manufactures Snapdragon chips', 'reported'],
  ['TSM', 'AVGO', 'Manufactures its chips', 'reported'],
  ['TSM', 'INTC', 'Manufactures some chip tiles (e.g. Lunar Lake)', 'disclosed'],
  ['ASML', 'TSM', 'Lithography machines (incl. EUV)', 'disclosed'],
  ['ASML', 'INTC', 'Lithography machines (incl. EUV)', 'disclosed'],
  ['ASML', '005930.KS', 'Lithography machines (incl. EUV)', 'disclosed'],
  ['AMAT', 'TSM', 'Chipmaking equipment', 'disclosed'],
  ['AMAT', 'INTC', 'Chipmaking equipment', 'disclosed'],
  ['AMAT', '005930.KS', 'Chipmaking equipment', 'disclosed'],
  ['LRCX', 'TSM', 'Etch and deposition equipment', 'disclosed'],
  ['LRCX', '005930.KS', 'Etch and deposition equipment', 'disclosed'],
  ['LRCX', 'MU', 'Etch and deposition equipment', 'disclosed'],
  ['ARM', 'AAPL', 'Chip design architecture (licence)', 'disclosed'],
  ['ARM', 'QCOM', 'Chip design architecture (licence)', 'disclosed'],
  ['ARM', 'NVDA', 'CPU architecture for its Grace chips (licence)', 'disclosed'],

  // ---- Apple's parts
  ['2317.TW', 'AAPL', 'Assembles iPhones', 'disclosed'],
  ['005930.KS', 'AAPL', 'OLED displays and memory', 'disclosed'],
  ['AVGO', 'AAPL', 'Wireless and RF chips', 'disclosed'],
  ['QCOM', 'AAPL', '5G modems', 'disclosed'],
  ['SWKS', 'AAPL', 'RF chips', 'disclosed'],
  ['CRUS', 'AAPL', 'Audio chips', 'disclosed'],
  ['GLW', 'AAPL', 'Cover glass', 'disclosed'],
  ['QCOM', '005930.KS', 'Snapdragon chips for Galaxy phones', 'disclosed'],

  // ---- AI data centres
  ['MU', 'NVDA', 'HBM memory for AI chips', 'disclosed'],
  ['000660.KS', 'NVDA', 'HBM memory for AI chips', 'reported'],
  ['NVDA', 'MSFT', 'AI GPUs for its data centres', 'reported'],
  ['NVDA', 'META', 'AI GPUs for its data centres', 'reported'],
  ['NVDA', 'AMZN', 'AI GPUs for AWS', 'reported'],
  ['NVDA', 'GOOGL', 'AI GPUs for Google Cloud', 'reported'],
  ['NVDA', 'ORCL', 'AI GPUs for Oracle Cloud', 'reported'],
  ['NVDA', 'TSLA', 'GPUs for AI training', 'disclosed'],
  ['AMD', 'MSFT', 'Instinct AI GPUs', 'disclosed'],
  ['AMD', 'META', 'Instinct AI GPUs', 'disclosed'],
  ['AMD', 'ORCL', 'Instinct AI GPUs', 'disclosed'],
  ['AVGO', 'GOOGL', 'Custom AI chips (TPUs)', 'reported'],
  ['AVGO', 'META', 'Custom AI chips', 'reported'],
  ['ANET', 'MSFT', 'Data-centre network switches (major customer)', 'disclosed'],
  ['ANET', 'META', 'Data-centre network switches (major customer)', 'disclosed'],
  ['CEG', 'MSFT', 'Nuclear power (Crane plant restart deal)', 'disclosed'],
  ['CEG', 'META', 'Nuclear power (Clinton plant deal)', 'disclosed'],
  ['NEE', 'GOOGL', 'Nuclear power (Duane Arnold restart deal)', 'disclosed'],

  // ---- cloud and internet
  ['AMZN', 'NFLX', 'Cloud computing (AWS)', 'disclosed'],
  ['GOOGL', 'SPOT', 'Cloud computing (Google Cloud)', 'disclosed'],
  ['AAPL', 'GOOGL', 'Default search placement on iPhone (Google pays Apple)', 'disclosed'],

  // ---- cars and batteries
  ['6752.T', 'TSLA', 'Battery cells', 'disclosed'],
  ['300750.SZ', 'TSLA', 'Battery cells', 'disclosed'],
  ['373220.KS', 'TSLA', 'Battery cells', 'disclosed'],
  ['373220.KS', 'GM', 'Battery cells (Ultium Cells joint venture)', 'disclosed'],
  ['6752.T', 'TM', 'Batteries (Prime Planet joint venture)', 'disclosed'],

  // ---- planes
  ['GE', 'BA', 'Jet engines (incl. CFM LEAP, a GE–Safran venture)', 'disclosed'],
  ['GE', 'AIR.PA', 'Jet engines (CFM LEAP for the A320neo)', 'disclosed'],
  ['RTX', 'BA', 'Avionics and systems (Collins Aerospace)', 'disclosed'],
  ['RTX', 'AIR.PA', 'Engines (Pratt & Whitney GTF) and systems', 'disclosed'],
  ['HON', 'BA', 'Avionics and aircraft systems', 'disclosed'],

  // ---- oil
  ['SLB', 'XOM', 'Oilfield services and equipment', 'reported'],
  ['SLB', 'CVX', 'Oilfield services and equipment', 'reported'],

  // ---- shops and brands
  ['PG', 'WMT', 'Household products (Walmart ~15% of P&G sales)', 'disclosed'],
  ['PEP', 'WMT', 'Drinks and snacks (Walmart ~14% of PepsiCo sales)', 'disclosed'],
  ['MDLZ', 'WMT', 'Snacks (its largest customer)', 'disclosed'],
  ['KO', 'MCD', 'Fountain drinks', 'reported'],

  // ---- phones and networks
  ['AAPL', 'T', 'iPhones sold through its stores and plans', 'reported'],
  ['AAPL', 'VZ', 'iPhones sold through its stores and plans', 'reported'],
  ['AAPL', 'TMUS', 'iPhones sold through its stores and plans', 'reported'],
  ['ERIC', 'T', 'Radio network equipment', 'disclosed'],
  ['CSCO', 'T', 'Network equipment', 'reported'],
  ['CSCO', 'VZ', 'Network equipment', 'reported'],
  ['AMT', 'T', 'Cell-tower space (major tenant)', 'disclosed'],
  ['AMT', 'VZ', 'Cell-tower space (major tenant)', 'disclosed'],
  ['AMT', 'TMUS', 'Cell-tower space (major tenant)', 'disclosed'],

  // ---- delivery and warehouses
  ['UPS', 'AMZN', 'Parcel delivery (its largest customer)', 'disclosed'],
  ['PLD', 'AMZN', 'Warehouses (its largest tenant)', 'disclosed'],
];

/** Suppliers and customers of `sym`, each { sym, what, basis }. */
export function chainOf(sym) {
  const s = String(sym).toUpperCase();
  return {
    suppliers: LINKS.filter((l) => l[1] === s).map(([from, , what, basis]) => ({ sym: from, what, basis })),
    customers: LINKS.filter((l) => l[0] === s).map(([, to, what, basis]) => ({ sym: to, what, basis })),
  };
}

export const covered = () => [...new Set(LINKS.flatMap((l) => [l[0], l[1]]))].sort();
