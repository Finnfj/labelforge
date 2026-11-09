import type { Conversation, Reply } from '../../dialect'
import { ADVERTISED_NAME_PREFIX, RESULT_PREFIX, Result } from './constants'

/**
 * What the LetraTag says, and what its replies mean.
 *
 * No status query is known for this printer. It sends an `ESC R` result when its
 * notifications are turned on, after the probe, and after a job, and none of them is
 * known to report battery or paper. So it is asked nothing on connect, and its
 * status is reported unknown rather than guessed at.
 */
export const letratagConversation: Conversation = {
  handshake: [],

  async identify(_ask, advertisedName) {
    const named = advertisedName?.startsWith(ADVERTISED_NAME_PREFIX) ?? false
    return {
      model: named ? 'DYMO LetraTag LT-200B' : advertisedName,
      firmware: null,
      serial: null,
      mac: named ? macFromName(advertisedName!) : null,
    }
  },

  async status() {
    return { batteryPercent: null, labelHeightDots: null, fault: 'unknown' }
  },

  readReply(bytes) {
    if (bytes.length < 3 || bytes[0] !== RESULT_PREFIX[0] || bytes[1] !== RESULT_PREFIX[1]) {
      return { kind: 'other' }
    }
    return RESULTS[bytes[2]] ?? failed(`The printer reported status ${bytes[2]}.`)
  },
}

/**
 * What each `ESC R` code means for a print, per docs/DYMO_PROTOCOL.md's table.
 *
 * `1` is read as no result yet: likely the provisional "printing" ysfchn/dymo-bluetooth
 * sees before the real result (see `Result.Printing`). Ending the wait on it would
 * lose a failure reported after it; if it is ever final instead, the cost is a wait
 * that runs out and a label reported unconfirmed.
 */
const RESULTS: Record<number, Reply> = {
  // Can be reported with the lid open or no cassette in (ysfchn/dymo-bluetooth).
  [Result.Success]: { kind: 'done' },
  [Result.Printing]: { kind: 'other' },
  [Result.Failed]: failed('The printer reported that the label failed.'),
  [Result.SuccessLowBattery]: {
    kind: 'done',
    warning:
      'The printer reports this label printed, but with a low battery — it may not manage ' +
      'another on the same batteries.',
  },
  [Result.Cancelled]: failed('The printer cancelled the label.'),
  [Result.AlsoFailed]: failed('The printer reported that the label failed.'),
  [Result.FailedLowBattery]: failed(
    'The printer reported a battery too low to print. Replace the batteries.',
  ),
  [Result.FailedNoCassette]: failed('The printer reported no cassette.'),
}

function failed(reason: string): Reply {
  return { kind: 'failed', reason }
}

/** The advertised name is `Letratag<MAC-without-colons>`: the MAC, if it is there. */
function macFromName(name: string): string | null {
  const hex = name.slice(ADVERTISED_NAME_PREFIX.length)
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null
  return (hex.match(/.{2}/g) ?? []).join(':').toUpperCase()
}
