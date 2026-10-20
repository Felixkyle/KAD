/* spotlight-supabase.js
   Loads the Service Spotlight cards from Supabase and renders them.
   Needs: the Supabase JS library loaded BEFORE this file, e.g.
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   If your site already creates a client, reuse it instead of creating a new one. */

(function () {
  const SUPABASE_URL = "https://xjaieymgmhberbkbucrh.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_r86lqj5QiI3qTgXicj7Ryg_AWkXZXu6";

  const sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const section = document.getElementById('spotlight');
  const grid = document.getElementById('spotlightGrid');
  if (!section || !grid) return;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const naira = n => '₦' + Number(n).toLocaleString('en-NG');

  function cardHTML(r) {
    const features = Array.isArray(r.features) ? r.features : [];
    const old = r.old_price ? `<span class="old">${naira(r.old_price)}</span>` : '';
    return `
      <article class="spot-card">
        <div class="spot-img"><img src="${esc(r.image_url)}" alt="${esc(r.title)}" loading="lazy"></div>
        <div class="spot-body">
          <div class="spot-cat">${esc(r.category)}</div>
          <h3>${esc(r.title)}</h3>
          <div class="spot-features">
            <h4>KEY FEATURES</h4>
            <ul>${features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>
          <div class="spot-price">${old}<span class="new">${naira(r.new_price)}</span></div>
          <div class="spot-actions">
            <button class="btn-cancel" type="button">Cancel</button>
            <button class="btn-order" type="button"
              data-title="${esc(r.title)}" data-price="${esc(naira(r.new_price))}">Order</button>
          </div>
        </div>
      </article>`;
  }

  async function load() {
    const { data, error } = await sb
      .from('service_spotlight')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    // The cards already written in index.html stay as the default.
    // They are only replaced when Supabase returns at least one active card.
    if (error || !data || !data.length) {
      if (error) console.error('Spotlight load failed:', error.message);
      return;
    }
    grid.innerHTML = data.map(cardHTML).join('');
  }

  // One listener handles every Order button, including ones added later
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.btn-order');
    if (btn) openModal(btn.dataset.title, btn.dataset.price);
  });

  load();
})();