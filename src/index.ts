'use client';

export { EnboxProvider, useEnboxClient } from './provider.js';
export type { EnboxProviderProps } from './provider.js';
export { useEnboxConnection } from './hooks/enbox-connection.js';
export type {
  EnboxConnection, EnboxConnectionState, BeforeConnect, BeforeDisconnect,
  ConnectOptions, DisconnectOptions, WalletRepairReason, WalletRepairState,
} from './hooks/enbox-connection.js';
export {
  useConnection,
  useConnectionActions,
  useEnbox,
  useIdentity,
  useProtocol,
  useSyncStatus,
} from './hooks/connection.js';
export type { ConnectionActions, ConnectionSelector, EqualityFn } from './hooks/connection.js';
export type { VaultConnectOptions } from '@enbox/browser';
export { useObservableStore } from './hooks/observable-store.js';
export type { ObservableStoreSource } from './hooks/observable-store.js';
export type {
  RecordStore, RecordStoreOptions, SelectedRecordStore,
  SelectedRecordStoreConfig, SelectedRecordSnapshot,
} from './config/record-store.js';
export { useProfile, useProfiles } from './hooks/profiles.js';
export type { ProfileSource, ResolvedProfile, ProfileResult, ProfileOptions, ProfileFieldState } from './hooks/profiles.js';
export { useRecordView } from './hooks/record-view.js';
export type { IdleRecordViewState, RecordViewOpener, RecordViewResult } from './hooks/record-view.js';
export { useContextView } from './hooks/context-view.js';
export type { IdleContextViewState, ContextViewOpener, ContextViewResult } from './hooks/context-view.js';
export type { ContextStore, ContextStoreOptions } from './config/context-store.js';
export { useRecords } from './hooks/records.js';
export type { RecordsOptions, RecordsResult } from './hooks/records.js';
export { useEnboxMutation } from './hooks/mutation.js';
export type { EnboxMutation, EnboxMutationOptions, EnboxMutationResult } from './hooks/mutation.js';
export { EnboxBindingChangedError, EnboxNotConnectedError } from './errors.js';
