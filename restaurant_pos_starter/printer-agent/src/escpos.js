const ESC = 0x1b;
const GS = 0x1d;
const GROUP_TITLES = Object.freeze({ kitchen: 'KITCHEN TICKET', bar: 'BAR TICKET', other: 'PREPARATION TICKET' });

export class UnsupportedPrinterTextError extends Error {
  constructor(field) {
    super(`Printer text field "${field}" contains characters outside the supported printable ASCII set; Arabic and other Unicode text require a raster-capable printer renderer`);
    this.name = 'UnsupportedPrinterTextError';
    this.code = 'UNSUPPORTED_PRINTER_TEXT_ENCODING';
  }
}

function safeText(value, field, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || /[^\x20-\x7e]/.test(value)) {
    throw new UnsupportedPrinterTextError(field);
  }
  return value.trim();
}

function wrapText(value, width) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      if (word.length <= width) line = word;
      else {
        for (let offset = 0; offset < word.length; offset += width) lines.push(word.slice(offset, offset + width));
      }
      continue;
    }
    if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      if (word.length <= width) line = word;
      else {
        for (let offset = 0; offset < word.length; offset += width) lines.push(word.slice(offset, offset + width));
        line = '';
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatPayload(job, columns) {
  if (!job || !['kitchen', 'bar', 'other'].includes(job.routing_group) || !job.payload || typeof job.payload !== 'object') {
    throw new TypeError('Invalid claimed print job');
  }
  const payload = job.payload;
  if (payload.routingGroup !== job.routing_group || typeof payload.orderId !== 'string' ||
      !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
    throw new TypeError('Print job payload does not match its routing group or item limits');
  }
  const orderLabel = safeText(payload.orderId.slice(0, 8).toUpperCase(), 'orderId', 8);
  const tableLabel = payload.tableName
    ? safeText(payload.tableName, 'tableName', 80)
    : (payload.tableId ? `TABLE ${safeText(String(payload.tableId).slice(0, 8).toUpperCase(), 'tableId', 8)}` : 'TAKEAWAY');
  const createdAt = new Date(payload.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new TypeError('Print job has an invalid createdAt timestamp');
  const lines = [GROUP_TITLES[job.routing_group], `ORDER: ${orderLabel}`, `TABLE: ${tableLabel}`, `TIME: ${createdAt.toISOString().slice(0, 19).replace('T', ' ')}`, '-'.repeat(columns)];
  for (const item of payload.items) {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new TypeError('Print job contains an invalid item quantity');
    }
    const name = safeText(item.name, 'item name', 200);
    if (!name) throw new TypeError('Print job contains an empty item name');
    const prefix = `${item.quantity} x `;
    const nameLines = wrapText(name, Math.max(8, columns - prefix.length));
    lines.push(prefix + (nameLines.shift() || ''));
    for (const line of nameLines) lines.push(`  ${line}`);
    if (item.notes !== null && item.notes !== undefined && item.notes !== '') {
      const notes = safeText(item.notes, 'item notes', 500);
      lines.push(...wrapText(`NOTE: ${notes}`, columns).map(line => `  ${line}`));
    }
  }
  lines.push('-'.repeat(columns), '*** END OF TICKET ***');
  return lines;
}

/**
 * Produces conservative ESC/POS bytes for printers using the standard ASCII subset.
 * Non-ASCII text is rejected rather than silently printing corrupted characters.
 */
export function buildEscPosTicket(job, { columns = 42, cut = true } = {}) {
  if (!Number.isInteger(columns) || columns < 24 || columns > 64) throw new RangeError('columns must be between 24 and 64');
  const lines = formatPayload(job, columns);
  const chunks = [
    Buffer.from([ESC, 0x40]),       // Initialize
    Buffer.from([ESC, 0x74, 0x00]), // Select printer code page 0; emitted text is ASCII only
    Buffer.from([ESC, 0x61, 0x01]), // Center heading
    Buffer.from([GS, 0x21, 0x11]),  // Double width and height
    Buffer.from(`${lines[0]}\n`, 'ascii'),
    Buffer.from([GS, 0x21, 0x00]),
    Buffer.from([ESC, 0x61, 0x00]), // Left alignment
    Buffer.from(`${lines.slice(1).join('\n')}\n`, 'ascii'),
    Buffer.from([ESC, 0x64, 0x03])  // Feed three lines
  ];
  if (cut) chunks.push(Buffer.from([GS, 0x56, 0x01])); // Partial cut
  const output = Buffer.concat(chunks);
  if (output.length > 65536) throw new RangeError('Encoded print ticket exceeds 64 KB');
  return output;
}
