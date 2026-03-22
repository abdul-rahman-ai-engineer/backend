import mongoose from 'mongoose';

const productAttributeSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            default: '',
            trim: true,
        },
        value: {
            type: String,
            default: '',
        },
    },
    { _id: false }
);

const productSchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    sku: {
        type: String,
        default: '',
    },
    product_id: {
        type: String,
        default: '',
    },
    description: {
        type: String,
        required: true
    },
    shortDescription: {
        type: String,
        default: ''
    },
    images: [
        {
            type: String,
            required: true
        }
    ],
    brand: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        default: 0
    },
    oldPrice: {
        type: Number,
        default: 0
    },
    catName:{
        type:String,
        default:''
    },
    catId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    subCatId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    subCat:{
        type:String,
        default:''
    },
    thirdsubCat:{
        type:String,
        default:''
    },
    thirdsubCatId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    countInStock: {
        type: Number,
        required: true,
    },
    rating: {
        type: Number,
        default: 0,
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    discount: {
        type: Number,
        required: true,
    },
    sale: {
        type: Number,
        default:0
    },
    productRam: [
        {
            type: String,
            default: null,
        }
    ],
    size: [
        {
            type: String,
            default: null,
        }
    ],
    productWeight: [
        {
            type: String,
            default: null,
        }
    ],
    attributes: {
        type: [productAttributeSchema],
        default: [],
    },
    specifications: [
        {
            name: { type: String, default: '' },
            values: { type: [String], default: [] },
            visible: { type: Boolean, default: true },
            scope: { type: String, enum: ['global', 'custom'], default: 'custom' }
        }
    ],
    bannerimages: [
        {
            type: String,
            required: true
        }
    ],
    bannerTitleName: {
        type: String,
        default: '',
    },
    isDisplayOnHomeBanner: {
        type: Boolean,
        default: false,
    },
},{
    timestamps : true
});


const ProductModel = mongoose.model('Product',productSchema)

export default ProductModel
