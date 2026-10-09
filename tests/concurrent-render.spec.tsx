import type { PropsWithChildren } from 'react';

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useEnboxMutation, useRecordView } from '../src/index.js';
import { connected, ControlledView, controlledClient } from './helpers.js';

describe('discarded concurrent renders', () => {
  it('does not open a suspended selection or replace committed mutation callbacks', async () => {
    const view = new ControlledView(['A']);
    const firstOpen = vi.fn(async () => view);
    const secondOpen = vi.fn(async () => new ControlledView(['B']));
    const firstWrite = vi.fn(async () => 'A');
    const secondWrite = vi.fn(async () => 'B');
    const suspended = new Promise<never>(() => {});
    const { client } = controlledClient(connected());
    function Pane({ selected }: { selected: string }) {
      const state = useRecordView(selected === 'A' ? firstOpen : secondOpen);
      const mutation = useEnboxMutation(selected === 'A' ? firstWrite : secondWrite);
      if (selected === 'B') throw suspended;
      return <><output>{state.records.join(',')}</output><button onClick={() => { void mutation.run(); }}>Write</button></>;
    }
    function App() {
      const [selected, setSelected] = useState('A');
      return <>
        <button onClick={() => startTransition(() => setSelected('B'))}>Change</button>
        <button onClick={() => setSelected('A')}>Keep A</button>
        <Suspense fallback={<p>Waiting</p>}><Pane selected={selected} /></Suspense>
      </>;
    }
    const Wrapper = ({ children }: PropsWithChildren) => <EnboxProvider client={client}>{children}</EnboxProvider>;
    const tree = render(<App />, { wrapper: Wrapper });
    await waitFor(() => expect(tree.getByText('A')).toBeDefined());
    act(() => { fireEvent.click(tree.getByText('Change')); });
    expect(secondOpen).not.toHaveBeenCalled();
    expect(view.close).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(tree.getByText('Write')); });
    expect(firstWrite).toHaveBeenCalledOnce();
    expect(secondWrite).not.toHaveBeenCalled();
    act(() => { fireEvent.click(tree.getByText('Keep A')); });
    expect(view.close).not.toHaveBeenCalled();
  });
});
