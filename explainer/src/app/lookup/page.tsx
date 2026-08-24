import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sourceFor } from '@/sources';
import type { IdKind } from '@/sources/types';

/**
 * Resolution, as its own step.
 *
 * It gets a page rather than being folded into the profile route because the ways it fails
 * carry different meanings and need different things said. "Not found", "that is a demo CID
 * which this path cannot resolve" and "this number is both a GCID and a CID" all arrive as an
 * empty upstream response, and reporting them identically is how support tickets get filed
 * against the wrong thing.
 */

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.5px]">{title}</h1>
      <div className="space-y-3 text-sm">{children}</div>
      <Link href="/" className="inline-block text-sm font-medium">
        ← Back to lookup
      </Link>
    </div>
  );
}

export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; kind?: string }>;
}) {
  const { id: rawId, kind: rawKind } = await searchParams;
  const id = Number(rawId);

  if (!rawId || !Number.isInteger(id) || id <= 0) {
    return (
      <Notice title="That is not an identifier">
        <p>
          GCIDs and CIDs are positive integers. Received{' '}
          <code className="font-mono">{rawId ?? '(nothing)'}</code>.
        </p>
      </Notice>
    );
  }

  // No inference. An unrecognised kind is an error, not an invitation to guess — see the
  // `OtherSpace` note in sources/types.ts for why guessing shows the wrong customer.
  if (rawKind !== 'gcid' && rawKind !== 'cid') {
    return (
      <Notice title="Say which kind of identifier that is">
        <p>
          <code className="font-mono">{id}</code> could be a GCID or a real CID, and the number
          itself carries no clue: 99% of GCIDs are also somebody else’s real CID.
        </p>
        <p className="text-muted">
          Pick the type on the lookup form. Guessing on your behalf would put a different
          customer’s financial data on screen with nothing to indicate it had happened.
        </p>
      </Notice>
    );
  }

  const kind: IdKind = rawKind;
  const resolution = await sourceFor(id).resolve(id, kind);

  switch (resolution.kind) {
    case 'resolved':
      // `via` and the original number travel with the redirect so the profile page can state
      // which reading produced it, rather than presenting a GCID with no history.
      redirect(`/profile/${resolution.user.gcid}?via=${resolution.via}&from=${id}`);

    case 'demo-cid':
      return (
        <Notice title="That is a demo CID">
          <p>
            <code className="font-mono">{id}</code> is not a real CID, but the identity map does
            list it as a demo CID — so this is a real person, reachable only by their real
            identifiers.
          </p>
          <p className="text-muted">
            Demo accounts are out of scope here: suitability is decided per customer, not per
            trading account, so there is nothing a demo id can tell you that the real one cannot.
            Look them up by GCID or real CID instead.
          </p>
        </Notice>
      );

    case 'unavailable':
      return (
        <Notice title="Cannot resolve that identifier yet">
          <p>{resolution.reason}</p>
        </Notice>
      );

    case 'not-found':
      return (
        <Notice title={`Not a ${resolution.tried === 'gcid' ? 'GCID' : 'real CID'}`}>
          <p>
            No user on record has <code className="font-mono">{id}</code> as their{' '}
            {resolution.tried === 'gcid' ? 'GCID' : 'real CID'}.
          </p>
          {resolution.alsoValidAs.length > 0 && (
            <p>
              It is, however, a valid{' '}
              {resolution.alsoValidAs
                .map((s) => (s === 'gcid' ? 'GCID' : s === 'cid' ? 'real CID' : 'demo CID'))
                .join(' and a valid ')}
              . You most likely picked the wrong id type.
            </p>
          )}
        </Notice>
      );
  }
}
