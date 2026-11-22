import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEscPosTicket, UnsupportedPrinterTextError } from '../src/escpos.js';

const job = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  routing_group: 'kitchen',
  payload: {
    orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tableId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    tableName: 'Terrace 4',
    createdAt: '2026-11-16T10:15:30.000Z',
    routingGroup: 'kitchen',
    items: [
      { name: 'Chicken Burger', quantity: 2, notes: 'No onions' },
      { name: 'Fries', quantity: 1, notes: null }
    ]
  }
};

test('builds a kitchen ESC/POS ticket with table snapshot, quantities and notes', () => {
  const bytes = buildEscPosTicket(job, { columns: 32 });
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]);
  const text = bytes.toString('ascii');
  assert.match(text, /KITCHEN TICKET/);
  assert.match(text, /TABLE: Terrace 4/);
  assert.match(text, /2 x Chicken Burger/);
  assert.match(text, /NOTE: No onions/);
  assert.match(text, /1 x Fries/);
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x01]);
});

test('uses the correct bar heading and can omit the cutter command', () => {
  const barJob = { ...job, routing_group: 'bar', payload: { ...job.payload, routingGroup: 'bar' } };
  const bytes = buildEscPosTicket(barJob, { cut: false });
  assert.match(bytes.toString('ascii'), /BAR TICKET/);
  assert.notDeepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x01]);
});

test('rejects Arabic/Unicode rather than silently printing corrupted text', () => {
  const arabicJob = { ...job, payload: { ...job.payload, items: [{ name: 'برغر', quantity: 1 }] } };
  assert.throws(() => buildEscPosTicket(arabicJob), UnsupportedPrinterTextError);
});

test('rejects mismatched routing, invalid quantities, controls and invalid column widths', () => {
  assert.throws(() => buildEscPosTicket({ ...job, payload: { ...job.payload, routingGroup: 'bar' } }), /does not match/);
  assert.throws(() => buildEscPosTicket({ ...job, payload: { ...job.payload, items: [{ name: 'Soup', quantity: 0 }] } }), /quantity/);
  assert.throws(() => buildEscPosTicket({ ...job, payload: { ...job.payload, items: [{ name: 'Soup\nVOID', quantity: 1 }] } }), UnsupportedPrinterTextError);
  assert.throws(() => buildEscPosTicket(job, { columns: 12 }), /columns/);
});
