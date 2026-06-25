/**
 * Public surface of the cloud-sync module.
 *
 * `useCloudSync` is a React hook that should be mounted once at the app root,
 * typically alongside `useAuth`. It handles the entire load/sync/teardown
 * lifecycle as the user signs in and out.
 */
export { useCloudSync, _resetCloudSyncForTests } from './sync';
