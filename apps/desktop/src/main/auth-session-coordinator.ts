import type { AuthSessionUserId } from "../shared/auth-session";
export { AUTH_SESSION_STATE_CHANNEL, parseAuthSessionUserId } from "../shared/auth-session";
/** Tracks the main renderer account so queued notifications cannot cross identities. */
export class AuthSessionCoordinator {
  private mainUserId: AuthSessionUserId | undefined;
  hasActiveMainSession(): boolean { return typeof this.mainUserId === "string"; }
  reportMain(userId: AuthSessionUserId): boolean {
    const becameLoggedOut = userId === null && this.mainUserId !== null;
    const accountChanged = this.mainUserId !== undefined && this.mainUserId !== userId;
    this.mainUserId = userId;
    return becameLoggedOut || accountChanged;
  }
}
