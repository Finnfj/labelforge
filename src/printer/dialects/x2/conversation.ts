import type { Conversation } from '../../dialect'
import * as cmd from './commands'
import {
  decodeBattery,
  decodeLabelHeight,
  decodeStatusFlags,
  decodeText,
  faultFromFlags,
} from './responses'

/**
 * ASCII "OK" — what the printer sends on the status channel when a job finishes.
 * Observed roughly 300 ms after `alignPaperEnd` in a capture of the vendor app.
 */
const DONE_REPLY = 'OK'

/**
 * What x2 says outside a print, and what its replies mean.
 *
 * Every reply format here is inferred rather than documented (see `responses.ts`),
 * so every answer is optional: a printer that answers differently still connects
 * and prints.
 */
export const x2Conversation: Conversation = {
  // The vendor SDK sends this immediately after connecting. Its effect is
  // undocumented, so it is sent on the same assumption: match what the shipping
  // app does.
  handshake: [{ bytes: cmd.setBluetoothType(), note: 'setBluetoothType' }],

  async identify(ask, advertisedName) {
    const model = decodeReply(await ask(cmd.getPrinterModel()), decodeText)
    const firmware = decodeReply(await ask(cmd.getPrinterVersion()), decodeText)
    const serial = decodeReply(await ask(cmd.getPrinterSerial()), decodeText)
    const mac = decodeReply(await ask(cmd.getPrinterMac()), decodeText)

    // A real P50S answers firmware and serial but stays silent on model. The
    // advertised BLE name carries it anyway. Observed forms use either separator
    // — `P50S-F871-BLE` and `P50_2950_BLE` — so split on both; splitting on the
    // underscore alone left the whole string as the "model". Head width is not
    // asked for at all — nothing reports it, and it has to be measured with the
    // diagnostics ruler strip.
    const modelFromName = advertisedName ? advertisedName.split(/[-_]/)[0] : null
    return { model: model ?? modelFromName, firmware, serial, mac }
  },

  async status(ask) {
    const battery = decodeReply(await ask(cmd.getPrinterBattery()), decodeBattery)
    // `10 FF 40`, from the vendor SDK's archived original. The tidied facade's
    // `1F 20 00` does not exist in the vendor code and never answers.
    const flags = decodeReply(await ask(cmd.getStatusFlags()), decodeStatusFlags)
    const labelHeight = decodeReply(await ask(cmd.getLabelHeight()), decodeLabelHeight)
    return { batteryPercent: battery, labelHeightDots: labelHeight, fault: faultFromFlags(flags) }
  },

  readReply(bytes) {
    return decodeText(bytes) === DONE_REPLY ? { kind: 'done' } : { kind: 'other' }
  },

  /*
   * The sequence is the vendor SDK's own: issue the locate command several times,
   * waiting for an acknowledgement each time, and only then ask for the height —
   * its comment is explicit that asking earlier returns an inaccurate value.
   */
  async calibrateLabelGap(ask, options) {
    const passes: Array<Uint8Array | null> = []
    const total = options.passes ?? 3
    for (let pass = 1; pass <= total; pass++) {
      const reply = await ask(cmd.locateLabel())
      passes.push(reply)
      options.onPass?.(pass, reply)
    }
    return {
      labelHeightDots: decodeReply(await ask(cmd.getLabelHeight()), decodeLabelHeight),
      passes,
    }
  },
}

function decodeReply<T>(bytes: Uint8Array | null, decode: (bytes: Uint8Array) => T | null) {
  return bytes ? decode(bytes) : null
}
