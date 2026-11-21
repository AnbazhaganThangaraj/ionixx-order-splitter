/** The example from the brief: USD 100 into AAPL 60% / TSLA 40%. */
export const briefExampleRequest = {
  orderType: 'BUY',
  totalAmount: '100',
  currency: 'USD',
  portfolio: [
    { symbol: 'AAPL', allocation: '60' },
    { symbol: 'TSLA', allocation: '40' },
  ],
};

export const withPartnerPrices = {
  orderType: 'BUY',
  totalAmount: '100.00',
  portfolio: [
    { symbol: 'AAPL', allocation: '60', marketPrice: '150.00' },
    { symbol: 'TSLA', allocation: '40' },
  ],
};
