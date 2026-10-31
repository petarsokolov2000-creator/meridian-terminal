// The simulated instrument universe. Every company here is fictional; currencies,
// commodities and government bond markets use their generic real-world names.

export const SECTORS = [
  'Technology', 'Semiconductors', 'Financials', 'Health Care', 'Energy', 'Industrials',
  'Consumer Disc.', 'Consumer Staples', 'Materials', 'Utilities', 'Communication', 'Real Estate',
];

// [ticker, name, sector, region]
const EQUITIES = [
  ['ARCX', 'Arcturix Systems', 'Technology', 'US'],
  ['NVLT', 'Novalight Software', 'Technology', 'US'],
  ['QBIT', 'Quobit Cloud', 'Technology', 'US'],
  ['HLXN', 'Helixon Data', 'Technology', 'US'],
  ['PRSM', 'Prismwave Networks', 'Technology', 'US'],
  ['VRDA', 'Veridata', 'Technology', 'EU'],
  ['SKPT', 'Skopt Digital', 'Technology', 'EU'],
  ['KNSH', 'Kanshi Electronics', 'Technology', 'ASIA'],
  ['TMRA', 'Tamura Interactive', 'Technology', 'ASIA'],
  ['SLCN', 'Silicona Devices', 'Semiconductors', 'US'],
  ['GATE', 'Gatelogic Micro', 'Semiconductors', 'US'],
  ['WAFR', 'Waferline Industries', 'Semiconductors', 'US'],
  ['PHTN', 'Photonix Semi', 'Semiconductors', 'EU'],
  ['LTHO', 'Lithora Equipment', 'Semiconductors', 'EU'],
  ['DKSM', 'Daekyo Semiconductor', 'Semiconductors', 'ASIA'],
  ['FNDR', 'Founders Mutual Bank', 'Financials', 'US'],
  ['GRNT', 'Granite Peak Capital', 'Financials', 'US'],
  ['LDGR', 'Ledgerline Payments', 'Financials', 'US'],
  ['BKSH', 'Bankshire Group', 'Financials', 'US'],
  ['HNSA', 'Hansa Kreditbank', 'Financials', 'EU'],
  ['AVRL', 'Averill Assurance', 'Financials', 'EU'],
  ['MRKA', 'Meruka Financial', 'Financials', 'ASIA'],
  ['CRDO', 'Cordova Re', 'Financials', 'EU'],
  ['VTLS', 'Vitalis Therapeutics', 'Health Care', 'US'],
  ['GNMX', 'Genomex Bio', 'Health Care', 'US'],
  ['CRDX', 'Cardiax Medical', 'Health Care', 'US'],
  ['MDLN', 'Medline Hollis', 'Health Care', 'US'],
  ['PHRA', 'Pharmaris', 'Health Care', 'EU'],
  ['SANV', 'Sanvera Labs', 'Health Care', 'EU'],
  ['TKBI', 'Takebi Pharma', 'Health Care', 'ASIA'],
  ['PTRA', 'Petrandes Energy', 'Energy', 'US'],
  ['BSNO', 'Basin Oil & Gas', 'Energy', 'US'],
  ['GLFR', 'Gulfridge Midstream', 'Energy', 'US'],
  ['NRSK', 'Nordsk Offshore', 'Energy', 'EU'],
  ['SOLR', 'Solaria Renewables', 'Energy', 'EU'],
  ['KYEN', 'Kyoen Resources', 'Energy', 'ASIA'],
  ['AXLE', 'Axleworth Industries', 'Industrials', 'US'],
  ['STRN', 'Sterner Aerospace', 'Industrials', 'US'],
  ['RLWY', 'Railway Continental', 'Industrials', 'US'],
  ['FRGO', 'Freightgo Logistics', 'Industrials', 'US'],
  ['MSCH', 'Maschinenwerk', 'Industrials', 'EU'],
  ['VLKR', 'Volker Automation', 'Industrials', 'EU'],
  ['HYDI', 'Hayadi Heavy', 'Industrials', 'ASIA'],
  ['SHPY', 'Shipyard Pacific', 'Industrials', 'ASIA'],
  ['LUXE', 'Luxemont', 'Consumer Disc.', 'EU'],
  ['DRVE', 'Drivetrain Motors', 'Consumer Disc.', 'US'],
  ['CRTX', 'Cartex Retail', 'Consumer Disc.', 'US'],
  ['STAY', 'Staybridge Resorts', 'Consumer Disc.', 'US'],
  ['STRD', 'Stride Athletic', 'Consumer Disc.', 'US'],
  ['MOTA', 'Motarai Auto', 'Consumer Disc.', 'ASIA'],
  ['BRSO', 'Brasso Fashion', 'Consumer Disc.', 'EU'],
  ['HRVS', 'Harvest Table Foods', 'Consumer Staples', 'US'],
  ['CLRW', 'Clearwater Beverages', 'Consumer Staples', 'US'],
  ['HOMD', 'Homedale Products', 'Consumer Staples', 'US'],
  ['NSTL', 'Nestor Alimenta', 'Consumer Staples', 'EU'],
  ['KRAM', 'Kramer Brewing', 'Consumer Staples', 'EU'],
  ['SKRA', 'Sakura Household', 'Consumer Staples', 'ASIA'],
  ['ORVN', 'Orevan Mining', 'Materials', 'US'],
  ['CHMX', 'Chemix Specialty', 'Materials', 'US'],
  ['STLW', 'Steelworth', 'Materials', 'US'],
  ['LTHM', 'Lithium Meridian', 'Materials', 'ASIA'],
  ['KPRA', 'Kupra Metals', 'Materials', 'EU'],
  ['PWRG', 'Powergrid Holdings', 'Utilities', 'US'],
  ['AQUA', 'Aquaterra Water', 'Utilities', 'US'],
  ['ENRV', 'Enervia', 'Utilities', 'EU'],
  ['TOHK', 'Tohoku Lightworks', 'Utilities', 'ASIA'],
  ['SGNL', 'Signalcast Media', 'Communication', 'US'],
  ['TLVX', 'Televox Wireless', 'Communication', 'US'],
  ['STRM', 'Streamhouse', 'Communication', 'US'],
  ['PXLS', 'Pixelsoft Games', 'Communication', 'ASIA'],
  ['ORNG', 'Oronge Telecom', 'Communication', 'EU'],
  ['TWRS', 'Towerstone REIT', 'Real Estate', 'US'],
  ['DPOT', 'Depot Logistics REIT', 'Real Estate', 'US'],
  ['URBN', 'Urbania Properties', 'Real Estate', 'EU'],
  ['MKTW', 'Makoto Realty', 'Real Estate', 'ASIA'],
];

// [ticker, name, region, level]
const INDICES = [
  ['MTUS500', 'Meridian US 500', 'US', 5840],
  ['MTUSTEC', 'Meridian US Tech 100', 'US', 20450],
  ['MTUSSML', 'Meridian US Small Cap', 'US', 2210],
  ['MTEU350', 'Meridian Europe 350', 'EU', 2045],
  ['MTDE40', 'Meridian Germany 40', 'EU', 19320],
  ['MTUK100', 'Meridian UK 100', 'EU', 8210],
  ['MTJP225', 'Meridian Japan 225', 'ASIA', 38900],
  ['MTHK50', 'Meridian Hong Kong 50', 'ASIA', 20150],
  ['MTKR200', 'Meridian Korea 200', 'ASIA', 352],
  ['MTVOL', 'Meridian Volatility Idx', 'US', 16.4],
];

// [pair, name, spot, annual vol, usd-sign: +1 if USD is the base]
const FX = [
  ['EURUSD', 'Euro / US Dollar', 1.0842, 0.075, -1],
  ['GBPUSD', 'British Pound / US Dollar', 1.2715, 0.08, -1],
  ['USDJPY', 'US Dollar / Japanese Yen', 151.42, 0.095, 1],
  ['USDCHF', 'US Dollar / Swiss Franc', 0.8812, 0.075, 1],
  ['AUDUSD', 'Australian Dollar / US Dollar', 0.6588, 0.1, -1],
  ['USDCAD', 'US Dollar / Canadian Dollar', 1.3684, 0.06, 1],
  ['NZDUSD', 'New Zealand Dollar / US Dollar', 0.6012, 0.105, -1],
  ['USDCNH', 'US Dollar / Offshore Yuan', 7.2318, 0.04, 1],
  ['USDINR', 'US Dollar / Indian Rupee', 83.41, 0.035, 1],
  ['USDMXN', 'US Dollar / Mexican Peso', 17.92, 0.12, 1],
  ['USDBRL', 'US Dollar / Brazilian Real', 5.012, 0.13, 1],
  ['USDKRW', 'US Dollar / Korean Won', 1352.6, 0.08, 1],
];

// [symbol, name, price, annual vol, group, unit]
const COMMODITIES = [
  ['CL1', 'Crude Oil WTI (front)', 78.42, 0.32, 'energy', 'USD/bbl'],
  ['CO1', 'Brent Crude (front)', 82.65, 0.3, 'energy', 'USD/bbl'],
  ['NG1', 'Natural Gas (front)', 2.618, 0.55, 'energy', 'USD/MMBtu'],
  ['HO1', 'Heating Oil (front)', 2.645, 0.33, 'energy', 'USD/gal'],
  ['XAU', 'Gold Spot', 2342.1, 0.15, 'metals', 'USD/oz'],
  ['XAG', 'Silver Spot', 27.84, 0.26, 'metals', 'USD/oz'],
  ['HG1', 'Copper (front)', 4.412, 0.22, 'metals', 'USD/lb'],
  ['XPT', 'Platinum Spot', 968.4, 0.24, 'metals', 'USD/oz'],
  ['C 1', 'Corn (front)', 4.415, 0.24, 'ags', 'USd/bu'],
  ['W 1', 'Wheat (front)', 5.862, 0.3, 'ags', 'USd/bu'],
  ['S 1', 'Soybeans (front)', 11.74, 0.2, 'ags', 'USd/bu'],
  ['KC1', 'Coffee (front)', 2.214, 0.34, 'ags', 'USd/lb'],
];

// [symbol, name, price, annual vol]
const CRYPTO = [
  ['XBTUSD', 'Bitcoin', 67420, 0.55],
  ['XETUSD', 'Ether', 3482, 0.68],
  ['XSOUSD', 'Solana', 152.4, 0.95],
  ['XRPUSD', 'XRP', 0.5214, 0.85],
  ['XADUSD', 'Cardano', 0.4482, 0.9],
  ['XDOUSD', 'Dogecoin', 0.1618, 1.05],
];

// Government curves: [country code, name, ccy, {tenor: yield %}]
export const CURVES = [
  ['US', 'United States', 'USD', { '3M': 5.38, '2Y': 4.72, '5Y': 4.31, '10Y': 4.28, '30Y': 4.45 }],
  ['DE', 'Germany', 'EUR', { '3M': 3.62, '2Y': 2.94, '5Y': 2.48, '10Y': 2.46, '30Y': 2.61 }],
  ['UK', 'United Kingdom', 'GBP', { '3M': 5.21, '2Y': 4.35, '5Y': 4.02, '10Y': 4.12, '30Y': 4.58 }],
  ['JP', 'Japan', 'JPY', { '3M': 0.08, '2Y': 0.32, '5Y': 0.55, '10Y': 0.92, '30Y': 2.01 }],
  ['IT', 'Italy', 'EUR', { '3M': 3.71, '2Y': 3.42, '5Y': 3.38, '10Y': 3.86, '30Y': 4.42 }],
  ['FR', 'France', 'EUR', { '3M': 3.65, '2Y': 3.01, '5Y': 2.82, '10Y': 3.04, '30Y': 3.48 }],
];
export const TENORS = ['3M', '2Y', '5Y', '10Y', '30Y'];
export const TENOR_YEARS = { '3M': 0.25, '2Y': 2, '5Y': 5, '10Y': 10, '30Y': 30 };

export const RAW = { EQUITIES, INDICES, FX, COMMODITIES, CRYPTO };
