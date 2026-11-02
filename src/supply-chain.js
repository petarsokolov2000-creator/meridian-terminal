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
  MCK: 'McKesson',
  COR: 'Cencora',
  CAH: 'Cardinal Health',
  DELL: 'Dell Technologies',
  HPQ: 'HP Inc.',
  '0992.HK': 'Lenovo',
  '9910.TW': 'Feng Tay',
  '9904.TW': 'Pou Chen',
  DKS: "Dick's Sporting Goods",
  'NESN.SW': 'Nestlé',
  MAS: 'Masco (Behr paint)',
  '096770.KS': 'SK Innovation (SK On)',
  '6902.T': 'Denso',
  'UMG.AS': 'Universal Music Group',
  WMG: 'Warner Music Group',
  'EL.PA': 'EssilorLuxottica',
  '1810.HK': 'Xiaomi',
  '7974.T': 'Nintendo',
  NOK: 'Nokia',
  DG: 'Dollar General',
  DAL: 'Delta Air Lines',
  CCEP: 'Coca-Cola Europacific Partners',
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
  ['AMD', 'MSFT', 'Instinct AI GPUs and the Xbox processor', 'disclosed'],
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
  // ---- more chips and electronics
  ['SONY', 'AAPL', 'Camera image sensors', 'disclosed'],
  ['AMD', 'SONY', 'PlayStation 5 processor', 'disclosed'],
  ['NVDA', '7974.T', 'Processor for the Nintendo Switch consoles', 'disclosed'],
  ['QCOM', '1810.HK', 'Snapdragon chips for its phones', 'disclosed'],
  ['005930.KS', 'IBM', 'Manufactures its mainframe processors', 'disclosed'],
  ['INTC', 'DELL', 'PC and server processors (a top customer)', 'disclosed'],
  ['INTC', 'HPQ', 'PC processors (a top customer)', 'disclosed'],
  ['INTC', '0992.HK', 'PC processors (a top customer)', 'disclosed'],
  ['LRCX', 'INTC', 'Etch and deposition equipment', 'disclosed'],
  ['LIN', 'TSM', 'Industrial gases for chip plants', 'reported'],
  ['LIN', '005930.KS', 'Industrial gases for chip plants', 'disclosed'],

  // ---- software and internet
  ['AMZN', 'CRM', 'Cloud computing (AWS partnership)', 'disclosed'],
  ['GOOGL', 'SHOP', 'Cloud computing (Google Cloud)', 'disclosed'],
  ['PYPL', 'SHOP', 'PayPal checkout inside Shopify Payments', 'disclosed'],
  ['GOOGL', 'UBER', 'Maps and location services', 'disclosed'],
  ['ORCL', 'UBER', 'Cloud computing (Oracle Cloud)', 'disclosed'],
  ['GOOGL', 'BKNG', 'Search advertising (its biggest marketing channel)', 'disclosed'],
  ['SONY', 'SPOT', 'Music licences (Sony Music)', 'disclosed'],
  ['UMG.AS', 'SPOT', 'Music licences', 'disclosed'],
  ['WMG', 'SPOT', 'Music licences', 'disclosed'],
  ['EL.PA', 'META', 'Makes the Ray-Ban Meta smart glasses', 'disclosed'],

  // ---- medicines: the three big US wholesalers buy most of the drug makers' US sales
  ['LLY', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['LLY', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['LLY', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['ABBV', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['ABBV', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['ABBV', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['JNJ', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['JNJ', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['JNJ', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['MRK', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['MRK', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['MRK', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['PFE', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['PFE', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['PFE', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['AMGN', 'MCK', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['AMGN', 'COR', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['AMGN', 'CAH', 'Medicines (one of its three largest customers)', 'disclosed'],
  ['TMO', 'PFE', 'Lab equipment and contract manufacturing', 'reported'],

  // ---- cards and payments
  ['V', 'COST', "Card network for Costco's US credit card (Costco takes only Visa cards in the US)", 'disclosed'],
  ['C', 'COST', 'Issues the Costco Anywhere Visa card', 'disclosed'],
  ['AXP', 'DAL', 'Delta SkyMiles co-brand cards (its largest card partnership)', 'disclosed'],
  ['COIN', 'BLK', 'Bitcoin custody for the iShares Bitcoin Trust', 'disclosed'],

  // ---- cars
  ['096770.KS', 'F', 'Battery cells (BlueOval SK joint venture)', 'disclosed'],
  ['300750.SZ', 'F', 'Battery technology licence (Michigan battery plant)', 'disclosed'],
  ['6902.T', 'TM', 'Car parts and electronics (Toyota group supplier)', 'disclosed'],

  // ---- planes and defence
  ['RTX', 'LMT', 'F-35 engines (Pratt & Whitney F135)', 'disclosed'],
  ['HON', 'LMT', 'F-35 power and cooling systems', 'disclosed'],

  // ---- mining and materials
  ['CAT', 'BHP', 'Mining trucks and equipment (incl. self-driving haul trucks)', 'reported'],
  ['SHW', 'LOW', 'Paint sold in its stores (HGTV Home by Sherwin-Williams)', 'disclosed'],
  ['MAS', 'HD', 'Behr paint, sold only at Home Depot', 'disclosed'],

  // ---- shoes, coffee and drinks
  ['9910.TW', 'NKE', 'Makes Nike shoes', 'disclosed'],
  ['9904.TW', 'NKE', 'Makes Nike shoes', 'disclosed'],
  ['NKE', 'DKS', 'Shoes and clothing (a major store partner)', 'reported'],
  ['SBUX', 'PEP', 'Coffee for bottled Starbucks drinks (North American Coffee Partnership)', 'disclosed'],
  ['SBUX', 'NESN.SW', 'Starbucks coffee sold in shops worldwide (Global Coffee Alliance)', 'disclosed'],
  ['KO', 'CCEP', 'Drink concentrate for bottling', 'disclosed'],

  // ---- telecom networks
  ['ERIC', 'VZ', 'Radio network equipment', 'disclosed'],
  ['005930.KS', 'VZ', '5G network equipment', 'disclosed'],
  ['NOK', 'TMUS', 'Radio network equipment', 'disclosed'],
  ['ERIC', 'TMUS', 'Radio network equipment', 'disclosed'],

  // ---- property
  ['O', 'DG', 'Store leases (one of its largest tenants)', 'disclosed'],
  // ---- AI servers and cloud (companies added with the 1,000+ list)
  ['NVDA', 'SMCI', 'GPUs for its AI servers', 'disclosed'],
  ['NVDA', 'DELL', 'GPUs for its AI servers', 'disclosed'],
  ['NVDA', 'HPE', 'GPUs for its AI servers', 'disclosed'],
  ['NVDA', 'CRWV', 'GPUs for its AI cloud', 'disclosed'],
  ['CRWV', 'MSFT', 'Rented AI computing power (its largest customer)', 'disclosed'],
  ['NVDA', 'NBIS', 'GPUs for its AI cloud', 'disclosed'],
  ['NBIS', 'MSFT', 'Rented AI computing power (multi-year deal)', 'disclosed'],
  ['MRVL', 'AMZN', 'Custom AI and networking chips for AWS', 'disclosed'],
  ['TSM', 'MRVL', 'Manufactures its chips', 'reported'],
  ['KLAC', 'TSM', 'Chip inspection and measuring equipment', 'disclosed'],
  ['KLAC', '005930.KS', 'Chip inspection and measuring equipment', 'disclosed'],
  ['AMZN', 'SNOW', 'Cloud computing (AWS, where most of it runs)', 'disclosed'],
  ['AMZN', 'DDOG', 'Cloud computing (AWS)', 'disclosed'],
  ['AMZN', 'CRWD', 'Cloud computing (AWS)', 'disclosed'],
  ['AMZN', 'MDB', 'Cloud computing (AWS, one of the clouds it runs on)', 'disclosed'],
  ['GEV', 'CVX', 'Gas turbines for power plants for data centres', 'disclosed'],
  ['TLN', 'AMZN', 'Nuclear power for its data centres (Susquehanna plant)', 'disclosed'],

  // ---- medicines
  ['CAH', 'CVS', 'Generic and brand medicines (its largest customer)', 'disclosed'],
  ['REGN', 'SNY', 'Makes Dupixent, which the two sell together (collaboration)', 'disclosed'],
  ['BNTX', 'PFE', 'COVID vaccine developed together (profit-sharing partnership)', 'disclosed'],

  // ---- planes and freight
  ['BA', 'DAL', 'Passenger jets', 'disclosed'],
  ['BA', 'UAL', 'Passenger jets (incl. 787 Dreamliners)', 'disclosed'],
  ['BA', 'LUV', 'Passenger jets (an all-737 fleet)', 'disclosed'],
  ['BA', 'FDX', 'Freighter jets', 'disclosed'],
  ['RIVN', 'AMZN', 'Electric delivery vans', 'disclosed'],

  // ---- food, drinks and household goods: Walmart is the largest customer of most of them
  ['CL', 'WMT', 'Toothpaste, soap and pet food (Walmart ~11% of sales)', 'disclosed'],
  ['KMB', 'WMT', 'Tissues, nappies and paper (its largest customer)', 'disclosed'],
  ['CLX', 'WMT', 'Cleaning products (its largest customer)', 'disclosed'],
  ['CHD', 'WMT', 'Household products (its largest customer)', 'disclosed'],
  ['GIS', 'WMT', 'Cereal and packaged food (its largest customer)', 'disclosed'],
  ['KHC', 'WMT', 'Packaged food (its largest customer)', 'disclosed'],
  ['HSY', 'WMT', 'Chocolate and snacks (its largest customer)', 'disclosed'],
  ['CPB', 'WMT', 'Soup and snacks (its largest customer)', 'disclosed'],
  ['SJM', 'WMT', 'Coffee, peanut butter and pet food (its largest customer)', 'disclosed'],
  ['TSN', 'WMT', 'Chicken, beef and pork (its largest customer)', 'disclosed'],
  ['HRL', 'WMT', 'Meat and packaged food (its largest customer)', 'disclosed'],
  ['HAS', 'WMT', 'Toys and games (a top customer)', 'disclosed'],
  ['HAS', 'AMZN', 'Toys and games (a top customer)', 'disclosed'],
  ['PEP', 'YUM', 'Drinks for Taco Bell, KFC and Pizza Hut', 'disclosed'],
  ['CELH', 'PEP', 'Energy drinks it distributes (most of Celsius sales)', 'disclosed'],
  ['MNST', 'KO', "Energy drinks distributed through Coca-Cola's bottlers", 'disclosed'],
  // ---- oil and gas: service contracts and long-term LNG (liquefied gas) deals
  ['LNG', 'SHEL', 'LNG under long-term supply contracts', 'disclosed'],
  ['LNG', 'TTE', 'LNG under long-term supply contracts', 'disclosed'],
  ['LNG', 'EQNR', 'LNG under a long-term supply contract', 'disclosed'],
  ['VG', 'SHEL', 'LNG under a long-term contract (the subject of an arbitration)', 'disclosed'],
  ['VG', 'BP', 'LNG under a long-term contract (the subject of an arbitration)', 'disclosed'],
  ['BKR', 'VG', 'Gas liquefaction equipment for its LNG plants', 'disclosed'],
  ['SRE', 'COP', 'LNG from Port Arthur LNG (long-term purchase contract)', 'disclosed'],
  ['HAL', 'XOM', 'Drilling and well services', 'reported'],
  ['HAL', 'CVX', 'Drilling and well services', 'reported'],
  ['SLB', 'COP', 'Oilfield services and equipment', 'reported'],
  ['OXY', 'MSFT', 'Carbon-removal credits (1PointFive direct air capture)', 'disclosed'],

  // ---- banks and cards: who issues which card, on which network
  ['JPM', 'AMZN', 'Issues the Amazon Prime Visa card', 'disclosed'],
  ['JPM', 'UAL', 'Issues the United co-brand credit cards', 'disclosed'],
  ['JPM', 'MAR', 'Issues Marriott Bonvoy credit cards', 'disclosed'],
  ['AXP', 'MAR', 'Issues Marriott Bonvoy credit cards', 'disclosed'],
  ['AXP', 'HLT', 'Issues Hilton Honors credit cards', 'disclosed'],
  ['C', 'AAL', 'Issues the AAdvantage credit cards (sole issuer from 2026)', 'disclosed'],
  ['MA', 'C', 'Card network for Citi cards incl. AAdvantage', 'reported'],
  ['V', 'JPM', 'Card network for most Chase cards', 'reported'],
  ['SYF', 'AMZN', 'Amazon store credit cards', 'disclosed'],
  ['SYF', 'LOW', "Lowe's store credit cards", 'disclosed'],
  ['SYF', 'PYPL', 'PayPal Credit', 'disclosed'],

  // ---- index licences for funds
  ['MSCI', 'BLK', 'Index licences for iShares ETFs (its largest client)', 'disclosed'],
  ['SPGI', 'BLK', 'S&P index licences for iShares ETFs', 'reported'],
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
