
import type { MemberRole } from "./workspace";

export interface UpdateMeRequest {
  name?: string;
  avatar_url?: string;
  language?: string;
  /** Free-form self-description (max 2000 chars). Pass "" to clear. */
  profile_description?: string;
  /** IANA tz to pin; "" clears back to browser-tz; undefined leaves untouched. */
  timezone?: string;
}

export interface CreateMemberRequest {
  email: string;
  role?: MemberRole;
}

export interface UpdateMemberRequest {
  role: MemberRole;
}

// Personal Access Tokens
export interface PersonalAccessToken {
  id: string;
  name: string;
  token_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface CreatePersonalAccessTokenRequest {
  name: string;
  expires_in_days?: number;
}

export interface CreatePersonalAccessTokenResponse extends PersonalAccessToken {
  token: string;
}
