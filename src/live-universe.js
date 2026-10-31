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
  // more large caps
  ['NOW', 'NOW', 'Technology', 'US'], ['INTU', 'INTU', 'Technology', 'US'], ['PANW', 'PANW', 'Technology', 'US'],
  ['PLTR', 'PLTR', 'Technology', 'US'], ['SHOP', 'SHOP', 'Technology', 'US'], ['UBER', 'UBER', 'Industrials', 'US'],
  ['ANET', 'ANET', 'Technology', 'US'], ['CSCO', 'CSCO', 'Technology', 'US'], ['ACN', 'ACN', 'Technology', 'US'],
  ['TXN', 'TXN', 'Semiconductors', 'US'], ['AMAT', 'AMAT', 'Semiconductors', 'US'], ['LRCX', 'LRCX', 'Semiconductors', 'US'],
  ['ARM', 'ARM', 'Semiconductors', 'EU'], ['WFC', 'WFC', 'Financials', 'US'], ['C', 'C', 'Financials', 'US'],
  ['AXP', 'AXP', 'Financials', 'US'], ['BLK', 'BLK', 'Financials', 'US'], ['SCHW', 'SCHW', 'Financials', 'US'],
  ['PYPL', 'PYPL', 'Financials', 'US'], ['COIN', 'COIN', 'Financials', 'US'], ['TMO', 'TMO', 'Health Care', 'US'],
  ['ISRG', 'ISRG', 'Health Care', 'US'], ['AMGN', 'AMGN', 'Health Care', 'US'], ['VRTX', 'VRTX', 'Health Care', 'US'],
  ['SLB', 'SLB', 'Energy', 'US'], ['OXY', 'OXY', 'Energy', 'US'], ['DE', 'DE', 'Industrials', 'US'],
  ['LMT', 'LMT', 'Industrials', 'US'], ['UNP', 'UNP', 'Industrials', 'US'], ['SBUX', 'SBUX', 'Consumer Disc.', 'US'],
  ['BKNG', 'BKNG', 'Consumer Disc.', 'US'], ['LOW', 'LOW', 'Consumer Disc.', 'US'], ['F', 'F', 'Consumer Disc.', 'US'],
  ['GM', 'GM', 'Consumer Disc.', 'US'], ['MDLZ', 'MDLZ', 'Consumer Staples', 'US'], ['PM', 'PM', 'Consumer Staples', 'US'],
  ['SHW', 'SHW', 'Materials', 'US'], ['CEG', 'CEG', 'Utilities', 'US'], ['TMUS', 'TMUS', 'Communication', 'US'],
  ['SPOT', 'SPOT', 'Communication', 'EU'], ['NTES', 'NTES', 'Communication', 'ASIA'], ['PDD', 'PDD', 'Consumer Disc.', 'ASIA'],
  ['O', 'O', 'Real Estate', 'US'],
];

// Exchange-traded funds: shown with stocks (sector "ETF"), left out of sector heat maps.
// [yahoo, display, name]
export const LIVE_ETFS = [
  ['SPY', 'SPY', 'SPDR S&P 500 ETF'], ['QQQ', 'QQQ', 'Invesco QQQ (Nasdaq 100)'], ['IWM', 'IWM', 'iShares Russell 2000'],
  ['DIA', 'DIA', 'SPDR Dow Jones'], ['TLT', 'TLT', 'iShares 20+Y Treasury'], ['HYG', 'HYG', 'iShares High Yield Corp'],
  ['LQD', 'LQD', 'iShares IG Corp Bond'], ['GLD', 'GLD', 'SPDR Gold Shares'], ['EEM', 'EEM', 'iShares MSCI Emerging'],
  ['XLK', 'XLK', 'Technology Select SPDR'], ['XLF', 'XLF', 'Financial Select SPDR'], ['XLE', 'XLE', 'Energy Select SPDR'],
  ['ARKK', 'ARKK', 'ARK Innovation'],
];

// [yahoo, display, name, region]
export const LIVE_INDICES = [
  ['^GSPC', 'SPX', 'S&P 500', 'US'], ['^NDX', 'NDX', 'Nasdaq 100', 'US'], ['^DJI', 'INDU', 'Dow Jones Industrial', 'US'],
  ['^RUT', 'RTY', 'Russell 2000', 'US'], ['^STOXX50E', 'SX5E', 'Euro Stoxx 50', 'EU'], ['^GDAXI', 'DAX', 'DAX 40', 'EU'],
  ['^FTSE', 'UKX', 'FTSE 100', 'EU'], ['^N225', 'NKY', 'Nikkei 225', 'ASIA'], ['^HSI', 'HSI', 'Hang Seng', 'ASIA'],
  ['^KS11', 'KOSPI', 'KOSPI', 'ASIA'], ['^VIX', 'VIX', 'CBOE Volatility Index', 'US'],
  ['^IXIC', 'CCMP', 'Nasdaq Composite', 'US'], ['^GSPTSE', 'SPTSX', 'S&P/TSX Composite', 'US'], ['^FCHI', 'CAC', 'CAC 40', 'EU'],
  ['^AXJO', 'AS51', 'S&P/ASX 200', 'ASIA'], ['^BSESN', 'SENSEX', 'BSE Sensex', 'ASIA'], ['000001.SS', 'SHCOMP', 'Shanghai Composite', 'ASIA'],
  ['^BVSP', 'IBOV', 'Bovespa', 'US'], ['^STOXX', 'SXXP', 'STOXX Europe 600', 'EU'],
];

// [yahoo, display, name]
export const LIVE_FX = [
  ['EURUSD=X', 'EURUSD', 'Euro / US Dollar'], ['GBPUSD=X', 'GBPUSD', 'British Pound / US Dollar'], ['JPY=X', 'USDJPY', 'US Dollar / Japanese Yen'],
  ['CHF=X', 'USDCHF', 'US Dollar / Swiss Franc'], ['AUDUSD=X', 'AUDUSD', 'Australian Dollar / US Dollar'], ['CAD=X', 'USDCAD', 'US Dollar / Canadian Dollar'],
  ['NZDUSD=X', 'NZDUSD', 'New Zealand Dollar / US Dollar'], ['CNH=X', 'USDCNH', 'US Dollar / Offshore Yuan'], ['INR=X', 'USDINR', 'US Dollar / Indian Rupee'],
  ['MXN=X', 'USDMXN', 'US Dollar / Mexican Peso'], ['BRL=X', 'USDBRL', 'US Dollar / Brazilian Real'], ['KRW=X', 'USDKRW', 'US Dollar / Korean Won'],
  ['EURGBP=X', 'EURGBP', 'Euro / British Pound'], ['EURJPY=X', 'EURJPY', 'Euro / Japanese Yen'], ['EURCHF=X', 'EURCHF', 'Euro / Swiss Franc'],
  ['SEK=X', 'USDSEK', 'US Dollar / Swedish Krona'], ['NOK=X', 'USDNOK', 'US Dollar / Norwegian Krone'], ['SGD=X', 'USDSGD', 'US Dollar / Singapore Dollar'],
  ['ZAR=X', 'USDZAR', 'US Dollar / South African Rand'], ['TRY=X', 'USDTRY', 'US Dollar / Turkish Lira'],
];

// [yahoo, display, name, unit]
export const LIVE_COMMODITIES = [
  ['CL=F', 'CL1', 'Crude Oil WTI (front)', 'USD/bbl'], ['BZ=F', 'CO1', 'Brent Crude (front)', 'USD/bbl'], ['NG=F', 'NG1', 'Natural Gas (front)', 'USD/MMBtu'],
  ['HO=F', 'HO1', 'Heating Oil (front)', 'USD/gal'], ['GC=F', 'GC1', 'Gold (front)', 'USD/oz'], ['SI=F', 'SI1', 'Silver (front)', 'USD/oz'],
  ['HG=F', 'HG1', 'Copper (front)', 'USD/lb'], ['PL=F', 'PL1', 'Platinum (front)', 'USD/oz'], ['ZC=F', 'C 1', 'Corn (front)', 'USd/bu'],
  ['ZW=F', 'W 1', 'Wheat (front)', 'USd/bu'], ['ZS=F', 'S 1', 'Soybeans (front)', 'USd/bu'], ['KC=F', 'KC1', 'Coffee (front)', 'USd/lb'],
  ['RB=F', 'XB1', 'RBOB Gasoline (front)', 'USD/gal'], ['PA=F', 'PA1', 'Palladium (front)', 'USD/oz'], ['CC=F', 'CC1', 'Cocoa (front)', 'USD/t'],
  ['SB=F', 'SB1', 'Sugar #11 (front)', 'USd/lb'], ['CT=F', 'CT1', 'Cotton (front)', 'USd/lb'], ['LE=F', 'LC1', 'Live Cattle (front)', 'USd/lb'],
  ['ALI=F', 'LA1', 'Aluminum (front)', 'USD/t'],
];

// [yahoo, display, name]
export const LIVE_CRYPTO = [
  ['BTC-USD', 'XBTUSD', 'Bitcoin'], ['ETH-USD', 'XETUSD', 'Ether'], ['SOL-USD', 'XSOUSD', 'Solana'],
  ['XRP-USD', 'XRPUSD', 'XRP'], ['ADA-USD', 'XADUSD', 'Cardano'], ['DOGE-USD', 'XDOUSD', 'Dogecoin'],
  ['BNB-USD', 'XBNUSD', 'BNB'], ['AVAX-USD', 'XAVUSD', 'Avalanche'], ['LINK-USD', 'XLKUSD', 'Chainlink'],
  ['DOT-USD', 'XDTUSD', 'Polkadot'], ['LTC-USD', 'XLTUSD', 'Litecoin'],
];

// Intraday US Treasury yields from Yahoo (CBOE yield indices). The 2Y has no such index, so
// it comes from the Treasury's official end-of-day curve instead, as do the euro-area curves
// (ECB); see src/live.js. [yahoo, display, tenor]
export const LIVE_BONDS = [
  ['^IRX', 'US3M', '3M'], ['^FVX', 'US5Y', '5Y'], ['^TNX', 'US10Y', '10Y'], ['^TYX', 'US30Y', '30Y'],
];
export const CURVE_TENORS = ['3M', '2Y', '5Y', '10Y', '30Y'];

export function liveSymbols() {
  return [...LIVE_EQUITIES, ...LIVE_ETFS, ...LIVE_INDICES, ...LIVE_FX, ...LIVE_COMMODITIES, ...LIVE_CRYPTO, ...LIVE_BONDS].map((r) => r[0]);
}

// Finnhub symbol for an instrument (stocks and crypto only; null = not streamed).
export function finnhubSymbol(ysym, cls) {
  if (cls === 'EQ') return ysym.replace('-', '.');
  if (cls === 'CRYPTO') return `BINANCE:${ysym.replace('-USD', '')}USDT`;
  return null;
}
