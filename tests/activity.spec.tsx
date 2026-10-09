import { Activity } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRecordView } from '../src/index.js';
import { ControlledView } from './helpers.js';

describe('React Activity', () => {
  it('reopens after Activity hides and restores retained state', async () => {
    const views: ControlledView<string>[] = [];
    const opener = async () => {
      const view = new ControlledView(['visible']);
      views.push(view);
      return view;
    };
    function Content() {
      const snapshot = useRecordView(opener);
      return <output>{snapshot.status}</output>;
    }
    const tree = render(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    tree.rerender(<Activity mode="hidden"><Content /></Activity>);
    expect(views[0]?.close).toHaveBeenCalledOnce();
    tree.rerender(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(views.length).toBe(2));
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    expect(views[1]?.close).not.toHaveBeenCalled();
    tree.unmount();
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });
});
