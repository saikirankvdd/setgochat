require('dotenv').config();
const mongoose = require('mongoose');

async function testConnection() {
    try {
        console.log("Attempting to connect to:", process.env.MONGODB_URI.replace(/:([^:@]+)@/, ':***@'));
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log("SUCCESS! Connected to MongoDB locally.");
        process.exit(0);
    } catch (e) {
        console.error("FAILED to connect locally:");
        console.error(e.message);
        process.exit(1);
    }
}
testConnection();
