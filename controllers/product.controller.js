import mongoose from 'mongoose';
import ProductModel from '../models/product.modal.js';
import ProductRAMSModel from '../models/productRAMS.js';
import ProductWEIGHTModel from '../models/productWEIGHT.js';
import ProductSIZEModel from '../models/productSIZE.js';
import CategoryModel from '../models/category.modal.js';
import { exportProductsToCsv } from '../services/productExport.service.js';
import {
    canonicalizeImportHeader,
    importProducts as importProductsService,
    validateImportHeaders,
} from '../services/productImport.service.js';

import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
    cloud_name: process.env.cloudinary_Config_Cloud_Name,
    api_key: process.env.cloudinary_Config_api_key,
    api_secret: process.env.cloudinary_Config_api_secret,
    secure: true,
});

//image upload

var imagesArr = [];

//uploadImages

export async function uploadImages(request, response) {
    try {
        imagesArr = [];

        const image = request.files;

        const options = {
            use_filename: true,
            unique_filename: false,
            overwrite: false,
        };

        for (let i = 0; i < image?.length; i++) {

            const img = await cloudinary.uploader.upload(
                image[i].path,
                options,
                function (error, result) {
                    imagesArr.push(result.secure_url);
                    fs.unlinkSync(`uploads/${request.files[i].filename}`);
                }
            );
        }

        return response.status(200).json({
            images: imagesArr
        });

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

var bannerImage = [];

//uploadBannerImages

export async function uploadBannerImages(request, response) {
    try {
        bannerImage = [];

        const image = request.files;

        const options = {
            use_filename: true,
            unique_filename: false,
            overwrite: false,
        };

        for (let i = 0; i < image?.length; i++) {

            const img = await cloudinary.uploader.upload(
                image[i].path,
                options,
                function (error, result) {
                    bannerImage.push(result.secure_url);
                    fs.unlinkSync(`uploads/${request.files[i].filename}`);
                }
            );
        }

        return response.status(200).json({
            images: bannerImage
        });

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

// Normalize product category display - ensure catName, subCat, thirdsubCat from refs when empty
function normalizeProductCategories(products) {
    if (!Array.isArray(products)) return products;
    return products.map((p) => {
        const catIdVal = p.catId?._id || p.catId;
        const subCatIdVal = p.subCatId?._id || p.subCatId;
        const thirdsubCatIdVal = p.thirdsubCatId?._id || p.thirdsubCatId;
        const normalizedImages = Array.isArray(p?.images) ? p.images.map((img) => normalizeCloudinaryUrl(img)).filter(Boolean) : [];
        const normalizedBannerImages = Array.isArray(p?.bannerimages) ? p.bannerimages.map((img) => normalizeCloudinaryUrl(img)).filter(Boolean) : [];
        return {
            ...p,
            catName: p.catName || p.catId?.name || '',
            subCat: p.subCat || p.subCatId?.name || '',
            thirdsubCat: p.thirdsubCat || p.thirdsubCatId?.name || '',
            catId: catIdVal?.toString?.() || catIdVal,
            subCatId: subCatIdVal?.toString?.() || subCatIdVal,
            thirdsubCatId: thirdsubCatIdVal?.toString?.() || thirdsubCatIdVal,
            images: normalizedImages,
            bannerimages: normalizedBannerImages,
        };
    });
}

function normalizeSpecifications(rawSpecifications) {
    if (!Array.isArray(rawSpecifications)) return [];

    const normalized = rawSpecifications.map((spec) => {
        const name = String(spec?.name || spec?.key || '').trim();

        let values = [];
        if (Array.isArray(spec?.values)) {
            values = spec.values.map((v) => String(v || '').trim()).filter(Boolean);
        } else if (typeof spec?.value === 'string') {
            values = spec.value.split(',').map((v) => v.trim()).filter(Boolean);
        } else if (spec?.value != null) {
            values = [String(spec.value).trim()].filter(Boolean);
        }

        return {
            name,
            values,
            visible: spec?.visible !== false,
            scope: spec?.scope === 'global' ? 'global' : 'custom',
        };
    });

    return normalized.filter((spec) => spec.name || spec.values.length);
}

// Helper: validate category hierarchy and resolve catName, subCat, thirdsubCat
async function resolveAndValidateCategories(catId, subCatId, thirdsubCatId, catName, subCat, thirdsubCat) {
    const ids = { catId: catId || null, subCatId: subCatId || null, thirdsubCatId: thirdsubCatId || null };
    const toId = (v) => {
        if (!v) return null;
        if (mongoose.Types.ObjectId.isValid(v)) return new mongoose.Types.ObjectId(v.toString());
        return null;
    };
    ids.catId = toId(catId);
    ids.subCatId = toId(subCatId);
    ids.thirdsubCatId = toId(thirdsubCatId);

    let catDoc = null, subDoc = null, thirdDoc = null;
    if (ids.catId) catDoc = await CategoryModel.findById(ids.catId).lean();
    if (ids.subCatId) subDoc = await CategoryModel.findById(ids.subCatId).lean();
    if (ids.thirdsubCatId) thirdDoc = await CategoryModel.findById(ids.thirdsubCatId).lean();

    if (ids.thirdsubCatId) {
        if (!thirdDoc) return { valid: false, error: 'Third-level category not found' };
        subDoc = subDoc || await CategoryModel.findById(thirdDoc.parentId).lean();
        if (!subDoc) return { valid: false, error: 'Third-level category has no valid subcategory parent' };
        if (ids.subCatId && subDoc._id.toString() !== ids.subCatId.toString())
            return { valid: false, error: 'Third-level category does not belong to selected subcategory' };
        ids.subCatId = ids.subCatId || subDoc._id;
        catDoc = catDoc || (subDoc.parentId ? await CategoryModel.findById(subDoc.parentId).lean() : null);
        if (catDoc) ids.catId = ids.catId || catDoc._id;
        if (ids.catId && catDoc && catDoc._id.toString() !== ids.catId.toString())
            return { valid: false, error: 'Subcategory does not belong to selected category' };
    } else if (ids.subCatId) {
        if (!subDoc) return { valid: false, error: 'Subcategory not found' };
        if (subDoc.parentId) {
            catDoc = catDoc || await CategoryModel.findById(subDoc.parentId).lean();
            if (catDoc) ids.catId = ids.catId || catDoc._id;
            if (ids.catId && catDoc && catDoc._id.toString() !== ids.catId.toString())
                return { valid: false, error: 'Subcategory does not belong to selected category' };
        }
    } else if (ids.catId) {
        if (!catDoc) return { valid: false, error: 'Category not found' };
        if (catDoc.parentId) return { valid: false, error: 'Selected ID must be a root category' };
    }

    const names = {
        catName: catDoc?.name ?? catName ?? '',
        subCat: subDoc?.name ?? subCat ?? '',
        thirdsubCat: thirdDoc?.name ?? thirdsubCat ?? ''
    };
    const leafId = ids.thirdsubCatId || ids.subCatId || ids.catId;
    return { valid: true, ...ids, ...names, category: leafId };
}

//create product

export async function createProduct(request, response) {
    try {
        const catId = request.body.catId;
        const subCatId = request.body.subCatId;
        const thirdsubCatId = request.body.thirdsubCatId;
        if (!catId && !subCatId && !thirdsubCatId) {
            return response.status(400).json({
                message: 'At least one category level is required',
                error: true,
                success: false
            });
        }
        const resolved = await resolveAndValidateCategories(
            catId, subCatId, thirdsubCatId,
            request.body.catName, request.body.subCat, request.body.thirdsubCat
        );
        if (!resolved.valid) {
            return response.status(400).json({
                message: resolved.error || 'Invalid category hierarchy',
                error: true,
                success: false
            });
        }

        const normalizedImages = (Array.isArray(imagesArr) && imagesArr.length ? imagesArr : (Array.isArray(request.body.images) ? request.body.images : []))
            .map((img) => normalizeCloudinaryUrl(img))
            .filter(Boolean);
        const normalizedBannerImages = (Array.isArray(bannerImage) && bannerImage.length ? bannerImage : (Array.isArray(request.body.bannerimages) ? request.body.bannerimages : []))
            .map((img) => normalizeCloudinaryUrl(img))
            .filter(Boolean);
        const computedDiscount = calculateDiscountPercent(request.body.oldPrice, request.body.price);
        const discount = computedDiscount > 0 ? computedDiscount : (Number(request.body.discount) || 0);

        let product = new ProductModel({
            name: request.body.name,
            description: request.body.description,
            images: normalizedImages,
            bannerimages: normalizedBannerImages,
            bannerTitleName: request.body.bannerTitleName,
            isDisplayOnHomeBanner: request.body.isDisplayOnHomeBanner,
            brand: request.body.brand,
            price: request.body.price,
            oldPrice: request.body.oldPrice,
            catName: resolved.catName,
            category: resolved.category,
            catId: resolved.catId,
            subCatId: resolved.subCatId,
            subCat: resolved.subCat,
            thirdsubCat: resolved.thirdsubCat,
            thirdsubCatId: resolved.thirdsubCatId,
            countInStock: request.body.countInStock,
            rating: request.body.rating,
            isFeatured: request.body.isFeatured,
            discount,
            productRam: request.body.productRam,
            size: request.body.size,
            productWeight: request.body.productWeight,
            specifications: normalizeSpecifications(request.body.specifications),
        });

        product = await product.save();

        if (!product) {
            response.status(500).json({
                error: true,
                success: false,
                message: "Product Not created"
            });
        }


        imagesArr = [];

        return response.status(200).json({
            message: "Product Created successfully",
            error: false,
            success: true,
            product: product
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products

export async function getAllProducts(request, response) {
    try {

        const { page, limit } = request.query;
        const totalProducts = await ProductModel.find();

        let products = await ProductModel.find()
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('catId', 'name')
            .populate('subCatId', 'name')
            .populate('thirdsubCatId', 'name')
            .populate('category', 'name')
            .lean();

        products = normalizeProductCategories(products);

        const total = await ProductModel.countDocuments();

        if (!products) {
            return response.status(400).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            total: total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalCount: totalProducts?.length,
            totalProducts: totalProducts
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by category id

export async function getAllProductsByCatId(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }

        const catIdParam = request.params.id;
        const catIdQuery = mongoose.Types.ObjectId.isValid(catIdParam)
            ? { $or: [{ catId: catIdParam }, { catId: new mongoose.Types.ObjectId(catIdParam) }] }
            : { catId: catIdParam };
        let products = await ProductModel.find(catIdQuery)
            .populate('catId', 'name').populate('subCatId', 'name').populate('thirdsubCatId', 'name')
            .populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by category name
export async function getAllProductsByCatName(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }


        let products = await ProductModel.find({
            catName: request.query.catName
        }).populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by sub category id

export async function getAllProductsBySubCatId(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }

        const subIdParam = request.params.id;
        const subIdQuery = mongoose.Types.ObjectId.isValid(subIdParam)
            ? { $or: [{ subCatId: subIdParam }, { subCatId: new mongoose.Types.ObjectId(subIdParam) }] }
            : { subCatId: subIdParam };
        let products = await ProductModel.find(subIdQuery)
            .populate('catId', 'name').populate('subCatId', 'name').populate('thirdsubCatId', 'name')
            .populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by sub category name

export async function getAllProductsBySubCatName(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }


        let products = await ProductModel.find({
            subCat: request.query.subCat
        }).populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by sub category id

export async function getAllProductsByThirdLavelCatId(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }

        const thirdIdParam = request.params.id;
        const thirdIdQuery = mongoose.Types.ObjectId.isValid(thirdIdParam)
            ? { $or: [{ thirdsubCatId: thirdIdParam }, { thirdsubCatId: new mongoose.Types.ObjectId(thirdIdParam) }] }
            : { thirdsubCatId: thirdIdParam };
        let products = await ProductModel.find(thirdIdQuery)
            .populate('catId', 'name').populate('subCatId', 'name').populate('thirdsubCatId', 'name')
            .populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by sub category name

export async function getAllProductsByThirdLavelCatName(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }


        let products = await ProductModel.find({
            thirdsubCat: request.query.thirdsubCat
        }).populate("category")
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products by price

export async function getAllProductsByPrice(request, response) {
    let productList = [];

    if (request.query.catId !== "" && request.query.catId !== undefined) {
        const productListArr = await ProductModel.find({
            catId: request.query.catId,
        }).populate("category").lean();

        productList = productListArr;
    }

    if (request.query.subCatId !== "" && request.query.subCatId !== undefined) {
        const productListArr = await ProductModel.find({
            subCatId: request.query.subCatId,
        }).populate("category").lean();

        productList = productListArr;
    }


    if (request.query.thirdsubCatId !== "" && request.query.thirdsubCatId !== undefined) {
        const productListArr = await ProductModel.find({
            thirdsubCatId: request.query.thirdsubCatId,
        }).populate("category").lean();

        productList = productListArr;
    }



    const filteredProducts = normalizeProductCategories(productList).filter((product) => {
        if (request.query.minPrice && product.price < parseInt(+request.query.minPrice)) {
            return false;
        }
        if (request.query.maxPrice && product.price > parseInt(+request.query.maxPrice)) {
            return false;
        }
        return true;
    });

    return response.status(200).json({
        error: false,
        success: true,
        products: filteredProducts,
        totalPages: 0,
        page: 0,
    });

}

//get all products by rating

export async function getAllProductsByRating(request, response) {
    try {

        const page = parseInt(request.query.page) || 1;
        const perPage = parseInt(request.query.perPage) || 10000;


        const totalPosts = await ProductModel.countDocuments();
        const totalPages = Math.ceil(totalPosts / perPage);

        if (page > totalPages) {
            return response.status(404).json(
                {
                    message: "Page not found",
                    success: false,
                    error: true
                }
            );
        }

        console.log(request.query.subCatId)

        let products = [];

        if (request.query.catId !== undefined) {

            products = await ProductModel.find({
                rating: request.query.rating,
                catId: request.query.catId,

            }).populate("category")
                .skip((page - 1) * perPage)
                .limit(perPage)
                .lean();
        }

        if (request.query.subCatId !== undefined) {

            products = await ProductModel.find({
                rating: request.query.rating,
                subCatId: request.query.subCatId,

            }).populate("category")
                .skip((page - 1) * perPage)
                .limit(perPage)
                .lean();
        }


        if (request.query.thirdsubCatId !== undefined) {

            products = await ProductModel.find({
                rating: request.query.rating,
                thirdsubCatId: request.query.thirdsubCatId,

            }).populate("category")
                .skip((page - 1) * perPage)
                .limit(perPage)
                .lean();
        }


        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        products = normalizeProductCategories(products);
        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            totalPages: totalPages,
            page: page,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all products count

export async function getProductsCount(request, response) {
    try {
        const productsCount = await ProductModel.countDocuments();

        if (!productsCount) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            productCount: productsCount
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all features products

export async function getAllFeaturedProducts(request, response) {
    try {

        let products = await ProductModel.find({
            isFeatured: true
        }).populate("category").lean();
        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//get all features products have banners

export async function getAllProductsBanners(request, response) {
    try {

        let products = await ProductModel.find({
            isDisplayOnHomeBanner: true
        }).populate("category").lean();
        products = normalizeProductCategories(products);

        if (!products) {
            response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//delete product

export async function deleteProduct(request, response) {

    const product = await ProductModel.findById(request.params.id).populate("category");

    if (!product) {
        return response.status(404).json({
            message: "Product Not found",
            error: true,
            success: false
        })
    }

    const images = product.images;

    let img = "";
    for (img of images) {
        const imgUrl = img;
        const urlArr = imgUrl.split("/");
        const image = urlArr[urlArr.length - 1];

        const imageName = image.split(".")[0];

        if (imageName) {
            cloudinary.uploader.destroy(imageName, (error, result) => {
                // console.log(error, result);
            });
        }


    }

    const deletedProduct = await ProductModel.findByIdAndDelete(request.params.id);

    if (!deletedProduct) {
        response.status(404).json({
            message: "Product not deleted!",
            success: false,
            error: true
        });
    }

    return response.status(200).json({
        success: true,
        error: false,
        message: "Product Deleted!",
    });
}

//delete multiple products

export async function deleteMultipleProduct(request, response) {
    const { ids } = request.body;

    if (!ids || !Array.isArray(ids)) {
        return response.status(400).json({ error: true, success: false, message: 'Invalid input' });
    }


    for (let i = 0; i < ids?.length; i++) {
        const product = await ProductModel.findById(ids[i]);

        const images = product.images;

        let img = "";
        for (img of images) {
            const imgUrl = img;
            const urlArr = imgUrl.split("/");
            const image = urlArr[urlArr.length - 1];

            const imageName = image.split(".")[0];

            if (imageName) {
                cloudinary.uploader.destroy(imageName, (error, result) => {
                    // console.log(error, result);
                });
            }


        }

    }

    try {
        await ProductModel.deleteMany({ _id: { $in: ids } });
        return response.status(200).json({
            message: "Product delete successfully",
            error: false,
            success: true
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }

}

//get single product

export async function getProduct(request, response) {
    try {
        let product = await ProductModel.findById(request.params.id)
            .populate('catId', 'name')
            .populate('subCatId', 'name')
            .populate('thirdsubCatId', 'name')
            .populate('category', 'name')
            .lean();

        if (!product) {
            return response.status(404).json({
                message: "The product is not found",
                error: true,
                success: false
            })
        }

        const [normalized] = normalizeProductCategories([product]);
        product = normalized;

        return response.status(200).json({
            error: false,
            success: true,
            product: product
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//delete images

export async function removeImageFromCloudinary(request, response) {

    const imgUrl = request.query.img;


    const urlArr = imgUrl.split("/");
    const image = urlArr[urlArr.length - 1];

    const imageName = image.split(".")[0];


    if (imageName) {
        const res = await cloudinary.uploader.destroy(
            imageName,
            (error, result) => {
                // console.log(error, res)
            }
        );

        if (res) {
            response.status(200).send(res);
        }
    }
}

//updated product 

export async function updateProduct(request, response) {
    try {
        const catId = request.body.catId;
        const subCatId = request.body.subCatId;
        const thirdsubCatId = request.body.thirdsubCatId;
        if (catId || subCatId || thirdsubCatId) {
            const resolved = await resolveAndValidateCategories(
                catId, subCatId, thirdsubCatId,
                request.body.catName, request.body.subCat, request.body.thirdsubCat
            );
            if (!resolved.valid) {
                return response.status(400).json({
                    message: resolved.error || 'Invalid category hierarchy',
                    error: true,
                    success: false
                });
            }
            request.body.catId = resolved.catId;
            request.body.subCatId = resolved.subCatId;
            request.body.thirdsubCatId = resolved.thirdsubCatId;
            request.body.catName = resolved.catName;
            request.body.subCat = resolved.subCat;
            request.body.thirdsubCat = resolved.thirdsubCat;
            request.body.category = resolved.category;
        }

        const normalizedImages = (Array.isArray(request.body.images) ? request.body.images : [])
            .map((img) => normalizeCloudinaryUrl(img))
            .filter(Boolean);
        const normalizedBannerImages = (Array.isArray(request.body.bannerimages) ? request.body.bannerimages : [])
            .map((img) => normalizeCloudinaryUrl(img))
            .filter(Boolean);
        const computedDiscount = calculateDiscountPercent(request.body.oldPrice, request.body.price);
        const discount = computedDiscount > 0 ? computedDiscount : (Number(request.body.discount) || 0);

        const product = await ProductModel.findByIdAndUpdate(
            request.params.id,
            {
                name: request.body.name,
                description: request.body.description,
                bannerimages: normalizedBannerImages,
                bannerTitleName: request.body.bannerTitleName,
                isDisplayOnHomeBanner: request.body.isDisplayOnHomeBanner,
                images: normalizedImages,
                brand: request.body.brand,
                price: request.body.price,
                oldPrice: request.body.oldPrice,
                catId: request.body.catId,
                catName: request.body.catName,
                subCat: request.body.subCat,
                subCatId: request.body.subCatId,
                category: request.body.category,
                thirdsubCat: request.body.thirdsubCat,
                thirdsubCatId: request.body.thirdsubCatId,
                countInStock: request.body.countInStock,
                rating: request.body.rating,
                isFeatured: request.body.isFeatured,
                discount,
                productRam: request.body.productRam,
                size: request.body.size,
                productWeight: request.body.productWeight,
                specifications: normalizeSpecifications(request.body.specifications),
            },
            { new: true }
        );


        if (!product) {
            return response.status(404).json({
                message: "the product can not be updated!",
                status: false,
            });
        }

        imagesArr = [];

        return response.status(200).json({
            message: "The product is updated",
            error: false,
            success: true
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//createProductRAMS

export async function createProductRAMS(request, response) {
    try {
        let productRAMS = new ProductRAMSModel({
            name: request.body.name
        })

        productRAMS = await productRAMS.save();

        if (!productRAMS) {
            response.status(500).json({
                error: true,
                success: false,
                message: "Product RAMS Not created"
            });
        }

        return response.status(200).json({
            message: "Product RAMS Created successfully",
            error: false,
            success: true,
            product: productRAMS
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//deleteProductRAMS

export async function deleteProductRAMS(request, response) {
    const productRams = await ProductRAMSModel.findById(request.params.id);

    if (!productRams) {
        return response.status(404).json({
            message: "Item Not found",
            error: true,
            success: false
        })
    }

    const deletedProductRams = await ProductRAMSModel.findByIdAndDelete(request.params.id);

    if (!deletedProductRams) {
        response.status(404).json({
            message: "Item not deleted!",
            success: false,
            error: true
        });
    }

    return response.status(200).json({
        success: true,
        error: false,
        message: "Product Ram Deleted!",
    });
}

//updateProductRam

export async function updateProductRam(request, response) {

    try {

        const productRam = await ProductRAMSModel.findByIdAndUpdate(
            request.params.id,
            {
                name: request.body.name,
            },
            { new: true }
        );


        if (!productRam) {
            return response.status(404).json({
                message: "the product Ram can not be updated!",
                status: false,
            });
        }

        return response.status(200).json({
            message: "The product Ram is updated",
            error: false,
            success: true
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }

}

//getProductRams

export async function getProductRams(request, response) {

    try {

        const productRam = await ProductRAMSModel.find();

        if (!productRam) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productRam
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//getProductRamsById

export async function getProductRamsById(request, response) {

    try {

        const productRam = await ProductRAMSModel.findById(request.params.id);

        if (!productRam) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productRam
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//createProductWEIGHT

export async function createProductWEIGHT(request, response) {
    try {
        let productWeight = new ProductWEIGHTModel({
            name: request.body.name
        })

        productWeight = await productWeight.save();

        if (!productWeight) {
            response.status(500).json({
                error: true,
                success: false,
                message: "Product WEIGHT Not created"
            });
        }

        return response.status(200).json({
            message: "Product WEIGHT Created successfully",
            error: false,
            success: true,
            product: productWeight
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//deleteProductWEIGHT

export async function deleteProductWEIGHT(request, response) {
    const productWeight = await ProductWEIGHTModel.findById(request.params.id);

    if (!productWeight) {
        return response.status(404).json({
            message: "Item Not found",
            error: true,
            success: false
        })
    }

    const deletedProductWeight = await ProductWEIGHTModel.findByIdAndDelete(request.params.id);

    if (!deletedProductWeight) {
        response.status(404).json({
            message: "Item not deleted!",
            success: false,
            error: true
        });
    }

    return response.status(200).json({
        success: true,
        error: false,
        message: "Product Weight Deleted!",
    });
}

//updateProductWeight

export async function updateProductWeight(request, response) {

    try {

        const productWeight = await ProductWEIGHTModel.findByIdAndUpdate(
            request.params.id,
            {
                name: request.body.name,
            },
            { new: true }
        );


        if (!productWeight) {
            return response.status(404).json({
                message: "the product weight can not be updated!",
                status: false,
            });
        }

        return response.status(200).json({
            message: "The product weight is updated",
            error: false,
            success: true
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }

}

//getProductWeight

export async function getProductWeight(request, response) {

    try {

        const productWeight = await ProductWEIGHTModel.find();

        if (!productWeight) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productWeight
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//getProductWeightById

export async function getProductWeightById(request, response) {

    try {

        const productWeight = await ProductWEIGHTModel.findById(request.params.id);

        if (!productWeight) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productWeight
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//createProductSize

export async function createProductSize(request, response) {
    try {
        let productSize = new ProductSIZEModel({
            name: request.body.name
        })

        productSize = await productSize.save();

        if (!productSize) {
            response.status(500).json({
                error: true,
                success: false,
                message: "Product size Not created"
            });
        }

        return response.status(200).json({
            message: "Product size Created successfully",
            error: false,
            success: true,
            product: productSize
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//deleteProductSize

export async function deleteProductSize(request, response) {
    const productSize = await ProductSIZEModel.findById(request.params.id);

    if (!productSize) {
        return response.status(404).json({
            message: "Item Not found",
            error: true,
            success: false
        })
    }

    const deletedProductSize = await ProductSIZEModel.findByIdAndDelete(request.params.id);

    if (!deletedProductSize) {
        response.status(404).json({
            message: "Item not deleted!",
            success: false,
            error: true
        });
    }

    return response.status(200).json({
        success: true,
        error: false,
        message: "Product size Deleted!",
    });
}

//updateProductSize

export async function updateProductSize(request, response) {

    try {

        const productSize = await ProductSIZEModel.findByIdAndUpdate(
            request.params.id,
            {
                name: request.body.name,
            },
            { new: true }
        );


        if (!productSize) {
            return response.status(404).json({
                message: "the product size can not be updated!",
                status: false,
            });
        }

        return response.status(200).json({
            message: "The product size is updated",
            error: false,
            success: true
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }

}

//getProductSize

export async function getProductSize(request, response) {

    try {

        const productSize = await ProductSIZEModel.find();

        if (!productSize) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productSize
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//getProductSizeById

export async function getProductSizeById(request, response) {

    try {

        const productSize = await ProductSIZEModel.findById(request.params.id);

        if (!productSize) {
            return response.status(500).json({
                error: true,
                success: false
            })
        }

        return response.status(200).json({
            error: false,
            success: true,
            data: productSize
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

//filters

export async function filters(request, response) {
    const { catId, subCatId, thirdsubCatId, minPrice, maxPrice, rating, page, limit } = request.body;

    const filters = {}

    if (catId?.length) {
        filters.catId = { $in: catId }
    }

    if (subCatId?.length) {
        filters.subCatId = { $in: subCatId }
    }

    if (thirdsubCatId?.length) {
        filters.thirdsubCatId = { $in: thirdsubCatId }
    }

    if (minPrice || maxPrice) {
        filters.price = { $gte: +minPrice || 0, $lte: +maxPrice || Infinity };
    }

    if (rating?.length) {
        filters.rating = { $in: rating }
    }

    try {

        let products = await ProductModel.find(filters).populate("category").skip((page - 1) * limit).limit(parseInt(limit)).lean();
        products = normalizeProductCategories(products);

        const total = await ProductModel.countDocuments(filters);

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            total: total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit)
        })

    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }


}

// Sort function

const sortItems = (products, sortBy, order) => {
    return products.sort((a, b) => {
        if (sortBy === 'name') {
            return order === 'asc'
                ? a.name.localeCompare(b.name)
                : b.name.localeCompare(a.name);
        }
        if (sortBy === 'price') {
            return order === 'asc' ? a.price - b.price : b.price - a.price;
        }
        return 0; // Default
    });
};

// sortBy

export async function sortBy(request, response) {
    const { products, sortBy, order } = request.body;
    const sortedItems = sortItems([...products?.products], sortBy, order);
    return response.status(200).json({
        error: false,
        success: true,
        products: sortedItems,
        totalPages: 0,
        page: 0,
    });
}

// import products from JSON

function parseCsvText(content) {
    const rows = [];
    let row = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const next = content[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            i++;
            continue;
        }

        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(current);
            current = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') {
                i++;
            }

            row.push(current);
            rows.push(row);
            row = [];
            current = '';
            continue;
        }

        current += char;
    }

    if (current.length || row.length) {
        row.push(current);
        rows.push(row);
    }

    return rows;
}

async function parseCsvUpload(filePath, updateExisting) {
    const fileBuffer = await fs.promises.readFile(filePath);

    if (fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b) {
        throw new Error('Uploaded file is not a CSV. The selected file appears to be an XLSX workbook. Save or export it as a real CSV first.');
    }

    const parserModule = await import('csv-parser').catch(() => null);
    if (parserModule?.default) {
        return await new Promise((resolve, reject) => {
            const headers = [];
            const rows = [];
            let validated = false;
            const stream = fs.createReadStream(filePath);
            const parser = parserModule.default({
                mapHeaders: ({ header }) => canonicalizeImportHeader(header),
            });

            parser.on('headers', (parsedHeaders) => {
                headers.push(...parsedHeaders);
                const validation = validateImportHeaders(parsedHeaders, updateExisting);
                validated = true;

                if (!validation.valid) {
                    reject(new Error(validation.message));
                    stream.destroy();
                }
            });

            parser.on('data', (rowData) => {
                const hasValue = Object.values(rowData || {}).some((value) => String(value || '').trim() !== '');
                if (hasValue) {
                    rows.push(rowData);
                }
            });

            parser.on('end', () => {
                if (!validated) {
                    return reject(new Error('CSV headers could not be read.'));
                }

                resolve({ headers, rows });
            });

            parser.on('error', (error) => {
                reject(error);
            });

            stream.on('error', (error) => {
                reject(error);
            });

            stream.pipe(parser);
        });
    }

    const content = fileBuffer.toString('utf8').replace(/^\uFEFF/, '');
    const parsedRows = parseCsvText(content);
    if (!parsedRows.length) {
        throw new Error('CSV file is empty or malformed.');
    }

    const [rawHeaders, ...dataRows] = parsedRows;
    const headers = rawHeaders.map((header) => canonicalizeImportHeader(header));
    const validation = validateImportHeaders(headers, updateExisting);
    if (!validation.valid) {
        throw new Error(validation.message);
    }

    const rows = dataRows
        .map((cells) => {
            const rowData = {};
            headers.forEach((header, index) => {
                rowData[header] = cells[index] ?? '';
            });
            return rowData;
        })
        .filter((rowData) => Object.values(rowData).some((value) => String(value || '').trim() !== ''));

    return { headers, rows };
}

// Parse AED price strings like "2,016.00 AED" to number
function parseAED(s) {
    if (s == null || typeof s !== 'string') return 0;
    const n = parseFloat(String(s).replace(/,/g, '').replace(/\s*AED\s*$/i, '').trim());
    return isNaN(n) ? 0 : n;
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

// Convert tareeqalraha JSON item (array of {key:value}) to flat object; collect "additional image link" as array
function parseTareeqalrahaItem(arr) {
    const flat = {};
    const multiKeys = { 'additional image link': true };
    for (const obj of arr || []) {
        if (!obj || typeof obj !== 'object') continue;
        for (const [k, v] of Object.entries(obj)) {
            if (v === undefined || v === null) continue;
            const val = typeof v === 'string' ? String(v).trim() : v;
            if (val === '') continue;
            if (multiKeys[k]) {
                if (!Array.isArray(flat[k])) flat[k] = [];
                flat[k].push(val);
            } else {
                flat[k] = val;
            }
        }
    }
    return flat;
}

// Parse "CATEGORY > SubCategory" or "CATEGORY > Sub > Third" into catName, subCat, thirdsubCat
function parseProductType(productType) {
    if (!productType || typeof productType !== 'string') return { catName: '', subCat: '', thirdsubCat: '' };
    const parts = productType.split(/\s*>\s*/).map((s) => s.trim()).filter(Boolean);
    return {
        catName: parts[0] || '',
        subCat: parts[1] || '',
        thirdsubCat: parts[2] || '',
    };
}

// Map flat tareeqalraha object to Product model document
function mapTareeqalrahaToProduct(flat) {
    const mainImg = flat['image link'] || '';
    const extraImgs = Array.isArray(flat['additional image link']) ? flat['additional image link'].filter(Boolean) : [];
    let images = [mainImg, ...extraImgs].filter(Boolean).map((url) => normalizeCloudinaryUrl(url));
    if (!images.length) images = ['https://via.placeholder.com/300?text=No+Image'];

    const originalPrice = parseAED(flat['price']);
    const salePrice = parseAED(flat['sale price']);
    const hasSale = salePrice > 0 && salePrice < originalPrice;
    const priceVal = hasSale ? salePrice : originalPrice;
    const oldPriceVal = hasSale ? originalPrice : originalPrice;
    const discountVal = calculateDiscountPercent(oldPriceVal, priceVal);

    const { catName, subCat, thirdsubCat } = parseProductType(flat['product type']);

    return {
        name: flat['title'] || flat['id'] || 'Untitled',
        description: flat['description'] || '',
        images,
        bannerimages: [images[0]],
        bannerTitleName: '',
        isDisplayOnHomeBanner: false,
        brand: flat['brand'] || '',
        price: priceVal,
        oldPrice: oldPriceVal,
        catName,
        catId: '',
        subCatId: '',
        subCat,
        thirdsubCat,
        thirdsubCatId: '',
        category: undefined,
        countInStock: (String(flat['availability'] || '').toLowerCase() === 'in_stock') ? 1 : 0,
        rating: 0,
        isFeatured: false,
        discount: discountVal,
        sale: 0,
        productRam: [],
        size: [],
        productWeight: [],
    };
}

export async function importTareeqalraha(request, response) {
    try {
        const { data } = request.body;
        if (!data || !Array.isArray(data)) {
            return response.status(400).json({
                error: true,
                success: false,
                message: 'Invalid input: data array (tareeqalraha JSON) is required'
            });
        }

        const toInsert = [];
        const errors = [];
        const BATCH = 150;

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!Array.isArray(row)) {
                errors.push({ index: i, message: 'Expected array of {key:value} objects' });
                continue;
            }
            const flat = parseTareeqalrahaItem(row);
            const name = flat['title'] || flat['id'];
            if (!name) {
                errors.push({ index: i, message: 'Missing title/id' });
                continue;
            }
            toInsert.push(mapTareeqalrahaToProduct(flat));
        }

        if (toInsert.length === 0) {
            return response.status(400).json({
                error: true,
                success: false,
                message: 'No valid products to import',
                errors: errors.length ? errors : undefined
            });
        }

        let imported = 0;
        for (let i = 0; i < toInsert.length; i += BATCH) {
            const chunk = toInsert.slice(i, i + BATCH);
            const res = await ProductModel.insertMany(chunk);
            imported += res.length;
        }

        return response.status(200).json({
            error: false,
            success: true,
            message: `Successfully imported ${imported} product(s) from tareeqalraha.json. Images use original URLs.`,
            imported,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (err) {
        return response.status(500).json({
            message: err.message || 'Import failed',
            error: true,
            success: false
        });
    }
}

/** Export products to CSV (tareeqalraha.csv) */
export async function exportProducts(request, response) {
    try {
        const columns = request.query.columns
            ? request.query.columns.split(',').map((c) => c.trim()).filter(Boolean)
            : undefined;
        const productTypes = request.query.productTypes
            ? request.query.productTypes.split(',').map((t) => t.trim()).filter(Boolean)
            : undefined;
        const catId = request.query.catId || undefined;
        const subCatId = request.query.subCatId || undefined;
        const thirdSubCatId = request.query.thirdSubCatId || undefined;
        const productIds = request.query.productIds
            ? request.query.productIds.split(',').map((id) => id.trim()).filter(Boolean)
            : undefined;

        const result = await exportProductsToCsv({
            columns,
            productTypes,
            catId,
            subCatId,
            thirdSubCatId,
            productIds,
        });

        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="tareeqalraha.csv"');
        response.send(result.csv);
    } catch (err) {
        response.status(500).json({
            error: true,
            success: false,
            message: err.message || 'Export failed',
        });
    }
}

export async function importProducts(request, response) {
    let uploadedFilePath = null;

    try {
        const updateExisting = String(request.body?.updateExisting || '').toLowerCase() === 'true' || request.body?.updateExisting === true;
        uploadedFilePath = request.file?.path || null;
        const productsInput = request.body?.products;

        if (uploadedFilePath) {
            const { rows } = await parseCsvUpload(uploadedFilePath, updateExisting);

            if (!rows.length) {
                return response.status(400).json({
                    error: true,
                    success: false,
                    message: 'No products found in the uploaded CSV.',
                });
            }

            const result = await importProductsService(rows, updateExisting);

            if (!result.success && result.created === 0 && result.updated === 0) {
                return response.status(400).json({
                    error: true,
                    success: false,
                    message: result.message || 'No products imported.',
                    created: result.created,
                    updated: result.updated,
                    failed: result.failed,
                    errors: result.errors,
                });
            }

            return response.status(200).json({
                error: false,
                success: true,
                message: result.message,
                imported: result.created + result.updated,
                created: result.created,
                updated: result.updated,
                failed: result.failed,
                errors: result.errors,
            });
        }

        if (!request.file && (productsInput === undefined || productsInput === null)) {
            return response.status(400).json({
                error: true,
                success: false,
                message: 'File not found. Upload a CSV file in the "file" field or provide a products array.',
            });
        }

        if (!Array.isArray(productsInput)) {
            return response.status(400).json({
                error: true,
                success: false,
                message: 'Request body must include "products" array when no CSV file is uploaded.',
            });
        }

        const result = await importProductsService(productsInput, updateExisting);

        if (!result.success && result.created === 0 && result.updated === 0) {
            return response.status(400).json({
                error: true,
                success: false,
                message: result.message || 'No products imported.',
                created: result.created,
                updated: result.updated,
                failed: result.failed,
                errors: result.errors,
            });
        }

        return response.status(200).json({
            error: false,
            success: true,
            message: result.message,
            imported: result.created + result.updated,
            created: result.created,
            updated: result.updated,
            failed: result.failed,
            errors: result.errors,
        });
    } catch (err) {
        const message = err.message || 'Import failed';
        const isValidationError = /csv|column|header|uploaded file|malformed|invalid csv format|file not found|no products found/i.test(message.toLowerCase());
        return response.status(isValidationError ? 400 : 500).json({
            message,
            error: true,
            success: false,
        });
    } finally {
        if (uploadedFilePath) {
            await fs.promises.unlink(uploadedFilePath).catch(() => null);
        }
    }
}

// searchProductController

export async function searchProductController(request, response) {
    try {

        const {query, page, limit } = request.body;

        if (!query) {
            return response.status(400).json({
                error: true,
                success: false,
                message: "Query is required"
            });
        }


        let products = await ProductModel.find({
            $or: [
                { name: { $regex: query, $options: "i" } },
                { brand: { $regex: query, $options: "i" } },
                { catName: { $regex: query, $options: "i" } },
                { subCat: { $regex: query, $options: "i" } },
                { thirdsubCat: { $regex: query, $options: "i" } },
            ],
        }).populate("category").lean()

        products = normalizeProductCategories(products);

        const total = await products?.length

        return response.status(200).json({
            error: false,
            success: true,
            products: products,
            total: 1,
            page: parseInt(page),
            totalPages: 1
        })


    } catch (error) {
        return response.status(500).json({
            message: error.message || error,
            error: true,
            success: false
        })
    }
}

// Build category lookup for sync (by ID and by path)
async function buildCategoryLookupForSync() {
    const all = await CategoryModel.find().lean();
    const byId = {};
    const byPath = {};
    all.forEach((c) => { byId[c._id.toString()] = c; });
    all.filter((c) => !c.parentId).forEach((c) => {
        byPath[c.name.trim().toLowerCase()] = c;
    });
    all.filter((c) => c.parentId).forEach((c) => {
        const parent = byId[(c.parentId || {}).toString?.() || c.parentId];
        if (!parent) return;
        const parentName = parent.name.trim().toLowerCase();
        const cName = c.name.trim().toLowerCase();
        if (!parent.parentId) {
            byPath[`${parentName}>${cName}`] = c;
        } else {
            const grandParent = byId[(parent.parentId || {}).toString?.() || parent.parentId];
            if (grandParent) {
                const gpName = grandParent.name.trim().toLowerCase();
                byPath[`${gpName}>${parentName}>${cName}`] = c;
            }
        }
    });
    return { byId, byPath };
}

function resolveCategoryByNames(catName, subCat, thirdsubCat, byPath, byId) {
    const n = (v) => (v || '').trim().toLowerCase();
    const cat = n(catName), sub = n(subCat), third = n(thirdsubCat);
    if (third && sub && cat) {
        const key = `${cat}>${sub}>${third}`;
        const found = byPath[key];
        if (found) {
            const parent = byId[(found.parentId || {}).toString?.() || found.parentId];
            const grandParent = parent && parent.parentId ? byId[(parent.parentId || {}).toString?.() || parent.parentId] : null;
            return { catId: grandParent?._id, subCatId: parent?._id, thirdsubCatId: found._id, catName: grandParent?.name ?? catName, subCat: parent?.name ?? subCat, thirdsubCat: found.name, category: found._id };
        }
    }
    if (sub && cat) {
        const key = `${cat}>${sub}`;
        const found = byPath[key];
        if (found) {
            const parent = byPath[cat];
            return { catId: parent?._id, subCatId: found._id, thirdsubCatId: null, catName: parent?.name ?? catName, subCat: found.name, thirdsubCat: thirdsubCat || '', category: found._id };
        }
    }
    if (cat) {
        const found = byPath[cat];
        if (found) return { catId: found._id, subCatId: null, thirdsubCatId: null, catName: found.name, subCat: subCat || '', thirdsubCat: thirdsubCat || '', category: found._id };
    }
    return null;
}

// syncProductCategories: backfill catName, subCat, thirdsubCat and ObjectId refs from Category
export async function syncProductCategories(request, response) {
    try {
        const { byId, byPath } = await buildCategoryLookupForSync();
        const products = await ProductModel.find().lean();
        let updated = 0;

        const toStr = (id) => (id == null ? '' : (typeof id === 'string' ? id : (id && id.toString ? id.toString() : '')));

        for (const p of products) {
            let update = {};

            const thirdStr = toStr(p.thirdsubCatId);
            const subStr = toStr(p.subCatId);
            const catStr = toStr(p.catId);

            if (thirdStr && byId[thirdStr]) {
                const third = byId[thirdStr];
                update.thirdsubCat = third.name;
                update.thirdsubCatId = third._id;
                update.category = third._id;
                const sub = third.parentId && byId[(third.parentId || {}).toString?.() || third.parentId];
                if (sub) {
                    update.subCat = sub.name;
                    update.subCatId = sub._id;
                    const cat = sub.parentId && byId[(sub.parentId || {}).toString?.() || sub.parentId];
                    if (cat) {
                        update.catName = cat.name;
                        update.catId = cat._id;
                    }
                }
            } else if (subStr && byId[subStr]) {
                const sub = byId[subStr];
                update.subCat = sub.name;
                update.subCatId = sub._id;
                update.category = sub._id;
                const cat = sub.parentId && byId[(sub.parentId || {}).toString?.() || sub.parentId];
                if (cat) {
                    update.catName = cat.name;
                    update.catId = cat._id;
                }
            } else if (catStr && byId[catStr]) {
                const cat = byId[catStr];
                update.catName = cat.name;
                update.catId = cat._id;
                update.category = cat._id;
            } else if (p.catName || p.subCat || p.thirdsubCat) {
                const resolved = resolveCategoryByNames(p.catName, p.subCat, p.thirdsubCat, byPath, byId);
                if (resolved) update = resolved;
            }

            if (Object.keys(update).length > 0) {
                await ProductModel.updateOne({ _id: p._id }, { $set: update });
                updated++;
            }
        }

        return response.status(200).json({
            error: false,
            success: true,
            message: `Synced category names and IDs for ${updated} product(s).`,
            updated,
        });
    } catch (err) {
        return response.status(500).json({
            message: err.message || 'Sync failed',
            error: true,
            success: false,
        });
    }
}

