import { act, fireEvent, render } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { EnboxProvider, useEnboxConnection } from '../src/index.js';
import { applicationFor, controlledClient } from './helpers.js';

describe('discarded concurrent application renders', () => {
  it('keeps committed provider controls alive while a client replacement is suspended', async () => {
    const first = controlledClient();
    const second = controlledClient();
    const suspended = new Promise<never>(() => {});
    function Content({ selected }: { selected: 'A' | 'B' }) {
      const connection = useEnboxConnection();
      if (selected === 'B') throw suspended;
      return <button onClick={() => { void connection.connect(); }}>Connect A</button>;
    }
    function App() {
      const [selected, setSelected] = useState<'A' | 'B'>('A');
      return <>
        <button onClick={() => startTransition(() => setSelected('B'))}>Replace client</button>
        <button onClick={() => setSelected('A')}>Keep client</button>
        <Suspense fallback={<p>Waiting</p>}>
          <EnboxProvider application={applicationFor(selected === 'A' ? first.client : second.client)} initializeOnMount={false}>
            <Content selected={selected} />
          </EnboxProvider>
        </Suspense>
      </>;
    }
    const tree = render(<App />);
    act(() => { fireEvent.click(tree.getByText('Replace client')); });
    expect(second.listeners.size).toBe(0);
    await act(async () => { fireEvent.click(tree.getByText('Connect A')); });
    expect(first.client.connect).toHaveBeenCalledOnce();
    expect(second.client.connect).not.toHaveBeenCalled();
    act(() => { fireEvent.click(tree.getByText('Keep client')); });
    await act(async () => { fireEvent.click(tree.getByText('Connect A')); });
    expect(first.client.connect).toHaveBeenCalledTimes(2);
    expect(second.client.initialize).not.toHaveBeenCalled();
    tree.unmount();
  });

});
