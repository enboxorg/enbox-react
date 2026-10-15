import type { Enbox } from '@enbox/browser';
import { useProfile } from '@enbox/react';
import { useState } from 'react';

export function ProfileCard({ enbox, did, identityName }: {
  enbox: Enbox | undefined;
  did: string;
  identityName?: string | undefined;
}) {
  const profile = useProfile(enbox, did);
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const publishedName = profile.displayName?.trim();
  const name = publishedName || identityName?.trim();
  const avatar = profile.avatarUrl !== failedAvatar ? profile.avatarUrl : undefined;
  const initials = name?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const profileStatus = profile.fields.profile.status;
  const publicName = publishedName || (profileStatus === 'idle' || profileStatus === 'loading' ? 'Loading…'
    : profileStatus === 'error' ? 'Unavailable' : 'Not published');
  const shortDid = did.length > 34 ? `${did.slice(0, 22)}…${did.slice(-8)}` : did;

  return (
    <section className="panel profile-card" aria-labelledby="profile-title">
      <div className="profile-heading">
        <div className="avatar" aria-hidden="true">
          {avatar
            ? <img src={avatar} alt="" onError={() => setFailedAvatar(avatar)} />
            : <span>{initials || '◌'}</span>}
        </div>
        <div className="profile-identity">
          <p className="eyebrow">Your public profile</p>
          <h2 id="profile-title">{name || 'Your profile'}</h2>
          <p className="short-did" title={did}>{shortDid}</p>
        </div>
        <span className="connected-badge"><span aria-hidden="true" />Connected</span>
      </div>
      {profileStatus === 'loading' && !name && <p role="status">Looking up your public profile…</p>}
      {profileStatus === 'not-found' && <p>No public profile yet. You can still make yourself at home.</p>}
      {profileStatus === 'error' && (
        <p className="profile-message" role="status">Your public profile couldn’t be loaded. The app is still yours to use.</p>
      )}
      <details className="profile-details">
        <summary>Profile details</summary>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <dl>
          <dt>Profile ID</dt><dd><code>{did}</code></dd>
          <dt>Public name</dt><dd>{publicName}</dd>
          {profile.location && <><dt>Location</dt><dd>{profile.location}</dd></>}
          {profile.website && <><dt>Website</dt><dd>{profile.website}</dd></>}
        </dl>
        {profile.fields.profile.failure && <p className="error-detail">{profile.fields.profile.failure.message}</p>}
      </details>
    </section>
  );
}
