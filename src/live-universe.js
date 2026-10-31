// The real-data universe: Yahoo Finance symbols with the terminal's own sector and region
// labels. Display tickers drop Yahoo's suffixes (=X, =F, -USD) where that stays unambiguous.

// [yahoo symbol, display ticker, sector, region]
export const LIVE_EQUITIES = [
  ['AAPL', 'AAPL', 'Technology', 'US'], ['MSFT', 'MSFT', 'Technology', 'US'], ['ORCL', 'ORCL', 'Technology', 'US'],
  ['CRM', 'CRM', 'Technology', 'US'], ['ADBE', 'ADBE', 'Technology', 'US'], ['IBM', 'IBM', 'Technology', 'US'],
  ['SAP', 'SAP', 'Technology', 'EU'], ['SONY', 'SONY', 'Technology', 'ASIA'],
  ['NVDA', 'NVDA', 'Semiconductors', 'US'], ['AVGO', 'AVGO', 'Semiconductors', 'US'], ['AMD', 'AMD', 'Semiconductors', 'US'],
  ['INTC', 'INTC', 'Semiconductors', 'US'], ['QCOM', 'QCOM', 'Semiconductors', 'US'], ['MU', 'MU', 'Semiconductors', 'US'],
  ['TSM', 'TSM', 'Semiconductors', 'ASIA'], ['ASML', 'ASML', 'Semiconductors', 'EU'],
  ['JPM', 'JPM', 'Financials', 'US'], ['BAC', 'BAC', 'Financials', 'US'], ['GS', 'GS', 'Financials', 'US'],
  ['MS', 'MS', 'Financials', 'US'], ['V', 'V', 'Financials', 'US'], ['MA', 'MA', 'Financials', 'US'],
  ['BRK-B', 'BRK/B', 'Financials', 'US'], ['HSBC', 'HSBC', 'Financials', 'EU'], ['MUFG', 'MUFG', 'Financials', 'ASIA'],
  ['LLY', 'LLY', 'Health Care', 'US'], ['UNH', 'UNH', 'Health Care', 'US'], ['JNJ', 'JNJ', 'Health Care', 'US'],
  ['MRK', 'MRK', 'Health Care', 'US'], ['ABBV', 'ABBV', 'Health Care', 'US'], ['PFE', 'PFE', 'Health Care', 'US'],
  ['NVO', 'NVO', 'Health Care', 'EU'], ['AZN', 'AZN', 'Health Care', 'EU'],
  ['XOM', 'XOM', 'Energy', 'US'], ['CVX', 'CVX', 'Energy', 'US'], ['COP', 'COP', 'Energy', 'US'],
  ['SHEL', 'SHEL', 'Energy', 'EU'], ['BP', 'BP', 'Energy', 'EU'], ['TTE', 'TTE', 'Energy', 'EU'],
  ['CAT', 'CAT', 'Industrials', 'US'], ['GE', 'GE', 'Industrials', 'US'], ['BA', 'BA', 'Industrials', 'US'],
  ['HON', 'HON', 'Industrials', 'US'], ['UPS', 'UPS', 'Industrials', 'US'], ['RTX', 'RTX', 'Industrials', 'US'],
  ['AMZN', 'AMZN', 'Consumer Disc.', 'US'], ['TSLA', 'TSLA', 'Consumer Disc.', 'US'], ['HD', 'HD', 'Consumer Disc.', 'US'],
  ['MCD', 'MCD', 'Consumer Disc.', 'US'], ['NKE', 'NKE', 'Consumer Disc.', 'US'], ['TM', 'TM', 'Consumer Disc.', 'ASIA'],
  ['BABA', 'BABA', 'Consumer Disc.', 'ASIA'],
  ['WMT', 'WMT', 'Consumer Staples', 'US'], ['PG', 'PG', 'Consumer Staples', 'US'], ['KO', 'KO', 'Consumer Staples', 'US'],
  ['PEP', 'PEP', 'Consumer Staples', 'US'], ['COST', 'COST', 'Consumer Staples', 'US'], ['UL', 'UL', 'Consumer Staples', 'EU'],
  ['LIN', 'LIN', 'Materials', 'US'], ['FCX', 'FCX', 'Materials', 'US'], ['NEM', 'NEM', 'Materials', 'US'], ['BHP', 'BHP', 'Materials', 'ASIA'],
  ['NEE', 'NEE', 'Utilities', 'US'], ['DUK', 'DUK', 'Utilities', 'US'], ['SO', 'SO', 'Utilities', 'US'],
  ['GOOGL', 'GOOGL', 'Communication', 'US'], ['META', 'META', 'Communication', 'US'], ['NFLX', 'NFLX', 'Communication', 'US'],
  ['DIS', 'DIS', 'Communication', 'US'], ['T', 'T', 'Communication', 'US'], ['VZ', 'VZ', 'Communication', 'US'],
  ['PLD', 'PLD', 'Real Estate', 'US'], ['AMT', 'AMT', 'Real Estate', 'US'], ['EQIX', 'EQIX', 'Real Estate', 'US'],
];

// [yahoo, display, name, region]
export const LIVE_INDICES = [
  ['^GSPC', 'SPX', 'S&P 500', 'US'], ['^NDX', 'NDX', 'Nasdaq 100', 'US'], ['^DJI', 'INDU', 'Dow Jones Industrial', 'US'],
  ['^RUT', 'RTY', 'Russell 2000', 'US'], ['^STOXX50E', 'SX5E', 'Euro Stoxx 50', 'EU'], ['^GDAXI', 'DAX', 'DAX 40', 'EU'],
  ['^FTSE', 'UKX', 'FTSE 100', 'EU'], ['^N225', 'NKY', 'Nikkei 225', 'ASIA'], ['^HSI', 'HSI', 'Hang Seng', 'ASIA'],
  ['^KS11', 'KOSPI', 'KOSPI', 'ASIA'], ['^VIX', 'VIX', 'CBOE Volatility Index', 'US'],
];

// [yahoo, display, name]
export const LIVE_FX = [
  ['EURUSD=X', 'EURUSD', 'Euro / US Dollar'], ['GBPUSD=X', 'GBPUSD', 'British Pound / US Dollar'], ['JPY=X', 'USDJPY', 'US Dollar / Japanese Yen'],
  ['CHF=X', 'USDCHF', 'US Dollar / Swiss Franc'], ['AUDUSD=X', 'AUDUSD', 'Australian Dollar / US Dollar'], ['CAD=X', 'USDCAD', 'US Dollar / Canadian Dollar'],
  ['NZDUSD=X', 'NZDUSD', 'New Zealand Dollar / US Dollar'], ['CNH=X', 'USDCNH', 'US Dollar / Offshore Yuan'], ['INR=X', 'USDINR', 'US Dollar / Indian Rupee'],
  ['MXN=X', 'USDMXN', 'US Dollar / Mexican Peso'], ['BRL=X', 'USDBRL', 'US Dollar / Brazilian Real'], ['KRW=X', 'USDKRW', 'US Dollar / Korean Won'],
];

// [yahoo, display, name, unit]
export const LIVE_COMMODITIES = [
  ['CL=F', 'CL1', 'Crude Oil WTI (front)', 'USD/bbl'], ['BZ=F', 'CO1', 'Brent Crude (front)', 'USD/bbl'], ['NG=F', 'NG1', 'Natural Gas (front)', 'USD/MMBtu'],
  ['HO=F', 'HO1', 'Heating Oil (front)', 'USD/gal'], ['GC=F', 'GC1', 'Gold (front)', 'USD/oz'], ['SI=F', 'SI1', 'Silver (front)', 'USD/oz'],
  ['HG=F', 'HG1', 'Copper (front)', 'USD/lb'], ['PL=F', 'PL1', 'Platinum (front)', 'USD/oz'], ['ZC=F', 'C 1', 'Corn (front)', 'USd/bu'],
  ['ZW=F', 'W 1', 'Wheat (front)', 'USd/bu'], ['ZS=F', 'S 1', 'Soybeans (front)', 'USd/bu'], ['KC=F', 'KC1', 'Coffee (front)', 'USd/lb'],
];

// [yahoo, display, name]
export const LIVE_CRYPTO = [
  ['BTC-USD', 'XBTUSD', 'Bitcoin'], ['ETH-USD', 'XETUSD', 'Ether'], ['SOL-USD', 'XSOUSD', 'Solana'],
  ['XRP-USD', 'XRPUSD', 'XRP'], ['ADA-USD', 'XADUSD', 'Cardano'], ['DOGE-USD', 'XDOUSD', 'Dogecoin'],
];

// Intraday US Treasury yields from Yahoo (CBOE yield indices). The 2Y has no such index, so
// it comes from the Treasury's official end-of-day curve instead, as do the euro-area curves
// (ECB); see src/live.js. [yahoo, display, tenor]
export const LIVE_BONDS = [
  ['^IRX', 'US3M', '3M'], ['^FVX', 'US5Y', '5Y'], ['^TNX', 'US10Y', '10Y'], ['^TYX', 'US30Y', '30Y'],
];
export const CURVE_TENORS = ['3M', '2Y', '5Y', '10Y', '30Y'];

export function liveSymbols() {
  return [...LIVE_EQUITIES, ...LIVE_INDICES, ...LIVE_FX, ...LIVE_COMMODITIES, ...LIVE_CRYPTO, ...LIVE_BONDS].map((r) => r[0]);
}

// Finnhub symbol for an instrument (stocks and crypto only; null = not streamed).
export function finnhubSymbol(ysym, cls) {
  if (cls === 'EQ') return ysym.replace('-', '.');
  if (cls === 'CRYPTO') return `BINANCE:${ysym.replace('-USD', '')}USDT`;
  return null;
}
