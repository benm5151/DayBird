/* Daybird cloud layer (Supabase). Loaded after supabase-js and config.js.
   If config is empty or the SDK failed to load, CLOUD.ready is false and the app stays local-only. */
const CLOUD = (() => {
  const cfg = window.DAYBIRD_CONFIG || {};
  const ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  let _user = null;

  let _init;
  function init() { return _init || (_init = _doInit()); }
  async function _doInit() {
    if (!ready) return null;
    const { data } = await sb.auth.getSession();
    _user = data.session?.user || null;
    if (_user) await ensureProfile();
    sb.auth.onAuthStateChange(async (_e, s) => { _user = s?.user || null; if (_user) await ensureProfile(); document.dispatchEvent(new Event('daybird:auth')); });
    return _user;
  }
  const user = () => _user;

  async function signIn(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw error;
  }
  async function signOut() { await sb.auth.signOut(); }

  // ---- profiles ----
  async function ensureProfile() {
    const { data } = await sb.from('profiles').select('id').eq('id', _user.id).maybeSingle();
    if (!data) await sb.from('profiles').insert({ id: _user.id, name: (_user.email || 'birder').split('@')[0] });
  }
  async function getProfile(id = _user?.id) {
    if (!id) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    return data;
  }
  async function saveProfile(p) {
    const row = { id: _user.id, name: p.name, bio: p.bio, favorite: p.favorite, favorite_why: p.favoriteWhy,
                  photo_url: p.photo, fav_photo_url: p.favPhoto, life: p.life, updated_at: new Date().toISOString() };
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
    const { error } = await sb.from('profiles').upsert(row);
    if (error) throw error;
  }

  // ---- photos ----  (dataURL in → public URL out)
  async function uploadPhoto(dataUrl, name = 'photo') {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${_user.id}/${name}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  // ---- feed ----
  async function listPosts(userId = null) {
    let q = sb.from('posts').select('id,text,tags,photo_url,created_at,user_id,profiles(name,photo_url)').order('created_at', { ascending: false }).limit(100);
    if (userId) q = q.eq('user_id', userId);
    const { data: posts, error } = await q;
    if (error) throw error;
    const ids = posts.map(p => p.id);
    const [{ data: likes }, { data: comments }] = await Promise.all([
      sb.from('likes').select('post_id,user_id').in('post_id', ids),
      sb.from('comments').select('id,post_id,user_id,text,created_at,profiles(name)').in('post_id', ids).order('created_at'),
    ]);
    const count = {}, mine = new Set(), cm = {};
    (likes || []).forEach(l => { count[l.post_id] = (count[l.post_id] || 0) + 1; if (l.user_id === _user?.id) mine.add(l.post_id); });
    (comments || []).forEach(c => (cm[c.post_id] = cm[c.post_id] || []).push({ id: c.id, who: c.profiles?.name || 'Birder', text: c.text, at: c.created_at, mine: c.user_id === _user?.id }));
    return posts.map(p => ({ id: p.id, userId: p.user_id, who: p.profiles?.name || 'Birder', avatar: p.profiles?.photo_url, text: p.text, tags: p.tags || [],
      photo: p.photo_url, at: p.created_at, likes: count[p.id] || 0, liked: mine.has(p.id), mine: p.user_id === _user?.id, comments: cm[p.id] || [] }));
  }
  async function deletePost(id) { const { error } = await sb.from('posts').delete().eq('id', id); if (error) throw error; }
  async function addComment(postId, text) { const { error } = await sb.from('comments').insert({ post_id: postId, user_id: _user.id, text }); if (error) throw error; }
  async function deleteComment(id) { await sb.from('comments').delete().eq('id', id); }
  async function createPost(text, tags, photoDataUrl) {
    const photo_url = photoDataUrl ? await uploadPhoto(photoDataUrl, 'post') : null;
    const { error } = await sb.from('posts').insert({ user_id: _user.id, text, tags, photo_url });
    if (error) throw error;
  }
  async function toggleLike(postId, liked) {
    if (liked) await sb.from('likes').delete().match({ post_id: postId, user_id: _user.id });
    else await sb.from('likes').insert({ post_id: postId, user_id: _user.id });
  }

  // ---- marketplace ----
  async function listListings() {
    const { data, error } = await sb.from('listings').select('*,profiles(name)').order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(l => ({ id: l.id, title: l.title, area: l.area, habitat: l.habitat, targets: l.targets, price: l.price, seats: l.seats,
      window: l.window, trigger: l.trigger, host: l.host_notes, dates: l.dates, sample: false, hostName: l.profiles?.name, mine: l.host_id === _user?.id, cloud: true }));
  }
  async function createListing(l) {
    const { data, error } = await sb.from('listings').insert({ host_id: _user.id, title: l.title, area: l.area, habitat: l.habitat, targets: l.targets,
      price: l.price, seats: l.seats, window: l.window, trigger: l.trigger, host_notes: l.host, dates: l.dates }).select('id').single();
    if (error) throw error;
    if (l.location || l.directions) {
      const { error: e2 } = await sb.from('listing_private').upsert({ listing_id: data.id, host_id: _user.id, location: l.location || '', directions: l.directions || '' });
      if (e2) throw e2;
    }
    return data.id;
  }
  async function deleteListing(id) { const { error } = await sb.from('listings').delete().eq('id', id); if (error) throw error; }
  // Only returns rows RLS lets this user see: hosts see their own, bookers see what they booked.
  async function privateLocations() {
    const { data } = await sb.from('listing_private').select('listing_id,location,directions');
    return Object.fromEntries((data || []).map(r => [r.listing_id, r]));
  }
  async function hostBookings() {
    const { data } = await sb.from('bookings').select('id,date,seats,created_at,listing_id,listings!inner(title,host_id),profiles(name)')
      .eq('listings.host_id', _user.id).order('date');
    return (data || []).map(b => ({ id: b.id, listingId: b.listing_id, title: b.listings?.title, who: b.profiles?.name || 'Birder', date: b.date, seats: b.seats }));
  }
  async function cancelBooking(id) { const { error } = await sb.from('bookings').delete().eq('id', id); if (error) throw error; }
  async function myBookings() {
    const { data } = await sb.from('bookings').select('id,date,seats,created_at,listing_id,listings(title,price)').eq('user_id', _user.id).order('created_at', { ascending: false });
    return (data || []).map(b => ({ id: b.id, listingId: b.listing_id, title: b.listings?.title, price: b.listings?.price || 0, date: b.date, seats: b.seats, at: b.created_at, cloud: true }));
  }
  async function book(listingId, date, seats) {
    const { error } = await sb.from('bookings').insert({ user_id: _user.id, listing_id: listingId, date, seats });
    if (error) throw error;
  }

  // ---- photo ID (edge function 'bird-id') ----
  async function photoId(payload) {
    const { data, error } = await sb.functions.invoke('bird-id', { body: payload });
    if (error) {
      let msg = error.message || String(error);
      try { const ctx = error.context; if (ctx && ctx.json) { const j = await ctx.json(); if (j.error) msg = j.error; } } catch {}
      if (/not found|404/i.test(msg)) msg = 'bird-id function is not deployed yet';
      throw new Error(msg);
    }
    return data;
  }

  return { ready, init, user, signIn, signOut, photoId, getProfile, saveProfile, uploadPhoto, listPosts, createPost, deletePost, addComment, deleteComment, toggleLike,
           listListings, createListing, deleteListing, privateLocations, hostBookings, cancelBooking, myBookings, book };
})();
