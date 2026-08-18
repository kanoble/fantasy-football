import type { User } from "@supabase/supabase-js";

/**
 * What the app bar knows about whoever is reading.
 *
 * One object rather than a prop each, because the five signed-in pages all reach
 * for the same facts and each new one would otherwise be a sixth edit across
 * five files. The bar is also where a commissioner or admin flag would land if
 * the draft ever grows one, and that belongs beside the address rather than in a
 * second parameter alongside it.
 */
export type Viewer = {
  /** The signed-in address, or undefined when nobody is signed in. */
  email: string | undefined;
  /**
   * The provider's profile photo, or null — which is the normal case, not a
   * failure. Google is under no obligation to send one, and a member may have
   * no photo set at all.
   */
  avatar: string | null;
};

/**
 * Hosts a profile photo may come from.
 *
 * `user_metadata` is not a trusted field. Supabase lets a signed-in user update
 * their own metadata through the auth API, so `avatar_url` is an arbitrary
 * string that happens to have been written by Google the first time. Checking
 * the host is what stops a member pointing the bar's avatar at anything they
 * like — `next.config.ts` allows the same hosts for `next/image`, and this is
 * the half of the pair that also covers the plain URL.
 *
 * The leading dot matters: it is what makes `notgoogleusercontent.com` fail to
 * match.
 */
const PHOTO_HOSTS = [".googleusercontent.com"];

/**
 * The two things the bar needs, from the user Supabase returns.
 *
 * Google's profile photo needs no new scope, no consent-screen change and no API
 * call — it is on the user object the moment sign-in succeeds, under
 * `avatar_url` and again under `picture`. Both are read, because which one
 * arrives is the provider's business rather than ours.
 */
export function viewerFrom(user: User | null | undefined): Viewer {
  // Typed as `{[key: string]: any}` by the client, and populated by whatever the
  // provider sent, so nothing here may assume a shape.
  const metadata: Record<string, unknown> = user?.user_metadata ?? {};
  const claimed = metadata.avatar_url ?? metadata.picture;

  return {
    email: user?.email,
    avatar: typeof claimed === "string" ? photoUrl(claimed) : null,
  };
}

/** The URL if it is one we will render, null otherwise. */
function photoUrl(claimed: string): string | null {
  let url: URL;
  try {
    url = new URL(claimed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!PHOTO_HOSTS.some((host) => url.hostname.endsWith(host))) return null;

  return url.toString();
}
