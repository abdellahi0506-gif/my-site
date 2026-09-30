-- ==========================================================
--  بيانات العينة — مطعم "طعم الشرق"
--  يتم استبدال :ADMIN_HASH أثناء التهيئة ببصمة bcrypt حقيقية
--  كلمة المرور الافتراضية للوحة التحكم: admin123
-- ==========================================================

INSERT INTO restaurants (name, description, currency, phone, email, address, admin_password_hash)
VALUES (
  'طعم الشرق',
  'مطعم متخصص في الأطباق الشرقية الفاخرة',
  'SAR',
  '+966501234567',
  'info@sharqtaste.com',
  'الرياض، السعودية',
  ':ADMIN_HASH'
);

INSERT INTO tables (restaurant_id, table_number, qr_code) VALUES
  (1, 1, '/menu/1?table=1'),
  (1, 2, '/menu/1?table=2'),
  (1, 3, '/menu/1?table=3'),
  (1, 4, '/menu/1?table=4'),
  (1, 5, '/menu/1?table=5');

INSERT INTO categories (restaurant_id, name, description, display_order, is_visible) VALUES
  (1, 'المقبلات', 'أطباق شهية لتبدأ وجبتك', 1, TRUE),
  (1, 'الأطباق الرئيسية', 'أطباق شهيرة ولذيذة', 2, TRUE),
  (1, 'الحلويات', 'حلويات شرقية فاخرة', 3, TRUE),
  (1, 'المشروبات', 'مشروبات منعشة وساخنة', 4, TRUE);

INSERT INTO menu_items (category_id, name, description, price, image_url, display_order) VALUES
  (1, 'حمص', 'حمص ناعم مع الطحينة والليمون وزيت الزيتون', 15, '/images/hummus.jpg', 1),
  (1, 'باذنجان متبل', 'باذنجان مشوي مع الثوم والليمون', 18, '/images/mutabbal.jpg', 2),
  (1, 'فلافل', 'أقراص فلافل مقرمشة مع صلصة الطحينة', 16, '/images/falafel.jpg', 3),
  (1, 'سلطة فتوش', 'خضار طازجة مع خبز محمّص ودبس الرمان', 22, '/images/fattoush.jpg', 4),
  (2, 'كبة اللحم', 'كبة سوريّة بحشوة اللحم والصنوبر', 45, '/images/kibbeh.jpg', 1),
  (2, 'شاورما دجاج', 'شاورما دجاج مع الخضار الطازجة والثومية', 35, '/images/shawarma.jpg', 2),
  (3, 'بقلاوة بالفستق', 'بقلاوة سوريّة بحشوة الفستق الحلبي', 25, '/images/baklava.jpg', 1),
  (3, 'كنافة', 'كنافة فلسطينيّة بالجبن والقشطة', 30, '/images/kunafa.jpg', 2),
  (4, 'عصير برتقال طازج', 'عصير برتقال بدون إضافات', 12, '/images/orange-juice.jpg', 1),
  (4, 'قهوة عربية', 'قهوة عربية سادة أو بالهيل', 8, '/images/arabic-coffee.jpg', 2);
