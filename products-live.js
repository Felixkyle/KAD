/* ============================================================
   KADIS — live products
   Drop <script src="products-live.js" defer></script> at the end of a
   category page. It loads that category's products from the database
   (the ones managed in kadisProducts.html) and shows them using the
   page's OWN card design, so each page keeps its look.

   - Figures out the category from the page's file name (see PAGE_TO_CATEGORY).
   - Cart, Quick View and filters keep working: the cards are real
     .prod-card elements, exactly like the hand-written ones.
   - If the database can't be reached (or has nothing for this category)
     the page's built-in products stay on screen, so the shop never goes blank.
   - Long descriptions are cleaned with DOMPurify before they are shown.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://xjaieymgmhberbkbucrh.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_r86lqj5QiI3qTgXicj7Ryg_AWkXZXu6'; // public "anon" key — safe in the browser; row-level security protects the data

  // page file name (without .html)  ->  category key stored in the database
  var PAGE_TO_CATEGORY = {
    gadgets: 'gadgets',
    electronic_converter: 'electronic_converter',
    cables: 'cables',
    computer: 'computer',
    ict_tools: 'ict_tools',
    ps: 'ps',
    ringlights: 'ringlights',
    satellite: 'satellite',
    smart: 'smart',
    solar: 'solar',
    wifi: 'wifi'
  };

  var script = document.currentScript;
  var pageName = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/i, '').toLowerCase();
  var category = (script && script.dataset && script.dataset.category) || PAGE_TO_CATEGORY[pageName];
  if (!category) return;

  var FIELDS_LEGACY = 'id,legacy_id,category,subcategory,brand,name,price,price_note,old_price,price_prefix,tag,status,image_url,short_description,full_description,specs,sort_order,created_at';
  // new: colour of the main picture + the extra pictures (product_images table)
  var FIELDS_FULL = FIELDS_LEGACY + ',image_color,product_images(image_url,color_label,sort_order)';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var grid = document.querySelector('.prod-grid');
    if (!grid) return;

    function load(full) {
      var url = SUPABASE_URL + '/rest/v1/products'
        + '?select=' + (full ? FIELDS_FULL : FIELDS_LEGACY)
        + '&category=eq.' + encodeURIComponent(category)
        + '&is_published=eq.true'
        + '&order=sort_order.asc,created_at.desc&limit=500'
        + (full ? '&product_images.order=sort_order.asc' : '');
      return fetch(url, { headers: { apikey: SUPABASE_KEY } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }

    // try with the extra pictures first; if that fails for any reason, fall back to the plain product list
    load(true)
      .catch(function (err) {
        if (window.console) console.warn('[kadis] extra pictures unavailable, loading plain products:', err.message || err);
        return load(false);
      })
      .then(function (products) {
        if (!Array.isArray(products) || !products.length) return; // keep the page's built-in products
        return loadPurifier().then(function (purify) { render(grid, products, purify); });
      })
      .catch(function (err) {
        // leave the built-in products in place
        if (window.console) console.warn('[kadis] live products unavailable, showing built-in list:', err.message || err);
      });
  });

  /* ---------- DOMPurify (loaded on demand) ---------- */
  var purifyPromise;
  function loadPurifier() {
    if (window.DOMPurify) return Promise.resolve(window.DOMPurify);
    if (purifyPromise) return purifyPromise;
    purifyPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js';
      s.onload = function () { resolve(window.DOMPurify || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return purifyPromise;
  }

  var SAFE = {
    ALLOWED_TAGS: ['p', 'br', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'],
    ALLOWED_ATTR: ['href', 'target', 'rel']
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // plain-text fallback if DOMPurify can't load: every blank-line block becomes a paragraph
  function textToHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '').replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, '\n');
    return (tmp.textContent || '').split(/\n+/).map(function (l) { return l.trim(); })
      .filter(Boolean).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
  }

  function buildDetailsHtml(p, purify) {
    var out = '';
    if (p.full_description) {
      var clean = purify ? purify.sanitize(p.full_description, SAFE) : textToHtml(p.full_description);
      var box = document.createElement('div');
      box.innerHTML = clean;
      // headings inside the quick-view popup use the site's own small-caps heading style
      box.querySelectorAll('h3, h4').forEach(function (h) {
        var p2 = document.createElement('p');
        p2.className = 'qv-heading';
        p2.textContent = h.textContent;
        h.replaceWith(p2);
      });
      box.querySelectorAll('a').forEach(function (a) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
      out += box.innerHTML;
    }
    var specs = Array.isArray(p.specs) ? p.specs.filter(function (s) { return s && s.label && s.value; }) : [];
    if (specs.length) {
      out += '<p class="qv-heading">Specifications</p><ul>'
        + specs.map(function (s) { return '<li><strong>' + esc(s.label) + ':</strong> ' + esc(s.value) + '</li>'; }).join('')
        + '</ul>';
    }
    return out;
  }

  /* ---------- formatting ---------- */
  function naira(n) {
    return '\u20A6' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });
  }

  function safeUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    return /^(https?:\/\/|\/|\.\/|images\/)/i.test(u) ? u : '';
  }

  /* ---------- card building ---------- */
  // used only if a page has no card of its own to copy
  var FALLBACK_CARD = '<div class="prod-card reveal"><div class="prod-img"></div><div class="prod-body">'
    + '<span class="prod-cat"></span><h5></h5><div class="prod-price"><div></div><div class="add-btn">+</div></div></div></div>';

  function makeTemplate(grid) {
    var existing = grid.querySelector('.prod-card');
    if (existing) return existing.cloneNode(true);
    var holder = document.createElement('div');
    holder.innerHTML = FALLBACK_CARD;
    return holder.firstChild;
  }

  function buildCard(tpl, p, purify) {
    var card = tpl.cloneNode(true);

    // reset everything the copied card carried that belongs to a different product
    Array.prototype.slice.call(card.attributes).forEach(function (a) {
      if (a.name.indexOf('data-') === 0 || a.name === 'style') card.removeAttribute(a.name);
    });
    card.className = 'prod-card reveal in-view';
    var id = p.legacy_id || (p.category + '-db-' + String(p.id).slice(0, 8));
    card.id = 'p-' + id;
    card.setAttribute('data-db-id', p.id);

    // pictures: main picture first, then the extra ones in the order the admin set
    var imgs = [];
    var mainUrl = safeUrl(p.image_url);
    if (mainUrl) imgs.push({ url: mainUrl, color: String(p.image_color || '').trim() });
    (Array.isArray(p.product_images) ? p.product_images.slice() : [])
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .forEach(function (r) {
        var u = safeUrl(r && r.image_url);
        if (u) imgs.push({ url: u, color: String(r.color_label || '').trim() });
      });
    window.KADIS_PRODUCT_GALLERY = window.KADIS_PRODUCT_GALLERY || {};
    if (imgs.length > 1) window.KADIS_PRODUCT_GALLERY[id] = { images: imgs };
    else delete window.KADIS_PRODUCT_GALLERY[id];
    var seenColors = {}, colorCount = 0;
    imgs.forEach(function (im) {
      var k = im.color.toLowerCase();
      if (k && !seenColors[k]) { seenColors[k] = 1; colorCount++; }
    });
    // 2+ colours: the "+" button on the card opens the preview so the customer must choose a colour
    if (colorCount >= 2) card.setAttribute('data-needs-color', '1');

    var label = p.subcategory || '';
    if (label) { card.setAttribute('data-subcat', label); card.setAttribute('data-cat', label); }
    if (p.brand) card.setAttribute('data-brand', p.brand);
    card.setAttribute('data-status', p.status === 'out_of_stock' ? 'out' : 'in_stock');
    if (p.status === 'out_of_stock') card.classList.add('is-out');

    // image + corner tag
    var media = card.querySelector('.prod-img, .prod-media');
    if (media) {
      media.innerHTML = '';
      var tagText = p.status === 'out_of_stock' ? 'OUT OF STOCK' : (p.tag || '');
      if (tagText) {
        var t = document.createElement('div');
        t.className = 'prod-tag' + (tagText === 'NEW' ? ' new' : tagText === 'SALE' ? ' sale' : '');
        t.textContent = tagText;
        media.appendChild(t);
      }
      var src = safeUrl(p.image_url) || (imgs[0] && imgs[0].url) || '';
      if (src) {
        var img = document.createElement('img');
        img.src = src;
        img.alt = p.name;
        img.loading = 'lazy';
        media.appendChild(img);
      }
    }

    // text
    var cat = card.querySelector('.prod-cat');
    if (cat) cat.textContent = label;
    var h = card.querySelector('h5');
    if (h) h.textContent = p.name;

    var desc = card.querySelector('.prod-desc');
    if (desc) {
      if (p.short_description) desc.textContent = p.short_description;
      else desc.remove();
    }
    var junk = card.querySelectorAll('.prod-meta, .prod-badge');
    for (var i = 0; i < junk.length; i++) junk[i].remove();

    // price
    var priceBox = card.querySelector('.prod-price > div:first-child');
    if (priceBox) {
      priceBox.innerHTML = '';
      if (p.price == null) {
        var note = document.createElement('b');
        note.textContent = p.price_note || 'Contact for price';
        priceBox.appendChild(note);
      } else {
        if (p.old_price != null && Number(p.old_price) > Number(p.price)) {
          var old = document.createElement('span');
          old.className = 'old';
          old.textContent = naira(p.old_price);
          priceBox.appendChild(old);
        }
        var b = document.createElement('b');
        b.textContent = (p.price_prefix ? p.price_prefix + ' ' : '') + naira(p.price);
        priceBox.appendChild(b);
      }
    }

    // long description for Quick View (Quickview.js reads window.KADIS_PRODUCT_DETAILS)
    var details = buildDetailsHtml(p, purify);
    window.KADIS_PRODUCT_DETAILS = window.KADIS_PRODUCT_DETAILS || {};
    if (details || p.brand) {
      window.KADIS_PRODUCT_DETAILS[id] = { brand: p.brand || '', full: details };
    } else {
      delete window.KADIS_PRODUCT_DETAILS[id];
    }
    return card;
  }

  function render(grid, products, purify) {
    var tpl = makeTemplate(grid);

    var frag = document.createDocumentFragment();
    products.forEach(function (p) { frag.appendChild(buildCard(tpl, p, purify)); });

    // the database is now the source of truth for this page
    grid.querySelectorAll('.prod-card').forEach(function (c) { c.remove(); });
    grid.appendChild(frag);

    addToSiteSearch(products);

    // let the page's own filter code recount and re-apply (gadgets page has these)
    try { if (typeof window.computeSubcatCounts === 'function') window.computeSubcatCounts(); } catch (e) { }
    try { if (typeof window.applyFilters === 'function') window.applyFilters(); } catch (e) { }

    document.dispatchEvent(new CustomEvent('kadis:products-rendered', { detail: { category: category, count: products.length } }));
  }

  // make new products findable in the site-wide search box
  function addToSiteSearch(products) {
    try {
      if (typeof KADIS_PRODUCT_INDEX === 'undefined' || !Array.isArray(KADIS_PRODUCT_INDEX)) return;
      var file = pageName + '.html';
      products.forEach(function (p) {
        if (p.legacy_id) return; // the old index already lists the original products
        KADIS_PRODUCT_INDEX.push({
          id: 'db-' + String(p.id).slice(0, 8),
          name: p.name,
          price: p.price == null ? (p.price_note || '') : naira(p.price),
          cat: p.subcategory || category,
          img: safeUrl(p.image_url),
          page: file
        });
      });
    } catch (e) { }
  }
})();