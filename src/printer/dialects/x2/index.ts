import type { Dialect } from '../../dialect'
import { planX2Print } from './plan'

/** The dialect of the P50 family and its relatives. See docs/PROTOCOL.md. */
export const x2: Dialect = {
  id: 'x2',
  planPrint: planX2Print,
}
