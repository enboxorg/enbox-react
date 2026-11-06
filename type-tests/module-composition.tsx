import { defineModule, defineStore, recordCodecs } from '@enbox/browser';
import { useFeature, useStore } from '@enbox/react';

const NotebookCore = defineModule({
  definition: {
    module: 'https://type-contract.test/notebook-core', published: false,
    types: { notebook: { dataFormats: ['application/json'] } },
    structure: { notebook: {} },
  } as const,
  codecs: { notebook: recordCodecs.json<{ name: string }>() },
});
const NotebookNotes = defineModule({
  definition: {
    module: 'https://type-contract.test/notebook-notes', published: false,
    uses: { core: NotebookCore.definition.module },
    types: { note: { dataFormats: ['application/json'] } },
    structure: { notebook: { $ref: 'core:notebook', note: {} } },
  } as const,
  codecs: { note: recordCodecs.json<{ title: string }>() },
  dependencies: { core: NotebookCore },
});
const NotesFeature = defineStore({
  modules: { notes: NotebookNotes },
  create({ modules }) {
    // @ts-expect-error referenced provider roots have no extension-owned collection
    modules.notes.collection('notebook');
    return { notes: modules.notes.collection('notebook/note') };
  },
});

export function ComposedModuleContract() {
  const feature = useFeature(NotesFeature);
  const state = useStore(feature.notes.within('notebook-context'));
  const title: string | undefined = state.records?.[0]?.value.title;
  // @ts-expect-error React retains the extension codec's inferred value
  const name: string | undefined = state.records?.[0]?.value.name;
  const progress = useStore(feature.notes.within('notebook-context').create);
  const pending: number = progress.pendingCount;
  void title;
  void name;
  void pending;
  return null;
}
