import type { ApplicationRuntime, StoreCollectionSelection, StoreDefinition, StoreInstance } from '@enbox/api';
import type { StoreSource } from '@enbox/react';

import { EnboxProvider, useApplication, useEnboxClient, useFeature, useStore } from '@enbox/react';

declare const application: ApplicationRuntime;
declare const definition: StoreDefinition<Readonly<{ name: string }>>;
declare const resource: StoreSource<Readonly<{ records: readonly { title: string }[]; current: boolean }>>;
declare const selected: StoreCollectionSelection<Readonly<{ title: string }>>;

export function ApplicationContract() {
  const runtime: ApplicationRuntime = useApplication();
  const client: ApplicationRuntime['connection'] = useEnboxClient();
  const feature: StoreInstance<typeof definition> = useFeature(definition);
  const name: string = feature.name;
  // @ts-expect-error a feature retains the output inferred from its definition
  void feature.missing;
  const state = useStore(resource);
  const title: string | undefined = state.records[0]?.title;
  const count: number = useStore(resource, (snapshot) => snapshot.records.length);
  const parent: string | null = useStore(selected, (snapshot) => snapshot.parentContextId);
  const selectedTitle: string | undefined = useStore(selected).records[0]?.title;
  const projection: { count: number } = useStore(resource, (snapshot) => ({ count: snapshot.records.length }),
    (previous, next) => previous.count === next.count);
  // @ts-expect-error resource payloads preserve their declared shape
  void state.records[0]?.missing;
  // @ts-expect-error selectors receive the store snapshot
  useStore(resource, (snapshot) => snapshot.missing);
  void runtime;
  void client;
  void feature;
  void name;
  void title;
  void count;
  void parent;
  void selectedTitle;
  void projection;
  return <EnboxProvider application={application} initializeOnMount={false} />;
}

// @ts-expect-error an application runtime already owns its native connection
const duplicateOwnership = <EnboxProvider application={application} client={application.connection} />;
void duplicateOwnership;
