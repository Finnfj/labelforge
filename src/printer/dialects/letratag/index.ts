import type { Dialect } from '../../dialect'
import { letratagConversation } from './conversation'
import { letratagLink } from './link'
import { assessLetraTagJob, planLetraTagPrint } from './plan'

/** DYMO's LetraTag dialect, as the LT-200B speaks it. See docs/DYMO_PROTOCOL.md. */
export const letratag: Dialect = {
  density: null,
  takesSpeed: false,
  link: letratagLink,
  conversation: letratagConversation,
  assessJob: assessLetraTagJob,
  planPrint: planLetraTagPrint,
}
