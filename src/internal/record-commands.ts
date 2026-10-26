import type { RecordPatchInput, RecordQuery, TypedProtocol, TypedRecord } from '@enbox/browser';
import type {
  AnyRecordDefinition, EnboxRecordCommands, EnboxRecordsCommands, EnboxSingletonCommands, RecordDeleteOptions, RecordKind,
} from '../config/record-definition.js';
import type { ConnectionBinding } from './connection-binding.js';

import { DwnResponseError } from '@enbox/browser';

import { EnboxBindingChangedError, EnboxNotConnectedError } from '../errors.js';
import { isSingletonPath } from './singleton-paths.js';

export type LocalRecordSelection = Omit<RecordQuery<TypedProtocol['definition'], string>, 'pagination'> & {
  recordId?: string; enabled?: boolean; pagination?: { limit: number };
};
export type AnyRecordCommands<T> = EnboxRecordsCommands<T> | EnboxRecordCommands<T> | EnboxSingletonCommands<T>;

export function assertRecordSelection(definition: AnyRecordDefinition, selection: LocalRecordSelection | null): void {
  if (definition.kind === 'singleton' && !isSingletonPath(definition.protocol.definition, definition.path)) {
    throw new TypeError('A singleton record store requires $recordLimit.max: 1.');
  }
  if (selection === null) return;
  const depth = definition.path.split('/').length - 1;
  if (depth === 0 ? selection.within !== undefined
    : typeof selection.within !== 'string' || selection.within.trim() === '' || selection.within.split('/').length !== depth) {
    throw new TypeError('Nested record selections require their direct parent context; root records do not accept within.');
  }
  if (definition.kind === 'record' && (typeof selection.recordId !== 'string' || selection.recordId.trim() === '')) {
    throw new TypeError('useEnboxRecord requires a nonempty recordId.');
  }
  if (definition.kind === 'singleton' && Object.hasOwn(selection, 'recordId')) {
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
  definition: AnyRecordDefinition,
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
    return binding.enbox.using(definition.protocol).records;
  };
  const patch = async (id: string, value: RecordPatchInput<T>, records = api()): Promise<TypedRecord<T>> => {
    if (definition.kind !== 'singleton') await assertParent(() => records.read(definition.path, id), within);
    return records.patch(definition.path, id, value as RecordPatchInput<unknown>) as Promise<TypedRecord<T>>;
  };
  const remove = async (id: string, options?: RecordDeleteOptions, records = api()): Promise<void> => {
    if (definition.kind !== 'singleton') await assertParent(() => records.read(definition.path, id), within);
    await records.delete(definition.path, {
      recordId: id, ...(within === undefined ? {} : { within }),
      ...(options?.prune === undefined ? {} : { prune: options.prune }),
    });
  };
  if (definition.kind === 'collection') {
    return Object.freeze({
      scope, isCurrent,
      create: async (data: T): Promise<TypedRecord<T>> => api().create(definition.path, {
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
    if (definition.kind === 'record') return { records, id: requestedId };
    const record = await records.read(definition.path, {
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
  if (definition.kind === 'record') return Object.freeze(commands);
  return Object.freeze({
    ...commands,
    set: async (data: T): Promise<TypedRecord<T>> => {
      // Definition validation supplies the native cardinality proof erased by the shared owner.
      const records = api();
      const set = records.set as (path: string, request: { data: T; within?: string }) => Promise<TypedRecord<T>>;
      return set.call(records, definition.path, { data, ...(within === undefined ? {} : { within }) });
    },
  });
}
