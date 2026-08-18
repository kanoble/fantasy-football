"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { Viewer } from "@/lib/viewer";
import { ThemeToggle } from "./theme";

/**
 * Who is reading, and the two things they might want to change about it.
 *
 * These used to sit in the masthead as three peers of the section nav — an
 * email address, a theme control and a sign-out, each as loud as the screen you
 * were on. Sign-out is the rarest action in the app and had the same weight as
 * everything else. Behind an avatar they are one target, and the bar gets its
 * width back for sections.
 */

/** The initial on the avatar. The local part's first letter, or a fallback. */
function initial(email: string | undefined) {
  const first = email?.trim()?.[0];
  return first ? first.toUpperCase() : "?";
}

export function Account({ viewer }: { viewer: Viewer }) {
  const { email, avatar } = viewer;
  const [open, setOpen] = useState(false);
  // A Google photo URL stops resolving the moment the photo is removed, and it
  // is the browser rather than the server that finds out. The initial is
  // already the right answer for a member with no photo, so a 404 falls back to
  // the same place rather than leaving a broken image in the bar.
  const [noPhoto, setNoPhoto] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Escape closes, and a click anywhere else closes. Both are registered only
  // while the menu is open, so the app is not listening to every document click
  // for the whole session.
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="acct" ref={box}>
      {/* A disclosure, not an ARIA menu. `role="menu"` promises every child is
          a `menuitem` with arrow-key navigation, and this holds an address, a
          three-state toggle and a form — declaring the role without the
          behaviour is worse for a screen reader than not declaring it. */}
      <button
        className="avatar"
        type="button"
        aria-expanded={open}
        aria-label={email ? `Account — ${email}` : "Account"}
        onClick={() => setOpen((was) => !was)}
      >
        {avatar && !noPhoto ? (
          // `unoptimized`, and this is the one decision in the change worth
          // knowing about. The budget reasoning in `next.config.ts` turns
          // entirely on WHERE an image appears: a portrait is one per player
          // page, but the avatar is in the bar on every view of every screen.
          // These are already small square JPEGs on Google's own CDN, sized by
          // the URL Google minted, so optimizing them would spend the one
          // metered thing in the project to make a 28px circle no smaller.
          //
          // `alt` is empty on purpose: the button beside it already carries
          // `aria-label="Account — <address>"`, and a screen reader announcing
          // the address twice is worse than a decorative image.
          <Image
            className="avatar-photo"
            src={avatar}
            alt=""
            width={28}
            height={28}
            unoptimized
            onError={() => setNoPhoto(true)}
          />
        ) : (
          initial(email)
        )}
      </button>

      {open ? (
        <div className="menu" aria-label="Account">
          <p className="menu-who" title={email}>
            {email ?? "not signed in"}
          </p>

          <div className="menu-row">
            <span className="menu-lbl">Theme</span>
            <ThemeToggle />
          </div>

          <form action="/auth/signout" method="post">
            <button className="menu-out" type="submit">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
