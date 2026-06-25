export type { IntegrationSource, NormalizedItem } from "./types";
export {
  buildAuthUrl,
  getAuthUrl,
  exchangeCodeAndSave,
  isConnected,
  loadGoogleAuth,
  GOOGLE_SCOPES,
} from "./google/oauth";
export { fetchCalendarToday, normalizeCalendarEvent } from "./google/calendar";
export { fetchUnreadInbox, normalizeGmailMessage } from "./google/gmail";
export {
  fetchSlackMentionsAndDms,
  normalizeSlackMessage,
} from "./slack/client";
