/** Namespace for extension ↔ service worker messages (D3, T-ADMIN-* extends below). */
export const MSG_NAMESPACE = "adp:" as const;
export const MSG_ADMIN_NAMESPACE = "adp:admin:" as const;

export const MSG_LOOKUP = "adp:lookup";
export const MSG_SYNC = "adp:sync-dlsite";
export const MSG_SERVER_STATUS = "adp:server-status";

export function isAdpMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_NAMESPACE);
}

export function isAdminMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_ADMIN_NAMESPACE);
}
