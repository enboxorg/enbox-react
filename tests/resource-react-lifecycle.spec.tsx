import { createApplication, defineStore } from '@enbox/browser';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useFeature, useStore } from '../src/index.js';
import { connected, ControlledView, controlledClient } from './helpers.js';

describe('headless resources in React', () => {
  it('keeps committed resources and commands while a replacement render is suspended', async () => {
    const firstView = new ControlledView(['A']);
    const firstOpen = vi.fn(async () => firstView);
    const secondOpen = vi.fn(async () => new ControlledView(['B']));
    const firstWrite = vi.fn(async () => 'A');
    const secondWrite = vi.fn(async () => 'B');
    const feature = defineStore({
      protocols: {},
      create: ({ resource, command }) => ({
        first: resource(firstOpen), second: resource(secondOpen),
        firstWrite: command(firstWrite), secondWrite: command(secondWrite),
      }),
    });
    const { client } = controlledClient(connected());
    const application = createApplication({ stores: { feature }, connection: () => client });
    const suspended = new Promise<never>(() => {});
    function Pane({ selected }: { selected: string }) {
      const stores = useFeature(feature);
      const state = useStore(selected === 'A' ? stores.first : stores.second);
      const command = selected === 'A' ? stores.firstWrite : stores.secondWrite;
      if (selected === 'B') throw suspended;
      return <><output>{state.records?.join(',')}</output><button onClick={() => { void command.run(); }}>Write</button></>;
    }
    function App() {
      const [selected, setSelected] = useState('A');
      return <>
        <button onClick={() => startTransition(() => setSelected('B'))}>Change</button>
        <button onClick={() => setSelected('A')}>Keep A</button>
        <Suspense fallback={<p>Waiting</p>}><Pane selected={selected} /></Suspense>
      </>;
    }
    const tree = render(<EnboxProvider application={application} initializeOnMount={false}><App /></EnboxProvider>);
    try {
      await waitFor(() => expect(tree.getByText('A')).toBeDefined());
      act(() => { fireEvent.click(tree.getByText('Change')); });
      expect(secondOpen).not.toHaveBeenCalled();
      expect(firstView.close).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(tree.getByText('Write')); });
      expect(firstWrite).toHaveBeenCalledOnce();
      expect(secondWrite).not.toHaveBeenCalled();
      act(() => { fireEvent.click(tree.getByText('Keep A')); });
      expect(firstView.close).not.toHaveBeenCalled();
    } finally {
      tree.unmount();
      await application.dispose();
    }
  });
});
