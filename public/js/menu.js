/* ==========================================================
   صفحة منيو الزائر
   ========================================================== */
(function () {
  'use strict';

  const { api, escapeHtml, formatPrice } = window.Sharq;

  const segments = window.location.pathname.split('/').filter(Boolean);
  const restaurantId = segments[segments.length - 1];
  const params = new URLSearchParams(window.location.search);
  const tableNumber = params.get('table');
  const wantsPreview = params.get('preview') === '1';

  let state = { currency: 'SAR', categories: [], query: '' };

  const root = document.getElementById('menu-root');
  const navEl = document.getElementById('category-nav');
  const searchInput = document.getElementById('search-input');
  const searchBar = document.getElementById('search-bar');
  const tableBadge = document.getElementById('table-badge');

  function skeletons(count = 4) {
    root.innerHTML = `<div class="items">${Array.from({ length: count })
      .map(() => '<div class="skeleton"></div>')
      .join('')}</div>`;
  }

  function renderHeader(data) {
    const { restaurant, table, preview } = data;
    document.title = `${restaurant.name} | المنيو`;
    document.getElementById('restaurant-name').textContent = restaurant.name;
    document.getElementById('restaurant-desc').textContent = restaurant.description || '';

    const logo = document.getElementById('restaurant-logo');
    if (restaurant.logo_url) {
      logo.innerHTML = `<img src="${escapeHtml(restaurant.logo_url)}" alt="${escapeHtml(restaurant.name)}">`;
    } else {
      logo.textContent = '🍽️';
    }

    const meta = document.getElementById('restaurant-meta');
    const bits = [];
    if (restaurant.address) bits.push(`📍 ${escapeHtml(restaurant.address)}`);
    if (restaurant.phone) bits.push(`📞 <span dir="ltr">${escapeHtml(restaurant.phone)}</span>`);
    if (restaurant.email) bits.push(`✉️ ${escapeHtml(restaurant.email)}`);
    meta.innerHTML = bits.map((bit) => `<span>${bit}</span>`).join('');

    if (table && table.number) {
      tableBadge.textContent = `🍽️ طاولة رقم ${table.number}`;
      tableBadge.classList.remove('hidden');
    }

    if (preview) {
      const note = document.createElement('div');
      note.className = 'badge';
      note.style.marginTop = '.75rem';
      note.textContent = 'وضع المعاينة: تظهر الفئات والأطباق المخفية';
      document.querySelector('.menu-header .container').appendChild(note);
    }
  }

  function renderNav(categories) {
    navEl.innerHTML = categories
      .map(
        (category) =>
          `<a href="#cat-${category.id}" data-target="cat-${category.id}">${escapeHtml(category.name)}</a>`
      )
      .join('');
  }

  function itemHtml(item) {
    const price = formatPrice(item.price, state.currency);
    const media = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
      : '<div class="placeholder">🍲</div>';

    return `
      <article class="item ${item.available ? '' : 'is-unavailable'}" data-name="${escapeHtml(
        item.name
      )}" data-desc="${escapeHtml(item.description || '')}">
        <div class="item-media">
          ${media}
          ${item.available ? '' : '<span class="badge badge-danger flag">غير متوفر حالياً</span>'}
        </div>
        <div class="item-body">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description || '')}</p>
          <div class="item-foot">
            <span class="price">${price.amount} <small>${escapeHtml(price.symbol)}</small></span>
          </div>
        </div>
      </article>`;
  }

  function renderCategories() {
    const query = state.query.trim().toLowerCase();
    const visible = state.categories.filter((category) => {
      if (!query) return true;
      const inCategory = category.name.toLowerCase().includes(query);
      const inItems = category.items.some(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          (item.description || '').toLowerCase().includes(query)
      );
      return inCategory || inItems;
    });

    if (!state.categories.length) {
      root.innerHTML = `<div class="empty-state"><div class="icon">📋</div>
        <h2>المنيو قيد التحديث</h2><p>لم يقم المطعم بإضافة أي أطباق بعد.</p></div>`;
      navEl.innerHTML = '';
      return;
    }

    if (!visible.length) {
      root.innerHTML = `<div class="empty-state"><div class="icon">🔍</div>
        <h2>لا توجد نتائج</h2><p>لم نجد أي طبق يطابق «${escapeHtml(state.query)}».</p></div>`;
      return;
    }

    root.innerHTML = visible
      .map((category) => {
        const items = query
          ? category.items.filter(
              (item) =>
                item.name.toLowerCase().includes(query) ||
                (item.description || '').toLowerCase().includes(query) ||
                category.name.toLowerCase().includes(query)
            )
          : category.items;

        if (!items.length) {
          return `<section class="section" id="cat-${category.id}">
            <div class="section-head"><h2>${escapeHtml(category.name)}</h2></div>
            <p class="text-muted">لا توجد أطباق في هذه الفئة حتى الآن.</p>
          </section>`;
        }

        return `
          <section class="section" id="cat-${category.id}">
            <div class="section-head">
              <h2>${escapeHtml(category.name)}</h2>
              <p>${escapeHtml(category.description || '')}</p>
            </div>
            <div class="items">${items.map(itemHtml).join('')}</div>
          </section>`;
      })
      .join('');
  }

  function setupScrollSpy() {
    const links = Array.from(navEl.querySelectorAll('a'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) =>
            link.classList.toggle('active', link.dataset.target === entry.target.id)
          );
        });
      },
      { rootMargin: '-120px 0px -70% 0px', threshold: 0 }
    );

    document.querySelectorAll('.section').forEach((section) => observer.observe(section));
  }

  async function load() {
    skeletons();
    try {
      const query = new URLSearchParams();
      if (tableNumber) query.set('table', tableNumber);
      if (wantsPreview) query.set('preview', '1');

      const data = await api(`/api/menu/${encodeURIComponent(restaurantId)}?${query.toString()}`);
      state.categories = data.categories || [];
      state.currency = data.restaurant.currency || 'SAR';

      renderHeader(data);
      renderNav(state.categories);
      renderCategories();
      setupScrollSpy();
      searchBar.classList.remove('hidden');
    } catch (error) {
      searchBar.classList.add('hidden');
      const notFound = error.status === 404;
      root.innerHTML = `
        <div class="empty-state">
          <div class="icon">${notFound ? '🔍' : '⚠️'}</div>
          <h2>${notFound ? 'المطعم غير موجود' : 'تعذّر تحميل المنيو'}</h2>
          <p>${escapeHtml(error.message)}</p>
          <p><a class="btn" href="/">العودة للرئيسية</a></p>
        </div>`;
    }
  }

  searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderCategories();
  });

  load();
})();
