/**
 * Validation middleware for product import.
 * Ensures request body has products array and optional updateExisting flag.
 */

export function validateImportBody(req, res, next) {
    const { products: productsInput, updateExisting } = req.body;

    if (!productsInput) {
        return res.status(400).json({
            error: true,
            success: false,
            message: 'Request body must include "products" array.',
        });
    }

    if (!Array.isArray(productsInput)) {
        return res.status(400).json({
            error: true,
            success: false,
            message: '"products" must be an array.',
        });
    }

    if (productsInput.length === 0) {
        return res.status(400).json({
            error: true,
            success: false,
            message: 'No products to import.',
        });
    }

    const hasName = productsInput.some(
        (p) => (p && (p.name || p.title)) && String(p.name || p.title).trim()
    );
    if (!hasName) {
        return res.status(400).json({
            error: true,
            success: false,
            message: 'At least one product must have a "name" or "title".',
        });
    }

    if (updateExisting) {
        const hasIdOrSku = productsInput.some(
            (p) => p && (String(p.id || p._id || '').trim() || String(p.sku || p.product_id || '').trim())
        );
        if (!hasIdOrSku) {
            return res.status(400).json({
                error: true,
                success: false,
                message: 'When updating existing products, each row must have "id" or "sku".',
            });
        }
    }

    next();
}
