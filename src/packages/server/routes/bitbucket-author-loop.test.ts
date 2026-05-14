import { describe, it, expect } from 'vitest';
import { isBitbucketAuthorLoop } from './bitbucket-author-loop.js';

const BOT = 'review-bot';

describe('isBitbucketAuthorLoop', () => {
  describe('event-key gating', () => {
    it('does NOT guard pullrequest:created — actor is the PR author and we want to route', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:created', payload, BOT)).toBe(false);
    });

    it('does NOT guard pullrequest:updated — author updates are still meaningful', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:updated', payload, BOT)).toBe(false);
    });

    it('does NOT guard repo:push or other non-PR-comment events', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('repo:push', payload, BOT)).toBe(false);
    });

    it('does guard pullrequest:approved when actor is the bot', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, BOT)).toBe(true);
    });

    it('does guard pullrequest:comment_created when actor is the bot', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:comment_created', payload, BOT)).toBe(true);
    });

    it('does guard pullrequest:changes_request_created when actor is the bot', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:changes_request_created', payload, BOT)).toBe(true);
    });
  });

  describe('actor identity matching', () => {
    it('matches by nickname', () => {
      const payload = { actor: { nickname: BOT, uuid: '{a}', account_id: '557:b' } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, BOT)).toBe(true);
    });

    it('matches by uuid (with curly braces preserved as Bitbucket sends them)', () => {
      const payload = { actor: { nickname: 'someone-else', uuid: '{abc-1234}', account_id: '557:x' } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, '{abc-1234}')).toBe(true);
    });

    it('matches by account_id', () => {
      const payload = { actor: { nickname: 'someone-else', uuid: '{x}', account_id: '557058:bot-acct' } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, '557058:bot-acct')).toBe(true);
    });

    it('does NOT match when actor is a different human user', () => {
      const payload = { actor: { nickname: 'mark', uuid: '{abc}', account_id: '557:human' } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, BOT)).toBe(false);
    });
  });

  describe('disabled / malformed input', () => {
    it('returns false when BITBUCKET_BOT_USERNAME is unset (guard disabled)', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, undefined)).toBe(false);
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, '')).toBe(false);
    });

    it('returns false when eventKey is missing', () => {
      const payload = { actor: { nickname: BOT } };
      expect(isBitbucketAuthorLoop(undefined, payload, BOT)).toBe(false);
    });

    it('returns false when payload is missing or non-object', () => {
      expect(isBitbucketAuthorLoop('pullrequest:approved', null, BOT)).toBe(false);
      expect(isBitbucketAuthorLoop('pullrequest:approved', 'not an object', BOT)).toBe(false);
      expect(isBitbucketAuthorLoop('pullrequest:approved', {}, BOT)).toBe(false);
    });

    it('returns false when actor field is missing or non-object', () => {
      expect(isBitbucketAuthorLoop('pullrequest:approved', { actor: null }, BOT)).toBe(false);
      expect(isBitbucketAuthorLoop('pullrequest:approved', { actor: 'mark' }, BOT)).toBe(false);
    });

    it('ignores non-string actor fields', () => {
      const payload = { actor: { nickname: 42, uuid: { x: 1 }, account_id: null } };
      expect(isBitbucketAuthorLoop('pullrequest:approved', payload, BOT)).toBe(false);
    });
  });
});
