/**
 * Public types for the auth module.
 *
 * Profile mirrors the `public.profiles` table 1:1. AuthStatus tracks the state
 * machine the UI uses to decide what to render: signed-out, needs-profile
 * (signed in but no profile yet — first-time signup), signed-in.
 *
 * Re-exported via lib's public surface; consumers don't need to import directly.
 */
import type { Session, User } from '@supabase/supabase-js';

export type { Session, User };

/** The user's profile row from the `profiles` table. */
export interface Profile {
  userId: string;
  displayName: string;
  userTypes: string[];
  avatarUrl: string | null;
  bio: string | null;
  pronouns: string | null;
  externalLink: string | null;
  socialHandles: Record<string, string>;
  instruments: string[];
  yearsPlaying: number | null;
  skillLevel: string | null;
  genres: string[];
  availableForLessons: boolean;
  lookingForTeacher: boolean;
  profilePublic: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Auth state machine. */
export type AuthStatus =
  /** Initial state, before the first session check resolves. */
  | 'idle'
  /** An auth operation is in progress (initial session check, sign-in, sign-out). */
  | 'loading'
  /** No active session. */
  | 'signed-out'
  /** Authenticated but no profile row yet — first-time signup, needs profile form. */
  | 'needs-profile'
  /** Fully signed in with a profile loaded. */
  | 'signed-in';

/** Payload accepted by the create-profile RPC at signup. */
export interface CreateProfileInput {
  displayName: string;
  userTypes: string[];
  avatarUrl?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  externalLink?: string | null;
  socialHandles?: Record<string, string>;
  instruments?: string[];
  yearsPlaying?: number | null;
  skillLevel?: string | null;
  genres?: string[];
  availableForLessons?: boolean;
  lookingForTeacher?: boolean;
}

/** Converts a snake_case row from Supabase into the camelCase `Profile` shape. */
export function rowToProfile(row: Record<string, unknown>): Profile {
  return {
    userId: row.user_id as string,
    displayName: row.display_name as string,
    userTypes: (row.user_types as string[]) ?? [],
    avatarUrl: (row.avatar_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    pronouns: (row.pronouns as string | null) ?? null,
    externalLink: (row.external_link as string | null) ?? null,
    socialHandles: (row.social_handles as Record<string, string>) ?? {},
    instruments: (row.instruments as string[]) ?? [],
    yearsPlaying: (row.years_playing as number | null) ?? null,
    skillLevel: (row.skill_level as string | null) ?? null,
    genres: (row.genres as string[]) ?? [],
    availableForLessons: (row.available_for_lessons as boolean) ?? false,
    lookingForTeacher: (row.looking_for_teacher as boolean) ?? false,
    profilePublic: (row.profile_public as boolean) ?? true,
    deleted: (row.deleted as boolean) ?? false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
