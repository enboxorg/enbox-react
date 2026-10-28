import type { ApplicationRuntime, ObservedStore, RecordViewState, StoreDefinition, StoreInstance } from '@enbox/browser';
import type { StoreSource } from '@enbox/react';

import { EnboxProvider, useApplication, useFeature, useStore } from '@enbox/react';

type Rows = Readonly<{ records: readonly { title: string }[]; current: boolean }>;
declare const application: ApplicationRuntime;
declare const definition: StoreDefinition<Readonly<{ name: string }>>;
declare const store: StoreSource<Rows>;
declare const selected: ObservedStore<RecordViewState<Readonly<{ title: string }>>, string>;

export function ApplicationContract() {
  const runtime: ApplicationRuntime = useApplication();
  const client: ApplicationRuntime['connection'] = runtime.connection;
  const feature: StoreInstance<typeof definition> = useFeature(definition);
  const name: string = feature.name;
  // @ts-expect-error a feature retains the output inferred from its definition
  void feature.missing;
  const state = useStore(store);
  const title: string | undefined = state.records[0]?.title;
  const count: number = useStore(store, { selector: (snapshot) => snapshot.records.length });
  const selection: string | null = useStore(selected, { selector: (snapshot) => snapshot.selection });
  const selectedState = useStore(selected);
  if (selectedState.status === 'ready') {
    const selectedTitle: string | undefined = selectedState.records[0]?.title;
    void selectedTitle;
  }
  const projection: { count: number } = useStore(store, {
    selector: (snapshot) => ({ count: snapshot.records.length }),
    isEqual: (previous, next) => previous.count === next.count,
  });
  // @ts-expect-error store payloads preserve their declared shape
  void state.records[0]?.missing;
  // @ts-expect-error selectors receive the store snapshot
  useStore(store, { selector: (snapshot) => snapshot.missing });
  void client;
  void name;
  void title;
  void count;
  void selection;
  void projection;
  return <EnboxProvider application={application} initializeOnMount={false} />;
}

// @ts-expect-error an application runtime already owns its native connection
const duplicateOwnership = <EnboxProvider application={application} client={application.connection} />;
// @ts-expect-error connection ownership must be constructed outside React
const configuredOwnership = <EnboxProvider config={{}} />;
void duplicateOwnership;
void configuredOwnership;
