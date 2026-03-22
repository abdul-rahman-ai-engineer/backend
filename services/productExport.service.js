/**
 * Product Export Service - builds CSV with selected fields and product type filters.
 */

import ProductModel from '../models/product.modal.js';

const DEFAULT_EXPORT_COLUMNS = [
    'name', 'description', 'brand', 'price', 'oldPrice', 'catName', 'subCat',
    'thirdsubCat', 'countInStock', 'rating', 'discount', 'sale', 'images', 'sku', 'product_id'
];

const PRODUCT_TYPES = {
    simple: 'simple',
    grouped: 'grouped',
    external: 'external',
    variable: 'variable',
    variation: 'variation',
};

function escapeCsv(value) {
    if (value == null) return '""';
    const s = String(value);
    return '"' + s.replace(/"/g, '""') + '"';
}

function getProductType(doc) {
    const hasVariations = (Array.isArray(doc.size) && doc.size.length > 0) ||
        (Array.isArray(doc.productRam) && doc.productRam.length > 0) ||
        (Array.isArray(doc.productWeight) && doc.productWeight.length > 0);
    return hasVariations ? PRODUCT_TYPES.variable : PRODUCT_TYPES.simple;
}

function filterByProductTypes(products, selectedTypes) {
    if (!selectedTypes || selectedTypes.length === 0) return products;
    return products.filter((p) => {
        const type = getProductType(p);
        return selectedTypes.includes(type);
    });
}

function productToRow(product, columns) {
    return columns.map((col) => {
        let value = product[col];
        if (Array.isArray(value)) {
            value = value.join(',');
        }
        if (value === undefined || value === null) value = '';
        return escapeCsv(value);
    });
}

export async function exportProductsToCsv(options = {}) {
    const {
        columns = DEFAULT_EXPORT_COLUMNS,
        productTypes = Object.values(PRODUCT_TYPES),
        catId,
        subCatId,
        thirdSubCatId,
        productIds,
    } = options;

    const query = {};
    if (productIds && productIds.length > 0) {
        query._id = { $in: productIds };
    }
    if (catId) query.catId = catId;
    if (subCatId) query.subCatId = subCatId;
    if (thirdSubCatId) query.thirdsubCatId = thirdSubCatId;

    const products = await ProductModel.find(query).lean();
    const filtered = filterByProductTypes(products, productTypes);

    const headerRow = columns.join(',');
    const dataRows = filtered.map((p) => productToRow(p, columns).join(','));
    const csv = [headerRow, ...dataRows].join('\r\n');

    return { csv, count: filtered.length, columns };
}

export { PRODUCT_TYPES, DEFAULT_EXPORT_COLUMNS };
