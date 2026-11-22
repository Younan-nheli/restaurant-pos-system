import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTicketCursor, encodeTicketCursor } from '../src/domain/ticketCursor.js';

const cursorData = {
  createdAt: '2026-11-12T14:39:43.123456Z',
  itemId: '8f14e45f-ea6b-4c2a-9f1b-7c8d9e0a1b2c'
};

test('round-trips a versioned ticket cursor with microsecond timestamp precision', () => {
  const encoded = encodeTicketCursor(cursorData);
  assert.deepEqual(decodeTicketCursor(encoded), cursorData);
});

test('rejects malformed, non-canonical and oversized cursors', () => {
  for (const value of ['', 'not-base64!', 'eyJ2IjoyfQ', 'A'.repeat(513)]) {
    assert.throws(() => decodeTicketCursor(value), /Invalid ticket cursor/);
  }
});

test('rejects cursors with invalid timestamps, IDs, or unexpected fields', () => {
  const invalidPayloads = [
    { v: 1, createdAt: '2026-02-31T14:39:43.123456Z', itemId: cursorData.itemId },
    { v: 1, createdAt: cursorData.createdAt, itemId: 'not-a-uuid' },
    { v: 1, createdAt: cursorData.createdAt, itemId: cursorData.itemId, tenantId: 'other-tenant' }
  ];
  for (const payload of invalidPayloads) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.throws(() => decodeTicketCursor(encoded), /Invalid ticket cursor/);
  }
});

test('encoder refuses invalid cursor fields', () => {
  assert.throws(() => encodeTicketCursor({ ...cursorData, itemId: 'bad' }), /Invalid ticket cursor fields/);
  assert.throws(() => encodeTicketCursor({ ...cursorData, createdAt: 'yesterday' }), /Invalid ticket cursor fields/);
});
