import mongoose from "mongoose";

const connectDB = async () => {
  try {
    console.log("MONGODB_URI =", process.env.MONGODB_URI);

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connect error:", error);
    process.exit(1);
  }
};

export default connectDB;
