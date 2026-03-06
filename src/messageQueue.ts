import { WebviewMessage } from './types';

/**
 * Async FIFO queue that processes one WebviewMessage at a time.
 *
 * Consecutive `timeUpdate` messages at the tail are de-duplicated so a fast
 * 100ms sync-loop can never build up a multi-second backlog.
 */
export class MessageQueue {
  private items: WebviewMessage[] = [];
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  enqueue(msg: WebviewMessage, process: (msg: WebviewMessage) => Promise<void>): void {
    // De-duplicate trailing timeUpdate — always keep only the freshest time value
    if (
      msg.type === 'timeUpdate' &&
      this.items.length > 0 &&
      this.items[this.items.length - 1].type === 'timeUpdate'
    ) {
      this.items[this.items.length - 1] = msg;
      if (this.running) {
        return; // drain loop will pick up the replaced item on its next iteration
      }
    } else {
      this.items.push(msg);
    }

    if (!this.running) {
      this.drain(process);
    }
  }

  private async drain(process: (msg: WebviewMessage) => Promise<void>): Promise<void> {
    this.running = true;
    while (this.items.length > 0) {
      const msg = this.items.shift()!;
      try {
        await process(msg);
      } catch (err) {
        console.error('CodeScrim MessageQueue: unhandled error', err);
      }
    }
    this.running = false;
  }

  clear(): void {
    this.items = [];
  }
}
