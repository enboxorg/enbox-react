import { useEnboxMutation, useRecords } from '@enbox/react';

import { CHOICES, DemoProtocol } from './protocol.js';
import type { ChoiceEmoji } from './protocol.js';
import './demo.css';

export function Demo({ disabled = false }: { disabled?: boolean }) {
  const choices = useRecords(DemoProtocol, 'choice', { materialize: true, pagination: { limit: 1 } });
  const save = useEnboxMutation((enbox, emoji: ChoiceEmoji) =>
    enbox.using(DemoProtocol).records.set('choice', { data: { emoji } }));
  const observed = CHOICES.find(({ emoji }) => emoji === choices.records[0]?.value.emoji);

  return (
    <section className="panel demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Your first record</h2>
      <p>Choose a little hello. It’s encrypted for this app, separate from your public profile.</p>
      <fieldset className="choice-options" disabled={disabled || save.isPending || choices.status !== 'ready'}>
        <legend className="sr-only">Choose your hello</legend>
        {CHOICES.map(({ emoji, label }) => (
          <button type="button" className="choice-option" key={emoji}
            aria-label={`Choose ${label.toLowerCase()}`}
            aria-pressed={observed?.emoji === emoji}
            onClick={() => { void save.run(emoji).catch(() => {}); }}>
            <span className="choice-emoji" aria-hidden="true">{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
      </fieldset>
      <p className="demo-status" role="status">
        {save.isPending ? 'Saving your choice…'
          : choices.status === 'loading' ? 'Reading your saved choice…'
            : observed ? `Saved: ${observed.emoji} ${observed.label}` : 'Choose an emoji to get started.'}
      </p>
      {choices.status === 'error' && (
        <div className="notice notice-error" role="alert">
          <p>Couldn’t read your choice: {choices.error.message}</p>
          <button type="button" className="button button-secondary" disabled={disabled || save.isPending}
            onClick={() => { void choices.retry().catch(() => {}); }}>
            Try again
          </button>
        </div>
      )}
      {save.error && (
        <p className="error-detail" role="alert">Couldn’t save: {save.error.message} Choose an emoji again to retry.</p>
      )}
    </section>
  );
}
