import type { ApplicationRuntime, StoreDefinition, StoreInstance } from '@enbox/browser';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useApplication, useFeature } from '../src/index.js';
import { connected, controlledClient } from './helpers.js';

const definition = {} as StoreDefinition<Readonly<{ name: string }>>;

/** Model the application subscription boundary independently of SDK internals. */
function controlledApplication() {
  const { client } = controlledClient(connected());
  const listeners = new Set<() => void>();
  let feature = { name: 'first' };
  const application: ApplicationRuntime = {
    manifest: { protocols: [] },
    connection: client,
    store: <Definition extends StoreDefinition>(_definition: Definition): StoreInstance<Definition> =>
      feature as StoreInstance<Definition>,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    initialize: vi.fn(async () => client.getSnapshot()),
    dispose: vi.fn(async () => {}),
  };
  return {
    application,
    listeners,
    replace(next = { name: 'replacement' }) {
      feature = next;
      for (const notify of listeners) notify();
    },
    notify() { for (const notify of listeners) notify(); },
  };
}

describe('application provider and features', () => {
  it('exposes one runtime and its native connection while leaving disposal to the owner', async () => {
    const { application } = controlledApplication();
    const hook = renderHook(() => ({ application: useApplication(), client: useApplication().connection }), {
      reactStrictMode: true,
      wrapper: ({ children }) => <EnboxProvider application={application}>{children}</EnboxProvider>,
    });
    expect(hook.result.current.application).toBe(application);
    expect(hook.result.current.client).toBe(application.connection);
    expect(application.initialize).toHaveBeenCalled();
    expect(application.connection.initialize).not.toHaveBeenCalled();
    await act(async () => { hook.unmount(); await Promise.resolve(); });
    expect(application.dispose).not.toHaveBeenCalled();
    expect(application.connection.dispose).not.toHaveBeenCalled();
  });

  it('shares features and replaces them on an application scope notification', () => {
    const control = controlledApplication();
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return [useFeature(definition), useFeature(definition)];
    }, {
      wrapper: ({ children }) => <EnboxProvider application={control.application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    const first = hook.result.current[0];
    expect(hook.result.current[1]).toBe(first);
    const initialRenders = renders;
    act(() => control.notify());
    expect(renders).toBe(initialRenders);
    act(() => control.replace());
    expect(hook.result.current[0]).not.toBe(first);
    expect(hook.result.current[1]).toBe(hook.result.current[0]);
    hook.unmount();
    expect(control.listeners.size).toBe(0);
  });

  it('respects explicit startup ownership', () => {
    const { application } = controlledApplication();
    const hook = renderHook(useApplication, {
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    expect(application.initialize).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('requires an application runtime for feature resolution', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useFeature(definition))).toThrow('EnboxProvider');
    } finally {
      report.mockRestore();
    }
  });
});
