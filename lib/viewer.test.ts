import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { viewerFrom } from "./viewer.ts";

/**
 * Who the bar thinks is reading, under test.
 *
 * Most of this is about one thing: `user_metadata` is not trusted input.
 * Supabase lets a signed-in member rewrite their own metadata through the auth
 * API, so `avatar_url` is a string that Google wrote once and anybody on the
 * allowlist could write again. The host check is the only thing standing
 * between that and an `<img src>`, and it is exactly the kind of check that
 * looks redundant right up until it is not.
 */

/** A Supabase user carrying whatever the provider (or the member) put there. */
const signedIn = (metadata: Record<string, unknown>, email = "kev@example.com") =>
  ({ email, user_metadata: metadata }) as never;

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocKexample=s96-c";

describe("viewerFrom", () => {
  it("reads Google's photo off the user, with no extra call", () => {
    const viewer = viewerFrom(signedIn({ avatar_url: PHOTO }));

    assert.equal(viewer.email, "kev@example.com");
    assert.equal(viewer.avatar, PHOTO);
  });

  it("accepts `picture`, which is the other name Google sends it under", () => {
    assert.equal(viewerFrom(signedIn({ picture: PHOTO })).avatar, PHOTO);
  });

  it("prefers `avatar_url` when both are present", () => {
    const other = "https://lh3.googleusercontent.com/a/other=s96-c";
    assert.equal(viewerFrom(signedIn({ avatar_url: PHOTO, picture: other })).avatar, PHOTO);
  });

  it("has no photo for a member who never set one", () => {
    const viewer = viewerFrom(signedIn({}));

    // Null, not undefined and not an empty string: the bar draws the initial,
    // which is the same answer a removed photo gets.
    assert.equal(viewer.avatar, null);
  });

  it("has no email and no photo for nobody", () => {
    assert.deepEqual(viewerFrom(null), { email: undefined, avatar: null });
    assert.deepEqual(viewerFrom(undefined), { email: undefined, avatar: null });
  });
});

describe("viewerFrom — what it refuses to render", () => {
  const refused = {
    "a host that merely ends in the same letters": "https://notgoogleusercontent.com/a/x=s96-c",
    "a lookalike host": "https://googleusercontent.com.evil.example/a/x",
    "somebody else's CDN entirely": "https://example.com/a/x.png",
    "plaintext http": "http://lh3.googleusercontent.com/a/x=s96-c",
    "a javascript: URL": "javascript:alert(1)",
    "a data: URL": "data:image/png;base64,iVBORw0KGgo=",
    "a protocol-relative URL": "//lh3.googleusercontent.com/a/x=s96-c",
    "something that is not a URL at all": "not a url",
    "the empty string": "",
  };

  for (const [what, claimed] of Object.entries(refused)) {
    it(`refuses ${what}`, () => {
      assert.equal(viewerFrom(signedIn({ avatar_url: claimed })).avatar, null);
    });
  }

  it("refuses a value that is not a string", () => {
    assert.equal(viewerFrom(signedIn({ avatar_url: 42 })).avatar, null);
    assert.equal(viewerFrom(signedIn({ avatar_url: { href: PHOTO } })).avatar, null);
    assert.equal(viewerFrom(signedIn({ avatar_url: null })).avatar, null);
  });

  it("still knows who is reading when it refuses the photo", () => {
    // The refusal must not take the address with it — a member with a junk
    // avatar is still a member, and the menu still has to name them.
    const viewer = viewerFrom(signedIn({ avatar_url: "javascript:alert(1)" }));

    assert.equal(viewer.email, "kev@example.com");
    assert.equal(viewer.avatar, null);
  });
});
