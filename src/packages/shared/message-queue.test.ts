import { describe, expect, it } from 'vitest';
import {
  appendQueuedMessage,
  prependQueuedMessage,
  QUEUED_MESSAGE_SEPARATOR,
} from './message-queue.js';

describe('single-entry message queue', () => {
  it('creates one entry for the first message', () => {
    const queue: string[] = [];

    appendQueuedMessage(queue, 'first');

    expect(queue).toEqual(['first']);
  });

  it('appends later messages to the existing entry', () => {
    const queue = ['first'];

    appendQueuedMessage(queue, 'second');
    appendQueuedMessage(queue, 'third');

    expect(queue).toEqual([
      ['first', 'second', 'third'].join(QUEUED_MESSAGE_SEPARATOR),
    ]);
  });

  it('normalizes an older multi-entry queue when appending', () => {
    const queue = ['first', 'second'];

    appendQueuedMessage(queue, 'third');

    expect(queue).toEqual(['first\n\nsecond\n\nthird']);
  });

  it('restores a failed message ahead of newly queued content', () => {
    const queue = ['newer note'];

    prependQueuedMessage(queue, 'failed delivery');

    expect(queue).toEqual(['failed delivery\n\nnewer note']);
  });
});
