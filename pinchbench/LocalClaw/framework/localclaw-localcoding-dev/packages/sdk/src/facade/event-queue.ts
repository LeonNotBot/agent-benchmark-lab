/**
 * @internal 回调 → async iterator 的桥。
 *
 * 把「SDK 内部以 onEvent 回调推送事件」的控制反转模式，转成消费者友好的
 * `for await` 拉取模式：push() 入队，end()/fail() 终止，[Symbol.asyncIterator]
 * 产出一个会在有值时 resolve、在 end 后结束、在 fail 后抛出的迭代器。
 *
 * 用于 createAgent().run()：底层 RunnerService 仍走 onEvent，门面在回调里
 * 调 push/end，对外只暴露 async iterable。
 */
export class EventQueue<T> {
  private readonly values: T[] = [];
  /** 等待取值的消费者（队列空时 next() 挂起在此）。 */
  private pendingResolve: ((r: IteratorResult<T>) => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;
  private ended = false;
  private error: unknown = null;

  /** 入队一个值。若有消费者在等，直接交付。 */
  push(value: T): void {
    if (this.ended) return;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  /** 正常结束：耗尽现有值后迭代器 done。 */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve({ value: undefined as never, done: true });
    }
  }

  /** 异常结束：耗尽现有值后迭代器抛出 err。 */
  fail(err: unknown): void {
    if (this.ended) return;
    this.error = err;
    this.ended = true;
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject(err);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.error !== null) return Promise.reject(this.error);
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.pendingResolve = resolve;
          this.pendingReject = reject;
        });
      },
    };
  }
}
