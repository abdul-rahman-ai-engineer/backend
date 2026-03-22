/**
 * Product Import Service – validates and imports products from CSV-like rows.
 * Resolves categories by name, supports create/update by ID or SKU, returns summary.
 */

import ProductModel from '../models/product.modal.js';
import CategoryModel from '../models/category.modal.js';

const HEADER_ALIASES = {
    id: 'id',
    _id: 'id',
    sku: 'sku',
    product_id: 'product_id',
    name: 'name',
    title: 'name',
    'product name': 'name',
    description: 'description',
    'short description': 'shortDescription',
    shortdescription: 'shortDescription',
    brand: 'brand',
    price: 'price',
    'regular price': 'price',
    regular_price: 'price',
    oldprice: 'oldPrice',
    'old price': 'oldPrice',
    sale_price: 'oldPrice',
    'sale price': 'oldPrice',
    old_price: 'oldPrice',
    catname: 'catName',
    categories: 'catName',
    category: 'catName',
    'category name': 'catName',
    subcat: 'subCat',
    'sub category': 'subCat',
    thirdsubcat: 'thirdsubCat',
    'third sub category': 'thirdsubCat',
    thirdsubcategory: 'thirdsubCat',
    countinstock: 'countInStock',
    stock: 'countInStock',
    rating: 'rating',
    discount: 'discount',
    sale: 'sale',
    images: 'images',
    image: 'images',
    'image(s)': 'images',
};

export function normalizeImportHeader(header) {
    return String(header || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function canonicalizeImportHeader(header) {
    const normalized = normalizeImportHeader(header);
    const attributeNameMatch = normalized.match(/^attribute\s*(\d+)\s*name$/i);
    if (attributeNameMatch) {
        return `attribute ${attributeNameMatch[1]} name`;
    }

    const attributeValueMatch = normalized.match(/^attribute\s*(\d+)\s*value(?:\(s\)|s)?$/i);
    if (attributeValueMatch) {
        return `attribute ${attributeValueMatch[1]} value(s)`;
    }

    return HEADER_ALIASES[normalized] || normalized;
}

/**
 * Build a flat map of category name -> category doc for resolution.
 * Keys: "catName", "catName > subCat", "catName > subCat > thirdsubCat"
 */
async function buildCategoryLookup() {
    const all = await CategoryModel.find().lean();
    const byId = {};
    const byPath = {};

    all.forEach((c) => {
        byId[c._id.toString()] = c;
    });

    // Root categories
    all.filter((c) => !c.parentId).forEach((c) => {
        byPath[c.name.trim().toLowerCase()] = c;
    });

    // Subcategories: "parentName > subName"
    all.filter((c) => c.parentId).forEach((c) => {
        const parent = byId[c.parentId.toString()];
        if (!parent) return;
        const key = `${parent.name.trim().toLowerCase()}>${c.name.trim().toLowerCase()}`;
        byPath[key] = c;
        // Also allow by sub name only if unique? We use full path for clarity.
    });

    // Third level: "cat > sub > third" (category with parent that has parent)
    all.filter((c) => c.parentId).forEach((c) => {
        const parent = byId[c.parentId.toString()];
        if (!parent) return;
        const grandParent = parent.parentId ? byId[parent.parentId.toString()] : null;
        if (!grandParent) return;
        const key = `${grandParent.name.trim().toLowerCase()}>${parent.name.trim().toLowerCase()}>${c.name.trim().toLowerCase()}`;
        byPath[key] = c;
    });

    return { byId, byPath };
}

function resolveCategory(catName, subCat, thirdsubCat, byPath, byId) {
    const norm = (v) => (v || '').trim().toLowerCase();
    const cat = norm(catName);
    const sub = norm(subCat);
    const third = norm(thirdsubCat);

    if (third && sub && cat) {
        const key = `${cat}>${sub}>${third}`;
        const found = byPath[key];
        if (found) {
            const parent = byId[found.parentId?.toString()];
            const grandParent = parent?.parentId ? byId[parent.parentId.toString()] : null;
            return {
                catId: grandParent?._id || null,
                subCatId: parent?._id || null,
                thirdsubCatId: found._id,
                category: found._id,
                catName: grandParent?.name ?? catName,
                subCat: parent?.name ?? subCat,
                thirdsubCat: found.name,
            };
        }
    }
    if (sub && cat) {
        const key = `${cat}>${sub}`;
        const found = byPath[key];
        if (found) {
            const parent = byPath[cat];
            return {
                catId: parent?._id || null,
                subCatId: found._id,
                thirdsubCatId: null,
                category: found._id,
                catName: parent?.name ?? catName,
                subCat: found.name,
                thirdsubCat: thirdsubCat || '',
            };
        }
    }
    if (cat) {
        const found = byPath[cat];
        if (found) {
            return {
                catId: found._id,
                subCatId: null,
                thirdsubCatId: null,
                category: found._id,
                catName: found.name,
                subCat: subCat || '',
                thirdsubCat: thirdsubCat || '',
            };
        }
    }
    return {
        catId: null,
        subCatId: null,
        thirdsubCatId: null,
        category: undefined,
        catName: catName || '',
        subCat: subCat || '',
        thirdsubCat: thirdsubCat || '',
    };
}

function parseNumber(val, fieldName) {
    if (val === '' || val === undefined || val === null) return { valid: true, value: 0 };
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim());
    if (Number.isNaN(num)) return { valid: false, value: null, message: `${fieldName} must be a number` };
    return { valid: true, value: num };
}

function parseImages(val) {
    if (val === undefined || val === null || val === '') return [];
    const s = String(val).trim();
    return s.split(/[|\n,]/).map((u) => u.trim()).filter(Boolean);
}

function normalizeCloudinaryUrl(url) {
    const input = String(url || '').trim();
    if (!input) return '';
    if (!/localhost:8000/i.test(input)) return input;

    const cloudName = process.env.cloudinary_Config_Cloud_Name;
    if (!cloudName) return input;

    const cleanPath = input
        .replace(/^https?:\/\/localhost:8000\/?/i, '')
        .replace(/^uploads\/?/i, '');

    return `https://res.cloudinary.com/${cloudName}/image/upload/v1/${cleanPath}`;
}

function calculateDiscountPercent(oldPrice, newPrice) {
    const oldVal = Number(oldPrice);
    const newVal = Number(newPrice);
    if (!oldVal || oldVal <= 0) return 0;
    const discount = ((oldVal - newVal) / oldVal) * 100;
    return Math.max(0, Math.round(discount));
}

function parseBoolean(val) {
    if (typeof val === 'boolean') return val;
    const normalized = String(val || '').trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
}

function isBlankAttributeValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized || normalized === '-' || normalized === 'n/a' || normalized === 'na' || normalized === 'null';
}

function extractAttributes(row) {
    const attributes = [];

    for (let i = 1; i <= 12; i++) {
        const name = String(row[`attribute ${i} name`] || '').trim();
        const rawValue = String(row[`attribute ${i} value(s)`] || '').trim();
        const values = rawValue
            .split(/[|,\n]/)
            .map((value) => value.trim())
            .filter((value) => !isBlankAttributeValue(value));

        if (!name || isBlankAttributeValue(rawValue) || values.length === 0) {
            continue;
        }

        attributes.push({
            name,
            value: values.join(' | '),
            values,
        });
    }

    return attributes;
}

/**
 * Validate and normalize a single product row for import.
 */
function normalizeProductRow(row, index, updateExisting) {
    const errors = [];
    const name = (row.name || row.title || '').toString().trim();
    if (!name) {
        errors.push({ row: index + 1, message: 'Name is required' });
        return { valid: false, errors, doc: null };
    }

    const sku = (row.sku || '').toString().trim();
    const productId = (row.product_id || '').toString().trim();
    if (updateExisting && !sku && !productId) {
        errors.push({ row: index + 1, message: 'SKU or product_id required when updating existing products' });
        return { valid: false, errors, doc: null };
    }

    if (row.price === '' || row.price === undefined || row.price === null) {
        errors.push({ row: index + 1, message: 'Price is required' });
        return { valid: false, errors, doc: null };
    }

    const priceRes = parseNumber(row.price ?? row.regular_price, 'price');
    if (!priceRes.valid) errors.push({ row: index + 1, message: priceRes.message });
    const oldPriceRes = parseNumber(row.oldPrice ?? row.sale_price ?? row.old_price, 'oldPrice');
    if (!oldPriceRes.valid) errors.push({ row: index + 1, message: oldPriceRes.message });
    const stockRes = parseNumber(row.countInStock ?? row.stock, 'stock');
    if (!stockRes.valid) errors.push({ row: index + 1, message: stockRes.message });
    const ratingRes = parseNumber(row.rating, 'rating');
    if (!ratingRes.valid) errors.push({ row: index + 1, message: ratingRes.message });
    const discountRes = parseNumber(row.discount, 'discount');
    if (!discountRes.valid) errors.push({ row: index + 1, message: discountRes.message });
    const saleRes = parseNumber(row.sale, 'sale');
    if (!saleRes.valid) errors.push({ row: index + 1, message: saleRes.message });
    const attributes = extractAttributes(row);

    const images = (Array.isArray(row.images) ? row.images : parseImages(row.images)).map((url) => normalizeCloudinaryUrl(url));
    if (images.length === 0 && (row.images === undefined || row.images === null || row.images === '')) {
        // Allow no images; some products may have none
    }

    const computedDiscount = calculateDiscountPercent(oldPriceRes.value, priceRes.value);

    const doc = {
        name,
        sku: sku || productId,
        product_id: productId || sku,
        description: (row.description || '').toString().trim() || name,
        shortDescription: (row.shortDescription || '').toString().trim(),
        images: images.length ? images : ['https://via.placeholder.com/300?text=No+Image'],
        bannerimages: images.length ? [images[0]] : [],
        bannerTitleName: (row.bannerTitleName || '').toString().trim(),
        isDisplayOnHomeBanner: false,
        brand: (row.brand || '').toString().trim(),
        price: priceRes.value,
        oldPrice: oldPriceRes.value,
        catName: (row.catName || row.category_path || row.categories || '').toString().trim(),
        subCat: (row.subCat || '').toString().trim(),
        thirdsubCat: (row.thirdsubCat || '').toString().trim(),
        countInStock: Math.max(0, Math.floor(stockRes.value)),
        rating: Math.min(5, Math.max(0, ratingRes.value)),
        isFeatured: parseBoolean(row.isFeatured),
        discount: computedDiscount > 0 ? computedDiscount : Math.max(0, discountRes.value),
        sale: Math.max(0, Math.floor(saleRes.value)),
        productRam: Array.isArray(row.productRam) ? row.productRam : [],
        size: Array.isArray(row.size) ? row.size : [],
        productWeight: Array.isArray(row.productWeight) ? row.productWeight : [],
        attributes: attributes.map((attribute) => ({
            name: attribute.name,
            value: attribute.value,
        })),
        specifications: attributes.map((attribute) => ({
            name: attribute.name,
            values: attribute.values,
            visible: true,
            scope: 'custom',
        })),
    };

    doc.catId = null;
    doc.subCatId = null;
    doc.thirdsubCatId = null;
    doc.category = undefined;
    // Will be set by resolveCategory after we have category lookup

    return { valid: errors.length === 0, errors, doc };
}

/**
 * Import products: create new and/or update existing (match by id or sku).
 * Returns { success, created, updated, failed, errors, message }.
 */
export async function importProducts(productsInput, updateExisting = false) {
    if (!Array.isArray(productsInput) || productsInput.length === 0) {
        return {
            success: false,
            message: 'No products to import',
            created: 0,
            updated: 0,
            failed: 0,
            errors: [],
        };
    }

    const { byId, byPath } = await buildCategoryLookup();
    const toInsert = [];
    const bulkOperations = [];
    const errors = [];
    const seenKeys = new Set();

    for (let i = 0; i < productsInput.length; i++) {
        const row = productsInput[i];
        const { valid, errors: rowErrors, doc } = normalizeProductRow(row, i, updateExisting);
        if (rowErrors.length) errors.push(...rowErrors);
        if (!valid || !doc) continue;

        const resolved = resolveCategory(doc.catName, doc.subCat, doc.thirdsubCat, byPath, byId);
        Object.assign(doc, resolved);

        const sku = doc.sku || '';
        const productId = doc.product_id || '';
        const dedupeKey = sku || productId || `row-${i + 1}`;

        if (seenKeys.has(dedupeKey)) {
            errors.push({ row: i + 1, message: 'Duplicate SKU/product_id in file' });
            continue;
        }
        seenKeys.add(dedupeKey);

        if (updateExisting && (sku || productId)) {
            const filter = [];
            if (sku) {
                filter.push({ sku });
            }
            if (productId) {
                filter.push({ product_id: productId });
            }

            bulkOperations.push({
                updateOne: {
                    filter: filter.length === 1 ? filter[0] : { $or: filter },
                    update: { $set: doc },
                    upsert: true,
                },
            });
            continue;
        }

        toInsert.push(doc);
    }

    let created = 0;
    let updated = 0;

    if (bulkOperations.length > 0) {
        try {
            const result = await ProductModel.bulkWrite(bulkOperations, { ordered: false });
            created += result.upsertedCount || 0;
            updated += result.matchedCount || 0;
        } catch (e) {
            errors.push({ row: 'update', message: e.message || 'Bulk update failed' });
        }
    }

    if (toInsert.length > 0) {
        try {
            const inserted = await ProductModel.insertMany(toInsert);
            created += inserted.length;
        } catch (e) {
            errors.push({ message: e.message || 'Insert failed' });
        }
    }

    const failed = errors.length;
    return {
        success: created > 0 || updated > 0,
        message: `Imported: ${created} created, ${updated} updated. ${failed} error(s).`,
        created,
        updated,
        failed,
        errors: errors.length ? errors : undefined,
    };
}

/**
 * Validate CSV headers (required: name; if updateExisting then id or sku).
 */
export function validateImportHeaders(headers, updateExisting) {
    const normalized = (headers || []).map((header) => canonicalizeImportHeader(header));
    const hasName = normalized.includes('name');
    const hasPrice = normalized.includes('price');
    if (!hasName || !hasPrice) {
        return { valid: false, message: 'Missing required headers' };
    }
    if (updateExisting) {
        const hasSku = normalized.includes('sku') || normalized.includes('product_id');
        if (!hasSku) {
            return { valid: false, message: 'When updating existing products, CSV must include "sku" or "product_id".' };
        }
    }
    return { valid: true };
}
