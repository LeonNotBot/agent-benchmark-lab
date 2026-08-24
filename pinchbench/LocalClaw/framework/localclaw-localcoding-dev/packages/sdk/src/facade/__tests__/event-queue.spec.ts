import { describe, it, expect } from "vitest";
import { EventQueue } from "../event-queue";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("EventQueue 异步时序", () => {
  it("先 push 后消费：按序取出所有值", async () => {
    const q = new EventQueue<number>();
    q.push(1); q.push(2); q.push(3); q.end();
    expect(await collect(q)).toEqual([1, 2, 3]);
  });

  it("先消费后 push（背压）：next() 挂起直到 push", async () => {
    const q = new EventQueue<string>();
    const p = q[Symbol.asyncIterator]().next();
    q.push("late");
    q.end();
    expect(await p).toEqual({ value: "late", done: false });
  });

  it("end() 后迭代器 done", async () => {
    const q = new EventQueue<number>();
    q.end();
    const r = await q[Symbol.asyncIterator]().next();
    expect(r.done).toBe(true);
  });

  it("end() 后 push 被忽略", async () => {
    const q = new EventQueue<number>();
    q.push(1); q.end(); q.push(2);
    expect(await collect(q)).toEqual([1]);
  });

  it("fail() 让挂起的消费者抛错", async () => {
    const q = new EventQueue<number>();
    const p = q[Symbol.asyncIterator]().next();
    q.fail(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
  });

  it("fail() 前已有的值先耗尽再抛错", async () => {
    const q = new EventQueue<number>();
    q.push(1); q.push(2); q.fail(new Error("late boom"));
    const iter = q[Symbol.asyncIterator]();
    expect(await iter.next()).toEqual({ value: 1, done: false });
    expect(await iter.next()).toEqual({ value: 2, done: false });
    await expect(iter.next()).rejects.toThrow("late boom");
  });

  it("重复 end/fail 无副作用", async () => {
    const q = new EventQueue<number>();
    q.push(1); q.end(); q.end(); q.fail(new Error("ignored"));
    expect(await collect(q)).toEqual([1]);
  });
});
