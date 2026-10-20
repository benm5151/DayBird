/* Daybird "what we store" notice. One sentence, reused next to every form that saves something,
   so the wording stays identical everywhere. Usage:
     DAYBIRD_NOTICE.storage()            → the plain sentence
     DAYBIRD_NOTICE.attach(el)           → writes it into el with a link to the privacy page
     DAYBIRD_NOTICE.storage('listing')   → the variant for the host form */
(() => {
  const BASE = 'What we store: your sign-in email, display name, optional photos, your life-list summary, a location rounded to about a mile, your mode and level, and anything you post, list or book.';
  const VARIANTS = {
    profile: 'What we store when you save: your display name, bio, favorite bird, the photos you add, the photos you put on your birds, and your life-list summary. Signed out, it stays in this browser only.',
    listing: 'What we store when you publish: the listing (title, area, habitat, birds, price, dates, rules), the exact location and directions in a private table only you and bookers can read, and the time you accepted the host agreement.',
    booking: 'What we store when you book: the listing, date, seats and the time you accepted the guest waiver. The host sees your display name.',
    circle: 'What we store: the circle name, who is in it, and each morning line you post (date, call, spot, note). Only members can read any of it.',
  };
  const storage = (kind) => VARIANTS[kind] || BASE;
  function attach(el, kind) {
    if (!el) return;
    el.textContent = storage(kind) + ' ';
    const a = document.createElement('a'); a.href = 'privacy.html'; a.textContent = 'Privacy';
    el.appendChild(a); el.appendChild(document.createTextNode('.'));
  }
  globalThis.DAYBIRD_NOTICE = { storage, attach };
})();
