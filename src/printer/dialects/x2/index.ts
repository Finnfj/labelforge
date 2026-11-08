import type { Dialect } from '../../dialect'
import { assessX2Job } from './assessJob'
import { x2Conversation } from './conversation'
import { x2Link } from './link'
import { planX2Print } from './plan'
import { X2_DENSITY } from './settings'

/** The dialect of the P50 family and its relatives. See docs/PROTOCOL.md. */
export const x2: Dialect = {
  density: X2_DENSITY,
  takesSpeed: true,
  link: x2Link,
  conversation: x2Conversation,
  assessJob: assessX2Job,
  planPrint: planX2Print,
}
