export { AppError, toErrorMessage } from './errors';
export type { AppErrorCode } from './errors';
export {
  ConnectionController,
  initialConnectionState,
  targetFromProfile,
  type ConnectionControllerOptions,
  type ConnectionResult,
} from './connection';
export { checkProxyHealth, type HealthCheckOptions, type HealthCheckResult } from './health';
export { ProfileService, MAX_PROFILES, type AddResult, type RemoveResult, type ProfileServiceOptions } from './profiles';
export { SettingsService } from './settings';
export {
  SubscriptionService,
  SUBSCRIPTION_TIMEOUT_MS,
  type RefreshResult,
  type SubscriptionServiceOptions,
} from './subscriptions';
