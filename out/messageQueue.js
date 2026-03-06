"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageQueue = void 0;
/**
 * Async FIFO queue that processes one WebviewMessage at a time.
 *
 * Consecutive `timeUpdate` messages at the tail are de-duplicated so a fast
 * 100ms sync-loop can never build up a multi-second backlog.
 */
class MessageQueue {
    constructor() {
        this.items = [];
        this.running = false;
    }
    get isRunning() {
        return this.running;
    }
    enqueue(msg, process) {
        // De-duplicate trailing timeUpdate — always keep only the freshest time value
        if (msg.type === 'timeUpdate' &&
            this.items.length > 0 &&
            this.items[this.items.length - 1].type === 'timeUpdate') {
            this.items[this.items.length - 1] = msg;
            if (this.running) {
                return; // drain loop will pick up the replaced item on its next iteration
            }
        }
        else {
            this.items.push(msg);
        }
        if (!this.running) {
            this.drain(process);
        }
    }
    async drain(process) {
        this.running = true;
        while (this.items.length > 0) {
            const msg = this.items.shift();
            try {
                await process(msg);
            }
            catch (err) {
                console.error('CodeScrim MessageQueue: unhandled error', err);
            }
        }
        this.running = false;
    }
    clear() {
        this.items = [];
    }
}
exports.MessageQueue = MessageQueue;
//# sourceMappingURL=messageQueue.js.map