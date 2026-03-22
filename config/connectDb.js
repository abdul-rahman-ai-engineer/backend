import mongoose from "mongoose";
import dotenv from 'dotenv'
import dns from 'node:dns';

dotenv.config()

// Force IPv4 DNS resolution to avoid timeout issues
dns.setDefaultResultOrder('ipv4first');

// Set custom DNS timeout
dns.setServers(['8.8.8.8', '8.8.4.4']); // Use Google DNS as fallback

if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined in environment variables")
}

async function connectDB() {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            console.log(`Attempting to connect to MongoDB... (Attempt ${retryCount + 1}/${maxRetries})`);

            const options = {
                serverSelectionTimeoutMS: 60000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 60000,
                retryWrites: true,
                w: 'majority'
            };

            await mongoose.connect(process.env.MONGODB_URI, options);
            console.log("✅ MongoDB connected successfully");
            return; // Success, exit function
        } catch (error) {
            retryCount++;
            console.error(`❌ MongoDB connection error (Attempt ${retryCount}/${maxRetries}):`, error.message);

            if (error.code === 'ETIMEOUT' || error.message.includes('ETIMEOUT')) {
                if (retryCount < maxRetries) {
                    console.log(`⏳ Retrying in 2 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                } else {
                    console.error("\n⚠️  DNS lookup timeout after multiple attempts.");
                    console.error("\n🔧 Solutions to try:");
                    console.error("1. Check your .env file - verify MONGODB_URI format:");
                    console.error("   mongodb+srv://username:password@cluster0.l21yukb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0");
                    console.error("2. Ensure hostname uses lowercase 'l' not '1': cluster0.l21yukb.mongodb.net");
                    console.error("3. Check Windows Firewall - allow Node.js through firewall");
                    console.error("4. Try different DNS servers or restart your router");
                    console.error("5. Temporarily disable VPN/proxy if active");
                    console.error("6. Try using mobile hotspot to test if it's network-specific");
                }
            } else {
                // Non-timeout error, don't retry
                console.error("❌ Connection failed:", error.message);
            }
            process.exit(1);
        }
    }
}

export default connectDB;



