/* ==========================================================
   لوحة تحكم المطعم
   ========================================================== */
(function () {
  'use strict';

  const { api, toast, escapeHtml, formatPrice, copyToClipboard, getToken, setToken } = window.Sharq;

  const $ = (id) => document.getElementById(id);

  const state = {
    restaurant: null,
    categories: [],
    tables: [],
    stats: null,
    dbClient: null,
    view: 'dashboard',
  };

  // ------------------------------------------------------------
  // التنقل بين الشاشات
  // ------------------------------------------------------------
  function showLogin() {
    $('login-screen').classList.remove('hidden');
    $('app').classList.add('hidden');
  }

  function showApp() {
    $('login-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.admin-side nav button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.viewPanel !== view);
    });
  }

  /** يغلّف طلبات الإدارة: عند انتهاء الجلسة نعيد المستخدم لشاشة الدخول */
  async function adminApi(path, options) {
    try {
      return await api(path, options);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        setToken(null);
        showLogin();
        toast('انتهت الجلسة، برجاء تسجيل الدخول مجدداً', 'error');
      }
      throw error;
    }
  }

  // ------------------------------------------------------------
  // تسجيل الدخول
  // ------------------------------------------------------------
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-submit');
    button.disabled = true;
    button.textContent = 'جارٍ الدخول…';
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: { password: $('login-password').value, restaurantId: $('login-restaurant').value || undefined },
      });
      setToken(result.token);
      $('login-password').value = '';
      showApp();
      await boot();
      toast(`مرحباً بك في ${result.restaurant.name}`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'دخول';
    }
  });

  $('logout-button').addEventListener('click', () => {
    setToken(null);
    showLogin();
  });

  document.querySelectorAll('.admin-side nav button').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  document.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.goto));
  });

  $('add-category-button').addEventListener('click', () => openCategoryModal(null));

  // ------------------------------------------------------------
  // تحميل البيانات
  // ------------------------------------------------------------
  async function loadRestaurant() {
    const data = await adminApi('/api/admin/restaurant');
    state.restaurant = data;
    document.title = `${data.name} | لوحة التحكم`;
    $('side-name').textContent = data.name;
    $('top-title').textContent = data.name;
    $('side-logo').textContent = data.logo_url ? '' : '🍽️';
    if (data.logo_url) {
      $('side-logo').innerHTML = `<img src="${escapeHtml(data.logo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
    }
    $('menu-link').href = `/menu/${data.id}`;
  }

  async function loadMenu() {
    state.categories = await adminApi('/api/admin/menu');
    renderMenu();
  }

  async function loadTables() {
    state.tables = await adminApi('/api/admin/tables');
    renderTables();
  }

  async function loadStats() {
    state.stats = await adminApi('/api/admin/stats');
    renderDashboard();
  }

  async function boot() {
    try {
      await loadRestaurant();
      try {
        const health = await api('/api/health');
        state.dbClient = health.database;
        $('db-client').textContent = health.database === 'mysql' ? 'MySQL' : 'SQLite (تطوير)';
      } catch (_) {
        /* الصحة غير متاحة */
      }
      await Promise.all([loadStats(), loadMenu(), loadTables(), fillSettings()]);
      setView(state.view);
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) toast(error.message, 'error');
    }
  }

  // ------------------------------------------------------------
  // لوحة المعلومات
  // ------------------------------------------------------------
  function renderDashboard() {
    const stats = state.stats || { categories: 0, items: 0, availableItems: 0, hiddenItems: 0, tables: 0 };
    $('stats-grid').innerHTML = [
      { label: 'الفئات', value: stats.categories, icon: '🗂️' },
      { label: 'الأطباق', value: stats.items, icon: '🍽️' },
      { label: 'الأطباق المتاحة', value: stats.availableItems, icon: '✅' },
      { label: 'أطباق غير متاحة', value: stats.hiddenItems, icon: '🚫' },
      { label: 'الطاولات', value: stats.tables, icon: '🪑' },
    ]
      .map(
        (card) => `<div class="stat">
            <div class="value">${card.value}</div>
            <div class="label">${card.icon} ${card.label}</div>
          </div>`
      )
      .join('');

    $('quick-menu-link').href = `/menu/${state.restaurant ? state.restaurant.id : 1}`;
  }

  // ------------------------------------------------------------
  // إدارة المنيو
  // ------------------------------------------------------------
  function renderMenu() {
    const root = $('menu-list');
    if (!state.categories.length) {
      root.innerHTML = `<div class="empty-state"><div class="icon">🗂️</div>
        <h3>لا توجد فئات بعد</h3><p>ابدأ بإضافة فئة مثل «المقبلات» ثم أضف الأطباق داخلها.</p></div>`;
      return;
    }

    root.innerHTML = state.categories
      .map((category) => {
        const items = category.items || [];
        return `
          <div class="category-block" data-category="${category.id}">
            <div class="category-head">
              <h3>${escapeHtml(category.name)}</h3>
              ${category.is_visible ? '' : '<span class="badge badge-danger">مخفية</span>'}
              <span class="badge">${items.length} طبق</span>
              <div class="grow"></div>
              <div class="actions">
                <button class="btn btn-sm btn-outline" data-action="add-item" data-id="${category.id}">➕ طبق</button>
                <button class="btn btn-sm btn-outline" data-action="edit-category" data-id="${category.id}">✏️</button>
                <button class="btn btn-sm btn-outline" data-action="delete-category" data-id="${category.id}">🗑️</button>
              </div>
            </div>
            ${
              items.length
                ? items.map(itemRowHtml).join('')
                : '<div class="item-row"><div class="info"><p>لا توجد أطباق في هذه الفئة.</p></div></div>'
            }
          </div>`;
      })
      .join('');
  }

  function itemRowHtml(item) {
    const price = formatPrice(item.price, state.restaurant ? state.restaurant.currency : 'SAR');
    const thumb = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy">`
      : '<div class="thumb">🍲</div>';

    return `
      <div class="item-row" data-item="${item.id}">
        ${thumb}
        <div class="info">
          <h4>${escapeHtml(item.name)} ${item.available ? '' : '<span class="badge badge-danger">غير متاح</span>'}</h4>
          <p>${escapeHtml(item.description || 'بدون وصف')}</p>
          <div class="text-muted" style="font-size:.85rem">${price.amount} ${escapeHtml(price.symbol)}</div>
        </div>
        <div class="row-actions">
          <label class="switch" title="إتاحة الطبق">
            <input type="checkbox" data-action="toggle-item" data-id="${item.id}" ${item.available ? 'checked' : ''}>
            متاح
          </label>
          <button class="btn btn-sm btn-outline" data-action="edit-item" data-id="${item.id}">✏️</button>
          <button class="btn btn-sm btn-outline" data-action="delete-item" data-id="${item.id}">🗑️</button>
        </div>
      </div>`;
  }

  function findItem(itemId) {
    for (const category of state.categories) {
      const found = (category.items || []).find((item) => item.id === Number(itemId));
      if (found) return found;
    }
    return null;
  }

  $('menu-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;

    if (button.dataset.action === 'add-item') return openItemModal(Number(id));
    if (button.dataset.action === 'edit-item') return openItemModal(null, findItem(id));
    if (button.dataset.action === 'edit-category') {
      return openCategoryModal(state.categories.find((category) => category.id === Number(id)));
    }

    if (button.dataset.action === 'delete-item') {
      const item = findItem(id);
      if (!item || !window.confirm(`حذف «${item.name}»؟`)) return;
      try {
        await adminApi(`/api/admin/menu-items/${item.id}`, { method: 'DELETE' });
        toast('تم حذف الطبق', 'success');
        await Promise.all([loadMenu(), loadStats()]);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (button.dataset.action === 'delete-category') {
      const category = state.categories.find((entry) => entry.id === Number(id));
      if (!category) return;
      if (!window.confirm(`حذف فئة «${category.name}» وكل أطباقها؟`)) return;
      try {
        await adminApi(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
        toast('تم حذف الفئة', 'success');
        await Promise.all([loadMenu(), loadStats()]);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  $('menu-list').addEventListener('change', async (event) => {
    const input = event.target.closest('[data-action="toggle-item"]');
    if (!input) return;
    const item = findItem(input.dataset.id);
    if (!item) return;
    try {
      await adminApi(`/api/admin/menu-items/${item.id}`, {
        method: 'PUT',
        body: { available: input.checked },
      });
      item.available = input.checked;
      await loadStats();
      toast(input.checked ? 'الطبق متاح الآن' : 'الطبق غير متاح الآن', 'success');
    } catch (error) {
      input.checked = !input.checked;
      toast(error.message, 'error');
    }
  });

  // ------------------------- النوافذ -------------------------
  function closeModal() {
    $('modal-root').innerHTML = '';
  }

  function openModal(html) {
    $('modal-root').innerHTML = `<div class="modal" id="modal"><div class="modal-panel">${html}</div></div>`;
    $('modal').addEventListener('click', (event) => {
      if (event.target.id === 'modal') closeModal();
    });
    $('modal-root').querySelectorAll('[data-close]').forEach((button) =>
      button.addEventListener('click', closeModal)
    );
  }

  function openCategoryModal(category) {
    const isEdit = Boolean(category);
    openModal(`
      <div class="modal-head">
        <h3>${isEdit ? 'تعديل الفئة' : 'إضافة فئة'}</h3>
        <button class="btn btn-sm btn-ghost" data-close>✕</button>
      </div>
      <form id="category-form">
        <div class="field">
          <label for="cat-name">اسم الفئة *</label>
          <input id="cat-name" required maxlength="255" value="${isEdit ? escapeHtml(category.name) : ''}" placeholder="مثال: المقبلات">
        </div>
        <div class="field">
          <label for="cat-desc">الوصف</label>
          <textarea id="cat-desc" maxlength="2000" placeholder="أطباق شهية لتبدأ وجبتك">${isEdit ? escapeHtml(category.description || '') : ''}</textarea>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cat-order">ترتيب العرض</label>
            <input id="cat-order" type="number" min="0" step="1" value="${isEdit ? category.display_order : ''}" placeholder="تلقائي">
          </div>
          <div class="field">
            <label>الظهور في المنيو</label>
            <label class="switch"><input id="cat-visible" type="checkbox" ${!isEdit || category.is_visible ? 'checked' : ''}> ظاهرة للزوار</label>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" type="submit">${isEdit ? 'حفظ' : 'إضافة'}</button>
          <button class="btn btn-outline" type="button" data-close>إلغاء</button>
        </div>
      </form>
    `);

    $('category-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: $('cat-name').value,
        description: $('cat-desc').value,
        displayOrder: $('cat-order').value,
        isVisible: $('cat-visible').checked,
      };
      try {
        if (isEdit) {
          await adminApi(`/api/admin/categories/${category.id}`, { method: 'PUT', body: payload });
        } else {
          await adminApi('/api/admin/categories', { method: 'POST', body: payload });
        }
        closeModal();
        toast(isEdit ? 'تم تحديث الفئة' : 'تمت إضافة الفئة', 'success');
        await Promise.all([loadMenu(), loadStats()]);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function openItemModal(categoryId, item) {
    const isEdit = Boolean(item);
    const currentCategoryId = isEdit ? item.category_id : categoryId;

    openModal(`
      <div class="modal-head">
        <h3>${isEdit ? 'تعديل الطبق' : 'إضافة طبق'}</h3>
        <button class="btn btn-sm btn-ghost" data-close>✕</button>
      </div>
      <form id="item-form">
        <div class="field">
          <label for="item-name">اسم الطبق *</label>
          <input id="item-name" required maxlength="255" value="${isEdit ? escapeHtml(item.name) : ''}" placeholder="مثال: كبة اللحم">
        </div>
        <div class="field">
          <label for="item-desc">الوصف</label>
          <textarea id="item-desc" maxlength="2000" placeholder="مكونات الطبق...">${isEdit ? escapeHtml(item.description || '') : ''}</textarea>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="item-price">السعر *</label>
            <input id="item-price" type="number" min="0" step="0.01" required value="${isEdit ? item.price : ''}" placeholder="0.00">
          </div>
          <div class="field">
            <label for="item-category">الفئة *</label>
            <select id="item-category">
              ${state.categories
                .map(
                  (category) =>
                    `<option value="${category.id}" ${category.id === currentCategoryId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="item-order">ترتيب العرض</label>
            <input id="item-order" type="number" min="0" step="1" value="${isEdit ? item.display_order : ''}" placeholder="تلقائي">
          </div>
          <div class="field">
            <label>الإتاحة</label>
            <label class="switch"><input id="item-available" type="checkbox" ${!isEdit || item.available ? 'checked' : ''}> متاح للطلب</label>
          </div>
        </div>
        <div class="field">
          <label for="item-image">صورة الطبق</label>
          <input id="item-image" type="file" accept="image/*">
          <div class="hint">الحد الأقصى 5 ميجابايت — JPG أو PNG أو WEBP</div>
          <div class="image-preview" id="image-preview">
            ${isEdit && item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : ''}
          </div>
          ${isEdit && item.image_url ? '<label class="switch"><input id="item-remove-image" type="checkbox"> حذف الصورة الحالية</label>' : ''}
        </div>
        <div class="modal-actions">
          <button class="btn" type="submit">${isEdit ? 'حفظ التغييرات' : 'إضافة الطبق'}</button>
          <button class="btn btn-outline" type="button" data-close>إلغاء</button>
        </div>
      </form>
    `);

    $('item-image').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        $('image-preview').innerHTML = `<img src="${loadEvent.target.result}" alt="">`;
      };
      reader.readAsDataURL(file);
    });

    $('item-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData();
      formData.append('name', $('item-name').value);
      formData.append('description', $('item-desc').value);
      formData.append('price', $('item-price').value);
      formData.append('categoryId', $('item-category').value);
      formData.append('displayOrder', $('item-order').value);
      formData.append('available', $('item-available').checked ? 'true' : 'false');

      const fileInput = $('item-image');
      if (fileInput.files[0]) formData.append('image', fileInput.files[0]);

      const removeCheckbox = $('item-remove-image');
      if (removeCheckbox && removeCheckbox.checked) formData.append('removeImage', 'true');

      try {
        if (isEdit) {
          await adminApi(`/api/admin/menu-items/${item.id}`, { method: 'PUT', body: formData });
        } else {
          await adminApi('/api/admin/menu-items', { method: 'POST', body: formData });
        }
        closeModal();
        toast(isEdit ? 'تم تحديث الطبق' : 'تمت إضافة الطبق', 'success');
        await Promise.all([loadMenu(), loadStats()]);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // ------------------------------------------------------------
  // الطاولات و QR
  // ------------------------------------------------------------
  function renderTables() {
    const root = $('tables-list');
    if (!state.tables.length) {
      root.innerHTML = `<div class="empty-state"><div class="icon">🪑</div>
        <h3>لا توجد طاولات</h3><p>أضف أرقام طاولات مطعمك لتحصل على رمز QR لكل طاولة.</p></div>`;
      return;
    }

    root.innerHTML = state.tables
      .map(
        (table) => `
        <div class="table-card">
          <img src="${table.qr}" alt="QR طاولة ${table.table_number}">
          <h4>طاولة رقم ${table.table_number}</h4>
          <div class="link" dir="ltr">${escapeHtml(table.url)}</div>
          <div class="row-actions">
            <button class="btn btn-sm btn-outline" data-action="copy-table" data-url="${escapeHtml(table.url)}">📋 نسخ</button>
            <button class="btn btn-sm btn-outline" data-action="print-table" data-id="${table.id}">🖨️ طباعة</button>
            <button class="btn btn-sm btn-outline" data-action="delete-table" data-id="${table.id}" data-number="${table.table_number}">🗑️</button>
          </div>
        </div>`
      )
      .join('');
  }

  $('tables-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    if (button.dataset.action === 'copy-table') {
      const ok = await copyToClipboard(button.dataset.url);
      toast(ok ? 'تم نسخ الرابط' : 'تعذّر النسخ', ok ? 'success' : 'error');
      return;
    }

    if (button.dataset.action === 'print-table') {
      const table = state.tables.find((entry) => entry.id === Number(button.dataset.id));
      if (!table || !state.restaurant) return;
      const printWindow = window.open('', '_blank', 'width=600,height=760');
      if (!printWindow) return toast('المتصفح منع فتح نافذة الطباعة', 'error');
      printWindow.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
        <title>QR طاولة ${table.table_number}</title>
        <style>
          body{font-family:'Tajawal',system-ui,sans-serif;text-align:center;padding:32px;color:#1c1714}
          img{width:320px;height:320px}
          h1{font-size:22px;margin:8px 0}
          p{margin:4px 0;color:#746a5f;font-size:14px}
          .name{font-size:18px;font-weight:700}
        </style></head><body>
        <div class="name">${escapeHtml(state.restaurant.name)}</div>
        <h1>امسح الرمز لعرض المنيو</h1>
        <img src="${table.qr}" alt="QR">
        <h1>طاولة رقم ${table.table_number}</h1>
        <p dir="ltr">${escapeHtml(table.url)}</p>
        <script>window.onload = () => setTimeout(() => window.print(), 300)<\/script>
        </body></html>`);
      printWindow.document.close();
      return;
    }

    if (button.dataset.action === 'delete-table') {
      if (!window.confirm(`حذف طاولة رقم ${button.dataset.number}؟`)) return;
      try {
        await adminApi(`/api/admin/tables/${button.dataset.id}`, { method: 'DELETE' });
        toast('تم حذف الطاولة', 'success');
        await Promise.all([loadTables(), loadStats()]);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  $('table-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('table-number');
    const value = input.value;
    if (!value) return;
    try {
      await adminApi('/api/admin/tables', { method: 'POST', body: { tableNumber: Number(value) } });
      input.value = '';
      toast(`تمت إضافة الطاولة رقم ${value}`, 'success');
      await Promise.all([loadTables(), loadStats()]);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // ------------------------------------------------------------
  // الإعدادات
  // ------------------------------------------------------------
  async function fillSettings() {
    if (!state.restaurant) return;
    $('set-name').value = state.restaurant.name || '';
    $('set-description').value = state.restaurant.description || '';
    $('set-currency').value = state.restaurant.currency || 'SAR';
    $('set-phone').value = state.restaurant.phone || '';
    $('set-email').value = state.restaurant.email || '';
    $('set-address').value = state.restaurant.address || '';
    $('set-logo-preview').innerHTML = state.restaurant.logo_url
      ? `<img src="${escapeHtml(state.restaurant.logo_url)}" alt="">`
      : '<div class="thumb">🏷️</div>';
  }

  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append('name', $('set-name').value);
    formData.append('description', $('set-description').value);
    formData.append('currency', $('set-currency').value);
    formData.append('phone', $('set-phone').value);
    formData.append('email', $('set-email').value);
    formData.append('address', $('set-address').value);
    const logo = $('set-logo').files[0];
    if (logo) formData.append('logo', logo);

    try {
      const result = await adminApi('/api/admin/restaurant', { method: 'PUT', body: formData });
      state.restaurant = result.restaurant;
      await loadRestaurant();
      await fillSettings();
      toast('تم حفظ الإعدادات', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('set-logo').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      $('set-logo-preview').innerHTML = `<img src="${loadEvent.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await adminApi('/api/admin/password', {
        method: 'PUT',
        body: {
          currentPassword: $('pass-current').value,
          newPassword: $('pass-new').value,
        },
      });
      $('pass-current').value = '';
      $('pass-new').value = '';
      toast('تم تغيير كلمة المرور', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // ------------------------------------------------------------
  // الإقلاع
  // ------------------------------------------------------------
  if (getToken()) {
    showApp();
    boot();
  } else {
    showLogin();
  }
})();
