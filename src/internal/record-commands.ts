import type { RecordPatchInput, RecordQuery, TypedProtocol, TypedRecord } from '@enbox/browser';
import type {
  EnboxRecordCommands, EnboxRecordsCommands, EnboxSingletonCommands, RecordDeleteOptions, RecordKind,
} from '../config/record-types.js';
import type { ConnectionBinding } from './connection-binding.js';

import { DwnResponseError } from '@enbox/browser';

import { EnboxBindingChangedError, EnboxNotConnectedError } from '../errors.js';
import { isSingletonPath } from './singleton-paths.js';
import { serializeQuery } from './serialize-query.js';

export type RecordDescriptor = Readonly<{ protocol: TypedProtocol; path: string; kind: RecordKind }>;

/** Own query data without evaluating accessors or accepting remote mutation scopes. */
export function copyRecordOptions<Options extends object | null>(options: Options): Options {
  if (options === null) return options;
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Record selections must use plain query objects.');
  if (Object.hasOwn(options, 'from') || Object.hasOwn(options, 'protocolRole')) {
    throw new TypeError('Enbox record mutations require the local session. Use useRecords for remote or role-authorized reads.');
  }
  return JSON.parse(serializeQuery(options), (_key: string, value: unknown): unknown =>
    value !== null && typeof value === 'object' ? Object.freeze(value) : value) as Options;
}

export function singleRecordKind(protocol: TypedProtocol, path: string, options: object | null | undefined): 'record' | 'singleton' {
  const byId = options != null && Object.hasOwn(options, 'recordId');
  return !byId && isSingletonPath(protocol.definition, path) ? 'singleton' : 'record';
}

export type LocalRecordSelection = Omit<RecordQuery<TypedProtocol['definition'], string>, 'pagination'> & {
  recordId?: string; enabled?: boolean; pagination?: { limit: number };
};
export type AnyRecordCommands<T> = EnboxRecordsCommands<T> | EnboxRecordCommands<T> | EnboxSingletonCommands<T>;

export function assertRecordSelection(descriptor: RecordDescriptor, selection: LocalRecordSelection | null): void {
  if (descriptor.kind === 'singleton' && !isSingletonPath(descriptor.protocol.definition, descriptor.path)) {
    throw new TypeError('A singleton record store requires $recordLimit.max: 1.');
  }
  if (selection === null) return;
  const depth = descriptor.path.split('/').length - 1;
  if (depth === 0 ? selection.within !== undefined
    : typeof selection.within !== 'string' || selection.within.trim() === '' || selection.within.split('/').length !== depth) {
    throw new TypeError('Nested record selections require their direct parent context; root records do not accept within.');
  }
  if (descriptor.kind === 'record' && (typeof selection.recordId !== 'string' || selection.recordId.trim() === '')) {
    throw new TypeError('useEnboxRecord requires a nonempty recordId.');
  }
  if (descriptor.kind === 'singleton' && Object.hasOwn(selection, 'recordId')) {
    throw new TypeError('A singleton selection does not accept recordId.');
  }
}

/** Only target changes retire writes; filters, pagination, and read enablement do not. */
export function recordTargetKey(kind: RecordKind, selection: LocalRecordSelection | null): string {
  return JSON.stringify([kind, selection !== null, selection?.within, selection?.recordId]);
}

async function assertParent(
  read: () => Promise<{ readonly contextId: string } | undefined>, within: string | undefined,
): Promise<void> {
  if (within === undefined) return;
  const record = await read();
  if (record !== undefined && record.contextId.split('/').slice(0, -1).join('/') !== within) {
    throw new TypeError('The record does not belong to the selected parent context.');
  }
}

/** Shared native CRUD. React only adds mutation presentation to these commands. */
export function createRecordCommands<T>(
  descriptor: RecordDescriptor,
  selection: LocalRecordSelection | null,
  binding: ConnectionBinding,
  ownerCurrent: () => boolean,
  scope: object = Object.freeze({}),
): AnyRecordCommands<T> {
  const within = selection?.within;
  const requestedId = selection?.recordId;
  const isCurrent = (): boolean => selection !== null && ownerCurrent()
    && binding.enbox !== undefined && binding.session !== undefined;
  const api = () => {
    if (selection === null || !ownerCurrent()) throw new EnboxBindingChangedError();
    if (binding.enbox === undefined || binding.session === undefined) throw new EnboxNotConnectedError();
    return binding.enbox.using(descriptor.protocol).records;
  };
  const patch = async (id: string, value: RecordPatchInput<T>, records = api()): Promise<TypedRecord<T>> => {
    if (descriptor.kind !== 'singleton') await assertParent(() => records.read(descriptor.path, id), within);
    return records.patch(descriptor.path, id, value as RecordPatchInput<unknown>) as Promise<TypedRecord<T>>;
  };
  const remove = async (id: string, options?: RecordDeleteOptions, records = api()): Promise<void> => {
    if (descriptor.kind !== 'singleton') await assertParent(() => records.read(descriptor.path, id), within);
    await records.delete(descriptor.path, {
      recordId: id, ...(within === undefined ? {} : { within }),
      ...(options?.prune === undefined ? {} : { prune: options.prune }),
    });
  };
  if (descriptor.kind === 'collection') {
    return Object.freeze({
      scope, isCurrent,
      create: async (data: T): Promise<TypedRecord<T>> => api().create(descriptor.path, {
        data, ...(within === undefined ? {} : { parentContextId: within }),
      }) as Promise<TypedRecord<T>>,
      patch: (variables: { id: string; patch: RecordPatchInput<T> }): Promise<TypedRecord<T>> => {
        const { id, patch: value } = variables;
        return patch(id, value);
      },
      delete: (id: string, options?: RecordDeleteOptions): Promise<void> => remove(id, options),
    });
  }
  const resolveTarget = async () => {
    const records = api();
    if (descriptor.kind === 'record') return { records, id: requestedId };
    const record = await records.read(descriptor.path, {
      filter: {}, ...(within === undefined ? {} : { within }),
    });
    return { records, id: record?.id };
  };
  const commands: EnboxRecordCommands<T> = {
    scope, isCurrent,
    patch: async (value): Promise<TypedRecord<T>> => {
      const { records, id } = await resolveTarget();
      if (id === undefined) throw new DwnResponseError('useEnboxRecord.patch', { code: 404, detail: 'Not Found' });
      return patch(id, value, records);
    },
    delete: async (options): Promise<void> => {
      const { records, id } = await resolveTarget();
      if (id !== undefined) await remove(id, options, records);
    },
  };
  if (descriptor.kind === 'record') return Object.freeze(commands);
  return Object.freeze({
    ...commands,
    set: async (data: T): Promise<TypedRecord<T>> => {
      // Protocol validation supplies the native cardinality proof erased by the shared owner.
      const records = api();
      const set = records.set as (path: string, request: { data: T; within?: string }) => Promise<TypedRecord<T>>;
      return set.call(records, descriptor.path, { data, ...(within === undefined ? {} : { within }) });
    },
  });
}
