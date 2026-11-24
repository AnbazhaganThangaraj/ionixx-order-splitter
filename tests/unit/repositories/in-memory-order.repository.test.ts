import { InMemoryOrderRepository } from '../../../src/repositories/in-memory-order.repository';
import { makeOrder } from '../../fixtures/order-factory';

const PARTNER = 'partner-a';
const page = (extra: { limit?: number; offset?: number; orderType?: 'BUY' | 'SELL' } = {}) => ({
  partnerId: PARTNER,
  limit: 20,
  offset: 0,
  ...extra,
});

describe('InMemoryOrderRepository', () => {
  let repository: InMemoryOrderRepository;

  beforeEach(() => {
    repository = new InMemoryOrderRepository();
  });

  it('returns an empty page when there are no orders', async () => {
    await expect(repository.list(page())).resolves.toEqual({ items: [], total: 0 });
  });

  it('saves and finds an order by id', async () => {
    const order = makeOrder();
    await repository.save(order);
    await expect(repository.findById(PARTNER, order.orderId)).resolves.toEqual(order);
  });

  it('returns undefined for an unknown id', async () => {
    await expect(
      repository.findById(PARTNER, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });

  it('refuses to overwrite an existing order', async () => {
    const order = makeOrder();
    await repository.save(order);
    await expect(repository.save(order)).rejects.toThrow(/already exists/);
  });

  it('lists newest first, even when timestamps are identical', async () => {
    const first = makeOrder();
    const second = makeOrder();
    const third = makeOrder();
    for (const order of [first, second, third]) await repository.save(order);

    const result = await repository.list(page());
    expect(result.items.map((o) => o.orderId)).toEqual([
      third.orderId,
      second.orderId,
      first.orderId,
    ]);
    expect(result.total).toBe(3);
  });

  it('pages with limit and offset and reports the full total', async () => {
    const orders = Array.from({ length: 5 }, () => makeOrder());
    for (const order of orders) await repository.save(order);
    const newestFirst = [...orders].reverse().map((o) => o.orderId);

    const result = await repository.list(page({ limit: 2, offset: 1 }));
    expect(result.items.map((o) => o.orderId)).toEqual(newestFirst.slice(1, 3));
    expect(result.total).toBe(5);
  });

  it('returns an empty page when offset is past the end', async () => {
    await repository.save(makeOrder());
    await expect(repository.list(page({ limit: 10, offset: 5 }))).resolves.toEqual({
      items: [],
      total: 1,
    });
  });

  it('filters by order type before paging', async () => {
    const buy = makeOrder({ orderType: 'BUY' });
    const sell1 = makeOrder({ orderType: 'SELL' });
    const sell2 = makeOrder({ orderType: 'SELL' });
    for (const order of [buy, sell1, sell2]) await repository.save(order);

    const result = await repository.list(page({ limit: 1, orderType: 'SELL' }));
    expect(result.items.map((o) => o.orderId)).toEqual([sell2.orderId]);
    expect(result.total).toBe(2);
  });

  describe('partner isolation', () => {
    it("never returns another partner's order by id", async () => {
      const order = makeOrder({ partnerId: 'partner-b' });
      await repository.save(order);
      await expect(repository.findById(PARTNER, order.orderId)).resolves.toBeUndefined();
      await expect(repository.findById('partner-b', order.orderId)).resolves.toEqual(order);
    });

    it("only lists and counts the partner's own orders", async () => {
      const mine = makeOrder();
      await repository.save(mine);
      await repository.save(makeOrder({ partnerId: 'partner-b' }));
      await repository.save(makeOrder({ partnerId: 'partner-b' }));

      const result = await repository.list(page());
      expect(result.items.map((o) => o.orderId)).toEqual([mine.orderId]);
      expect(result.total).toBe(1);
    });
  });

  it('isolates stored data from callers (no shared references)', async () => {
    const order = makeOrder();
    await repository.save(order);

    const found = await repository.findById(PARTNER, order.orderId);
    (found as { totalAmount: string }).totalAmount = 'tampered';

    await expect(repository.findById(PARTNER, order.orderId)).resolves.toMatchObject({
      totalAmount: '100.00',
    });
  });

  it('starts empty for every new instance (data does not survive a restart)', async () => {
    await repository.save(makeOrder());
    const afterRestart = new InMemoryOrderRepository();
    await expect(afterRestart.list(page())).resolves.toEqual({ items: [], total: 0 });
  });
});

describe('InMemoryOrderRepository paging at scale', () => {
  it('pages correctly across partners and types with many orders', async () => {
    const repository = new InMemoryOrderRepository();
    const mine: string[] = [];
    for (let i = 0; i < 2_000; i++) {
      const orderType = i % 3 === 0 ? 'SELL' : 'BUY';
      const partnerId = i % 2 === 0 ? 'partner-a' : 'partner-b';
      const order = makeOrder({ orderType, partnerId });
      await repository.save(order);
      if (partnerId === 'partner-a' && orderType === 'SELL') mine.push(order.orderId);
    }
    const newestFirst = [...mine].reverse();

    const page = await repository.list({
      partnerId: 'partner-a',
      orderType: 'SELL',
      limit: 25,
      offset: 50,
    });
    expect(page.total).toBe(mine.length);
    expect(page.items.map((o) => o.orderId)).toEqual(newestFirst.slice(50, 75));

    const lastPage = await repository.list({
      partnerId: 'partner-a',
      orderType: 'SELL',
      limit: 25,
      offset: mine.length - 10,
    });
    expect(lastPage.items.map((o) => o.orderId)).toEqual(newestFirst.slice(-10));
  });
});
