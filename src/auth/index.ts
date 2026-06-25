/**
 * Public barrel for the auth module.
 *
 * Consumers should import from `@fretwork/lib` (which re-exports from here)
 * rather than reaching into `lib/src/auth/...` directly.
 */
export { getSupabaseClient, isSupabaseConfigured, _resetSupabaseClientForTests } from './supabaseClient';
export {
  useAuthStore,
  selectIsSignedIn,
  selectNeedsProfile,
  selectIsAuthLoading,
} from './useAuthStore';
export type { AuthStoreState } from './useAuthStore';
export { useAuth } from './useAuth';
export type { UseAuthReturn } from './useAuth';
export { rowToProfile } from './types';
export {
  readSessionContent,
  countSessionContent,
  uploadSessionContent,
  clearSessionContent,
  markMigrationResolved,
  hasMigrationBeenResolved,
  clearMigrationFlag,
} from './migration';
export type { MigrationCounts, MigrationResult } from './migration';
export type {
  AuthStatus,
  Profile,
  Session,
  User,
  CreateProfileInput,
} from './types';
