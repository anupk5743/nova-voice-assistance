import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
    try {
        // There is no direct listModels method in the JS SDK? 
        // Actually there is usually strictly via REST or specific calls.
        // We'll just try to instantiate a few and generate.

        const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];

        for (const modelName of models) {
            process.stdout.write(`Testing ${modelName}... `);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hi");
                console.log("OK");
            } catch (e) {
                console.log("FAILED: " + e.message);
            }
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
