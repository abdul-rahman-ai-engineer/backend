import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config()


if (!process.env.MONGODB_URI) {
    throw new Error(
        "http://localhost:8000"
    )
}

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI)
        console.log("connect DB")
    } catch (error) {
        console.log("Mongodb connect error", error)
        process.exit(1);
    }
}

export default connectDB;