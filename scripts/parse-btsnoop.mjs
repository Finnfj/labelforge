#!/usr/bin/env node
/**
 * Decode an Android Bluetooth HCI snoop log down to the printer's ATT traffic.
 *
 *   node scripts/parse-btsnoop.mjs captures/btsnoop_hci.log
 *
 * The point of this is to settle, with facts rather than inference, what the vendor
 * app sends around a print — in particular whether it issues any gap-seek or motion
 * command we have not found in the SDK. See docs/PROTOCOL.md, "What is left".
 *
 * A snoop log is every Bluetooth packet the phone saw, so it contains other devices'
 * traffic too. This tool therefore reports other connections as counts only and
 * prints packet contents for the printer's connection alone, unless --all is given.
 *
 * Options:
 *   --name <substr>  device name to treat as the printer (default: P50)
 *   --all            decode every connection, not just the printer's
 *   --full           do not abbreviate long payloads (the raster is large)
 *   --max <n>        stop after n ATT packets in the timeline
 *
 * Format references: btsnoop file format (Symbian/Frontline, as used by Android),
 * Bluetooth Core spec vol 4 part E (HCI) and vol 3 part F (ATT).
 */
import { readFileSync } from 'node:fs'

/** Microseconds between the btsnoop epoch (0000-01-01) and the Unix epoch. */
const UNIX_EPOCH_MICROS = 62_168_256_000_000_000n

const H4 = { COMMAND: 0x01, ACL: 0x02, SCO: 0x03, EVENT: 0x04 }

const ATT_OPCODE = {
  0x01: 'Error Response',
  0x02: 'Exchange MTU Request',
  0x03: 'Exchange MTU Response',
  0x04: 'Find Information Request',
  0x05: 'Find Information Response',
  0x06: 'Find By Type Value Request',
  0x07: 'Find By Type Value Response',
  0x08: 'Read By Type Request',
  0x09: 'Read By Type Response',
  0x0a: 'Read Request',
  0x0b: 'Read Response',
  0x0c: 'Read Blob Request',
  0x0d: 'Read Blob Response',
  0x10: 'Read By Group Type Request',
  0x11: 'Read By Group Type Response',
  0x12: 'Write Request',
  0x13: 'Write Response',
  0x16: 'Prepare Write Request',
  0x18: 'Execute Write Request',
  0x1b: 'Handle Value Notification',
  0x1d: 'Handle Value Indication',
  0x1e: 'Handle Value Confirmation',
  0x52: 'Write Command',
}

/**
 * Commands we already know, so anything unrecognised stands out.
 *
 * Deliberately a duplicate of src/printer/protocol/commands.ts rather than an import:
 * this script must run on a bare `node` with no build step, and a lookup table in a
 * diagnostic tool is cheap to keep honest. Longest prefix wins.
 */
const KNOWN = [
  ['1fc00100', 'startPrintJob'],
  ['1fc00101', 'stopPrintJob'],
  ['1fb200', 'setBluetoothType'],
  ['1f1151', 'alignPaperStart'],
  ['1f1150', 'alignPaperEnd'],
  ['1f1100', 'adjustPosition forward dots'],
  ['1f1101', 'adjustPosition forward mm'],
  ['1f1110', 'adjustPosition back dots'],
  ['1f1111', 'adjustPosition back mm'],
  ['1f1210', 'locate none'],
  ['1f1220', 'locate gap'],
  ['1f1230', 'locate black mark'],
  ['1f8001', 'setPaperType'],
  ['1f8000', 'getPaperType'],
  ['1f8002', 'setPaperType (silent variant)'],
  ['1f7001', 'setDensity'],
  ['1f7000', 'getDensity'],
  ['1f7002', 'setPrintParams (vendor: density + 6 zero bytes)'],
  ['1f6001', 'setSpeed'],
  ['1f6000', 'getSpeed'],
  ['1f40', 'selfCheck'],
  ['1f3060', 'learnPaper'],
  ['1f30', 'getSensor'],
  ['1f2000', 'printerStatus'],
  ['1f10', '*** RASTER IMAGE HEADER ***'],
  ['1f50be', '!! factory reset !!'],
  ['1fa0be', '!! bootloader !!'],
  ['10ff03', 'learnLabelGap'],
  ['10ff12', 'setShutdownMinutes'],
  ['10ff13', 'getShutdownMinutes'],
  ['10ff1000', 'setDensityLegacy'],
  ['10ff20f0', 'getPrinterModel'],
  ['10ff20f1', 'getPrinterVersion'],
  ['10ff20f2', 'getPrinterSerial'],
  ['10ff3010', 'getBluetoothVersion'],
  ['10ff3011', 'getBluetoothName'],
  ['10ff3012', 'getBluetoothMac'],
  ['10ff40', 'getStatusFlags'],
  ['10ff50f1', 'getPrinterBattery'],
  ['10ff50f2', 'getLabelHeight'],
  ['10ff70', 'getPrinterInfo'],
  ['1d0c', 'locateLabel'],
  ['1b4a', 'feedDotLines (ESC J)'],
  ['1b40', 'ESC @ initialise'],
  ['0c', 'bare form feed'],
].sort((a, b) => b[0].length - a[0].length)

function identify(hex) {
  for (const [prefix, name] of KNOWN) if (hex.startsWith(prefix)) return name
  return null
}

// --- arguments ------------------------------------------------------------

const TAKES_VALUE = new Set(['--name', '--max'])

const opts = { name: 'P50', max: '0' }
const bare = new Set()
let path = null
for (let i = 0, argv = process.argv.slice(2); i < argv.length; i++) {
  const arg = argv[i]
  if (TAKES_VALUE.has(arg)) opts[arg.slice(2)] = argv[++i]
  else if (arg.startsWith('--')) bare.add(arg)
  else path ??= arg
}

const wantName = String(opts.name).toLowerCase()
const decodeAll = bare.has('--all')
const full = bare.has('--full')
const maxPackets = Number(opts.max) || Infinity

if (!path) {
  console.error(
    'usage: node scripts/parse-btsnoop.mjs <btsnoop_hci.log> [--all] [--name P50] [--full]',
  )
  process.exit(2)
}

// --- record iteration ----------------------------------------------------

function* records(buf) {
  if (buf.length < 16) throw new Error('file is too short to be a btsnoop log')
  const magic = buf.subarray(0, 8).toString('latin1')
  if (!magic.startsWith('btsnoop')) {
    throw new Error(
      `not a btsnoop log (starts with ${JSON.stringify(magic)}). If this is a bugreport zip, ` +
        'extract FS/data/misc/bluetooth/logs/btsnoop_hci.log from it first.',
    )
  }
  const datalink = buf.readUInt32BE(12)
  if (datalink !== 1001 && datalink !== 1002 && datalink !== 1003) {
    console.error(`warning: unexpected datalink type ${datalink}; expected an HCI UART log`)
  }

  let off = 16
  while (off + 24 <= buf.length) {
    const included = buf.readUInt32BE(off + 4)
    const packetFlags = buf.readUInt32BE(off + 8)
    const ts = buf.readBigUInt64BE(off + 16)
    const end = off + 24 + included
    if (end > buf.length) break // truncated tail; take what we have
    yield { received: (packetFlags & 1) === 1, ts, data: buf.subarray(off + 24, end) }
    off = end
  }
}

// --- formatting ---------------------------------------------------------

const hex = (b) => Buffer.from(b).toString('hex')
const spaced = (b) => hex(b).replace(/(..)/g, '$1 ').trim()

function abbreviate(b) {
  if (full || b.length <= 40) return spaced(b)
  return `${spaced(b.subarray(0, 32))} … ${spaced(b.subarray(b.length - 4))}  (${b.length} bytes)`
}

const BASE_UUID_SUFFIX = '00001000800000805f9b34fb'

function fmtUuid(bytes) {
  if (bytes.length === 2) return bytes.readUInt16LE(0).toString(16).padStart(4, '0')
  if (bytes.length === 4) return bytes.readUInt32LE(0).toString(16).padStart(8, '0')
  if (bytes.length !== 16) return hex(bytes)
  const be = hex(Buffer.from(bytes).reverse())
  // A 128-bit UUID built on the Bluetooth base is really a 16-bit one; showing it
  // as ff02 rather than 0000ff02-… is what makes the timeline readable.
  if (be.slice(8) === BASE_UUID_SUFFIX && be.slice(0, 4) === '0000') return be.slice(4, 8)
  return `${be.slice(0, 8)}-${be.slice(8, 12)}-${be.slice(12, 16)}-${be.slice(16, 20)}-${be.slice(20)}`
}

const fmtAddr = (b) => hex(Buffer.from(b).reverse()).replace(/(..)(?=.)/g, '$1:')

function fmtTime(ts, first) {
  const unix = Number(ts - UNIX_EPOCH_MICROS) / 1000
  const wall = Number.isFinite(unix) && unix > 0 ? new Date(unix).toISOString().slice(11, 23) : '??'
  return `${wall}  +${((Number(ts - first) / 1e6).toFixed(3) + 's').padStart(9)}`
}

// --- state ---------------------------------------------------------------

/** Advertised name per device address, from advertising reports. */
const addrName = new Map()
/** ACL connection handle → peer address. */
const connAddr = new Map()
/** ATT handle → UUID string, learned from discovery in the capture itself. */
const attUuid = new Map()
/** ACL handle → L2CAP reassembly state. */
const asm = new Map()
/** ACL handle → the type of the outstanding Read By Type Request. */
const pendingType = new Map()

const attPackets = []
const otherTraffic = new Map()

// --- HCI events ----------------------------------------------------------

function parseAdvertisingData(buf) {
  let i = 0
  while (i < buf.length) {
    const len = buf[i]
    if (len === 0 || i + 1 + len > buf.length) break
    const type = buf[i + 1]
    if (type === 0x08 || type === 0x09) {
      return buf.subarray(i + 2, i + 1 + len).toString('utf8')
    }
    i += 1 + len
  }
  return null
}

function handleEvent(d) {
  if (d.length < 2) return
  const code = d[0]
  const params = d.subarray(2, 2 + d[1])

  if (code === 0x3e && params.length >= 1) {
    const sub = params[0]
    // LE Connection Complete (0x01) and its Enhanced form (0x0a) share the layout
    // up to and including the peer address, which is all we need.
    if ((sub === 0x01 || sub === 0x0a) && params.length >= 12 && params[1] === 0x00) {
      connAddr.set(params.readUInt16LE(2), fmtAddr(params.subarray(6, 12)))
    } else if (sub === 0x02 && params.length >= 2) {
      let i = 2
      for (let r = 0; r < params[1] && i + 9 <= params.length; r++) {
        const addr = fmtAddr(params.subarray(i + 2, i + 8))
        const dataLen = params[i + 8]
        const name = parseAdvertisingData(params.subarray(i + 9, i + 9 + dataLen))
        if (name) addrName.set(addr, name)
        i += 9 + dataLen + 1 // + RSSI
      }
    }
  } else if (code === 0x03 && params.length >= 9 && params[0] === 0x00) {
    connAddr.set(params.readUInt16LE(1), fmtAddr(params.subarray(3, 9)))
  }
}

// --- ATT -----------------------------------------------------------------

function handleAtt(conn, received, ts, b) {
  if (b.length < 1) return
  const opcode = b[0]
  let attHandle = null
  let value = null

  switch (opcode) {
    case 0x12:
    case 0x52:
    case 0x1b:
    case 0x1d:
    case 0x16:
      if (b.length >= 3) {
        attHandle = b.readUInt16LE(1)
        value = b.subarray(opcode === 0x16 ? 5 : 3)
      }
      break
    case 0x0a:
    case 0x0c:
      if (b.length >= 3) attHandle = b.readUInt16LE(1)
      break
    case 0x0b:
    case 0x0d:
      value = b.subarray(1)
      break
    case 0x08:
      // Remember what was asked for, so the response can be interpreted.
      if (b.length >= 7) pendingType.set(conn, fmtUuid(b.subarray(5)))
      break
    case 0x09: {
      const entryLen = b[1]
      const type = pendingType.get(conn)
      // Characteristic declarations (0x2803) carry the value handle and its UUID,
      // which is how ff01/ff02/ff03 get their names in the timeline below.
      if (type === '2803' && entryLen >= 5) {
        for (let i = 2; i + entryLen <= b.length; i += entryLen) {
          const entry = b.subarray(i, i + entryLen)
          attUuid.set(entry.readUInt16LE(3), fmtUuid(entry.subarray(5)))
        }
      }
      break
    }
    case 0x05: {
      const format = b[1]
      const size = format === 0x01 ? 2 : 16
      for (let i = 2; i + 2 + size <= b.length; i += 2 + size) {
        attUuid.set(b.readUInt16LE(i), fmtUuid(b.subarray(i + 2, i + 2 + size)))
      }
      break
    }
    default:
      break
  }

  attPackets.push({ conn, received, ts, opcode, attHandle, value, raw: b })
}

function handleAcl(received, ts, d) {
  if (d.length < 4) return
  const header = d.readUInt16LE(0)
  const conn = header & 0x0fff
  const continuation = ((header >> 12) & 0x3) === 0x1
  const payload = d.subarray(4, 4 + d.readUInt16LE(2))

  let state = asm.get(conn)
  if (continuation) {
    if (!state) return
    state.chunks.push(payload)
    state.have += payload.length
  } else {
    if (payload.length < 4) return
    state = {
      cid: payload.readUInt16LE(2),
      need: payload.readUInt16LE(0),
      chunks: [payload.subarray(4)],
      have: payload.length - 4,
    }
    asm.set(conn, state)
  }

  if (state.have < state.need) return
  asm.delete(conn)
  const body = Buffer.concat(state.chunks).subarray(0, state.need)
  if (state.cid === 0x0004) handleAtt(conn, received, ts, body)
  else
    otherTraffic.set(
      `cid 0x${state.cid.toString(16)}`,
      (otherTraffic.get(`cid 0x${state.cid.toString(16)}`) ?? 0) + 1,
    )
}

// --- run ----------------------------------------------------------------

let first = null
let total = 0
let buf = Buffer.alloc(0)

try {
  buf = readFileSync(path)
  for (const rec of records(buf)) {
    total++
    first ??= rec.ts
    if (rec.data.length < 1) continue
    const type = rec.data[0]
    if (type === H4.EVENT) handleEvent(rec.data.subarray(1))
    else if (type === H4.ACL) handleAcl(rec.received, rec.ts, rec.data.subarray(1))
  }
} catch (e) {
  // A wrong path or the wrong file out of the bugreport is much likelier than a
  // genuine bug in here, so say which it was rather than printing a stack trace.
  console.error(`error: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}

// Which connection is the printer? By advertised name if we saw it advertise,
// otherwise by whichever connection carried the most ATT writes.
const named = [...connAddr.entries()].filter(([, addr]) =>
  (addrName.get(addr) ?? '').toLowerCase().includes(wantName),
)
let targets = new Set(named.map(([conn]) => conn))
let targetReason = `advertised name contains ${JSON.stringify(wantName)}`

if (targets.size === 0) {
  const writes = new Map()
  for (const p of attPackets) {
    if (p.opcode === 0x12 || p.opcode === 0x52) writes.set(p.conn, (writes.get(p.conn) ?? 0) + 1)
  }
  const busiest = [...writes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (busiest) {
    targets = new Set([busiest[0]])
    targetReason = `no device advertised a matching name, so this is a guess: the connection with the most ATT writes (${busiest[1]})`
  }
}
if (decodeAll) {
  targets = new Set(attPackets.map((p) => p.conn))
  targetReason = '--all given'
}

const out = []
out.push(`file          ${path}  (${(buf.length / 1e6).toFixed(1)} MB)`)
out.push(`records       ${total}`)
if (first != null) {
  const last = attPackets.at(-1)?.ts ?? first
  out.push(`span          ${(Number(last - first) / 1e6).toFixed(1)} s`)
}
out.push('')
out.push('Devices seen')
if (connAddr.size === 0) out.push('  (no connections completed inside the capture window)')
for (const [conn, addr] of connAddr) {
  const name = addrName.get(addr)
  const count = attPackets.filter((p) => p.conn === conn).length
  out.push(
    `  handle 0x${conn.toString(16).padStart(4, '0')}  ${addr}  ${name ? JSON.stringify(name) : '(name not advertised in this capture)'}  — ${count} ATT packets${targets.has(conn) ? '   <== decoded below' : ''}`,
  )
}
out.push('')
out.push(`Target selection: ${targetReason}`)

if (attUuid.size) {
  out.push('')
  out.push('Characteristics discovered in this capture')
  for (const [h, uuid] of [...attUuid].sort((a, b) => a[0] - b[0])) {
    out.push(`  handle 0x${h.toString(16).padStart(4, '0')} = ${uuid}`)
  }
} else {
  out.push('')
  out.push(
    'No GATT discovery in this capture — the app reused cached handles, so handle→UUID is unknown.',
  )
  out.push('The write target is still identifiable by volume; see the command stream below.')
}

// --- timeline ------------------------------------------------------------

out.push('')
out.push('='.repeat(78))
out.push('ATT timeline   → to printer, ← from printer')
out.push('='.repeat(78))

let shown = 0
const streams = new Map()

for (const p of attPackets) {
  if (!targets.has(p.conn)) continue
  const uuid = p.attHandle != null ? attUuid.get(p.attHandle) : undefined
  const where =
    p.attHandle != null
      ? `0x${p.attHandle.toString(16).padStart(4, '0')}${uuid ? ` ${uuid}` : ''}`
      : ''
  const name = p.value?.length ? identify(hex(p.value)) : null

  if ((p.opcode === 0x12 || p.opcode === 0x52) && p.value?.length) {
    const key = p.attHandle ?? -1
    if (!streams.has(key)) streams.set(key, [])
    streams.get(key).push(p.value)
  }

  if (shown++ >= maxPackets) continue
  out.push(
    [
      fmtTime(p.ts, first),
      p.received ? '←' : '→',
      (ATT_OPCODE[p.opcode] ?? `opcode 0x${p.opcode.toString(16)}`).padEnd(26),
      where.padEnd(12),
      p.value?.length ? abbreviate(p.value) : '',
      name ? `   ${name}` : '',
    ].join('  '),
  )
}
if (shown > maxPackets) out.push(`  … ${shown - maxPackets} further packets suppressed by --max`)

// --- command stream ------------------------------------------------------

out.push('')
out.push('='.repeat(78))
out.push('Command stream — every write, in order, per handle')
out.push('='.repeat(78))

for (const [handle, chunks] of [...streams].sort((a, b) => {
  const len = (c) => c.reduce((n, x) => n + x.length, 0)
  return len(b[1]) - len(a[1])
})) {
  const joined = Buffer.concat(chunks)
  const uuid = attUuid.get(handle)
  out.push('')
  out.push(
    `handle 0x${handle.toString(16).padStart(4, '0')}${uuid ? ` (${uuid})` : ''} — ${chunks.length} writes, ${joined.length} bytes`,
  )

  // Split the concatenated stream at recognised command boundaries. Chunking is a
  // transport concern, so a command can straddle two writes; reading the joined
  // stream is the only way to see the real sequence.
  let i = 0
  while (i < joined.length) {
    const rest = joined.subarray(i)
    const restHex = hex(rest)
    const name = identify(restHex)

    if (name && restHex.startsWith('1f10') && rest.length >= 10) {
      const rowBytes = rest.readUInt16BE(2)
      const height = rest.readUInt16BE(4)
      const payloadLen = rest.readUInt32BE(6)
      out.push(
        `  +${String(i).padStart(6)}  raster: ${rowBytes} bytes/row (${rowBytes * 8} dots), ${height} rows (${(height / 8).toFixed(1)} mm), ${payloadLen} compressed bytes`,
      )
      i += 10 + payloadLen
      continue
    }

    // Commands are 2–5 bytes; anything longer without a match is opaque payload.
    const width = name ? Math.min(matchLength(restHex), rest.length) : Math.min(16, rest.length)
    out.push(
      `  +${String(i).padStart(6)}  ${spaced(rest.subarray(0, width))}${name ? `   ${name}` : '   ?'}`,
    )
    i += width
  }
}

function matchLength(restHex) {
  for (const [prefix] of KNOWN)
    if (restHex.startsWith(prefix)) return prefix.length / 2 + argLength(prefix)
  return 1
}

/**
 * Trailing argument bytes for commands whose parameters follow the opcode.
 *
 * Getting these right is what keeps the stream in step: one mis-sized command
 * desynchronises everything after it, the raster header is then missed, and its
 * compressed payload gets scanned as though it were commands — throwing off false
 * matches. That is exactly what happened on the first real capture until `1f7002`
 * was added here.
 */
function argLength(prefix) {
  if (prefix === '1f1100' || prefix === '1f1101' || prefix === '1f1110' || prefix === '1f1111')
    return 2
  if (prefix === '1f7002') return 7
  if (prefix === '1f8001' || prefix === '1f8002' || prefix === '1f7001' || prefix === '1f6001')
    return 1
  if (prefix === '10ff12') return 2
  if (prefix === '10ff1000' || prefix === '1b4a' || prefix === '1f30') return 1
  if (prefix === '1f1220' || prefix === '1f1210' || prefix === '1f1230') return 1
  return 0
}

if (streams.size === 0) {
  out.push('')
  out.push('No writes were captured for the target connection. Either the snoop log was')
  out.push('collected outside the print, or the target guess above is wrong — try --all.')
}

console.log(out.join('\n'))
