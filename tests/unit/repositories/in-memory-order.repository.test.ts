import { InMemoryOrderRepository } from '../../../src/repositories/in-memory-order.repository';
import { makeOrder } from '../../fixtures/order-factory';

describe('InMemoryOrderRepository', () => {
  let repository: InMemoryOrderRepository;

  beforeEach(() => {
    repository = new InMemoryOrderRepository();
  });

  it('returns an empty page when there are no orders', async () => {
    await expect(repository.list({ limit: 20, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('saves and finds an order by id', async () => {
    const order = makeOrder();
    await repository.save(order);
    await expect(repository.findById(order.orderId)).resolves.toEqual(order);
  });

  it('returns undefined for an unknown id', async () => {
    await expect(
      repository.findById('00000000-0000-4000-8000-000000000000'),
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

    const page = await repository.list({ limit: 20, offset: 0 });
    expect(page.items.map((o) => o.orderId)).toEqual([
      third.orderId,
      second.orderId,
      first.orderId,
    ]);
    expect(page.total).toBe(3);
  });

  it('pages with limit and offset and reports the full total', async () => {
    const orders = Array.from({ length: 5 }, () => makeOrder());
    for (const order of orders) await repository.save(order);
    const newestFirst = [...orders].reverse().map((o) => o.orderId);

    const page = await repository.list({ limit: 2, offset: 1 });
    expect(page.items.map((o) => o.orderId)).toEqual(newestFirst.slice(1, 3));
    expect(page.total).toBe(5);
  });

  it('returns an empty page when offset is past the end', async () => {
    await repository.save(makeOrder());
    await expect(repository.list({ limit: 10, offset: 5 })).resolves.toEqual({
      items: [],
      total: 1,
    });
  });

  it('filters by order type before paging', async () => {
    const buy = makeOrder({ orderType: 'BUY' });
    const sell1 = makeOrder({ orderType: 'SELL' });
    const sell2 = makeOrder({ orderType: 'SELL' });
    for (const order of [buy, sell1, sell2]) await repository.save(order);

    const page = await repository.list({ limit: 1, offset: 0, orderType: 'SELL' });
    expect(page.items.map((o) => o.orderId)).toEqual([sell2.orderId]);
    expect(page.total).toBe(2);
  });

  it('isolates stored data from callers (no shared references)', async () => {
    const order = makeOrder();
    await repository.save(order);

    const found = await repository.findById(order.orderId);
    (found as { totalAmount: string }).totalAmount = 'tampered';

    await expect(repository.findById(order.orderId)).resolves.toMatchObject({
      totalAmount: '100.00',
    });
  });

  it('starts empty for every new instance (data does not survive a restart)', async () => {
    await repository.save(makeOrder());
    const afterRestart = new InMemoryOrderRepository();
    await expect(afterRestart.list({ limit: 20, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});
